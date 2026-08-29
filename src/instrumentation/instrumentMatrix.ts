import {
  type AnyNode,
  type AssignmentExpression,
  type Expression,
  type ExpressionStatement,
  type Identifier,
  type IfStatement,
  type Program,
  type VariableDeclaration,
} from 'acorn';

import {
  hasUnsafeInstrumentationSyntax,
  isFiniteNumericLiteral,
  isIdentifierReference,
  isProgramOrBlockStatement,
  isRootWrite,
  isRootedInvocation,
  isSupportedIndexExpression,
  sameSupportedIndexExpression,
  sourceLine,
  walkAst,
} from './ast';
import {
  applySourceEdits,
  expressionSource,
  lineIndentation,
  type SourceEdit,
} from './edits';

type MatrixCell = {
  readonly row: Expression;
  readonly column: Expression;
};

type MatrixCellSyntax = {
  readonly root: Identifier;
  readonly cell: MatrixCell;
};

type MatrixSwap = {
  readonly kind: 'swap';
  readonly statement: ExpressionStatement;
  readonly mutation: AssignmentExpression;
  readonly cells: readonly [MatrixCell, MatrixCell];
  readonly line: number;
};

type MatrixComparison = {
  readonly kind: 'compare';
  readonly statement: IfStatement;
  readonly cells: readonly [MatrixCell, MatrixCell];
  readonly line: number;
};

type MatrixSet = {
  readonly kind: 'set';
  readonly statement: ExpressionStatement;
  readonly mutation: AssignmentExpression;
  readonly cell: MatrixCell;
  readonly line: number;
};

type MatrixOperation = MatrixSwap | MatrixComparison | MatrixSet;

type MatrixCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly operations: readonly MatrixOperation[];
};

const COMPARISON_OPERATORS = new Set(['<', '<=', '>', '>=', '===', '!==']);
const ARITHMETIC_OPERATORS = new Set(['+', '-', '*', '/', '%', '**']);

export function instrumentMatrix(
  source: string,
  program: Program,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const candidates = findMatrixDeclarations(program)
    .map((declaration) => analyzeMatrix(program, declaration))
    .filter((candidate): candidate is MatrixCandidate => candidate !== null);

  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  if (candidate === undefined) return null;

  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text: `;\ntrace.initialize({ structure: 'matrix', source: { line: ${candidate.declarationLine} } });\ntrace.createMatrix({ values: ${candidate.root}, source: { line: ${candidate.declarationLine} } });\n`,
    },
    ...candidate.operations.map((operation) =>
      operationEdit(source, operation, candidate.root),
    ),
  ];

  return applySourceEdits(source, edits);
}

function analyzeMatrix(
  program: Program,
  declaration: VariableDeclaration,
): MatrixCandidate | null {
  const declarator = declaration.declarations[0];
  if (declarator?.id.type !== 'Identifier') return null;

  const root = declarator.id.name;
  const declarationLine = sourceLine(declaration);
  if (declarationLine === null) return null;

  const operations: MatrixOperation[] = [];

  walkAst(program, (node, parent, grandparent, insideUnsupportedScope) => {
    if (insideUnsupportedScope) return;

    const swap = matchMatrixSwap(node, parent, grandparent, root);
    if (swap !== null) {
      operations.push(swap);
      return;
    }

    const comparison = matchMatrixComparison(node, parent, root);
    if (comparison !== null) operations.push(comparison);

    const set = matchMatrixSet(node, parent, grandparent, root);
    if (set !== null) operations.push(set);
  });

  if (
    operations.length === 0 ||
    operations.some(
      (operation) => operation.statement.start < declaration.end,
    ) ||
    hasUnsafeMatrixUsage(program, declaration, operations, root)
  ) {
    return null;
  }

  return { declaration, declarationLine, root, operations };
}

function matchMatrixSwap(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  root: string,
): MatrixSwap | null {
  if (
    node.type !== 'AssignmentExpression' ||
    node.operator !== '=' ||
    parent?.type !== 'ExpressionStatement' ||
    !isProgramOrBlockStatement(grandparent) ||
    node.left.type !== 'ArrayPattern' ||
    node.right.type !== 'ArrayExpression' ||
    node.left.elements.length !== 2 ||
    node.right.elements.length !== 2
  ) {
    return null;
  }

  const [leftFirstNode, leftSecondNode] = node.left.elements;
  const [rightFirstNode, rightSecondNode] = node.right.elements;
  const leftFirst = matchMatrixCell(leftFirstNode, root);
  const leftSecond = matchMatrixCell(leftSecondNode, root);
  const rightFirst = matchMatrixCell(rightFirstNode, root);
  const rightSecond = matchMatrixCell(rightSecondNode, root);
  const line = sourceLine(node);

  if (
    leftFirst === null ||
    leftSecond === null ||
    rightFirst === null ||
    rightSecond === null ||
    line === null ||
    !sameCell(leftFirst, rightSecond) ||
    !sameCell(leftSecond, rightFirst)
  ) {
    return null;
  }

  return {
    kind: 'swap',
    statement: parent,
    mutation: node,
    cells: [leftFirst, leftSecond],
    line,
  };
}

function matchMatrixComparison(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): MatrixComparison | null {
  if (
    node.type !== 'IfStatement' ||
    !isProgramOrBlockStatement(parent) ||
    node.test.type !== 'BinaryExpression' ||
    !COMPARISON_OPERATORS.has(node.test.operator)
  ) {
    return null;
  }

  const left = matchMatrixCell(node.test.left, root);
  const right = matchMatrixCell(node.test.right, root);
  const line = sourceLine(node.test);

  if (left === null || right === null || line === null) return null;

  return {
    kind: 'compare',
    statement: node,
    cells: [left, right],
    line,
  };
}

function matchMatrixSet(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  root: string,
): MatrixSet | null {
  if (
    node.type !== 'AssignmentExpression' ||
    node.operator !== '=' ||
    parent?.type !== 'ExpressionStatement' ||
    !isProgramOrBlockStatement(grandparent)
  ) {
    return null;
  }

  const cell = matchMatrixCell(node.left, root);
  const line = sourceLine(node);

  if (
    cell === null ||
    line === null ||
    !isSupportedMatrixValue(node.right, root)
  ) {
    return null;
  }

  return {
    kind: 'set',
    statement: parent,
    mutation: node,
    cell,
    line,
  };
}

function findMatrixDeclarations(program: Program): VariableDeclaration[] {
  return program.body.filter(
    (statement): statement is VariableDeclaration =>
      statement.type === 'VariableDeclaration' &&
      statement.kind === 'const' &&
      statement.declarations.length === 1 &&
      statement.declarations[0]?.id.type === 'Identifier' &&
      isSupportedInitialMatrix(statement.declarations[0].init),
  );
}

function isSupportedInitialMatrix(
  expression: Expression | null | undefined,
): boolean {
  if (
    expression?.type !== 'ArrayExpression' ||
    expression.elements.length === 0
  ) {
    return false;
  }

  const rows = expression.elements;
  const firstRow = rows[0];
  if (firstRow?.type !== 'ArrayExpression' || firstRow.elements.length === 0) {
    return false;
  }

  const columns = firstRow.elements.length;
  return rows.every(
    (row) =>
      row?.type === 'ArrayExpression' &&
      row.elements.length === columns &&
      row.elements.every(isFiniteNumericLiteral),
  );
}

function matchMatrixCell(
  node: AnyNode | null | undefined,
  root: string,
): MatrixCell | null {
  const syntax = matrixCellSyntax(node);
  return syntax?.root.name === root ? syntax.cell : null;
}

function matrixCellSyntax(
  node: AnyNode | null | undefined,
): MatrixCellSyntax | null {
  if (
    node?.type !== 'MemberExpression' ||
    !node.computed ||
    node.optional ||
    node.property.type === 'PrivateIdentifier' ||
    node.object.type !== 'MemberExpression' ||
    !node.object.computed ||
    node.object.optional ||
    node.object.object.type !== 'Identifier' ||
    node.object.property.type === 'PrivateIdentifier' ||
    !isSupportedIndexExpression(node.object.property) ||
    !isSupportedIndexExpression(node.property)
  ) {
    return null;
  }

  return {
    root: node.object.object,
    cell: {
      row: node.object.property,
      column: node.property,
    },
  };
}

function sameCell(left: MatrixCell, right: MatrixCell): boolean {
  return (
    sameSupportedIndexExpression(left.row, right.row) &&
    sameSupportedIndexExpression(left.column, right.column)
  );
}

function isSupportedMatrixValue(expression: Expression, root: string): boolean {
  if (isFiniteNumericLiteral(expression)) return true;
  if (matchMatrixCell(expression, root) !== null) return true;
  if (isMatrixCellRead(expression)) return true;
  if (expression.type === 'UnaryExpression') {
    return (
      (expression.operator === '+' || expression.operator === '-') &&
      isSupportedMatrixValue(expression.argument, root)
    );
  }
  if (
    expression.type !== 'BinaryExpression' ||
    !ARITHMETIC_OPERATORS.has(expression.operator) ||
    expression.left.type === 'PrivateIdentifier'
  ) {
    return false;
  }

  return (
    isSupportedMatrixValue(expression.left, root) &&
    isSupportedMatrixValue(expression.right, root)
  );
}

function isMatrixCellRead(expression: Expression): boolean {
  return matrixCellSyntax(expression) !== null;
}

function hasUnsafeMatrixUsage(
  program: Program,
  declaration: VariableDeclaration,
  operations: readonly MatrixOperation[],
  root: string,
): boolean {
  const supportedMutations = new Set<AnyNode>(
    operations.flatMap((operation) =>
      operation.kind === 'swap' || operation.kind === 'set'
        ? [operation.mutation]
        : [],
    ),
  );
  let unsafe = false;

  walkAst(program, (node, parent, grandparent) => {
    if (
      isRootedInvocation(node, root) ||
      (isRootWrite(node, root) && !supportedMutations.has(node)) ||
      (isIdentifierReference(node, parent, root) &&
        !isSafeMatrixReference(node, parent, grandparent, declaration))
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

function isSafeMatrixReference(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  declaration: VariableDeclaration,
): boolean {
  return (
    node === declaration.declarations[0]?.id ||
    (parent?.type === 'MemberExpression' &&
      parent.object === node &&
      ((!parent.computed &&
        parent.property.type === 'Identifier' &&
        parent.property.name === 'length') ||
        (parent.computed &&
          grandparent?.type === 'MemberExpression' &&
          grandparent.object === parent &&
          (grandparent.computed ||
            (grandparent.property.type === 'Identifier' &&
              grandparent.property.name === 'length')))))
  );
}

function operationEdit(
  source: string,
  operation: MatrixOperation,
  root: string,
): SourceEdit {
  const indentation = lineIndentation(source, operation.statement.start);

  if (operation.kind === 'compare') {
    const [left, right] = operation.cells;
    return {
      start: operation.statement.start,
      end: operation.statement.start,
      text: `trace.compare({ positions: [{ row: ${expressionSource(source, left.row)}, column: ${expressionSource(source, left.column)} }, { row: ${expressionSource(source, right.row)}, column: ${expressionSource(source, right.column)} }], source: { line: ${operation.line} } });\n${indentation}`,
    };
  }

  if (operation.kind === 'swap') {
    const [first, second] = operation.cells;

    return {
      start: operation.statement.end,
      end: operation.statement.end,
      text: `;\n${indentation}trace.swap({ positions: [{ row: ${expressionSource(source, first.row)}, column: ${expressionSource(source, first.column)} }, { row: ${expressionSource(source, second.row)}, column: ${expressionSource(source, second.column)} }], source: { line: ${operation.line} } });\n`,
    };
  }

  const row = expressionSource(source, operation.cell.row);
  const column = expressionSource(source, operation.cell.column);
  return {
    start: operation.statement.end,
    end: operation.statement.end,
    text: `;\n${indentation}trace.set({ position: { row: ${row}, column: ${column} }, value: ${root}[${row}][${column}], source: { line: ${operation.line} } });\n`,
  };
}
