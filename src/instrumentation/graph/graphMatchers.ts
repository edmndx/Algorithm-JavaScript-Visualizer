import type { AnyNode, Identifier } from 'acorn';

export function matchZeroDeclaration(
  node: AnyNode | undefined,
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'let' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'Literal' &&
    declarator.init.value === 0
    ? declarator.id
    : null;
}

export function isSingleArgumentCall(
  node: AnyNode | undefined,
  root: string,
  method: string,
  argument: string,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    node.expression.callee.type === 'MemberExpression' &&
    !node.expression.callee.computed &&
    !node.expression.callee.optional &&
    node.expression.callee.object.type === 'Identifier' &&
    node.expression.callee.object.name === root &&
    node.expression.callee.property.type === 'Identifier' &&
    node.expression.callee.property.name === method &&
    node.expression.arguments.length === 1 &&
    node.expression.arguments[0]?.type === 'Identifier' &&
    node.expression.arguments[0].name === argument
  );
}
