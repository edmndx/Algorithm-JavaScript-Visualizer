import {
  parse,
  type AnyNode,
  type Expression,
  type ObjectExpression,
  type Program,
} from 'acorn';

import { TRACE_LIMITS } from '../protocol';

export function parseJavaScript(source: string): Program | null {
  try {
    return parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      ecmaVersion: 'latest',
      locations: true,
      sourceType: 'script',
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function walkAst(
  root: AnyNode,
  visit: (node: AnyNode, parent: AnyNode | null) => void,
): void {
  function descend(node: AnyNode, parent: AnyNode | null): void {
    visit(node, parent);

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            descend(child, node);
          }
        }
      } else if (isNode(value)) {
        descend(value, node);
      }
    }
  }

  descend(root, null);
}

export function isIdentifierReference(
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

export function hasUnsafeInstrumentationSyntax(program: Program): boolean {
  let unsafe = false;

  walkAst(program, (node, parent) => {
    if (
      node.type === 'WithStatement' ||
      isDirectEval(node) ||
      isIdentifierReference(node, parent, 'trace')
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

export function sourceLine(node: AnyNode): number | null {
  return node.loc?.start.line ?? null;
}

export function isFiniteNumericLiteral(node: AnyNode | null): boolean {
  if (node?.type === 'Literal' && typeof node.value === 'number') {
    return Number.isFinite(node.value);
  }

  return (
    node?.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number' &&
    Number.isFinite(node.argument.value)
  );
}

export function staticTraceValue(node: AnyNode | null): string | number | null {
  if (node?.type === 'Literal') {
    if (
      typeof node.value === 'string' &&
      node.value.length <= TRACE_LIMITS.stringLength
    ) {
      return node.value;
    }
    if (typeof node.value === 'number' && Number.isFinite(node.value)) {
      return node.value;
    }
    return null;
  }

  if (
    node?.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number' &&
    Number.isFinite(node.argument.value)
  ) {
    return -node.argument.value;
  }

  return null;
}

export function objectPropertyValue(
  expression: ObjectExpression,
  name: string,
): AnyNode | null {
  const matches = expression.properties.filter(
    (property) =>
      property.type === 'Property' &&
      property.kind === 'init' &&
      !property.computed &&
      !property.method &&
      ((property.key.type === 'Identifier' && property.key.name === name) ||
        (property.key.type === 'Literal' && property.key.value === name)),
  );
  const property = matches[0];
  return matches.length === 1 && property?.type === 'Property'
    ? property.value
    : null;
}

export function isSupportedIndexExpression(expression: Expression): boolean {
  return supportedIndexKey(expression) !== null;
}

export function createIdentifierAllocator(
  program: Program,
  prefix: string,
): () => string {
  const names = new Set<string>();
  walkAst(program, (node) => {
    if (node.type === 'Identifier') names.add(node.name);
  });

  let index = 0;
  return () => {
    let name: string;
    do {
      name = `${prefix}${index}`;
      index += 1;
    } while (names.has(name));

    names.add(name);
    return name;
  };
}

function supportedIndexKey(expression: Expression): string | null {
  // Instrumenters may repeat these expressions in an adjacent trace call.
  // Identifiers therefore represent stable numeric indices; calls, updates,
  // assignments, and member access are deliberately unsupported.
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

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  );
}
