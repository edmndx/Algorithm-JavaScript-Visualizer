import type { AnyNode, Identifier } from 'acorn';

export function isNamed(
  node: AnyNode | null | undefined,
  name: string,
): node is Identifier {
  return node?.type === 'Identifier' && node.name === name;
}

export function isLiteralValue(
  node: AnyNode | null | undefined,
  value: number | null,
): boolean {
  return node?.type === 'Literal' && node.value === value;
}

export function isNamedMember(
  node: AnyNode | null | undefined,
  object: string,
  property: string,
): boolean {
  return (
    node?.type === 'MemberExpression' &&
    !node.optional &&
    !node.computed &&
    isNamed(node.object, object) &&
    isNamed(node.property, property)
  );
}

export function isIndexedItem(
  node: AnyNode | null | undefined,
  array: string,
  index: string,
): boolean {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    !node.optional &&
    isNamed(node.object, array) &&
    isNamed(node.property, index)
  );
}

export function initializedBinding(
  node: AnyNode | undefined,
  kind: 'const' | 'let',
) {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== kind ||
    node.declarations.length !== 1
  )
    return null;
  const entry = node.declarations[0];
  return entry?.id.type === 'Identifier' && entry.init
    ? { node, name: entry.id.name, init: entry.init }
    : null;
}

export function isIdentifierCall(
  node: AnyNode | null | undefined,
  fn: string,
  checks: readonly ((node: AnyNode) => boolean)[],
): boolean {
  return (
    node?.type === 'CallExpression' &&
    !node.optional &&
    isNamed(node.callee, fn) &&
    node.arguments.length === checks.length &&
    node.arguments.every((arg, index) => checks[index]!(arg))
  );
}
