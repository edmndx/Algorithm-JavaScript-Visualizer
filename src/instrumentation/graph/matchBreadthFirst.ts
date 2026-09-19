import type { AnyNode, Identifier, VariableDeclaration } from 'acorn';

import { sourceLine } from '../ast';
import type { PrimaryOperationBinding } from '../sourceContract';
import { isSingleArgumentCall, matchZeroDeclaration } from './graphMatchers';
import type { GraphTraversal } from './graphTypes';

export function findBreadthFirstTraversal(
  binding: PrimaryOperationBinding,
  declaration: VariableDeclaration,
  nodeIds: ReadonlySet<string>,
): GraphTraversal | null {
  const statements =
    binding.scope.owner === null
      ? binding.scope.body.body.slice(
          binding.scope.body.body.indexOf(declaration) + 1,
        )
      : binding.scope.body.body;
  if (statements.length !== 4) return null;

  const queueSeed = matchQueueDeclaration(statements[0], nodeIds);
  if (queueSeed === null) return null;

  const visited = matchVisitedDeclaration(statements[1], queueSeed.seed);
  const head = matchZeroDeclaration(statements[2]);
  const loop = statements[3];
  if (
    visited === null ||
    head === null ||
    loop?.type !== 'WhileStatement' ||
    !matchesTraversalCondition(loop.test, head.name, queueSeed.queue.name) ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 3
  ) {
    return null;
  }

  const [extractionStatement, nodeVisit, neighborStatement] = loop.body.body;
  if (extractionStatement?.type !== 'VariableDeclaration') return null;

  const extracted = matchQueueExtraction(extractionStatement);
  if (
    extracted === null ||
    extracted.queue.name !== queueSeed.queue.name ||
    extracted.head.name !== head.name ||
    nodeVisit?.type !== 'ExpressionStatement' ||
    !isConsoleVisit(nodeVisit, extracted.node) ||
    neighborStatement === undefined
  ) {
    return null;
  }

  const nodeVisitLine = sourceLine(nodeVisit);
  const neighborLoop = matchNeighborLoop(
    neighborStatement,
    binding.root,
    extracted.node,
    extracted.queue,
    visited.name,
  );
  if (nodeVisitLine === null || neighborLoop === null) return null;

  return {
    node: extracted.node,
    nodeVisitPoint: nodeVisit,
    nodeVisitLine,
    neighbor: neighborLoop.neighbor,
    edgeVisitPoint: neighborLoop.edgeVisitPoint,
    edgeVisitLine: neighborLoop.edgeVisitLine,
    rootReferences: [neighborLoop.rootReference],
  };
}

function matchQueueDeclaration(
  node: AnyNode | undefined,
  nodeIds: ReadonlySet<string>,
): { readonly queue: Identifier; readonly seed: string } | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  const seed =
    declarator?.init?.type === 'ArrayExpression'
      ? declarator.init.elements[0]
      : null;
  return declarator?.id.type === 'Identifier' &&
    declarator?.init?.type === 'ArrayExpression' &&
    declarator.init.elements.length === 1 &&
    seed?.type === 'Literal' &&
    typeof seed.value === 'string' &&
    nodeIds.has(seed.value)
    ? { queue: declarator.id, seed: seed.value }
    : null;
}

function matchVisitedDeclaration(
  node: AnyNode | undefined,
  seed: string,
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  const argument =
    declarator?.init?.type === 'NewExpression'
      ? declarator.init.arguments[0]
      : null;
  const element =
    argument?.type === 'ArrayExpression' ? argument.elements[0] : null;

  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'NewExpression' &&
    declarator.init.callee.type === 'Identifier' &&
    declarator.init.callee.name === 'Set' &&
    declarator.init.arguments.length === 1 &&
    argument?.type === 'ArrayExpression' &&
    argument.elements.length === 1 &&
    element?.type === 'Literal' &&
    element.value === seed
    ? declarator.id
    : null;
}

function matchesTraversalCondition(
  node: AnyNode,
  head: string,
  queue: string,
): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '<' &&
    node.left.type === 'Identifier' &&
    node.left.name === head &&
    node.right.type === 'MemberExpression' &&
    !node.right.computed &&
    !node.right.optional &&
    node.right.object.type === 'Identifier' &&
    node.right.object.name === queue &&
    node.right.property.type === 'Identifier' &&
    node.right.property.name === 'length'
  );
}

function matchQueueExtraction(declaration: VariableDeclaration): {
  readonly node: Identifier;
  readonly queue: Identifier;
  readonly head: Identifier;
} | null {
  if (declaration.kind !== 'const' || declaration.declarations.length !== 1) {
    return null;
  }

  const declarator = declaration.declarations[0];
  if (
    declarator?.id.type !== 'Identifier' ||
    declarator.init?.type !== 'MemberExpression' ||
    !declarator.init.computed ||
    declarator.init.optional ||
    declarator.init.object.type !== 'Identifier' ||
    declarator.init.property.type !== 'UpdateExpression' ||
    declarator.init.property.operator !== '++' ||
    declarator.init.property.prefix ||
    declarator.init.property.argument.type !== 'Identifier'
  ) {
    return null;
  }

  return {
    node: declarator.id,
    queue: declarator.init.object,
    head: declarator.init.property.argument,
  };
}

function isConsoleVisit(node: AnyNode, value: Identifier): boolean {
  return (
    node.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    node.expression.callee.type === 'MemberExpression' &&
    !node.expression.callee.computed &&
    !node.expression.callee.optional &&
    node.expression.callee.object.type === 'Identifier' &&
    node.expression.callee.object.name === 'console' &&
    node.expression.callee.property.type === 'Identifier' &&
    node.expression.callee.property.name === 'log' &&
    node.expression.arguments.length === 1 &&
    node.expression.arguments[0]?.type === 'Identifier' &&
    node.expression.arguments[0].name === value.name
  );
}

function matchNeighborLoop(
  node: AnyNode,
  root: string,
  currentNode: Identifier,
  queue: Identifier,
  visited: string,
): {
  readonly neighbor: Identifier;
  readonly rootReference: Identifier;
  readonly edgeVisitPoint: AnyNode;
  readonly edgeVisitLine: number;
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
    node.right.property.name !== currentNode.name ||
    node.body.type !== 'BlockStatement'
  ) {
    return null;
  }

  const neighbor = node.left.declarations[0].id;
  const edgeVisitPoint = node.body.body[0];
  const edgeVisitLine = sourceLine(node.right);
  if (
    node.body.body.length !== 1 ||
    edgeVisitPoint === undefined ||
    edgeVisitLine === null ||
    !matchesDiscoveryGuard(edgeVisitPoint, queue.name, visited, neighbor.name)
  ) {
    return null;
  }

  return {
    neighbor,
    rootReference: node.right.object,
    edgeVisitPoint,
    edgeVisitLine,
  };
}

function matchesDiscoveryGuard(
  node: AnyNode,
  queue: string,
  visited: string,
  neighbor: string,
): boolean {
  if (
    node.type !== 'IfStatement' ||
    node.alternate !== null ||
    node.test.type !== 'UnaryExpression' ||
    node.test.operator !== '!' ||
    node.test.argument.type !== 'CallExpression' ||
    node.test.argument.callee.type !== 'MemberExpression' ||
    node.test.argument.callee.object.type !== 'Identifier' ||
    node.test.argument.callee.object.name !== visited ||
    node.test.argument.callee.property.type !== 'Identifier' ||
    node.test.argument.callee.property.name !== 'has' ||
    node.test.argument.arguments.length !== 1 ||
    node.test.argument.arguments[0]?.type !== 'Identifier' ||
    node.test.argument.arguments[0].name !== neighbor ||
    node.consequent.type !== 'BlockStatement' ||
    node.consequent.body.length !== 2
  ) {
    return false;
  }

  return (
    isSingleArgumentCall(node.consequent.body[0], visited, 'add', neighbor) &&
    isSingleArgumentCall(node.consequent.body[1], queue, 'push', neighbor)
  );
}
