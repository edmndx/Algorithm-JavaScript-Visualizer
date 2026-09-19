import type {
  AnyNode,
  Expression,
  Identifier,
  MemberExpression,
  VariableDeclaration,
  ForStatement,
  Statement,
  ExpressionStatement,
  AssignmentExpression,
} from 'acorn';
import {
  isNamed as named,
  isLiteralValue as literal,
  isNamedMember as member,
} from '../matchers';
import { isFiniteNumericLiteral, isSupportedIndexExpression } from '../ast';
import { TRACE_LIMITS } from '../../protocol';

type MatrixCellSyntax = {
  readonly root: Identifier;
  readonly cell: { readonly row: Expression; readonly column: Expression };
  readonly read: MemberExpression;
};

export function matrixCellSyntax(
  node: AnyNode | null | undefined,
): MatrixCellSyntax | null {
  if (
    node?.type !== 'MemberExpression' ||
    !node.computed ||
    node.optional ||
    node.property.type === 'PrivateIdentifier' ||
    node.object.type !== 'MemberExpression' ||
    !node.object.computed ||
    node.object.optional ||
    node.object.object.type !== 'Identifier' ||
    node.object.property.type === 'PrivateIdentifier' ||
    !isSupportedIndexExpression(node.object.property) ||
    !isSupportedIndexExpression(node.property)
  ) {
    return null;
  }

  return {
    root: node.object.object,
    cell: { row: node.object.property, column: node.property },
    read: node,
  };
}

export function isSupportedInitialMatrix(
  expression: Expression | null | undefined,
): boolean {
  if (
    expression?.type !== 'ArrayExpression' ||
    expression.elements.length === 0 ||
    expression.elements.length > TRACE_LIMITS.matrixRows
  ) {
    return false;
  }

  const rows = expression.elements;
  const firstRow = rows[0];
  if (firstRow?.type !== 'ArrayExpression' || firstRow.elements.length === 0) {
    return false;
  }

  const columns = firstRow.elements.length;
  if (
    columns > TRACE_LIMITS.matrixColumns ||
    rows.length * columns > TRACE_LIMITS.matrixCells
  )
    return false;
  return rows.every(
    (row) =>
      row?.type === 'ArrayExpression' &&
      row.elements.length === columns &&
      row.elements.every(isFiniteNumericLiteral),
  );
}

export type Binding = {
  statement: VariableDeclaration;
  name: string;
  init: Expression;
};
export type Loop = {
  statement: ForStatement;
  index: string;
  body: readonly Statement[];
};
export type Write = {
  statement: ExpressionStatement;
  assignment: AssignmentExpression;
};

export const minusOne = (
  node: AnyNode | null | undefined,
  name: string,
): boolean =>
  node?.type === 'BinaryExpression' &&
  node.operator === '-' &&
  named(node.left, name) &&
  literal(node.right, 1);
export const plusOne = (
  node: AnyNode | null | undefined,
  name: string,
  length: boolean,
): boolean =>
  node?.type === 'BinaryExpression' &&
  node.operator === '+' &&
  (length ? member(node.left, name, 'length') : named(node.left, name)) &&
  literal(node.right, 1);
export const index = (
  node: AnyNode | null | undefined,
  array: string,
  offset: string,
): boolean =>
  node?.type === 'MemberExpression' &&
  !node.optional &&
  node.computed &&
  named(node.object, array) &&
  minusOne(node.property, offset);
export const cell = (
  node: AnyNode | null | undefined,
  grid: string,
  row: (node: AnyNode) => boolean,
  column: (node: AnyNode) => boolean,
): boolean =>
  node?.type === 'MemberExpression' &&
  !node.optional &&
  node.computed &&
  node.object.type === 'MemberExpression' &&
  !node.object.optional &&
  node.object.computed &&
  named(node.object.object, grid) &&
  row(node.object.property) &&
  column(node.property);

export function binding(
  node: AnyNode | undefined,
  kind: 'const' | 'let',
): Binding | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== kind ||
    node.declarations.length !== 1
  )
    return null;
  const entry = node.declarations[0];
  return entry?.id.type === 'Identifier' &&
    entry.init !== null &&
    entry.init !== undefined
    ? { statement: node, name: entry.id.name, init: entry.init }
    : null;
}

export function loop(
  node: AnyNode | undefined,
  start: number,
  bound: (node: AnyNode) => boolean,
): Loop | null {
  if (node?.type !== 'ForStatement' || node.body.type !== 'BlockStatement')
    return null;
  const counter = binding(node.init ?? undefined, 'let');
  if (
    !counter ||
    !literal(counter.init, start) ||
    node.test?.type !== 'BinaryExpression' ||
    node.test.operator !== '<=' ||
    !named(node.test.left, counter.name) ||
    !bound(node.test.right) ||
    node.update?.type !== 'UpdateExpression' ||
    node.update.operator !== '++' ||
    !named(node.update.argument, counter.name)
  )
    return null;
  return { statement: node, index: counter.name, body: node.body.body };
}

export function write(
  node: Statement | undefined,
  grid: string,
  row: (node: AnyNode) => boolean,
  column: (node: AnyNode) => boolean,
): Write | null {
  if (
    node?.type !== 'ExpressionStatement' ||
    node.expression.type !== 'AssignmentExpression' ||
    node.expression.operator !== '=' ||
    !cell(node.expression.left, grid, row, column)
  )
    return null;
  return { statement: node, assignment: node.expression };
}

export function allocation(
  node: Expression,
  row: string,
  column: string,
  columnLength: boolean,
): boolean {
  if (
    node.type !== 'CallExpression' ||
    !member(node.callee, 'Array', 'from') ||
    node.arguments.length !== 2 ||
    node.arguments[0]?.type !== 'ObjectExpression' ||
    node.arguments[0].properties.length !== 1 ||
    node.arguments[1]?.type !== 'ArrowFunctionExpression'
  )
    return false;
  const property = node.arguments[0].properties[0];
  const callback = node.arguments[1];
  if (
    property?.type !== 'Property' ||
    property.computed ||
    !named(property.key, 'length') ||
    !plusOne(property.value, row, true) ||
    callback.params.length !== 0 ||
    callback.body.type !== 'CallExpression' ||
    callback.body.optional ||
    callback.body.arguments.length !== 1 ||
    !literal(callback.body.arguments[0], 0) ||
    callback.body.callee.type !== 'MemberExpression' ||
    callback.body.callee.computed ||
    callback.body.callee.optional ||
    !named(callback.body.callee.property, 'fill') ||
    callback.body.callee.object.type !== 'CallExpression' ||
    !named(callback.body.callee.object.callee, 'Array') ||
    callback.body.callee.object.arguments.length !== 1
  )
    return false;
  return plusOne(
    callback.body.callee.object.arguments[0],
    column,
    columnLength,
  );
}

export function sameStructure(
  node: unknown,
  model: unknown,
  names: Map<string, string>,
  used: Set<string>,
): boolean {
  if (model === null || typeof model !== 'object') return node === model;
  if (Array.isArray(model))
    return (
      Array.isArray(node) &&
      node.length === model.length &&
      model.every((child, index) =>
        sameStructure(node[index], child, names, used),
      )
    );
  if (node === null || typeof node !== 'object' || Array.isArray(node))
    return false;
  const actual = node as Record<string, unknown>;
  const expected = model as Record<string, unknown>;
  if (expected.type === 'Identifier') {
    if (actual.type !== 'Identifier' || typeof actual.name !== 'string')
      return false;
    const key = expected.name as string;
    if (key === 'Math' || key === 'abs' || key === 'length' || key === 'push')
      return actual.name === key;
    const mapped = names.get(key);
    if (mapped !== undefined) return actual.name === mapped;
    if (used.has(actual.name)) return false;
    names.set(key, actual.name);
    used.add(actual.name);
    return true;
  }
  return Object.entries(expected).every(
    ([key, value]) =>
      key === 'start' ||
      key === 'end' ||
      key === 'loc' ||
      key === 'raw' ||
      sameStructure(actual[key], value, names, used),
  );
}
