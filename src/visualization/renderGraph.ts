import { select } from 'd3';

import type { GraphSceneState } from '../scene';
import type { D3RenderFunction } from './D3Scene';
import {
  createGraphEdgeGeometries,
  createGraphViewBox,
  GRAPH_NODE_RADIUS,
  type GraphEdgeGeometry,
} from './graphGeometry';
import {
  createGraphLayout,
  type PositionedGraphEdge,
  type PositionedGraphNode,
} from './graphLayout';
import {
  createStringAttributeTween,
  createTransformTween,
} from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';
import { VISUALIZATION_TRANSITION_MS } from './visualizationTransition';

type RenderedGraphNode = PositionedGraphNode & {
  readonly isMarked: boolean;
  readonly isVisited: boolean;
};

type RenderedGraphEdge = PositionedGraphEdge &
  GraphEdgeGeometry & {
    readonly isMarked: boolean;
    readonly isVisited: boolean;
  };

export const renderGraph: D3RenderFunction<GraphSceneState> = (
  svg,
  scene,
  context,
) => {
  const layout = createGraphLayout(scene);
  const markedNodeIds = new Set(
    Object.entries(scene.nodeMarkers).flatMap(([name, ids]) =>
      name === 'path' ? [] : ids,
    ),
  );
  const markedEdgeIds = new Set(
    Object.entries(scene.edgeMarkers).flatMap(([name, ids]) =>
      name === 'path' ? [] : ids,
    ),
  );
  const activePath = scene.scopeStack
    .map((scope) => scope.target)
    .filter(
      (target): target is string =>
        target !== null && scene.nodes.some((node) => node.id === target),
    );
  const pathNodeIds = new Set(activePath);
  const pathEdgeIds = new Set(
    activePath.slice(1).map((node, index) => `${activePath[index]}->${node}`),
  );

  const visitedNodeIds = new Set(scene.visitedNodeIds);
  const visitedEdgeIds = new Set(scene.visitedEdgeIds);
  const discoveredNodeIds = new Set(scene.discoveredNodeIds);
  const predecessorEdgeIds = new Set(
    scene.edges
      .filter(
        (edge) =>
          edge.directed === true && scene.predecessors[edge.to] === edge.from,
      )
      .map((edge) => edge.id),
  );
  const nodes: readonly RenderedGraphNode[] = layout.nodes.map((node) => ({
    ...node,
    isMarked:
      markedNodeIds.has(node.id) ||
      pathNodeIds.has(node.id) ||
      (discoveredNodeIds.has(node.id) && !visitedNodeIds.has(node.id)) ||
      scene.frontier.includes(node.id) ||
      scene.currentNodeId === node.id,
    isVisited: visitedNodeIds.has(node.id),
  }));
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
      isMarked:
        markedEdgeIds.has(edge.id) ||
        pathEdgeIds.has(edge.id) ||
        predecessorEdgeIds.has(edge.id) ||
        scene.currentEdgeId === edge.id,
      isVisited: visitedEdgeIds.has(edge.id),
    };
  });
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-graph').empty();
  updateVisualizationViewBox(
    svg,
    createGraphViewBox(layout.width, layout.height, nodes, edges),
    hadRoot && context?.animate === true,
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
      (enter) => enter.append('path').attr('d', (edge) => edge.path),
      (update) => update,
    )
    .attr('data-edge-id', (edge) => edge.id)
    .style('opacity', 1)
    .attr('class', 'visualization-edge visualization-graph-edge')
    .classed('visualization-visited-edge', (edge) => edge.isVisited)
    .classed('visualization-marked-edge', (edge) => edge.isMarked)
    .attr('marker-end', (edge) =>
      edge.edge.directed === true ? 'url(#graph-arrowhead)' : null,
    );

  if (context?.animate)
    edgePaths
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attrTween(
        'd',
        createStringAttributeTween<RenderedGraphEdge>('d', (edge) => edge.path),
      );
  else edgePaths.attr('d', (edge) => edge.path);

  root
    .selectAll<SVGTextElement, RenderedGraphEdge>(
      'text.visualization-edge-weight',
    )
    .data(
      edges.filter((edge) => edge.edge.weight !== undefined),
      (edge) => edge.id,
    )
    .join('text')
    .attr('class', 'visualization-edge-weight')
    .attr('x', (edge) => edge.labelX)
    .attr('y', (edge) => edge.labelY)
    .text((edge) => edge.edge.weight ?? '');

  const nodeGroups = root
    .selectAll<SVGGElement, RenderedGraphNode>('g.visualization-graph-node')
    .data(nodes, (node) => node.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-graph-node')
          .attr('transform', (node) => `translate(${node.x}, ${node.y})`);
        group.append('circle').attr('class', 'visualization-node');
        group.append('text').attr('class', 'visualization-number');
        group.append('text').attr('class', 'visualization-distance');
        return group;
      },
      (update) => update,
    )
    .attr('data-node-id', (node) => node.id)
    .style('opacity', 1)
    .classed('visualization-visited', (node) => node.isVisited)
    .classed('visualization-marked', (node) => node.isMarked);
  if (context?.animate)
    nodeGroups
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attrTween(
        'transform',
        createTransformTween<RenderedGraphNode>(
          (node) => `translate(${node.x}, ${node.y})`,
        ),
      );
  else
    nodeGroups.attr('transform', (node) => `translate(${node.x}, ${node.y})`);
  nodeGroups
    .select<SVGCircleElement>('circle.visualization-node')
    .attr('r', GRAPH_NODE_RADIUS);
  nodeGroups
    .select<SVGTextElement>('text.visualization-number')
    .attr('dy', '0.35em')
    .text((node, index) =>
      typeof node.node.value === 'number'
        ? String(node.node.value)
        : /^-?\d+(?:\.\d+)?$/.test(node.id)
          ? node.id
          : index,
    );
  nodeGroups
    .select<SVGTextElement>('text.visualization-distance')
    .attr('y', -GRAPH_NODE_RADIUS - 11)
    .text((node) => {
      const distance = scene.distances[node.id];
      return [
        ...(typeof distance === 'number' ? [distance] : []),
        ...Object.values(scene.nodeMetrics[node.id] ?? {}),
      ].join(', ');
    });
};
