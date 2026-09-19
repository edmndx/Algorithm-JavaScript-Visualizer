import { select } from 'd3';

import type { LinkedListSceneState } from '../scene';
import type { D3RenderFunction } from './D3Scene';
import {
  createStringAttributeTween,
  createTransformTween,
} from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';
import { VISUALIZATION_TRANSITION_MS } from './visualizationTransition';

type LinkedListNode = LinkedListSceneState['nodes'][number];

type PositionedLinkedListNode = {
  readonly node: LinkedListNode;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly isMarked: boolean;
  readonly isHead: boolean;
  readonly isTail: boolean;
};

type LinkedListConnection = {
  readonly id: string;
  readonly path: string;
};

const NODE_WIDTH = 116;
const NODE_HEIGHT = 64;
const NODE_GAP = 84;
const HORIZONTAL_PADDING = 64;
const NODE_Y = 92;
const VIEW_HEIGHT = 228;

function getLinkedListDisplayOrder(
  scene: LinkedListSceneState,
): readonly LinkedListNode[] {
  const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
  const visitedIds = new Set<string>();
  const orderedNodes: LinkedListNode[] = [];
  let currentId = scene.headId;
  while (currentId !== null && !visitedIds.has(currentId)) {
    const node = nodesById.get(currentId)!;
    orderedNodes.push(node);
    visitedIds.add(node.id);
    currentId = node.nextId;
  }
  return orderedNodes;
}

function connectionPath(
  source: PositionedLinkedListNode,
  target: PositionedLinkedListNode,
): string {
  const isForward = target.index > source.index;
  const sourceX = isForward ? source.x + NODE_WIDTH : source.x;
  const targetX = isForward ? target.x : target.x + NODE_WIDTH;
  const laneOffset = -7;
  const y = source.y + NODE_HEIGHT / 2 + laneOffset;

  if (Math.abs(target.index - source.index) === 1) {
    const firstControlX = sourceX + (targetX - sourceX) / 3;
    const secondControlX = sourceX + ((targetX - sourceX) * 2) / 3;
    return `M ${sourceX} ${y} C ${firstControlX} ${y}, ${secondControlX} ${y}, ${targetX} ${y}`;
  }

  const targetY = target.y + NODE_HEIGHT / 2 + laneOffset;
  const arcY = 32;
  return `M ${sourceX} ${y} C ${sourceX} ${arcY}, ${targetX} ${arcY}, ${targetX} ${targetY}`;
}

export const renderLinkedList: D3RenderFunction<LinkedListSceneState> = (
  svg,
  scene,
  context,
) => {
  const markedIds = new Set([
    ...Object.values(scene.markers).flat(),
    ...Object.values(scene.pointers),
    ...(scene.comparison?.nodeIds ?? []),
  ]);

  const positionedNodes: readonly PositionedLinkedListNode[] =
    getLinkedListDisplayOrder(scene).map((node, index) => ({
      node,
      index,
      x: HORIZONTAL_PADDING + index * (NODE_WIDTH + NODE_GAP),
      y: NODE_Y,
      isMarked: markedIds.has(node.id),
      isHead: scene.headId === node.id,
      isTail: scene.tailId === node.id,
    }));
  const positionedById = new Map(
    positionedNodes.map((positioned) => [positioned.node.id, positioned]),
  );
  const connections: LinkedListConnection[] = [];
  for (const source of positionedNodes) {
    if (source.node.nextId !== null) {
      const target = positionedById.get(source.node.nextId)!;
      connections.push({
        id: JSON.stringify(['next', source.node.id, target.node.id]),
        path: connectionPath(source, target),
      });
    }
  }

  const contentWidth = Math.max(
    NODE_WIDTH,
    positionedNodes.length * NODE_WIDTH +
      Math.max(0, positionedNodes.length - 1) * NODE_GAP,
  );
  const width = HORIZONTAL_PADDING * 2 + contentWidth;
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-linked-list').empty();
  updateVisualizationViewBox(
    svg,
    `0 0 ${width} ${VIEW_HEIGHT}`,
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
    .attr('id', 'linked-list-arrowhead')
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
    .selectAll<SVGGElement, null>('g.visualization-linked-list')
    .data([null])
    .join('g')
    .attr('class', 'visualization-linked-list');

  const connectionPaths = root
    .selectAll<SVGPathElement, LinkedListConnection>(
      'path.visualization-list-connection',
    )
    .data(connections, (connection) => connection.id)
    .join(
      (enter) =>
        enter.append('path').attr('d', (connection) => connection.path),
      (update) => update,
    )
    .attr('data-edge-id', (connection) => connection.id)
    .style('opacity', 1)
    .attr(
      'class',
      'visualization-edge visualization-list-connection visualization-list-connection--next',
    )
    .attr('marker-end', 'url(#linked-list-arrowhead)');

  if (context?.animate)
    connectionPaths
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attrTween(
        'd',
        createStringAttributeTween<LinkedListConnection>(
          'd',
          (connection) => connection.path,
        ),
      );
  else connectionPaths.attr('d', (connection) => connection.path);

  const groups = root
    .selectAll<SVGGElement, PositionedLinkedListNode>(
      'g.visualization-list-node',
    )
    .data(positionedNodes, (positioned) => positioned.node.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-list-node')
          .attr(
            'transform',
            (positioned) => `translate(${positioned.x}, ${positioned.y})`,
          );
        group.append('rect').attr('class', 'visualization-node');
        group.append('text').attr('class', 'visualization-number');
        return group;
      },
      (update) => update,
    )
    .attr('data-node-id', (positioned) => positioned.node.id)
    .style('opacity', 1)
    .classed('visualization-head', (positioned) => positioned.isHead)
    .classed('visualization-tail', (positioned) => positioned.isTail)
    .classed('visualization-marked', (positioned) => positioned.isMarked);

  if (context?.animate)
    groups
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attrTween(
        'transform',
        createTransformTween<PositionedLinkedListNode>(
          (positioned) => `translate(${positioned.x}, ${positioned.y})`,
        ),
      );
  else
    groups.attr(
      'transform',
      (positioned) => `translate(${positioned.x}, ${positioned.y})`,
    );

  groups
    .select<SVGRectElement>('rect.visualization-node')
    .attr('width', NODE_WIDTH)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 10);
  groups
    .select<SVGTextElement>('text.visualization-number')
    .attr('x', NODE_WIDTH / 2)
    .attr('y', NODE_HEIGHT / 2)
    .attr('dy', '0.35em')
    .text((positioned) =>
      typeof positioned.node.value === 'number'
        ? String(positioned.node.value)
        : '',
    );
};
