import {
  type AnyNode,
  type AssignmentExpression,
  type Expression,
  type ExpressionStatement,
  type Identifier,
  type IfStatement,
  type MemberExpression,
  type Program,
  type UpdateExpression,
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

type ArraySwapMatch = {
  readonly kind: 'swap';
  readonly statement: ExpressionStatement;
  readonly mutation: AssignmentExpression;
  readonly indices: readonly [Expression, Expression];
  readonly line: number;
};

type ArrayComparisonMatch = {
  readonly kind: 'compare';
  readonly statement: IfStatement;
  readonly indices: readonly [Expression, Expression];
  readonly line: number;
};

type ArraySetMatch = {
  readonly kind: 'set';
  readonly statement: ExpressionStatement;
  readonly mutation: AssignmentExpression | UpdateExpression;
  readonly index: Expression;
  readonly line: number;
};

type ArrayOperation = ArraySwapMatch | ArrayComparisonMatch | ArraySetMatch;

const COMPARISON_OPERATORS = new Set(['<', '<=', '>', '>=', '===', '!==']);
const ARITHMETIC_OPERATORS = new Set(['+', '-', '*', '/', '%', '**']);
const SUPPORTED_ASSIGNMENT_OPERATORS = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
]);

export function instrumentArray(
  source: string,
  program: Program,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const trackedDeclaration = findTrackedArrayDeclaration(program);
  if (trackedDeclaration === null) return null;

  const trackedDeclarator = trackedDeclaration.declarations[0];
  const declarationLine = sourceLine(trackedDeclaration);
  if (trackedDeclarator?.id.type !== 'Identifier' || declarationLine === null)
    return null;

  const trackedRoot = trackedDeclarator.id.name;

  const operations: ArrayOperation[] = [];

  walkAst(program, (node, parent, grandparent, insideUnsupportedScope) => {
    if (insideUnsupportedScope) return;

    const swap = matchArraySwap(node, parent, grandparent, trackedRoot);

    if (swap !== null) {
      operations.push(swap);
      return;
    }

    const comparison = matchArrayComparison(node, parent, trackedRoot);
    if (comparison !== null) operations.push(comparison);

    const arraySet = matchArraySet(node, parent, grandparent, trackedRoot);
    if (arraySet !== null) operations.push(arraySet);
  });

  if (
    operations.length === 0 ||
    operations.some(
      (operation) => operation.statement.start < trackedDeclaration.end,
    ) ||
    hasUnsafeTrackedArrayUsage(
      program,
      trackedDeclaration,
      operations,
      trackedRoot,
    )
  ) {
    return null;
  }

  const edits: SourceEdit[] = [
    {
      start: trackedDeclaration.end,
      end: trackedDeclaration.end,
      text: `;\ntrace.initialize({ structure: 'array', source: { line: ${declarationLine} } });\ntrace.createArray({ values: ${trackedRoot}, source: { line: ${declarationLine} } });\n`,
    },
    ...operations.map((operation) =>
      operationInsertion(source, operation, trackedRoot),
    ),
  ];

  return applySourceEdits(source, edits);
}

function matchArraySwap(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  trackedRoot: string,
): ArraySwapMatch | null {
  if (
    node.type !== 'AssignmentExpression' ||
    parent?.type !== 'ExpressionStatement' ||
    !isProgramOrBlockStatement(grandparent) ||
    node.operator !== '=' ||
    node.left.type !== 'ArrayPattern' ||
    node.right.type !== 'ArrayExpression' ||
    node.left.elements.length !== 2 ||
    node.right.elements.length !== 2
  ) {
    return null;
  }

  const [leftFirst, leftSecond] = node.left.elements;
  const [rightFirst, rightSecond] = node.right.elements;

  if (
    !isDirectComputedMember(leftFirst) ||
    !isDirectComputedMember(leftSecond) ||
    !isDirectComputedMember(rightFirst) ||
    !isDirectComputedMember(rightSecond)
  ) {
    return null;
  }

  const line = sourceLine(node);

  if (
    line === null ||
    leftFirst.object.name !== trackedRoot ||
    leftSecond.object.name !== trackedRoot ||
    rightFirst.object.name !== trackedRoot ||
    rightSecond.object.name !== trackedRoot ||
    !sameSupportedIndexExpression(leftFirst.property, rightSecond.property) ||
    !sameSupportedIndexExpression(leftSecond.property, rightFirst.property)
  ) {
    return null;
  }

  return {
    kind: 'swap',
    statement: parent,
    mutation: node,
    indices: [leftFirst.property, leftSecond.property],
    line,
  };
}

function matchArrayComparison(
  node: AnyNode,
  parent: AnyNode | null,
  trackedRoot: string,
): ArrayComparisonMatch | null {
  if (
    node.type !== 'IfStatement' ||
    !isProgramOrBlockStatement(parent) ||
    node.test.type !== 'BinaryExpression' ||
    !COMPARISON_OPERATORS.has(node.test.operator) ||
    !isDirectComputedMember(node.test.left) ||
    !isDirectComputedMember(node.test.right)
  ) {
    return null;
  }

  const left = node.test.left;
  const right = node.test.right;
  const line = sourceLine(node.test);

  if (
    line === null ||
    left.object.name !== trackedRoot ||
    right.object.name !== trackedRoot ||
    !isSupportedIndexExpression(left.property) ||
    !isSupportedIndexExpression(right.property)
  ) {
    return null;
  }

  return {
    kind: 'compare',
    statement: node,
    indices: [left.property, right.property],
    line,
  };
}

function matchArraySet(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  trackedRoot: string,
): ArraySetMatch | null {
  if (
    parent?.type !== 'ExpressionStatement' ||
    !isProgramOrBlockStatement(grandparent)
  ) {
    return null;
  }

  const line = sourceLine(node);
  if (line === null) return null;

  if (node.type === 'AssignmentExpression') {
    if (
      !SUPPORTED_ASSIGNMENT_OPERATORS.has(node.operator) ||
      !isDirectComputedMember(node.left) ||
      node.left.object.name !== trackedRoot ||
      !isSupportedIndexExpression(node.left.property) ||
      !isSupportedWriteValue(node.right, trackedRoot)
    ) {
      return null;
    }

    return {
      kind: 'set',
      statement: parent,
      mutation: node,
      index: node.left.property,
      line,
    };
  }

  if (
    node.type !== 'UpdateExpression' ||
    !isDirectComputedMember(node.argument) ||
    node.argument.object.name !== trackedRoot ||
    !isSupportedIndexExpression(node.argument.property)
  ) {
    return null;
  }

  return {
    kind: 'set',
    statement: parent,
    mutation: node,
    index: node.argument.property,
    line,
  };
}

function findTrackedArrayDeclaration(
  program: Program,
): VariableDeclaration | null {
  const matches = program.body.filter(
    (statement): statement is VariableDeclaration => {
      if (
        statement.type !== 'VariableDeclaration' ||
        statement.kind !== 'const' ||
        statement.declarations.length !== 1
      ) {
        return false;
      }

      const [declarator] = statement.declarations;
      return (
        declarator?.id.type === 'Identifier' &&
        isSupportedInitialArray(declarator.init)
      );
    },
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function isSupportedInitialArray(
  expression: Expression | null | undefined,
): boolean {
  return (
    expression?.type === 'ArrayExpression' &&
    expression.elements.every(isFiniteNumericLiteral)
  );
}

function hasUnsafeTrackedArrayUsage(
  program: Program,
  declaration: VariableDeclaration,
  operations: readonly ArrayOperation[],
  root: string,
): boolean {
  const supportedMutationNodes = new Set<AnyNode>(
    operations.flatMap((operation) =>
      operation.kind === 'compare' ? [] : [operation.mutation],
    ),
  );
  let hasUnsafeUsage = false;

  walkAst(program, (node, parent) => {
    if (
      isRootedInvocation(node, root) ||
      (isRootWrite(node, root) && !supportedMutationNodes.has(node)) ||
      (isIdentifierReference(node, parent, root) &&
        !isSafeTrackedRootReference(node, parent, declaration))
    ) {
      hasUnsafeUsage = true;
    }
  });

  return hasUnsafeUsage;
}

function isSafeTrackedRootReference(
  node: AnyNode,
  parent: AnyNode | null,
  declaration: VariableDeclaration,
): boolean {
  return (
    node === declaration.declarations[0]?.id ||
    (parent?.type === 'MemberExpression' && parent.object === node)
  );
}

function isDirectComputedMember(
  node: AnyNode | null | undefined,
): node is MemberExpression & {
  readonly object: Identifier;
  readonly property: Expression;
} {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    !node.optional &&
    node.object.type === 'Identifier' &&
    node.property.type !== 'PrivateIdentifier'
  );
}

function isSupportedWriteValue(expression: Expression, root: string): boolean {
  if (isFiniteNumericLiteral(expression)) return true;
  if (expression.type === 'UnaryExpression') {
    return (
      (expression.operator === '+' || expression.operator === '-') &&
      isSupportedWriteValue(expression.argument, root)
    );
  }
  if (expression.type === 'MemberExpression') {
    if (
      expression.object.type !== 'Identifier' ||
      expression.object.name !== root ||
      expression.optional
    ) {
      return false;
    }

    return expression.computed
      ? expression.property.type !== 'PrivateIdentifier' &&
          isSupportedIndexExpression(expression.property)
      : expression.property.type === 'Identifier' &&
          expression.property.name === 'length';
  }
  if (
    expression.type !== 'BinaryExpression' ||
    !ARITHMETIC_OPERATORS.has(expression.operator) ||
    expression.left.type === 'PrivateIdentifier'
  ) {
    return false;
  }

  return (
    isSupportedWriteValue(expression.left, root) &&
    isSupportedWriteValue(expression.right, root)
  );
}

function operationInsertion(
  source: string,
  operation: ArrayOperation,
  root: string,
): SourceEdit {
  const indentation = lineIndentation(source, operation.statement.start);

  if (operation.kind === 'compare') {
    return {
      start: operation.statement.start,
      end: operation.statement.start,
      text: `trace.compare({ indices: [${expressionSource(source, operation.indices[0])}, ${expressionSource(source, operation.indices[1])}], source: { line: ${operation.line} } });\n${indentation}`,
    };
  }

  if (operation.kind === 'swap') {
    return {
      start: operation.statement.end,
      end: operation.statement.end,
      text: `;\n${indentation}trace.swap({ indices: [${expressionSource(source, operation.indices[0])}, ${expressionSource(source, operation.indices[1])}], source: { line: ${operation.line} } });\n`,
    };
  }

  const index = expressionSource(source, operation.index);
  return {
    start: operation.statement.end,
    end: operation.statement.end,
    text: `;\n${indentation}trace.set({ index: ${index}, value: ${root}[${index}], source: { line: ${operation.line} } });\n`,
  };
}
