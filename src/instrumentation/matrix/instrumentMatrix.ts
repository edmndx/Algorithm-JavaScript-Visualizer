import {
  type AnyNode,
  type MemberExpression,
  type VariableDeclaration,
} from 'acorn';

import {
  hasUnsafeInstrumentationSyntax,
  isDirectConsoleArgument,
  isIdentifierReference,
  isRootWrite,
  isRootedInvocation,
  sourceLine,
  walkAst,
} from '../ast';
import {
  applySourceEdits,
  expressionSource,
  lineIndentation,
  type SourceEdit,
} from '../edits';
import {
  isSupportedInitialMatrix,
  matchMatrixComparison,
  matchMatrixMark,
  matchMatrixSet,
  matchMatrixSwap,
  matrixCellSyntax,
  type MatrixMark,
  type MatrixOperation,
} from './matrixMatchers';
import {
  hasSafePrimaryRootUsage,
  primaryOperationBindings,
  type PrimaryOperationBinding,
  type ValidVisualizationSource,
} from '../sourceContract';

type MatrixCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly initialRoot: string;
  readonly root: string;
  readonly operations: readonly MatrixOperation[];
};

export function instrumentMatrix(
  source: string,
  contract: ValidVisualizationSource,
): string | null {
  const { program } = contract;
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  if (!isSupportedInitialMatrix(contract.declaration.declarations[0]?.init)) {
    return null;
  }
  const declaration = contract.declaration;

  const candidates = primaryOperationBindings(contract)
    .map((binding) => analyzeMatrix(contract, declaration, binding))
    .filter((candidate): candidate is MatrixCandidate => candidate !== null);

  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  if (candidate === undefined) return null;

  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text: `;\ntrace.initialize({ structure: 'matrix', context: { input: { kind: 'grid', values: ${candidate.initialRoot} } }, source: { line: ${candidate.declarationLine} } });\ntrace.createMatrix({ values: ${candidate.initialRoot}, source: { line: ${candidate.declarationLine} } });\ntrace.region({ start: { row: 0, column: 0 }, end: { row: ${candidate.initialRoot}.length - 1, column: ${candidate.initialRoot}[0].length - 1 }, source: { line: ${candidate.declarationLine} } });\n`,
    },
    ...candidate.operations.map((operation) =>
      operationEdit(source, operation, candidate.root),
    ),
  ];

  return applySourceEdits(source, edits);
}

function analyzeMatrix(
  contract: ValidVisualizationSource,
  declaration: VariableDeclaration,
  binding: PrimaryOperationBinding,
): MatrixCandidate | null {
  const root = binding.root;
  const declarationLine = sourceLine(declaration);
  if (declarationLine === null) return null;

  const operations: MatrixOperation[] = [];

  walkAst(
    binding.scope.body,
    (node, parent, grandparent, insideUnsupportedScope) => {
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

      const mark = matchMatrixMark(node, parent, grandparent, root);
      if (mark !== null) operations.push(mark);
    },
  );

  if (
    operations.length === 0 ||
    operations.some(
      (operation) => operation.statement.start < declaration.end,
    ) ||
    !hasSafePrimaryRootUsage(contract, binding) ||
    hasUnsafeMatrixUsage(binding.scope.body, declaration, operations, root)
  ) {
    return null;
  }

  return {
    declaration,
    declarationLine,
    initialRoot: contract.identifier,
    root,
    operations,
  };
}

function hasUnsafeMatrixUsage(
  rootNode: AnyNode,
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
  const marks = operations.filter(
    (operation): operation is MatrixMark => operation.kind === 'mark',
  );
  const ownedCells = new Set<AnyNode>(
    marks.length === 0
      ? []
      : operations.flatMap((operation) =>
          matrixOperationCells(operation, root),
        ),
  );
  if (hasUnsafeMatrixMarkReceiverUsage(rootNode, marks, root)) return true;

  let unsafe = false;

  walkAst(rootNode, (node, parent, grandparent) => {
    const cell = marks.length === 0 ? null : matrixCellSyntax(node);
    if (
      isRootedInvocation(node, root) ||
      (isRootWrite(node, root) && !supportedMutations.has(node)) ||
      (cell?.root.name === root && !ownedCells.has(node)) ||
      (isIdentifierReference(node, parent, root) &&
        !isSafeMatrixReference(node, parent, grandparent, declaration))
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

function matrixOperationCells(
  operation: MatrixOperation,
  root: string,
): readonly MemberExpression[] {
  const operationRoot =
    operation.kind === 'mark'
      ? operation.read
      : operation.kind === 'compare'
        ? operation.statement.test
        : operation.mutation;
  const cells: MemberExpression[] = [];

  walkAst(operationRoot, (node) => {
    const cell = matrixCellSyntax(node);
    if (cell?.root.name === root) cells.push(cell.read);
  });

  return cells;
}

function hasUnsafeMatrixMarkReceiverUsage(
  rootNode: AnyNode,
  marks: readonly MatrixMark[],
  root: string,
): boolean {
  if (marks.length === 0) return false;

  const receiverName = marks[0]?.receiver.name;
  if (
    receiverName === undefined ||
    receiverName === root ||
    marks.some(({ receiver }) => receiver.name !== receiverName) ||
    (rootNode.type !== 'Program' && rootNode.type !== 'BlockStatement')
  ) {
    return true;
  }

  const bindings = rootNode.body.flatMap((statement) => {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      statement.declarations.length !== 1
    ) {
      return [];
    }

    const declarator = statement.declarations[0];
    return declarator?.id.type === 'Identifier' &&
      declarator.id.name === receiverName &&
      declarator.init?.type === 'ArrayExpression' &&
      declarator.init.elements.length === 0
      ? [{ declaration: statement, identifier: declarator.id }]
      : [];
  });
  const binding = bindings[0];
  if (
    bindings.length !== 1 ||
    binding === undefined ||
    marks.some(({ statement }) => statement.start <= binding.declaration.end)
  ) {
    return true;
  }

  const supportedReceivers = new Set<AnyNode>(
    marks.map(({ receiver }) => receiver),
  );
  let unsafe = false;

  walkAst(rootNode, (node, parent) => {
    if (!isIdentifierReference(node, parent, receiverName)) return;
    if (
      node === binding.identifier ||
      supportedReceivers.has(node) ||
      isDirectConsoleArgument(node, parent) ||
      (parent?.type === 'ReturnStatement' && parent.argument === node)
    ) {
      return;
    }

    unsafe = true;
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
    isDirectConsoleArgument(node, parent) ||
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

  if (operation.kind === 'mark') {
    return {
      start: operation.statement.start,
      end: operation.statement.start,
      text: `trace.visitCell({ position: { row: ${expressionSource(source, operation.cell.row)}, column: ${expressionSource(source, operation.cell.column)} }, source: { line: ${operation.line} } });\ntrace.mark({ marker: 'probe', positions: [{ row: ${expressionSource(source, operation.cell.row)}, column: ${expressionSource(source, operation.cell.column)} }], source: { line: ${operation.line} } });\n${indentation}`,
    };
  }

  if (operation.kind === 'compare') {
    const [left, right] = operation.cells;
    return {
      start: operation.statement.start,
      end: operation.statement.start,
      text: `trace.visitCell({ position: { row: ${expressionSource(source, left.row)}, column: ${expressionSource(source, left.column)} }, source: { line: ${operation.line} } });\ntrace.compare({ positions: [{ row: ${expressionSource(source, left.row)}, column: ${expressionSource(source, left.column)} }, { row: ${expressionSource(source, right.row)}, column: ${expressionSource(source, right.column)} }], source: { line: ${operation.line} } });\n${indentation}`,
    };
  }

  if (operation.kind === 'swap') {
    const [first, second] = operation.cells;

    return {
      start: operation.statement.end,
      end: operation.statement.end,
      text: `;\n${indentation}trace.visitCell({ position: { row: ${expressionSource(source, first.row)}, column: ${expressionSource(source, first.column)} }, source: { line: ${operation.line} } });\n${indentation}trace.swap({ positions: [{ row: ${expressionSource(source, first.row)}, column: ${expressionSource(source, first.column)} }, { row: ${expressionSource(source, second.row)}, column: ${expressionSource(source, second.column)} }], source: { line: ${operation.line} } });\n`,
    };
  }

  const row = expressionSource(source, operation.cell.row);
  const column = expressionSource(source, operation.cell.column);
  return {
    start: operation.statement.end,
    end: operation.statement.end,
    text: `;\n${indentation}trace.visitCell({ position: { row: ${row}, column: ${column} }, source: { line: ${operation.line} } });\n${indentation}trace.set({ position: { row: ${row}, column: ${column} }, value: ${root}[${row}][${column}], source: { line: ${operation.line} } });\n`,
  };
}
