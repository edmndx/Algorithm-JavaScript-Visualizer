import type {
  AnyNode,
  AssignmentExpression,
  Expression,
  ExpressionStatement,
  Identifier,
  IfStatement,
  MemberExpression,
} from 'acorn';

import {
  isFiniteNumericLiteral,
  isProgramOrBlockStatement,
  isSupportedIndexExpression,
  sameSupportedIndexExpression,
  sourceLine,
} from '../ast';
type MatrixCell = {
  readonly row: Expression;
  readonly column: Expression;
};

type MatrixCellSyntax = {
  readonly root: Identifier;
  readonly cell: MatrixCell;
  readonly read: MemberExpression;
};

type MatrixSwap = {
  readonly kind: 'swap';
  readonly statement: ExpressionStatement;
  readonly mutation: AssignmentExpression;
  readonly cells: readonly [MatrixCell, MatrixCell];
  readonly line: number;
};

type MatrixComparison = {
  readonly kind: 'compare';
  readonly statement: IfStatement;
  readonly cells: readonly [MatrixCell, MatrixCell];
  readonly line: number;
};

type MatrixSet = {
  readonly kind: 'set';
  readonly statement: ExpressionStatement;
  readonly mutation: AssignmentExpression;
  readonly cell: MatrixCell;
  readonly line: number;
};

export type MatrixMark = {
  readonly kind: 'mark';
  readonly statement: ExpressionStatement;
  readonly receiver: Identifier;
  readonly cell: MatrixCell;
  readonly read: MemberExpression;
  readonly line: number;
};

export type MatrixOperation =
  MatrixSwap | MatrixComparison | MatrixSet | MatrixMark;

const COMPARISON_OPERATORS = new Set(['<', '<=', '>', '>=', '===', '!==']);
const ARITHMETIC_OPERATORS = new Set(['+', '-', '*', '/', '%', '**']);

export function matchMatrixSwap(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  root: string,
): MatrixOperation | null {
  if (
    node.type !== 'AssignmentExpression' ||
    node.operator !== '=' ||
    parent?.type !== 'ExpressionStatement' ||
    !isProgramOrBlockStatement(grandparent) ||
    node.left.type !== 'ArrayPattern' ||
    node.right.type !== 'ArrayExpression' ||
    node.left.elements.length !== 2 ||
    node.right.elements.length !== 2
  ) {
    return null;
  }

  const [leftFirstNode, leftSecondNode] = node.left.elements;
  const [rightFirstNode, rightSecondNode] = node.right.elements;
  const leftFirst = matchMatrixCell(leftFirstNode, root);
  const leftSecond = matchMatrixCell(leftSecondNode, root);
  const rightFirst = matchMatrixCell(rightFirstNode, root);
  const rightSecond = matchMatrixCell(rightSecondNode, root);
  const line = sourceLine(node);

  if (
    leftFirst === null ||
    leftSecond === null ||
    rightFirst === null ||
    rightSecond === null ||
    line === null ||
    !sameCell(leftFirst, rightSecond) ||
    !sameCell(leftSecond, rightFirst)
  ) {
    return null;
  }

  return {
    kind: 'swap',
    statement: parent,
    mutation: node,
    cells: [leftFirst, leftSecond],
    line,
  };
}

export function matchMatrixComparison(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): MatrixOperation | null {
  if (
    node.type !== 'IfStatement' ||
    !isProgramOrBlockStatement(parent) ||
    node.test.type !== 'BinaryExpression' ||
    !COMPARISON_OPERATORS.has(node.test.operator)
  ) {
    return null;
  }

  const left = matchMatrixCell(node.test.left, root);
  const right = matchMatrixCell(node.test.right, root);
  const line = sourceLine(node.test);
  return left === null || right === null || line === null
    ? null
    : {
        kind: 'compare',
        statement: node,
        cells: [left, right],
        line,
      };
}

export function matchMatrixSet(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  root: string,
): MatrixOperation | null {
  if (
    node.type !== 'AssignmentExpression' ||
    node.operator !== '=' ||
    parent?.type !== 'ExpressionStatement' ||
    !isProgramOrBlockStatement(grandparent)
  ) {
    return null;
  }

  const cell = matchMatrixCell(node.left, root);
  const line = sourceLine(node);
  return cell === null ||
    line === null ||
    !isSupportedMatrixValue(node.right, root)
    ? null
    : {
        kind: 'set',
        statement: parent,
        mutation: node,
        cell,
        line,
      };
}

export function matchMatrixMark(
  node: AnyNode,
  parent: AnyNode | null,
  grandparent: AnyNode | null,
  root: string,
): MatrixOperation | null {
  if (
    node.type !== 'CallExpression' ||
    node.optional ||
    parent?.type !== 'ExpressionStatement' ||
    grandparent?.type !== 'BlockStatement' ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.optional ||
    node.callee.computed ||
    node.callee.object.type !== 'Identifier' ||
    node.callee.object.name === root ||
    node.callee.property.type !== 'Identifier' ||
    node.callee.property.name !== 'push' ||
    node.arguments.length !== 1
  ) {
    return null;
  }

  const [argument] = node.arguments;
  const syntax = matrixCellSyntax(argument);
  const line = sourceLine(node);
  return syntax?.root.name !== root || line === null
    ? null
    : {
        kind: 'mark',
        statement: parent,
        receiver: node.callee.object,
        cell: syntax.cell,
        read: syntax.read,
        line,
      };
}

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
    expression.elements.length === 0
  ) {
    return false;
  }

  const rows = expression.elements;
  const firstRow = rows[0];
  if (firstRow?.type !== 'ArrayExpression' || firstRow.elements.length === 0) {
    return false;
  }

  const columns = firstRow.elements.length;
  return rows.every(
    (row) =>
      row?.type === 'ArrayExpression' &&
      row.elements.length === columns &&
      row.elements.every(isFiniteNumericLiteral),
  );
}

function matchMatrixCell(
  node: AnyNode | null | undefined,
  root: string,
): MatrixCell | null {
  const syntax = matrixCellSyntax(node);
  return syntax?.root.name === root ? syntax.cell : null;
}

function sameCell(left: MatrixCell, right: MatrixCell): boolean {
  return (
    sameSupportedIndexExpression(left.row, right.row) &&
    sameSupportedIndexExpression(left.column, right.column)
  );
}

function isSupportedMatrixValue(expression: Expression, root: string): boolean {
  if (isFiniteNumericLiteral(expression)) return true;
  if (matchMatrixCell(expression, root) !== null) return true;
  if (matrixCellSyntax(expression) !== null) return true;
  if (expression.type === 'UnaryExpression') {
    return (
      (expression.operator === '+' || expression.operator === '-') &&
      isSupportedMatrixValue(expression.argument, root)
    );
  }
  if (
    expression.type !== 'BinaryExpression' ||
    !ARITHMETIC_OPERATORS.has(expression.operator) ||
    expression.left.type === 'PrivateIdentifier'
  ) {
    return false;
  }

  return (
    isSupportedMatrixValue(expression.left, root) &&
    isSupportedMatrixValue(expression.right, root)
  );
}
