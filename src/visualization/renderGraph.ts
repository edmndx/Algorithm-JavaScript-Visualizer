import { select } from 'd3';

import type { GraphSceneState } from '../scene';
import { VISUALIZATION_TRANSITION_MS, type D3RenderFunction } from './D3Scene';
import {
  createGraphLayout,
  type PositionedGraphEdge,
  type PositionedGraphNode,
} from './graphLayout';
import {
  createStringAttributeTween,
  createTransformTween,
} from './transformTween';
import { VISUALIZATION_READABILITY_LIMITS } from './visualizationLimits';
import { updateVisualizationViewBox } from './viewBoxTransition';

type RenderedGraphNode = PositionedGraphNode & {
  readonly markerNames: readonly string[];
  readonly distanceLabel: string | null;
  readonly isVisited: boolean;
};

type RenderedGraphEdge = PositionedGraphEdge & {
  readonly markerNames: readonly string[];
  readonly isVisited: boolean;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly bounds: GraphBounds;
};

const NODE_RADIUS = 24;
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

export type GraphBounds = {
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

function graphNodeText(node: PositionedGraphNode['node']): string {
  if (node.label !== undefined) return node.label;
  if (node.value !== undefined) return String(node.value);
  return node.id;
}

function collapsedGraphEdgePath(edge: PositionedGraphEdge): string {
  if (edge.source.id === edge.target.id) {
    return `M ${edge.source.x} ${edge.source.y} C ${edge.source.x} ${edge.source.y}, ${edge.source.x} ${edge.source.y}, ${edge.source.x} ${edge.source.y}`;
  }
  return `M ${edge.source.x} ${edge.source.y} Q ${edge.source.x} ${edge.source.y} ${edge.source.x} ${edge.source.y}`;
}

function endpointPairKey(edge: PositionedGraphEdge): string {
  if (edge.source.id === edge.target.id) {
    return JSON.stringify(['loop', edge.source.id]);
  }
  const [firstId, secondId] = [edge.source.id, edge.target.id].sort();
  return JSON.stringify(['pair', firstId, secondId]);
}

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
      path: `M ${source.x} ${source.y - NODE_RADIUS} C ${source.x + radius} ${source.y - radius}, ${source.x + radius} ${source.y + radius}, ${source.x + NODE_RADIUS} ${source.y}`,
      labelX: source.x + radius,
      labelY: source.y - radius * 0.72,
      bounds: {
        minimumX: source.x - NODE_RADIUS,
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
  const sourceX = source.x + unitX * NODE_RADIUS;
  const sourceY = source.y + unitY * NODE_RADIUS;
  const targetX = target.x - unitX * NODE_RADIUS;
  const targetY = target.y - unitY * NODE_RADIUS;
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

export const renderGraph: D3RenderFunction<GraphSceneState> = (svg, scene) => {
  const layout = createGraphLayout(scene);
  const nodeMarkerNames = new Map<string, string[]>();
  const edgeMarkerNames = new Map<string, string[]>();

  for (const [name, nodeIds] of Object.entries(scene.nodeMarkers)) {
    for (const nodeId of nodeIds) {
      const names = nodeMarkerNames.get(nodeId) ?? [];
      names.push(name);
      nodeMarkerNames.set(nodeId, names);
    }
  }
  for (const [name, edgeIds] of Object.entries(scene.edgeMarkers)) {
    for (const edgeId of edgeIds) {
      const names = edgeMarkerNames.get(edgeId) ?? [];
      names.push(name);
      edgeMarkerNames.set(edgeId, names);
    }
  }

  const visitedNodeIds = new Set(scene.visitedNodeIds);
  const visitedEdgeIds = new Set(scene.visitedEdgeIds);
  const nodes: readonly RenderedGraphNode[] = layout.nodes.map((node) => {
    const hasDistance = Object.prototype.hasOwnProperty.call(
      scene.distances,
      node.id,
    );
    const distance = scene.distances[node.id];
    return {
      ...node,
      markerNames: nodeMarkerNames.get(node.id) ?? [],
      distanceLabel: hasDistance
        ? `d: ${distance === null ? '∞' : String(distance)}`
        : null,
      isVisited: visitedNodeIds.has(node.id),
    };
  });
  const geometryById = new Map(
    createGraphEdgeGeometries(layout.edges).map((geometry) => [
      geometry.id,
      geometry,
    ]),
  );
  const edges: readonly RenderedGraphEdge[] = layout.edges.map((edge) => {
    const geometry = geometryById.get(edge.id);
    if (geometry === undefined) {
      throw new Error(`Graph edge "${edge.id}" has no rendered geometry.`);
    }
    return {
      ...edge,
      ...geometry,
      markerNames: edgeMarkerNames.get(edge.id) ?? [],
      isVisited: visitedEdgeIds.has(edge.id),
    };
  });
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-graph').empty();
  updateVisualizationViewBox(
    svg,
    createGraphViewBox(layout.width, layout.height, nodes, edges),
    hadRoot,
  );
  const definitions = selection
    .selectAll<SVGDefsElement, null>('defs.visualization-definitions')
    .data([null])
    .join('defs')
    .attr('class', 'visualization-definitions');
  definitions
    .selectAll<SVGMarkerElement, null>('marker.visualization-arrowhead')
    .data([null])
    .join('marker')
    .attr('class', 'visualization-arrowhead')
    .attr('id', 'graph-arrowhead')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 9)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .selectAll<SVGPathElement, null>('path')
    .data([null])
    .join('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5 Z');

  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-graph')
    .data([null])
    .join('g')
    .attr('class', 'visualization-graph');
  const edgePaths = root
    .selectAll<SVGPathElement, RenderedGraphEdge>(
      'path.visualization-graph-edge',
    )
    .data(edges, (edge) => edge.id)
    .join(
      (enter) =>
        enter
          .append('path')
          .attr('d', (edge) =>
            hadRoot ? collapsedGraphEdgePath(edge) : edge.path,
          )
          .style('opacity', hadRoot ? 0 : 1),
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attrTween(
            'd',
            createStringAttributeTween<RenderedGraphEdge>(
              'd',
              collapsedGraphEdgePath,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-edge-id', (edge) => edge.id)
    .attr('class', 'visualization-edge visualization-graph-edge')
    .classed('visualization-visited-edge', (edge) => edge.isVisited)
    .classed('visualization-marked-edge', (edge) => edge.markerNames.length > 0)
    .attr('marker-end', (edge) =>
      edge.edge.directed === true ? 'url(#graph-arrowhead)' : null,
    );

  edgePaths
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'd',
      createStringAttributeTween<RenderedGraphEdge>('d', (edge) => edge.path),
    );

  const edgeLabels = root
    .selectAll<SVGGElement, RenderedGraphEdge>(
      'g.visualization-graph-edge-label',
    )
    .data(edges, (edge) => edge.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-graph-edge-label')
          .style('opacity', hadRoot ? 0 : 1)
          .attr(
            'transform',
            (edge) =>
              `translate(${hadRoot ? edge.source.x : edge.labelX}, ${hadRoot ? edge.source.y : edge.labelY})`,
          );
        group.append('text').attr('class', 'visualization-edge-weight');
        group.append('text').attr('class', 'visualization-marker');
        return group;
      },
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attrTween(
            'transform',
            createTransformTween<RenderedGraphEdge>(
              (edge) => `translate(${edge.source.x}, ${edge.source.y})`,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-edge-id', (edge) => edge.id);
  edgeLabels
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'transform',
      createTransformTween<RenderedGraphEdge>(
        (edge) => `translate(${edge.labelX}, ${edge.labelY})`,
      ),
    );
  edgeLabels
    .select<SVGTextElement>('text.visualization-edge-weight')
    .text((edge) => edge.edge.weight ?? '');
  edgeLabels
    .select<SVGTextElement>('text.visualization-marker')
    .attr('y', 14)
    .text((edge) => edge.markerNames.join(', '));

  const nodeGroups = root
    .selectAll<SVGGElement, RenderedGraphNode>('g.visualization-graph-node')
    .data(nodes, (node) => node.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-graph-node')
          .style('opacity', hadRoot ? 0 : 1)
          .attr(
            'transform',
            (node) =>
              `translate(${hadRoot ? layout.width / 2 : node.x}, ${hadRoot ? layout.height / 2 : node.y})`,
          );
        group.append('circle').attr('class', 'visualization-node');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-marker');
        group.append('text').attr('class', 'visualization-distance');
        return group;
      },
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attrTween(
            'transform',
            createTransformTween<RenderedGraphNode>(
              () => `translate(${layout.width / 2}, ${layout.height / 2})`,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-node-id', (node) => node.id)
    .classed('visualization-visited', (node) => node.isVisited)
    .classed('visualization-marked', (node) => node.markerNames.length > 0);
  nodeGroups
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'transform',
      createTransformTween<RenderedGraphNode>(
        (node) => `translate(${node.x}, ${node.y})`,
      ),
    );
  nodeGroups
    .select<SVGCircleElement>('circle.visualization-node')
    .attr('r', NODE_RADIUS);
  nodeGroups
    .select<SVGTextElement>('text.visualization-value')
    .attr('dy', '0.35em')
    .text((node) => graphNodeText(node.node));
  nodeGroups
    .select<SVGTextElement>('text.visualization-marker')
    .attr('y', NODE_RADIUS + 17)
    .text((node) => node.markerNames.join(', '));
  nodeGroups
    .select<SVGTextElement>('text.visualization-distance')
    .attr('y', -NODE_RADIUS - 11)
    .text((node) => node.distanceLabel ?? '');
};
