import type { AnyNode, FunctionDeclaration, Identifier, Program } from 'acorn';

import { isDirectMember, sourceLine } from '../ast';
import {
  isBstBoundsGuard,
  isBstRecursiveCall,
  isLiteral,
  isNullGuardReturning,
  isRecursiveChildCall,
  matchExternalInvocation,
} from './treeMatchers';
import type { TreeTraversal, TreeVisit } from './treeTypes';

export function matchDepthFirstTraversal(
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

  return { kind: 'visit', initialCall, visit };
}

export function matchMaximumDepthTraversal(
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
    kind: 'maximum-depth',
    initialCall,
    target: parameter,
    expression: result.argument,
    line,
  };
}

export function matchBstValidationTraversal(
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
    boundsGuard?.type !== 'IfStatement' ||
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
    kind: 'bounds-check',
    initialCall,
    target: node,
    lower,
    upper,
    condition: boundsGuard.test,
    line,
  };
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
