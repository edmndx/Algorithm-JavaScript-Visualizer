import type {
  AnyNode,
  CallExpression,
  FunctionDeclaration,
  Identifier,
  Program,
} from 'acorn';

import { isDirectMember, isIdentifierReference, walkAst } from '../ast';

export function matchExternalInvocation(
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

export function isNullGuardReturning(
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

export function isNullGuardReturningEmptyArray(
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

export function isLiteral(
  node: AnyNode | null | undefined,
  value: unknown,
): boolean {
  return node?.type === 'Literal' && node.value === value;
}

export function isIdentifierNamed(
  node: AnyNode | null | undefined,
  name: string,
): node is Identifier {
  return node?.type === 'Identifier' && node.name === name;
}

export function isRecursiveChildCall(
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

export function isBstBoundsGuard(
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

export function isBstRecursiveCall(
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
