import type {
  AnyNode,
  BlockStatement,
  Identifier,
  MemberExpression,
} from 'acorn';

import { sourceLine } from '../ast';
import type { PrimaryOperationBinding } from '../sourceContract';
import { isSingleArgumentCall, matchZeroDeclaration } from './graphMatchers';
import type { GraphTraversal } from './graphTypes';

export function findKahnTraversal(
  binding: PrimaryOperationBinding,
): GraphTraversal | null {
  const statements = binding.scope.body.body;
  if (
    binding.scope.owner === null ||
    binding.scope.owner.async ||
    binding.scope.owner.generator ||
    statements.length !== 8
  ) {
    return null;
  }

  const indegree = matchEmptyCollectionDeclaration(
    statements[0],
    'const',
    'ObjectExpression',
  );
  const initialization = matchObjectKeysLoop(statements[1], binding.root);
  if (
    indegree === null ||
    initialization === null ||
    initialization.body.body.length !== 1 ||
    !matchesIndexedAssignment(
      initialization.body.body[0],
      indegree.name,
      initialization.item.name,
      0,
    )
  ) {
    return null;
  }

  const incrementLoop = matchObjectKeysLoop(statements[2], binding.root);
  if (incrementLoop === null || incrementLoop.body.body.length !== 1) {
    return null;
  }

  const incrementStatement = incrementLoop.body.body[0];
  if (incrementStatement === undefined) return null;

  const incrementEdges = matchAdjacencyLoop(
    incrementStatement,
    binding.root,
    incrementLoop.item.name,
  );
  if (
    incrementEdges === null ||
    incrementEdges.body.body.length !== 1 ||
    !matchesIndexedUpdate(
      incrementEdges.body.body[0],
      indegree.name,
      incrementEdges.item.name,
      '++',
    )
  ) {
    return null;
  }

  const queue = matchEmptyCollectionDeclaration(
    statements[3],
    'const',
    'ArrayExpression',
  );
  const queueSeed = matchObjectKeysLoop(statements[4], binding.root);
  if (
    queue === null ||
    queueSeed === null ||
    queueSeed.body.body.length !== 1 ||
    !matchesZeroIndegreeEnqueue(
      queueSeed.body.body[0],
      indegree.name,
      queue.name,
      queueSeed.item.name,
    )
  ) {
    return null;
  }

  const completed = matchZeroDeclaration(statements[5]);
  const loop = statements[6];
  if (
    completed === null ||
    loop?.type !== 'WhileStatement' ||
    !matchesNonEmptyQueue(loop.test, queue.name) ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 3
  ) {
    return null;
  }

  const [dequeueStatement, completionStatement, outgoingStatement] =
    loop.body.body;
  const dequeued = matchQueueShift(dequeueStatement, queue.name);
  if (
    dequeued === null ||
    completionStatement === undefined ||
    !matchesIdentifierUpdate(completionStatement, completed.name, '++') ||
    outgoingStatement === undefined
  ) {
    return null;
  }

  const outgoing = matchAdjacencyLoop(
    outgoingStatement,
    binding.root,
    dequeued.name,
  );
  const dequeueLine =
    dequeueStatement === undefined ? null : sourceLine(dequeueStatement);
  const decrementStatement = outgoing?.body.body[0];
  const enqueueStatement = outgoing?.body.body[1];
  if (
    outgoing === null ||
    dequeueLine === null ||
    outgoing.body.body.length !== 2 ||
    decrementStatement === undefined ||
    enqueueStatement === undefined ||
    !matchesIndexedUpdate(
      decrementStatement,
      indegree.name,
      outgoing.item.name,
      '--',
    ) ||
    !matchesZeroIndegreeEnqueue(
      enqueueStatement,
      indegree.name,
      queue.name,
      outgoing.item.name,
    )
  ) {
    return null;
  }

  const returnedRoot = matchKahnReturn(
    statements[7],
    completed.name,
    binding.root,
  );
  const edgeVisitLine = sourceLine(outgoing.access);
  if (returnedRoot === null || edgeVisitLine === null) return null;

  return {
    node: dequeued,
    nodeVisitPoint: completionStatement,
    nodeVisitLine: dequeueLine,
    neighbor: outgoing.item,
    edgeVisitPoint: decrementStatement,
    edgeVisitLine,
    rootReferences: [
      initialization.rootReference,
      incrementLoop.rootReference,
      incrementEdges.rootReference,
      queueSeed.rootReference,
      outgoing.rootReference,
      returnedRoot,
    ],
  };
}

function matchEmptyCollectionDeclaration(
  node: AnyNode | undefined,
  kind: 'const',
  initializerType: 'ArrayExpression' | 'ObjectExpression',
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== kind ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  if (
    declarator?.id.type !== 'Identifier' ||
    declarator.init?.type !== initializerType
  ) {
    return null;
  }

  const isEmpty =
    declarator.init.type === 'ArrayExpression'
      ? declarator.init.elements.length === 0
      : declarator.init.properties.length === 0;
  return isEmpty ? declarator.id : null;
}

function matchObjectKeysLoop(
  node: AnyNode | undefined,
  root: string,
): {
  readonly item: Identifier;
  readonly body: BlockStatement;
  readonly rootReference: Identifier;
} | null {
  if (
    node?.type !== 'ForOfStatement' ||
    node.await ||
    node.left.type !== 'VariableDeclaration' ||
    node.left.kind !== 'const' ||
    node.left.declarations.length !== 1 ||
    node.left.declarations[0]?.id.type !== 'Identifier' ||
    node.body.type !== 'BlockStatement'
  ) {
    return null;
  }

  const rootReference = matchObjectKeysCall(node.right, root);
  return rootReference === null
    ? null
    : {
        item: node.left.declarations[0].id,
        body: node.body,
        rootReference,
      };
}

function matchObjectKeysCall(node: AnyNode, root: string): Identifier | null {
  if (
    node.type !== 'CallExpression' ||
    node.optional ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.computed ||
    node.callee.optional ||
    node.callee.object.type !== 'Identifier' ||
    node.callee.object.name !== 'Object' ||
    node.callee.property.type !== 'Identifier' ||
    node.callee.property.name !== 'keys' ||
    node.arguments.length !== 1
  ) {
    return null;
  }

  const argument = node.arguments[0];
  return argument?.type === 'Identifier' && argument.name === root
    ? argument
    : null;
}

function matchAdjacencyLoop(
  node: AnyNode,
  root: string,
  sourceNode: string,
): {
  readonly item: Identifier;
  readonly access: MemberExpression;
  readonly rootReference: Identifier;
  readonly body: BlockStatement;
} | null {
  if (
    node.type !== 'ForOfStatement' ||
    node.await ||
    node.left.type !== 'VariableDeclaration' ||
    node.left.kind !== 'const' ||
    node.left.declarations.length !== 1 ||
    node.left.declarations[0]?.id.type !== 'Identifier' ||
    node.right.type !== 'MemberExpression' ||
    !node.right.computed ||
    node.right.optional ||
    node.right.object.type !== 'Identifier' ||
    node.right.object.name !== root ||
    node.right.property.type !== 'Identifier' ||
    node.right.property.name !== sourceNode ||
    node.body.type !== 'BlockStatement'
  ) {
    return null;
  }

  return {
    item: node.left.declarations[0].id,
    access: node.right,
    rootReference: node.right.object,
    body: node.body,
  };
}

function matchesIndexedAssignment(
  node: AnyNode | undefined,
  object: string,
  property: string,
  value: number,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'AssignmentExpression' &&
    node.expression.operator === '=' &&
    matchesIndexedMember(node.expression.left, object, property) &&
    node.expression.right.type === 'Literal' &&
    node.expression.right.value === value
  );
}

function matchesIndexedUpdate(
  node: AnyNode | undefined,
  object: string,
  property: string,
  operator: '++' | '--',
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'UpdateExpression' &&
    !node.expression.prefix &&
    node.expression.operator === operator &&
    matchesIndexedMember(node.expression.argument, object, property)
  );
}

function matchesIndexedMember(
  node: AnyNode,
  object: string,
  property: string,
): boolean {
  return (
    node.type === 'MemberExpression' &&
    node.computed &&
    !node.optional &&
    node.object.type === 'Identifier' &&
    node.object.name === object &&
    node.property.type === 'Identifier' &&
    node.property.name === property
  );
}

function matchesZeroIndegreeEnqueue(
  node: AnyNode | undefined,
  indegree: string,
  queue: string,
  course: string,
): boolean {
  return (
    node?.type === 'IfStatement' &&
    node.alternate === null &&
    node.test.type === 'BinaryExpression' &&
    node.test.operator === '===' &&
    matchesIndexedMember(node.test.left, indegree, course) &&
    node.test.right.type === 'Literal' &&
    node.test.right.value === 0 &&
    isSingleArgumentCall(node.consequent, queue, 'push', course)
  );
}

function matchesNonEmptyQueue(node: AnyNode, queue: string): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '>' &&
    node.left.type === 'MemberExpression' &&
    !node.left.computed &&
    !node.left.optional &&
    node.left.object.type === 'Identifier' &&
    node.left.object.name === queue &&
    node.left.property.type === 'Identifier' &&
    node.left.property.name === 'length' &&
    node.right.type === 'Literal' &&
    node.right.value === 0
  );
}

function matchQueueShift(
  node: AnyNode | undefined,
  queue: string,
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  const call = declarator?.init;
  return declarator?.id.type === 'Identifier' &&
    call?.type === 'CallExpression' &&
    !call.optional &&
    call.arguments.length === 0 &&
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    !call.callee.optional &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === queue &&
    call.callee.property.type === 'Identifier' &&
    call.callee.property.name === 'shift'
    ? declarator.id
    : null;
}

function matchesIdentifierUpdate(
  node: AnyNode,
  identifier: string,
  operator: '++' | '--',
): boolean {
  return (
    node.type === 'ExpressionStatement' &&
    node.expression.type === 'UpdateExpression' &&
    !node.expression.prefix &&
    node.expression.operator === operator &&
    node.expression.argument.type === 'Identifier' &&
    node.expression.argument.name === identifier
  );
}

function matchKahnReturn(
  node: AnyNode | undefined,
  completed: string,
  root: string,
): Identifier | null {
  if (
    node?.type !== 'ReturnStatement' ||
    node.argument?.type !== 'BinaryExpression' ||
    node.argument.operator !== '===' ||
    node.argument.left.type !== 'Identifier' ||
    node.argument.left.name !== completed ||
    node.argument.right.type !== 'MemberExpression' ||
    node.argument.right.computed ||
    node.argument.right.optional ||
    node.argument.right.property.type !== 'Identifier' ||
    node.argument.right.property.name !== 'length'
  ) {
    return null;
  }

  return matchObjectKeysCall(node.argument.right.object, root);
}
