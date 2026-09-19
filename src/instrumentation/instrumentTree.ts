import {
  type AnyNode,
  type CallExpression,
  type FunctionDeclaration,
  type Identifier,
  type ObjectExpression,
  type Program,
  type VariableDeclaration,
} from 'acorn';

import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  isIdentifierReference,
  isRootWrite,
  objectPropertyValue,
  sourceLine,
  staticTraceValue,
  walkAst,
} from './ast';
import { applySourceEdits, lineIndentation, type SourceEdit } from './edits';
import type { ValidVisualizationSource } from './sourceContract';

type StaticTreeNode = {
  readonly id: string;
  readonly access: string;
  readonly value: string | number;
  readonly children: readonly string[];
};

type TreeVisit = {
  readonly insertionPoint: AnyNode;
  readonly target: Identifier;
  readonly line: number;
};

type TreeTraversal = {
  readonly initialCall: CallExpression;
  readonly visit: TreeVisit;
};

type TreeCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly nodes: readonly StaticTreeNode[];
  readonly traversal: TreeTraversal;
};

export function instrumentTree(
  source: string,
  program: Program,
  contract: ValidVisualizationSource,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const candidates = findTreeDeclarations(program, contract.identifier)
    .map(({ declaration, nodes }) => analyzeTree(program, declaration, nodes))
    .filter((candidate): candidate is TreeCandidate => candidate !== null);

  if (candidates.length !== 1) return null;

  const candidate = candidates[0];
  if (candidate === undefined) return null;

  const allocateIdentifier = createIdentifierAllocator(program, '__traceTree');
  const nodeIds = allocateIdentifier();
  const weakMapEntries = candidate.nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const traceNodes = candidate.nodes
    .map(
      ({ id, value, children }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, children: ${JSON.stringify(children)} }`,
    )
    .join(', ');
  const visitIndentation = lineIndentation(
    source,
    candidate.traversal.visit.insertionPoint.start,
  );
  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'tree', source: { line: ${candidate.declarationLine} } });\n` +
        `const ${nodeIds} = new WeakMap([${weakMapEntries}]);\n` +
        `trace.createTree({ rootId: ${JSON.stringify(candidate.nodes[0]?.id)}, nodes: [${traceNodes}], source: { line: ${candidate.declarationLine} } });\n`,
    },
    {
      start: candidate.traversal.visit.insertionPoint.start,
      end: candidate.traversal.visit.insertionPoint.start,
      text: `trace.visit({ nodeId: ${nodeIds}.get(${candidate.traversal.visit.target.name}), source: { line: ${candidate.traversal.visit.line} } });\n${visitIndentation}`,
    },
  ];

  return applySourceEdits(source, edits);
}

function findTreeDeclarations(
  program: Program,
  identifier: string,
): Array<{
  readonly declaration: VariableDeclaration;
  readonly nodes: readonly StaticTreeNode[];
}> {
  return program.body.flatMap((statement) => {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      statement.declarations.length !== 1
    ) {
      return [];
    }

    const declarator = statement.declarations[0];
    if (
      declarator?.id.type !== 'Identifier' ||
      declarator.id.name !== identifier ||
      declarator.init?.type !== 'ObjectExpression'
    ) {
      return [];
    }

    const nodes = readStaticTree(declarator.init, declarator.id.name, {
      nextId: 0,
    });
    return nodes === null ? [] : [{ declaration: statement, nodes }];
  });
}

function readStaticTree(
  expression: ObjectExpression,
  access: string,
  ids: { nextId: number },
): StaticTreeNode[] | null {
  if (expression.properties.length !== 3) return null;

  const valueExpression = objectPropertyValue(expression, 'value');
  const leftExpression = objectPropertyValue(expression, 'left');
  const rightExpression = objectPropertyValue(expression, 'right');
  const value = staticTraceValue(valueExpression);

  if (value === null || leftExpression === null || rightExpression === null) {
    return null;
  }

  const id = `node-${ids.nextId}`;
  ids.nextId += 1;
  const left = readStaticChild(leftExpression, `${access}.left`, ids);
  const right = readStaticChild(rightExpression, `${access}.right`, ids);
  if (left === null || right === null) return null;

  return [
    {
      id,
      access,
      value,
      children: [left[0]?.id, right[0]?.id].filter(
        (childId): childId is string => childId !== undefined,
      ),
    },
    ...left,
    ...right,
  ];
}

function readStaticChild(
  expression: AnyNode,
  access: string,
  ids: { nextId: number },
): readonly StaticTreeNode[] | null {
  if (expression.type === 'Literal' && expression.value === null) {
    return [];
  }
  if (expression.type !== 'ObjectExpression') return null;

  return readStaticTree(expression, access, ids);
}

function analyzeTree(
  program: Program,
  declaration: VariableDeclaration,
  nodes: readonly StaticTreeNode[],
): TreeCandidate | null {
  const declarator = declaration.declarations[0];
  const declarationLine = sourceLine(declaration);
  if (declarator?.id.type !== 'Identifier' || declarationLine === null) {
    return null;
  }

  const root = declarator.id.name;
  const traversals = program.body
    .filter(
      (statement): statement is FunctionDeclaration =>
        statement.type === 'FunctionDeclaration' && statement.id !== null,
    )
    .flatMap((traversal) =>
      [
        matchDepthFirstTraversal(program, traversal, root),
        matchMaximumDepthTraversal(program, traversal, root),
        matchBstValidationTraversal(program, traversal, root),
        matchLevelOrderTraversal(program, traversal, root),
      ].filter((candidate): candidate is TreeTraversal => candidate !== null),
    );
  const traversal = traversals[0];

  if (
    traversals.length !== 1 ||
    traversal === undefined ||
    hasUnsafeTreeUsage(program, declaration, traversal, root)
  ) {
    return null;
  }

  return { declaration, declarationLine, nodes, traversal };
}

function matchDepthFirstTraversal(
  program: Program,
  declaration: FunctionDeclaration,
  root: string,
): TreeTraversal | null {
  if (
    declaration.id === null ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 1 ||
    declaration.params[0]?.type !== 'Identifier' ||
    declaration.body.body.length !== 4
  ) {
    return null;
  }

  const traversalName = declaration.id.name;
  const parameter = declaration.params[0];
  const [guard, ...steps] = declaration.body.body;
  if (!isNullGuard(guard, parameter)) return null;

  let leftCalls = 0;
  let rightCalls = 0;
  let visit: TreeVisit | null = null;

  for (const step of steps) {
    const child = recursiveChild(step, declaration, parameter);
    if (child === 'left') {
      leftCalls += 1;
      continue;
    }
    if (child === 'right') {
      rightCalls += 1;
      continue;
    }

    const matchedVisit = matchTreeVisit(step, parameter);
    if (matchedVisit === null || visit !== null) return null;
    visit = matchedVisit;
  }

  if (leftCalls !== 1 || rightCalls !== 1 || visit === null) return null;

  const initialCall = matchExternalInvocation(
    program,
    declaration,
    traversalName,
    (call) =>
      call.arguments.length === 1 &&
      call.arguments[0]?.type === 'Identifier' &&
      call.arguments[0].name === root,
  );
  if (initialCall === null) return null;

  return { initialCall, visit };
}

function matchMaximumDepthTraversal(
  program: Program,
  declaration: FunctionDeclaration,
  root: string,
): TreeTraversal | null {
  if (
    declaration.id === null ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 1 ||
    declaration.params[0]?.type !== 'Identifier' ||
    declaration.body.body.length !== 2
  ) {
    return null;
  }

  const parameter = declaration.params[0];
  const [guard, result] = declaration.body.body;
  if (
    !isNullGuardReturning(guard, parameter, 0) ||
    result?.type !== 'ReturnStatement' ||
    result.argument?.type !== 'BinaryExpression' ||
    result.argument.operator !== '+' ||
    !isLiteral(result.argument.left, 1) ||
    result.argument.right.type !== 'CallExpression' ||
    result.argument.right.optional ||
    !isDirectMember(result.argument.right.callee, 'Math', 'max') ||
    result.argument.right.arguments.length !== 2 ||
    !isRecursiveChildCall(
      result.argument.right.arguments[0],
      declaration,
      parameter,
      'left',
    ) ||
    !isRecursiveChildCall(
      result.argument.right.arguments[1],
      declaration,
      parameter,
      'right',
    )
  ) {
    return null;
  }

  const initialCall = matchExternalInvocation(
    program,
    declaration,
    declaration.id.name,
    (call) =>
      call.arguments.length === 1 &&
      call.arguments[0]?.type === 'Identifier' &&
      call.arguments[0].name === root,
  );
  const line = sourceLine(result);
  if (initialCall === null || line === null) return null;

  return {
    initialCall,
    visit: { insertionPoint: result, target: parameter, line },
  };
}

function matchBstValidationTraversal(
  program: Program,
  declaration: FunctionDeclaration,
  root: string,
): TreeTraversal | null {
  if (
    declaration.id === null ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 3 ||
    declaration.params.some((parameter) => parameter.type !== 'Identifier') ||
    declaration.body.body.length !== 3
  ) {
    return null;
  }

  const [node, lower, upper] = declaration.params as [
    Identifier,
    Identifier,
    Identifier,
  ];
  const [guard, boundsGuard, result] = declaration.body.body;
  if (
    !isNullGuardReturning(guard, node, true) ||
    !isBstBoundsGuard(boundsGuard, node, lower, upper) ||
    result?.type !== 'ReturnStatement' ||
    result.argument?.type !== 'LogicalExpression' ||
    result.argument.operator !== '&&' ||
    !isBstRecursiveCall(
      result.argument.left,
      declaration,
      node,
      lower,
      upper,
      'left',
    ) ||
    !isBstRecursiveCall(
      result.argument.right,
      declaration,
      node,
      lower,
      upper,
      'right',
    )
  ) {
    return null;
  }

  const initialCall = matchExternalInvocation(
    program,
    declaration,
    declaration.id.name,
    (call) =>
      call.arguments.length === 3 &&
      call.arguments[0]?.type === 'Identifier' &&
      call.arguments[0].name === root,
  );
  if (initialCall === null || boundsGuard === undefined) {
    return null;
  }
  const line = sourceLine(boundsGuard);
  if (line === null) return null;

  return {
    initialCall,
    visit: { insertionPoint: boundsGuard, target: node, line },
  };
}

function matchLevelOrderTraversal(
  program: Program,
  declaration: FunctionDeclaration,
  root: string,
): TreeTraversal | null {
  if (
    declaration.id === null ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 1 ||
    declaration.params[0]?.type !== 'Identifier' ||
    declaration.body.body.length !== 5
  ) {
    return null;
  }

  const parameter = declaration.params[0];
  const [guard, resultDeclaration, queueDeclaration, loop, resultReturn] =
    declaration.body.body;
  const resultName = matchEmptyArrayDeclaration(resultDeclaration);
  const queueName = matchSeededQueueDeclaration(queueDeclaration, parameter);
  if (
    !isNullGuardReturningEmptyArray(guard, parameter) ||
    resultName === null ||
    queueName === null ||
    loop?.type !== 'WhileStatement' ||
    !isPositiveLengthTest(loop.test, queueName) ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 4 ||
    resultReturn?.type !== 'ReturnStatement' ||
    resultReturn.argument?.type !== 'Identifier' ||
    resultReturn.argument.name !== resultName
  ) {
    return null;
  }

  const [levelDeclaration, levelSizeDeclaration, iteration, resultPush] =
    loop.body.body;
  const levelName = matchEmptyArrayDeclaration(levelDeclaration);
  const levelSizeName = matchLengthDeclaration(levelSizeDeclaration, queueName);
  if (
    levelName === null ||
    levelSizeName === null ||
    iteration?.type !== 'ForStatement' ||
    !isCanonicalIndexLoop(iteration, levelSizeName) ||
    iteration.body.type !== 'BlockStatement' ||
    iteration.body.body.length !== 4 ||
    !isPushStatement(resultPush, resultName, levelName)
  ) {
    return null;
  }

  const [dequeueDeclaration, levelPush, leftPush, rightPush] =
    iteration.body.body;
  const dequeuedNode = matchDequeueDeclaration(dequeueDeclaration, queueName);
  if (
    dequeuedNode === null ||
    !isValuePushStatement(levelPush, levelName, dequeuedNode.name) ||
    !isNonNullChildPush(leftPush, queueName, dequeuedNode.name, 'left') ||
    !isNonNullChildPush(rightPush, queueName, dequeuedNode.name, 'right')
  ) {
    return null;
  }

  const initialCall = matchExternalInvocation(
    program,
    declaration,
    declaration.id.name,
    (call) =>
      call.arguments.length === 1 &&
      call.arguments[0]?.type === 'Identifier' &&
      call.arguments[0].name === root,
  );
  if (
    initialCall === null ||
    dequeueDeclaration === undefined ||
    levelPush === undefined
  ) {
    return null;
  }
  const line = sourceLine(dequeueDeclaration);
  if (line === null) return null;

  return {
    initialCall,
    visit: {
      insertionPoint: levelPush,
      target: dequeuedNode,
      line,
    },
  };
}

function matchExternalInvocation(
  program: Program,
  declaration: FunctionDeclaration,
  functionName: string,
  matchesArguments: (call: CallExpression) => boolean,
): CallExpression | null {
  const calls: CallExpression[] = [];
  let unsafeReference = false;

  walkAst(program, (node, parent, _grandparent, insideUnsupportedScope) => {
    if (
      (node.start > declaration.start && node.end < declaration.end) ||
      node === declaration.id ||
      !isIdentifierReference(node, parent, functionName)
    ) {
      return;
    }

    if (insideUnsupportedScope) {
      unsafeReference = true;
      return;
    }

    if (
      parent?.type === 'CallExpression' &&
      parent.callee === node &&
      !parent.optional
    ) {
      calls.push(parent);
      return;
    }

    unsafeReference = true;
  });

  const call = calls[0];
  return !unsafeReference &&
    calls.length === 1 &&
    call !== undefined &&
    matchesArguments(call)
    ? call
    : null;
}

function isNullGuardReturning(
  node: AnyNode | undefined,
  parameter: Identifier,
  value: boolean | number,
): boolean {
  return (
    node?.type === 'IfStatement' &&
    node.alternate === null &&
    isStrictNullComparison(node.test, parameter) &&
    node.consequent.type === 'ReturnStatement' &&
    isLiteral(node.consequent.argument, value)
  );
}

function isNullGuardReturningEmptyArray(
  node: AnyNode | undefined,
  parameter: Identifier,
): boolean {
  return (
    node?.type === 'IfStatement' &&
    node.alternate === null &&
    isStrictNullComparison(node.test, parameter) &&
    node.consequent.type === 'ReturnStatement' &&
    node.consequent.argument?.type === 'ArrayExpression' &&
    node.consequent.argument.elements.length === 0
  );
}

function isStrictNullComparison(node: AnyNode, parameter: Identifier): boolean {
  if (node.type !== 'BinaryExpression' || node.operator !== '===') {
    return false;
  }

  return (
    (isIdentifierNamed(node.left, parameter.name) &&
      isLiteral(node.right, null)) ||
    (isIdentifierNamed(node.right, parameter.name) &&
      isLiteral(node.left, null))
  );
}

function isLiteral(node: AnyNode | null | undefined, value: unknown): boolean {
  return node?.type === 'Literal' && node.value === value;
}

function isIdentifierNamed(
  node: AnyNode | null | undefined,
  name: string,
): node is Identifier {
  return node?.type === 'Identifier' && node.name === name;
}

function isDirectMember(
  node: AnyNode | null | undefined,
  objectName: string,
  propertyName: string,
): boolean {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    !node.optional &&
    isIdentifierNamed(node.object, objectName) &&
    isIdentifierNamed(node.property, propertyName)
  );
}

function isRecursiveChildCall(
  node: AnyNode | null | undefined,
  declaration: FunctionDeclaration,
  parameter: Identifier,
  child: 'left' | 'right',
): boolean {
  return (
    node?.type === 'CallExpression' &&
    !node.optional &&
    isIdentifierNamed(node.callee, declaration.id?.name ?? '') &&
    node.arguments.length === 1 &&
    isDirectMember(node.arguments[0], parameter.name, child)
  );
}

function isBstBoundsGuard(
  node: AnyNode | undefined,
  target: Identifier,
  lower: Identifier,
  upper: Identifier,
): boolean {
  if (
    node?.type !== 'IfStatement' ||
    node.alternate !== null ||
    node.test.type !== 'LogicalExpression' ||
    node.test.operator !== '||' ||
    node.consequent.type !== 'ReturnStatement' ||
    !isLiteral(node.consequent.argument, false)
  ) {
    return false;
  }

  const { left, right } = node.test;
  return (
    left.type === 'BinaryExpression' &&
    left.operator === '<=' &&
    isDirectMember(left.left, target.name, 'value') &&
    isIdentifierNamed(left.right, lower.name) &&
    right.type === 'BinaryExpression' &&
    right.operator === '>=' &&
    isDirectMember(right.left, target.name, 'value') &&
    isIdentifierNamed(right.right, upper.name)
  );
}

function isBstRecursiveCall(
  node: AnyNode | null | undefined,
  declaration: FunctionDeclaration,
  target: Identifier,
  lower: Identifier,
  upper: Identifier,
  child: 'left' | 'right',
): boolean {
  if (
    node?.type !== 'CallExpression' ||
    node.optional ||
    !isIdentifierNamed(node.callee, declaration.id?.name ?? '') ||
    node.arguments.length !== 3 ||
    !isDirectMember(node.arguments[0], target.name, child)
  ) {
    return false;
  }

  return child === 'left'
    ? isIdentifierNamed(node.arguments[1], lower.name) &&
        isDirectMember(node.arguments[2], target.name, 'value')
    : isDirectMember(node.arguments[1], target.name, 'value') &&
        isIdentifierNamed(node.arguments[2], upper.name);
}

function matchEmptyArrayDeclaration(node: AnyNode | undefined): string | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'ArrayExpression' &&
    declarator.init.elements.length === 0
    ? declarator.id.name
    : null;
}

function matchSeededQueueDeclaration(
  node: AnyNode | undefined,
  parameter: Identifier,
): string | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'ArrayExpression' &&
    declarator.init.elements.length === 1 &&
    isIdentifierNamed(declarator.init.elements[0], parameter.name)
    ? declarator.id.name
    : null;
}

function matchLengthDeclaration(
  node: AnyNode | undefined,
  collectionName: string,
): string | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  return declarator?.id.type === 'Identifier' &&
    isDirectMember(declarator.init, collectionName, 'length')
    ? declarator.id.name
    : null;
}

function isPositiveLengthTest(node: AnyNode, collectionName: string): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '>' &&
    isDirectMember(node.left, collectionName, 'length') &&
    isLiteral(node.right, 0)
  );
}

function isCanonicalIndexLoop(node: AnyNode, limitName: string): boolean {
  if (
    node.type !== 'ForStatement' ||
    node.init?.type !== 'VariableDeclaration' ||
    node.init.kind !== 'let' ||
    node.init.declarations.length !== 1
  ) {
    return false;
  }

  const index = node.init.declarations[0];
  return (
    index?.id.type === 'Identifier' &&
    isLiteral(index.init, 0) &&
    node.test?.type === 'BinaryExpression' &&
    node.test.operator === '<' &&
    isIdentifierNamed(node.test.left, index.id.name) &&
    isIdentifierNamed(node.test.right, limitName) &&
    node.update?.type === 'UpdateExpression' &&
    node.update.operator === '++' &&
    !node.update.prefix &&
    isIdentifierNamed(node.update.argument, index.id.name)
  );
}

function matchDequeueDeclaration(
  node: AnyNode | undefined,
  queueName: string,
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'CallExpression' &&
    !declarator.init.optional &&
    isDirectMember(declarator.init.callee, queueName, 'shift') &&
    declarator.init.arguments.length === 0
    ? declarator.id
    : null;
}

function isPushStatement(
  node: AnyNode | undefined,
  receiverName: string,
  argumentName: string,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    isDirectMember(node.expression.callee, receiverName, 'push') &&
    node.expression.arguments.length === 1 &&
    isIdentifierNamed(node.expression.arguments[0], argumentName)
  );
}

function isValuePushStatement(
  node: AnyNode | undefined,
  receiverName: string,
  targetName: string,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    isDirectMember(node.expression.callee, receiverName, 'push') &&
    node.expression.arguments.length === 1 &&
    isDirectMember(node.expression.arguments[0], targetName, 'value')
  );
}

function isNonNullChildPush(
  node: AnyNode | undefined,
  queueName: string,
  targetName: string,
  child: 'left' | 'right',
): boolean {
  return (
    node?.type === 'IfStatement' &&
    node.alternate === null &&
    node.test.type === 'BinaryExpression' &&
    node.test.operator === '!==' &&
    isDirectMember(node.test.left, targetName, child) &&
    isLiteral(node.test.right, null) &&
    node.consequent.type === 'ExpressionStatement' &&
    node.consequent.expression.type === 'CallExpression' &&
    !node.consequent.expression.optional &&
    isDirectMember(node.consequent.expression.callee, queueName, 'push') &&
    node.consequent.expression.arguments.length === 1 &&
    isDirectMember(node.consequent.expression.arguments[0], targetName, child)
  );
}

function isNullGuard(
  node: AnyNode | undefined,
  parameter: Identifier,
): boolean {
  if (
    node?.type !== 'IfStatement' ||
    node.alternate !== null ||
    node.test.type !== 'BinaryExpression' ||
    node.test.operator !== '===' ||
    node.consequent.type !== 'ReturnStatement' ||
    node.consequent.argument !== null
  ) {
    return false;
  }

  return (
    (node.test.left.type === 'Identifier' &&
      node.test.left.name === parameter.name &&
      node.test.right.type === 'Literal' &&
      node.test.right.value === null) ||
    (node.test.right.type === 'Identifier' &&
      node.test.right.name === parameter.name &&
      node.test.left.type === 'Literal' &&
      node.test.left.value === null)
  );
}

function recursiveChild(
  node: AnyNode,
  traversal: FunctionDeclaration,
  parameter: Identifier,
): 'left' | 'right' | null {
  if (
    node.type !== 'ExpressionStatement' ||
    node.expression.type !== 'CallExpression' ||
    node.expression.optional ||
    node.expression.callee.type !== 'Identifier' ||
    node.expression.callee.name !== traversal.id?.name ||
    node.expression.arguments.length !== 1
  ) {
    return null;
  }

  const argument = node.expression.arguments[0];
  if (
    argument?.type !== 'MemberExpression' ||
    argument.computed ||
    argument.optional ||
    argument.object.type !== 'Identifier' ||
    argument.object.name !== parameter.name ||
    argument.property.type !== 'Identifier' ||
    (argument.property.name !== 'left' && argument.property.name !== 'right')
  ) {
    return null;
  }

  return argument.property.name;
}

function matchTreeVisit(
  node: AnyNode,
  parameter: Identifier,
): TreeVisit | null {
  if (
    node.type !== 'ExpressionStatement' ||
    node.expression.type !== 'CallExpression' ||
    node.expression.optional ||
    node.expression.callee.type !== 'MemberExpression' ||
    node.expression.callee.computed ||
    node.expression.callee.optional ||
    node.expression.callee.object.type !== 'Identifier' ||
    node.expression.callee.object.name !== 'console' ||
    node.expression.callee.property.type !== 'Identifier' ||
    node.expression.callee.property.name !== 'log' ||
    node.expression.arguments.length !== 1
  ) {
    return null;
  }

  const value = node.expression.arguments[0];
  if (
    value?.type !== 'MemberExpression' ||
    value.computed ||
    value.optional ||
    value.object.type !== 'Identifier' ||
    value.object.name !== parameter.name ||
    value.property.type !== 'Identifier' ||
    value.property.name !== 'value'
  ) {
    return null;
  }

  const line = sourceLine(value);
  return line === null
    ? null
    : { insertionPoint: node, target: parameter, line };
}

function hasUnsafeTreeUsage(
  program: Program,
  declaration: VariableDeclaration,
  traversal: TreeTraversal,
  root: string,
): boolean {
  const initialRoot = traversal.initialCall.arguments[0];
  let unsafe = false;

  walkAst(program, (node, parent) => {
    if (
      isRootWrite(node, root) ||
      (isIdentifierReference(node, parent, root) &&
        node !== declaration.declarations[0]?.id &&
        node !== initialRoot)
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}
