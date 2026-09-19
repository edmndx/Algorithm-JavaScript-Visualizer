import { select } from 'd3';

import type { TreeSceneState } from '../scene';
import type { D3RenderFunction } from './D3Scene';
import {
  createStringAttributeTween,
  createTransformTween,
} from './transformTween';
import {
  createTreeLayout,
  type PositionedTreeLink,
  type PositionedTreeNode,
} from './treeLayout';
import { updateVisualizationViewBox } from './viewBoxTransition';
import { VISUALIZATION_TRANSITION_MS } from './visualizationTransition';

type RenderedTreeNode = PositionedTreeNode & {
  readonly isMarked: boolean;
  readonly isCompared: boolean;
  readonly isVisited: boolean;
  readonly isRoot: boolean;
};

const NODE_RADIUS = 25;

function treeLinkPath(link: PositionedTreeLink): string {
  const middleY = (link.source.y + link.target.y) / 2;
  return `M ${link.source.x} ${link.source.y} C ${link.source.x} ${middleY}, ${link.target.x} ${middleY}, ${link.target.x} ${link.target.y}`;
}

export const renderTree: D3RenderFunction<TreeSceneState> = (
  svg,
  scene,
  context,
) => {
  const layout = createTreeLayout(scene);
  const markedIds = new Set(
    Object.entries(scene.markers).flatMap(([name, ids]) =>
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
    activePath
      .slice(1)
      .map((node, index) => JSON.stringify([activePath[index], node])),
  );

  const comparedIds = new Set(scene.comparedNodeIds ?? []);
  const visitedIds = new Set(scene.visitedNodeIds);
  const nodes: readonly RenderedTreeNode[] = layout.nodes.map((positioned) => ({
    ...positioned,
    isMarked: markedIds.has(positioned.id) || pathNodeIds.has(positioned.id),
    isCompared: comparedIds.has(positioned.id),
    isVisited: visitedIds.has(positioned.id),
    isRoot: positioned.id === scene.rootId,
  }));
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-tree').empty();
  updateVisualizationViewBox(
    svg,
    `0 0 ${layout.width} ${layout.height}`,
    hadRoot && context?.animate === true,
  );
  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-tree')
    .data([null])
    .join('g')
    .attr('class', 'visualization-tree');

  const linkPaths = root
    .selectAll<SVGPathElement, PositionedTreeLink>(
      'path.visualization-tree-link',
    )
    .data(layout.links, (link) => link.id)
    .join(
      (enter) => enter.append('path').attr('d', treeLinkPath),
      (update) => update,
    )
    .attr('data-edge-id', (link) => link.id)
    .style('opacity', 1)
    .attr('class', 'visualization-edge visualization-tree-link')
    .classed('visualization-visited-edge', (link) => pathEdgeIds.has(link.id));

  if (context?.animate)
    linkPaths
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attrTween(
        'd',
        createStringAttributeTween<PositionedTreeLink>('d', treeLinkPath),
      );
  else linkPaths.attr('d', treeLinkPath);

  const groups = root
    .selectAll<SVGGElement, RenderedTreeNode>('g.visualization-tree-node')
    .data(nodes, (node) => node.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-tree-node')
          .attr('transform', (node) => `translate(${node.x}, ${node.y})`);
        group.append('circle').attr('class', 'visualization-node');
        group.append('text').attr('class', 'visualization-number');
        return group;
      },
      (update) => update,
    )
    .attr('data-node-id', (node) => node.id)
    .style('opacity', 1)
    .classed('visualization-compared', (node) => node.isCompared)
    .classed('visualization-visited', (node) => node.isVisited)
    .classed('visualization-root', (node) => node.isRoot)
    .classed('visualization-marked', (node) => node.isMarked);

  if (context?.animate)
    groups
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attrTween(
        'transform',
        createTransformTween<RenderedTreeNode>(
          (node) => `translate(${node.x}, ${node.y})`,
        ),
      );
  else groups.attr('transform', (node) => `translate(${node.x}, ${node.y})`);

  groups
    .select<SVGCircleElement>('circle.visualization-node')
    .attr('r', NODE_RADIUS);
  groups
    .select<SVGTextElement>('text.visualization-number')
    .attr('dy', '0.35em')
    .text((node) =>
      typeof node.node.value === 'number'
        ? String(node.node.value)
        : /^-?\d+(?:\.\d+)?$/.test(node.id)
          ? node.id
          : '',
    );
};
