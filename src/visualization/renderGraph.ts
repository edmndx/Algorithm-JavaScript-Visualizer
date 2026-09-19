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
import { indexMarkerNames } from './indexMarkerNames';
import {
  createStringAttributeTween,
  createTransformTween,
} from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';
import { VISUALIZATION_TRANSITION_MS } from './visualizationTransition';

type RenderedGraphNode = PositionedGraphNode & {
  readonly markerNames: readonly string[];
  readonly distanceLabel: string | null;
  readonly isVisited: boolean;
};

type RenderedGraphEdge = PositionedGraphEdge &
  GraphEdgeGeometry & {
    readonly markerNames: readonly string[];
    readonly isVisited: boolean;
  };

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

export const renderGraph: D3RenderFunction<GraphSceneState> = (svg, scene) => {
  const layout = createGraphLayout(scene);
  const nodeMarkerNames = indexMarkerNames(scene.nodeMarkers);
  const edgeMarkerNames = indexMarkerNames(scene.edgeMarkers);

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
    .attr('r', GRAPH_NODE_RADIUS);
  nodeGroups
    .select<SVGTextElement>('text.visualization-value')
    .attr('dy', '0.35em')
    .text((node) => graphNodeText(node.node));
  nodeGroups
    .select<SVGTextElement>('text.visualization-marker')
    .attr('y', GRAPH_NODE_RADIUS + 17)
    .text((node) => node.markerNames.join(', '));
  nodeGroups
    .select<SVGTextElement>('text.visualization-distance')
    .attr('y', -GRAPH_NODE_RADIUS - 11)
    .text((node) => node.distanceLabel ?? '');
};
