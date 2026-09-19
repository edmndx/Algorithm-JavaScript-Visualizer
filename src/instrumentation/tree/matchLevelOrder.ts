import type { AnyNode, FunctionDeclaration, Identifier, Program } from 'acorn';

import { isDirectMember, sourceLine } from '../ast';
import {
  isIdentifierNamed,
  isLiteral,
  isNullGuardReturningEmptyArray,
  matchExternalInvocation,
} from './treeMatchers';
import type { TreeTraversal } from './treeTypes';

export function matchLevelOrderTraversal(
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
    kind: 'visit',
    initialCall,
    visit: {
      insertionPoint: levelPush,
      target: dequeuedNode,
      line,
    },
  };
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
