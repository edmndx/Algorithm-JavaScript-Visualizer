import type { AnyNode, ArrayExpression, ObjectExpression } from 'acorn';

import { TRACE_LIMITS } from '../../protocol';

export type StaticGraphNode = {
  readonly id: string;
  readonly neighbors: readonly string[];
};

export function readStaticGraph(
  expression: ObjectExpression,
): readonly StaticGraphNode[] | null {
  if (
    expression.properties.length === 0 ||
    expression.properties.length > TRACE_LIMITS.collectionItems
  ) {
    return null;
  }

  const nodes: StaticGraphNode[] = [];
  const nodeIds = new Set<string>();

  for (const property of expression.properties) {
    if (
      property.type !== 'Property' ||
      property.kind !== 'init' ||
      property.computed ||
      property.method ||
      property.value.type !== 'ArrayExpression'
    ) {
      return null;
    }

    const id = staticPropertyName(property.key);
    const neighbors = readStaticNeighbors(property.value);
    if (
      id === null ||
      id.length === 0 ||
      id.length > TRACE_LIMITS.stringLength ||
      id.includes('->') ||
      nodeIds.has(id) ||
      neighbors === null
    ) {
      return null;
    }

    nodeIds.add(id);
    nodes.push({ id, neighbors });
  }

  const edges = nodes.flatMap(({ id: from, neighbors }) =>
    neighbors.map((to) => `${from}->${to}`),
  );
  const valid =
    edges.length <= TRACE_LIMITS.collectionItems &&
    edges.every((id) => id.length <= TRACE_LIMITS.stringLength) &&
    nodes.every(({ neighbors }) =>
      neighbors.every((neighbor) => nodeIds.has(neighbor)),
    );

  return valid ? nodes : null;
}

function readStaticNeighbors(
  expression: ArrayExpression,
): readonly string[] | null {
  if (expression.elements.length > TRACE_LIMITS.collectionItems) return null;

  const neighbors: string[] = [];
  for (const element of expression.elements) {
    if (
      element?.type !== 'Literal' ||
      typeof element.value !== 'string' ||
      element.value.length === 0 ||
      element.value.length > TRACE_LIMITS.stringLength ||
      element.value.includes('->') ||
      neighbors.includes(element.value)
    ) {
      return null;
    }

    neighbors.push(element.value);
  }

  return neighbors;
}

function staticPropertyName(node: AnyNode): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  return null;
}
