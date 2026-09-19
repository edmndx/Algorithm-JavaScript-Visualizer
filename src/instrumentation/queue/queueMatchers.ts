import type {
  AnyNode,
  CallExpression,
  Expression,
  Identifier,
  MemberExpression,
  UpdateExpression,
} from 'acorn';

import {
  isDirectRootMethodCall,
  isDirectWriteTarget,
  isMathTruncCall,
  isNumberCall,
  sourceLine,
  staticTraceValue,
} from '../ast';

type QueueCall = {
  readonly kind: 'enqueue' | 'dequeue' | 'dequeue-back';
  readonly call: CallExpression;
  readonly member: MemberExpression;
  readonly line: number;
};

type QueuePeek = {
  readonly kind: 'peek';
  readonly member: MemberExpression;
  readonly line: number;
};

export type QueueCursorDequeue = {
  readonly kind: 'cursor-dequeue';
  readonly member: MemberExpression;
  readonly cursor: Identifier;
  readonly update: UpdateExpression;
  readonly line: number;
};

export type QueueOperation = QueueCall | QueuePeek | QueueCursorDequeue;

export function matchQueueCall(node: AnyNode, root: string): QueueCall | null {
  if (!isDirectRootMethodCall(node, root)) return null;

  const method = node.callee.property.name;
  const line = sourceLine(node);
  if (line === null) return null;

  if (
    method === 'push' &&
    node.arguments.length > 0 &&
    node.arguments.every(
      (argument) =>
        argument.type !== 'SpreadElement' && isSupportedQueueValue(argument),
    )
  ) {
    return { kind: 'enqueue', call: node, member: node.callee, line };
  }

  if (node.arguments.length !== 0) return null;
  if (method === 'shift') {
    return { kind: 'dequeue', call: node, member: node.callee, line };
  }

  return method === 'pop'
    ? { kind: 'dequeue-back', call: node, member: node.callee, line }
    : null;
}

export function matchQueueCursorDequeue(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): QueueCursorDequeue | null {
  if (
    node.type !== 'MemberExpression' ||
    !node.computed ||
    node.optional ||
    node.object.type !== 'Identifier' ||
    node.object.name !== root ||
    node.property.type !== 'UpdateExpression' ||
    node.property.operator !== '++' ||
    node.property.prefix ||
    node.property.argument.type !== 'Identifier' ||
    isDirectWriteTarget(node, parent)
  ) {
    return null;
  }

  const line = sourceLine(node);
  return line === null
    ? null
    : {
        kind: 'cursor-dequeue',
        member: node,
        cursor: node.property.argument,
        update: node.property,
        line,
      };
}

export function matchQueuePeek(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): QueuePeek | null {
  if (
    node.type !== 'MemberExpression' ||
    !node.computed ||
    node.optional ||
    node.object.type !== 'Identifier' ||
    node.object.name !== root ||
    node.property.type !== 'Literal' ||
    node.property.value !== 0 ||
    isDirectWriteTarget(node, parent)
  ) {
    return null;
  }

  const line = sourceLine(node);
  return line === null ? null : { kind: 'peek', member: node, line };
}

function isSupportedQueueValue(expression: Expression): boolean {
  if (
    expression.type === 'Identifier' ||
    staticTraceValue(expression) !== null
  ) {
    return true;
  }

  if (expression.type === 'TemplateLiteral') {
    return expression.expressions.every(isSupportedQueueValue);
  }

  if (expression.type === 'UnaryExpression') {
    return (
      (expression.operator === '+' || expression.operator === '-') &&
      isSupportedQueueValue(expression.argument)
    );
  }

  if (expression.type === 'BinaryExpression') {
    return (
      expression.left.type !== 'PrivateIdentifier' &&
      ['+', '-', '*', '/', '%', '**'].includes(expression.operator) &&
      isSupportedQueueValue(expression.left) &&
      isSupportedQueueValue(expression.right)
    );
  }

  if (
    expression.type !== 'CallExpression' ||
    expression.optional ||
    expression.arguments.length !== 1
  ) {
    return false;
  }

  const [argument] = expression.arguments;
  return (
    argument !== undefined &&
    argument.type !== 'SpreadElement' &&
    isSupportedQueueValue(argument) &&
    (isNumberCall(expression) || isMathTruncCall(expression))
  );
}
