import {
  parse,
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

type Insertion = {
  readonly offset: number;
  readonly text: string;
};

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

export function instrumentJavaScript(source: string): string {
  let program: Program;

  try {
    program = parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      ecmaVersion: 'latest',
      locations: true,
      sourceType: 'script',
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return source;
    throw error;
  }

  const trackedDeclaration = findTrackedArrayDeclaration(program);
  const trackedDeclarator = trackedDeclaration?.declarations[0];
  const declarationLine = trackedDeclaration?.loc?.start.line;

  if (
    trackedDeclaration === null ||
    trackedDeclarator?.id.type !== 'Identifier' ||
    declarationLine === undefined
  ) {
    return source;
  }

  const trackedRoot = trackedDeclarator.id.name;

  const operations: ArrayOperation[] = [];

  walk(program, (node, parent, grandparent, insideUnsupportedScope) => {
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
    return source;
  }

  const insertions: Insertion[] = [
    {
      offset: trackedDeclaration.end,
      text: `;\ntrace.initialize({ structure: 'array', source: { line: ${declarationLine} } });\ntrace.createArray({ values: ${trackedRoot}, source: { line: ${declarationLine} } });\n`,
    },
    ...operations.map((operation) =>
      operationInsertion(source, operation, trackedRoot),
    ),
  ];

  let instrumentedSource = source;

  for (const insertion of insertions.sort(
    (left, right) => right.offset - left.offset,
  )) {
    instrumentedSource =
      instrumentedSource.slice(0, insertion.offset) +
      insertion.text +
      instrumentedSource.slice(insertion.offset);
  }

  return instrumentedSource;
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

  const line = node.loc?.start.line;

  if (
    line === undefined ||
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
  const line = node.test.loc?.start.line;

  if (
    line === undefined ||
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

  const line = node.loc?.start.line;
  if (line === undefined) return null;

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

function isFiniteNumericLiteral(expression: AnyNode | null): boolean {
  if (expression?.type === 'Literal' && typeof expression.value === 'number') {
    return Number.isFinite(expression.value);
  }

  return (
    expression?.type === 'UnaryExpression' &&
    expression.operator === '-' &&
    expression.argument.type === 'Literal' &&
    typeof expression.argument.value === 'number' &&
    Number.isFinite(expression.argument.value)
  );
}

function hasUnsafeTrackedArrayUsage(
  program: Program,
  declaration: VariableDeclaration,
  operations: readonly ArrayOperation[],
  root: string,
): boolean {
  const supportedMutationNodes = new Set(
    operations.flatMap((operation) =>
      operation.kind === 'compare' ? [] : [operation.mutation],
    ),
  );
  let hasUnsafeUsage = false;

  walk(program, (node, parent) => {
    if (
      node.type === 'WithStatement' ||
      isIdentifierReference(node, parent, 'trace') ||
      isDirectEval(node) ||
      isTrackedArrayInvocation(node, root) ||
      isUnsupportedTrackedWrite(node, root, supportedMutationNodes) ||
      (isIdentifierReference(node, parent, root) &&
        !isSafeTrackedRootReference(node, parent, declaration))
    ) {
      hasUnsafeUsage = true;
    }
  });

  return hasUnsafeUsage;
}

function isUnsupportedTrackedWrite(
  node: AnyNode,
  root: string,
  supportedMutationNodes: ReadonlySet<AssignmentExpression | UpdateExpression>,
): boolean {
  switch (node.type) {
    case 'AssignmentExpression':
      return (
        !supportedMutationNodes.has(node) && writesTrackedArray(node.left, root)
      );
    case 'UpdateExpression':
      return (
        !supportedMutationNodes.has(node) &&
        writesTrackedArray(node.argument, root)
      );
    case 'UnaryExpression':
      return (
        node.operator === 'delete' && writesTrackedArray(node.argument, root)
      );
    case 'ForInStatement':
    case 'ForOfStatement':
      return writesTrackedArray(node.left, root);
    default:
      return false;
  }
}

function writesTrackedArray(node: AnyNode, root: string): boolean {
  if (node.type === 'Identifier') return node.name === root;
  if (node.type === 'ChainExpression') {
    return writesTrackedArray(node.expression, root);
  }
  if (node.type === 'MemberExpression') return isMemberRootedAt(node, root);
  if (node.type === 'AssignmentPattern') {
    return writesTrackedArray(node.left, root);
  }
  if (node.type === 'RestElement') {
    return writesTrackedArray(node.argument, root);
  }
  if (node.type === 'ArrayPattern') {
    return node.elements.some(
      (element) => element !== null && writesTrackedArray(element, root),
    );
  }
  if (node.type !== 'ObjectPattern') return false;

  return node.properties.some((property) =>
    property.type === 'RestElement'
      ? writesTrackedArray(property.argument, root)
      : writesTrackedArray(property.value, root),
  );
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

function isTrackedArrayInvocation(node: AnyNode, root: string): boolean {
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    return isMemberRootedAt(node.callee, root);
  }
  return (
    node.type === 'TaggedTemplateExpression' && isMemberRootedAt(node.tag, root)
  );
}

function isMemberRootedAt(node: AnyNode, root: string): boolean {
  if (node.type === 'ChainExpression') {
    return isMemberRootedAt(node.expression, root);
  }
  if (node.type !== 'MemberExpression') return false;

  return node.object.type === 'Identifier'
    ? node.object.name === root
    : isMemberRootedAt(node.object, root);
}

function isIdentifierReference(
  node: AnyNode,
  parent: AnyNode | null,
  name: string,
): boolean {
  if (node.type !== 'Identifier' || node.name !== name) return false;

  if (
    (parent?.type === 'MemberExpression' &&
      parent.property === node &&
      !parent.computed) ||
    (parent?.type === 'Property' &&
      parent.key === node &&
      !parent.computed &&
      !parent.shorthand) ||
    ((parent?.type === 'MethodDefinition' ||
      parent?.type === 'PropertyDefinition') &&
      parent.key === node &&
      !parent.computed)
  ) {
    return false;
  }

  return !(
    parent?.type === 'LabeledStatement' ||
    parent?.type === 'BreakStatement' ||
    parent?.type === 'ContinueStatement'
  );
}

function isDirectEval(node: AnyNode): boolean {
  return (
    node.type === 'CallExpression' &&
    !node.optional &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'eval'
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

function isSupportedIndexExpression(expression: Expression): boolean {
  return supportedIndexKey(expression) !== null;
}

function sameSupportedIndexExpression(
  left: Expression,
  right: Expression,
): boolean {
  const leftKey = supportedIndexKey(left);
  return leftKey !== null && leftKey === supportedIndexKey(right);
}

function supportedIndexKey(expression: Expression): string | null {
  if (expression.type === 'Identifier') return `id:${expression.name}`;
  if (expression.type === 'Literal') {
    return typeof expression.value === 'number' &&
      Number.isInteger(expression.value) &&
      expression.value >= 0
      ? `number:${expression.value}`
      : null;
  }
  if (
    expression.type !== 'BinaryExpression' ||
    (expression.operator !== '+' && expression.operator !== '-') ||
    expression.left.type === 'PrivateIdentifier'
  ) {
    return null;
  }

  const left = supportedIndexKey(expression.left);
  const right = supportedIndexKey(expression.right);

  return left === null || right === null
    ? null
    : `(${left}${expression.operator}${right})`;
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
): Insertion {
  const indentation = lineIndentation(source, operation.statement.start);

  if (operation.kind === 'compare') {
    return {
      offset: operation.statement.start,
      text: `trace.compare({ indices: [${expressionSource(source, operation.indices[0])}, ${expressionSource(source, operation.indices[1])}], source: { line: ${operation.line} } });\n${indentation}`,
    };
  }

  if (operation.kind === 'swap') {
    return {
      offset: operation.statement.end,
      text: `;\n${indentation}trace.swap({ indices: [${expressionSource(source, operation.indices[0])}, ${expressionSource(source, operation.indices[1])}], source: { line: ${operation.line} } });\n`,
    };
  }

  const index = expressionSource(source, operation.index);
  return {
    offset: operation.statement.end,
    text: `;\n${indentation}trace.set({ index: ${index}, value: ${root}[${index}], source: { line: ${operation.line} } });\n`,
  };
}

function expressionSource(source: string, expression: Expression): string {
  return source.slice(expression.start, expression.end);
}

function lineIndentation(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^\s*$/.test(prefix) ? prefix : '';
}

function isProgramOrBlockStatement(node: AnyNode | null): boolean {
  return node?.type === 'Program' || node?.type === 'BlockStatement';
}

function isUnsupportedScopeBoundary(node: AnyNode): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression' ||
    node.type === 'CatchClause'
  );
}

function walk(
  root: AnyNode,
  visit: (
    node: AnyNode,
    parent: AnyNode | null,
    grandparent: AnyNode | null,
    insideUnsupportedScope: boolean,
  ) => void,
): void {
  function descend(
    node: AnyNode,
    parent: AnyNode | null,
    grandparent: AnyNode | null,
    insideUnsupportedScope: boolean,
  ) {
    visit(node, parent, grandparent, insideUnsupportedScope);

    const childInsideUnsupportedScope =
      insideUnsupportedScope || isUnsupportedScopeBoundary(node);

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            descend(child, node, parent, childInsideUnsupportedScope);
          }
        }
      } else if (isNode(value)) {
        descend(value, node, parent, childInsideUnsupportedScope);
      }
    }
  }

  descend(root, null, null, false);
}

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  );
}
