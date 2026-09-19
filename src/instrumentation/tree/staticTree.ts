import type { AnyNode, ObjectExpression } from 'acorn';

import { objectPropertyValue, staticTraceValue } from '../ast';

export type StaticTreeNode = {
  readonly id: string;
  readonly access: string;
  readonly value: string | number;
  readonly children: readonly string[];
};

export function readStaticTree(
  expression: ObjectExpression,
  access: string,
  ids: { nextId: number },
): StaticTreeNode[] | null {
  if (expression.properties.length !== 3) return null;

  const valueExpression = objectPropertyValue(expression, 'value');
  const leftExpression = objectPropertyValue(expression, 'left');
  const rightExpression = objectPropertyValue(expression, 'right');
  const value = staticTraceValue(valueExpression);

  if (value === null || leftExpression === null || rightExpression === null) {
    return null;
  }

  const id = `node-${ids.nextId}`;
  ids.nextId += 1;
  const left = readStaticChild(leftExpression, `${access}.left`, ids);
  const right = readStaticChild(rightExpression, `${access}.right`, ids);
  if (left === null || right === null) return null;

  return [
    {
      id,
      access,
      value,
      children: [left[0]?.id, right[0]?.id].filter(
        (childId): childId is string => childId !== undefined,
      ),
    },
    ...left,
    ...right,
  ];
}

function readStaticChild(
  expression: AnyNode,
  access: string,
  ids: { nextId: number },
): readonly StaticTreeNode[] | null {
  if (expression.type === 'Literal' && expression.value === null) {
    return [];
  }
  if (expression.type !== 'ObjectExpression') return null;

  return readStaticTree(expression, access, ids);
}
