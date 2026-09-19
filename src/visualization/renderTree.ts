import { select } from 'd3';

import type { TreeSceneState } from '../scene';
import { VISUALIZATION_TRANSITION_MS, type D3RenderFunction } from './D3Scene';
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

type RenderedTreeNode = PositionedTreeNode & {
  readonly markerNames: readonly string[];
  readonly semanticLabel: string;
  readonly isCompared: boolean;
  readonly isVisited: boolean;
  readonly isRoot: boolean;
  readonly isBoundsChecked: boolean;
  readonly boundsMatch: boolean;
  readonly isDepthActive: boolean;
};

const NODE_RADIUS = 25;

function treeLinkPath(link: PositionedTreeLink): string {
  const middleY = (link.source.y + link.target.y) / 2;
  return `M ${link.source.x} ${link.source.y} C ${link.source.x} ${middleY}, ${link.target.x} ${middleY}, ${link.target.x} ${link.target.y}`;
}

function collapsedTreeLinkPath(link: PositionedTreeLink): string {
  return `M ${link.source.x} ${link.source.y} C ${link.source.x} ${link.source.y}, ${link.source.x} ${link.source.y}, ${link.source.x} ${link.source.y}`;
}

function nodeText(node: PositionedTreeNode['node']): string {
  if (node.label !== undefined) return node.label;
  if (node.value !== undefined) return String(node.value);
  return node.id;
}

function boundsLabel(
  bounds: NonNullable<TreeSceneState['boundsCheck']>,
): string {
  return `(${bounds.lower ?? '−∞'}, ${bounds.upper ?? '+∞'})`;
}

export const renderTree: D3RenderFunction<TreeSceneState> = (svg, scene) => {
  const layout = createTreeLayout(scene);
  const markerNames = new Map<string, string[]>();
  for (const [name, nodeIds] of Object.entries(scene.markers)) {
    for (const nodeId of nodeIds) {
      const names = markerNames.get(nodeId) ?? [];
      names.push(name);
      markerNames.set(nodeId, names);
    }
  }

  const comparedIds = new Set(scene.comparedNodeIds ?? []);
  const visitedIds = new Set(scene.visitedNodeIds);
  const nodes: readonly RenderedTreeNode[] = layout.nodes.map((positioned) => ({
    ...positioned,
    markerNames: markerNames.get(positioned.id) ?? [],
    semanticLabel:
      scene.boundsCheck?.nodeId === positioned.id
        ? boundsLabel(scene.boundsCheck)
        : scene.depthByNodeId[positioned.id] === undefined
          ? ''
          : `d=${scene.depthByNodeId[positioned.id]}`,
    isCompared: comparedIds.has(positioned.id),
    isVisited: visitedIds.has(positioned.id),
    isRoot: positioned.id === scene.rootId,
    isBoundsChecked: scene.boundsCheck?.nodeId === positioned.id,
    boundsMatch:
      scene.boundsCheck?.nodeId === positioned.id && scene.boundsCheck.matches,
    isDepthActive: scene.activeDepthNodeId === positioned.id,
  }));
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-tree').empty();
  updateVisualizationViewBox(
    svg,
    `0 0 ${layout.width} ${layout.height}`,
    hadRoot,
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
      (enter) =>
        enter
          .append('path')
          .attr('d', hadRoot ? collapsedTreeLinkPath : treeLinkPath)
          .style('opacity', hadRoot ? 0 : 1),
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attrTween(
            'd',
            createStringAttributeTween<PositionedTreeLink>(
              'd',
              collapsedTreeLinkPath,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-edge-id', (link) => link.id)
    .attr('class', 'visualization-edge visualization-tree-link');

  linkPaths
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'd',
      createStringAttributeTween<PositionedTreeLink>('d', treeLinkPath),
    );

  const groups = root
    .selectAll<SVGGElement, RenderedTreeNode>('g.visualization-tree-node')
    .data(nodes, (node) => node.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-tree-node')
          .style('opacity', hadRoot ? 0 : 1)
          .attr(
            'transform',
            (node) =>
              `translate(${node.x}, ${hadRoot ? node.y - NODE_RADIUS * 2 : node.y})`,
          );
        group.append('circle').attr('class', 'visualization-node');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-tree-semantic');
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
            createTransformTween<RenderedTreeNode>(
              () => `translate(${layout.width / 2}, ${layout.height / 2})`,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-node-id', (node) => node.id)
    .classed('visualization-compared', (node) => node.isCompared)
    .classed('visualization-visited', (node) => node.isVisited)
    .classed('visualization-root', (node) => node.isRoot)
    .classed('visualization-bounds-checked', (node) => node.isBoundsChecked)
    .classed('visualization-bounds-match', (node) => node.boundsMatch)
    .classed(
      'visualization-bounds-mismatch',
      (node) => node.isBoundsChecked && !node.boundsMatch,
    )
    .classed('visualization-depth-active', (node) => node.isDepthActive)
    .classed('visualization-marked', (node) => node.markerNames.length > 0);

  groups
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'transform',
      createTransformTween<RenderedTreeNode>(
        (node) => `translate(${node.x}, ${node.y})`,
      ),
    );

  groups
    .select<SVGCircleElement>('circle.visualization-node')
    .attr('r', NODE_RADIUS);
  groups
    .select<SVGTextElement>('text.visualization-value')
    .attr('dy', '0.35em')
    .text((node) => nodeText(node.node));
  groups
    .select<SVGTextElement>('text.visualization-tree-semantic')
    .attr('y', -NODE_RADIUS - 10)
    .text((node) => node.semanticLabel);
  groups
    .select<SVGTextElement>('text.visualization-marker')
    .attr('y', NODE_RADIUS + 17)
    .text((node) => node.markerNames.join(', '));
};
