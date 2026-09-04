import { select } from 'd3';

import type { LinkedListSceneState } from '../scene';
import { VISUALIZATION_TRANSITION_MS, type D3RenderFunction } from './D3Scene';
import {
  createStringAttributeTween,
  createTransformTween,
} from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';

type LinkedListNode = LinkedListSceneState['nodes'][number];

type PositionedLinkedListNode = {
  readonly node: LinkedListNode;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly markerNames: readonly string[];
  readonly isVisited: boolean;
  readonly isHead: boolean;
  readonly isTail: boolean;
};

type LinkedListConnection = {
  readonly id: string;
  readonly kind: 'next' | 'previous';
  readonly path: string;
};

const NODE_WIDTH = 116;
const NODE_HEIGHT = 64;
const NODE_GAP = 84;
const HORIZONTAL_PADDING = 64;
const NODE_Y = 92;
const VIEW_HEIGHT = 228;

export function createLinkedListConnectionId(
  kind: LinkedListConnection['kind'],
  sourceId: string,
  targetId: string,
): string {
  return JSON.stringify([kind, sourceId, targetId]);
}

export function getLinkedListDisplayOrder(
  scene: LinkedListSceneState,
): readonly LinkedListNode[] {
  const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== scene.nodes.length) {
    throw new Error('Linked-list SceneState contains duplicate node IDs.');
  }
  const visitedIds = new Set<string>();
  const orderedNodes: LinkedListNode[] = [];

  function appendSegment(startId: string | null): void {
    let currentId = startId;

    while (currentId !== null && !visitedIds.has(currentId)) {
      const node = nodesById.get(currentId);
      if (node === undefined) {
        throw new Error(
          `Linked-list node "${currentId}" is missing from SceneState.`,
        );
      }

      orderedNodes.push(node);
      visitedIds.add(node.id);
      currentId = node.nextId;
    }
  }

  appendSegment(scene.headId);
  for (const node of scene.nodes) {
    if (!visitedIds.has(node.id)) appendSegment(node.id);
  }

  return orderedNodes;
}

function connectionPath(
  source: PositionedLinkedListNode,
  target: PositionedLinkedListNode,
  kind: LinkedListConnection['kind'],
): string {
  const isForward = target.index > source.index;
  const sourceX = isForward ? source.x + NODE_WIDTH : source.x;
  const targetX = isForward ? target.x : target.x + NODE_WIDTH;
  const laneOffset = kind === 'next' ? -7 : 7;
  const y = source.y + NODE_HEIGHT / 2 + laneOffset;

  if (Math.abs(target.index - source.index) === 1) {
    const firstControlX = sourceX + (targetX - sourceX) / 3;
    const secondControlX = sourceX + ((targetX - sourceX) * 2) / 3;
    return `M ${sourceX} ${y} C ${firstControlX} ${y}, ${secondControlX} ${y}, ${targetX} ${y}`;
  }

  const targetY = target.y + NODE_HEIGHT / 2 + laneOffset;
  const arcY = kind === 'next' ? 32 : VIEW_HEIGHT - 28;
  return `M ${sourceX} ${y} C ${sourceX} ${arcY}, ${targetX} ${arcY}, ${targetX} ${targetY}`;
}

export const renderLinkedList: D3RenderFunction<LinkedListSceneState> = (
  svg,
  scene,
) => {
  const markerNames = new Map<string, string[]>();
  for (const [name, nodeIds] of Object.entries(scene.markers)) {
    for (const nodeId of nodeIds) {
      const names = markerNames.get(nodeId) ?? [];
      names.push(name);
      markerNames.set(nodeId, names);
    }
  }

  const visitedIds = new Set(scene.visitedNodeIds);
  const positionedNodes: readonly PositionedLinkedListNode[] =
    getLinkedListDisplayOrder(scene).map((node, index) => ({
      node,
      index,
      x: HORIZONTAL_PADDING + index * (NODE_WIDTH + NODE_GAP),
      y: NODE_Y,
      markerNames: markerNames.get(node.id) ?? [],
      isVisited: visitedIds.has(node.id),
      isHead: scene.headId === node.id,
      isTail: scene.tailId === node.id,
    }));
  const positionedById = new Map(
    positionedNodes.map((positioned) => [positioned.node.id, positioned]),
  );
  const connections: LinkedListConnection[] = [];
  const rendersPrevious =
    scene.kind === 'doubly' || scene.kind === 'circular-doubly';

  for (const source of positionedNodes) {
    if (source.node.nextId !== null) {
      const target = positionedById.get(source.node.nextId);
      if (target !== undefined) {
        connections.push({
          id: createLinkedListConnectionId(
            'next',
            source.node.id,
            target.node.id,
          ),
          kind: 'next',
          path: connectionPath(source, target, 'next'),
        });
      } else {
        throw new Error(
          `Linked-list node "${source.node.nextId}" is missing from SceneState.`,
        );
      }
    }

    if (rendersPrevious && source.node.previousId != null) {
      const target = positionedById.get(source.node.previousId);
      if (target !== undefined) {
        connections.push({
          id: createLinkedListConnectionId(
            'previous',
            source.node.id,
            target.node.id,
          ),
          kind: 'previous',
          path: connectionPath(source, target, 'previous'),
        });
      } else {
        throw new Error(
          `Linked-list node "${source.node.previousId}" is missing from SceneState.`,
        );
      }
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
  updateVisualizationViewBox(svg, `0 0 ${width} ${VIEW_HEIGHT}`, hadRoot);
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
        enter
          .append('path')
          .attr('d', (connection) => connection.path)
          .style('opacity', hadRoot ? 0 : 1),
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-edge-id', (connection) => connection.id)
    .attr(
      'class',
      (connection) =>
        `visualization-edge visualization-list-connection visualization-list-connection--${connection.kind}`,
    )
    .attr('marker-end', 'url(#linked-list-arrowhead)');

  connectionPaths
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'd',
      createStringAttributeTween<LinkedListConnection>(
        'd',
        (connection) => connection.path,
      ),
    );

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
          .style('opacity', hadRoot ? 0 : 1)
          .attr(
            'transform',
            (positioned) =>
              `translate(${positioned.x}, ${hadRoot ? positioned.y - NODE_HEIGHT : positioned.y})`,
          );
        group.append('rect').attr('class', 'visualization-node');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-marker');
        group.append('text').attr('class', 'visualization-node-role');
        return group;
      },
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attrTween(
            'transform',
            createTransformTween<PositionedLinkedListNode>(
              (positioned) =>
                `translate(${positioned.x}, ${positioned.y + NODE_HEIGHT})`,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-node-id', (positioned) => positioned.node.id)
    .classed('visualization-visited', (positioned) => positioned.isVisited)
    .classed('visualization-head', (positioned) => positioned.isHead)
    .classed('visualization-tail', (positioned) => positioned.isTail)
    .classed(
      'visualization-marked',
      (positioned) => positioned.markerNames.length > 0,
    );

  groups
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'transform',
      createTransformTween<PositionedLinkedListNode>(
        (positioned) => `translate(${positioned.x}, ${positioned.y})`,
      ),
    );

  groups
    .select<SVGRectElement>('rect.visualization-node')
    .attr('width', NODE_WIDTH)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 10);
  groups
    .select<SVGTextElement>('text.visualization-value')
    .attr('x', NODE_WIDTH / 2)
    .attr('y', NODE_HEIGHT / 2 - 4)
    .attr('dy', '0.35em')
    .text((positioned) => String(positioned.node.value));
  groups
    .select<SVGTextElement>('text.visualization-marker')
    .attr('x', NODE_WIDTH / 2)
    .attr('y', NODE_HEIGHT + 20)
    .text((positioned) => positioned.markerNames.join(', '));
  groups
    .select<SVGTextElement>('text.visualization-node-role')
    .attr('x', NODE_WIDTH / 2)
    .attr('y', -14)
    .text((positioned) =>
      [positioned.isHead && 'HEAD', positioned.isTail && 'TAIL']
        .filter(Boolean)
        .join(' · '),
    );
};
