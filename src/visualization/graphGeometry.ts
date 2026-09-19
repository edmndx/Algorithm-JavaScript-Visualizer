import type { PositionedGraphEdge, PositionedGraphNode } from './graphLayout';
import { VISUALIZATION_READABILITY_LIMITS } from './visualizationLimits';

export const GRAPH_NODE_RADIUS = 24;

const PARALLEL_EDGE_GAP = 32;
const SELF_LOOP_BASE_RADIUS = 48;
const SELF_LOOP_RADIUS_GAP = 18;
const GRAPH_NODE_PADDING = 36;
const EDGE_LABEL_HORIZONTAL_PADDING = 48;
const EDGE_LABEL_VERTICAL_PADDING = 24;
const MAX_PARALLEL_EDGE_OFFSET =
  ((VISUALIZATION_READABILITY_LIMITS.graphParallelEdges - 1) / 2) *
  PARALLEL_EDGE_GAP;
const MAX_SELF_LOOP_RADIUS =
  SELF_LOOP_BASE_RADIUS +
  (VISUALIZATION_READABILITY_LIMITS.graphSelfLoops - 1) * SELF_LOOP_RADIUS_GAP;
const STABLE_HORIZONTAL_MARGIN =
  Math.max(GRAPH_NODE_PADDING, MAX_PARALLEL_EDGE_OFFSET, MAX_SELF_LOOP_RADIUS) +
  EDGE_LABEL_HORIZONTAL_PADDING;
const STABLE_VERTICAL_MARGIN =
  Math.max(GRAPH_NODE_PADDING, MAX_PARALLEL_EDGE_OFFSET, MAX_SELF_LOOP_RADIUS) +
  EDGE_LABEL_VERTICAL_PADDING;

type GraphBounds = {
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
};

export type GraphEdgeGeometry = {
  readonly id: string;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly bounds: GraphBounds;
};

export function createGraphEdgeGeometries(
  edges: readonly PositionedGraphEdge[],
): readonly GraphEdgeGeometry[] {
  const siblingsByPair = new Map<string, PositionedGraphEdge[]>();
  for (const edge of edges) {
    const key = endpointPairKey(edge);
    const siblings = siblingsByPair.get(key) ?? [];
    siblings.push(edge);
    siblingsByPair.set(key, siblings);
  }

  const siblingPositionById = new Map<
    string,
    { readonly index: number; readonly count: number }
  >();
  for (const siblings of siblingsByPair.values()) {
    for (const [index, edge] of siblings.entries()) {
      siblingPositionById.set(edge.id, { index, count: siblings.length });
    }
  }

  return edges.map((edge) => {
    const siblingPosition = siblingPositionById.get(edge.id);
    if (siblingPosition === undefined) {
      throw new Error(`Graph edge "${edge.id}" has no sibling position.`);
    }
    return edgeGeometry(edge, siblingPosition.index, siblingPosition.count);
  });
}

export function createGraphViewBox(
  width: number,
  height: number,
  nodes: readonly PositionedGraphNode[],
  edges: readonly GraphEdgeGeometry[],
): string {
  const minimumX = Math.min(
    -STABLE_HORIZONTAL_MARGIN,
    ...nodes.map((node) => node.x - GRAPH_NODE_PADDING),
    ...edges.map((edge) =>
      Math.min(
        edge.bounds.minimumX,
        edge.labelX - EDGE_LABEL_HORIZONTAL_PADDING,
      ),
    ),
  );
  const minimumY = Math.min(
    -STABLE_VERTICAL_MARGIN,
    ...nodes.map((node) => node.y - GRAPH_NODE_PADDING),
    ...edges.map((edge) =>
      Math.min(edge.bounds.minimumY, edge.labelY - EDGE_LABEL_VERTICAL_PADDING),
    ),
  );
  const maximumX = Math.max(
    width + STABLE_HORIZONTAL_MARGIN,
    ...nodes.map((node) => node.x + GRAPH_NODE_PADDING),
    ...edges.map((edge) =>
      Math.max(
        edge.bounds.maximumX,
        edge.labelX + EDGE_LABEL_HORIZONTAL_PADDING,
      ),
    ),
  );
  const maximumY = Math.max(
    height + STABLE_VERTICAL_MARGIN,
    ...nodes.map((node) => node.y + GRAPH_NODE_PADDING),
    ...edges.map((edge) =>
      Math.max(edge.bounds.maximumY, edge.labelY + EDGE_LABEL_VERTICAL_PADDING),
    ),
  );
  return `${minimumX} ${minimumY} ${maximumX - minimumX} ${maximumY - minimumY}`;
}

function endpointPairKey(edge: PositionedGraphEdge): string {
  if (edge.source.id === edge.target.id) {
    return JSON.stringify(['loop', edge.source.id]);
  }
  const [firstId, secondId] = [edge.source.id, edge.target.id].sort();
  return JSON.stringify(['pair', firstId, secondId]);
}

function edgeGeometry(
  edge: PositionedGraphEdge,
  siblingIndex: number,
  siblingCount: number,
): GraphEdgeGeometry {
  const { source, target } = edge;
  if (source.id === target.id) {
    const radius = SELF_LOOP_BASE_RADIUS + siblingIndex * SELF_LOOP_RADIUS_GAP;
    return {
      id: edge.id,
      path: `M ${source.x} ${source.y - GRAPH_NODE_RADIUS} C ${source.x + radius} ${source.y - radius}, ${source.x + radius} ${source.y + radius}, ${source.x + GRAPH_NODE_RADIUS} ${source.y}`,
      labelX: source.x + radius,
      labelY: source.y - radius * 0.72,
      bounds: {
        minimumX: source.x - GRAPH_NODE_RADIUS,
        minimumY: source.y - radius,
        maximumX: source.x + radius,
        maximumY: source.y + radius,
      },
    };
  }

  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const distance = Math.hypot(deltaX, deltaY);
  const fallback = coincidentDirection(source.id, target.id);
  const endpointDirection = source.id < target.id ? 1 : -1;
  const unitX =
    distance === 0 ? fallback.x * endpointDirection : deltaX / distance;
  const unitY =
    distance === 0 ? fallback.y * endpointDirection : deltaY / distance;
  const sourceX = source.x + unitX * GRAPH_NODE_RADIUS;
  const sourceY = source.y + unitY * GRAPH_NODE_RADIUS;
  const targetX = target.x - unitX * GRAPH_NODE_RADIUS;
  const targetY = target.y - unitY * GRAPH_NODE_RADIUS;
  const canonicalDirection = source.id < target.id ? 1 : -1;
  const canonicalNormalX = -unitY * canonicalDirection;
  const canonicalNormalY = unitX * canonicalDirection;
  const offset = (siblingIndex - (siblingCount - 1) / 2) * PARALLEL_EDGE_GAP;
  const controlX = (source.x + target.x) / 2 + canonicalNormalX * offset;
  const controlY = (source.y + target.y) / 2 + canonicalNormalY * offset;
  const labelX = (sourceX + 2 * controlX + targetX) / 4;
  const labelY = (sourceY + 2 * controlY + targetY) / 4;

  return {
    id: edge.id,
    path: `M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`,
    labelX,
    labelY,
    bounds: {
      minimumX: Math.min(sourceX, controlX, targetX),
      minimumY: Math.min(sourceY, controlY, targetY),
      maximumX: Math.max(sourceX, controlX, targetX),
      maximumY: Math.max(sourceY, controlY, targetY),
    },
  };
}

function coincidentDirection(
  firstId: string,
  secondId: string,
): {
  readonly x: number;
  readonly y: number;
} {
  const key = JSON.stringify(['pair', ...[firstId, secondId].sort()]);
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16_777_619) >>> 0;
  }
  const angle = (hash / 2 ** 32) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
