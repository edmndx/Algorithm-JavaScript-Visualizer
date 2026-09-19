import { hierarchy, tree } from 'd3';

import type { TreeSceneState } from '../scene';

type TreeNode = TreeSceneState['nodes'][number];

export type PositionedTreeNode = {
  readonly id: string;
  readonly node: TreeNode;
  readonly x: number;
  readonly y: number;
};

export type PositionedTreeLink = {
  readonly id: string;
  readonly source: PositionedTreeNode;
  readonly target: PositionedTreeNode;
};

type TreeLayout = {
  readonly nodes: readonly PositionedTreeNode[];
  readonly links: readonly PositionedTreeLink[];
  readonly width: number;
  readonly height: number;
};

const EMPTY_WIDTH = 240;
const EMPTY_HEIGHT = 160;
const HORIZONTAL_GAP = 104;
const VERTICAL_GAP = 104;
const LAYOUT_PADDING = 44;

export function createTreeLayout(scene: TreeSceneState): TreeLayout {
  if (scene.nodes.length === 0) {
    return {
      nodes: [],
      links: [],
      width: EMPTY_WIDTH,
      height: EMPTY_HEIGHT,
    };
  }

  const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
  const root = scene.rootId === null ? undefined : nodesById.get(scene.rootId);
  if (root === undefined) {
    throw new Error('Tree root is missing from SceneState.');
  }

  const laidOutRoot = tree<TreeNode>().nodeSize([HORIZONTAL_GAP, VERTICAL_GAP])(
    hierarchy(root, (node) =>
      node.children.map((childId) => nodesById.get(childId)!),
    ),
  );
  const descendants = laidOutRoot.descendants();
  const minimumX = Math.min(...descendants.map((node) => node.x));
  const maximumX = Math.max(...descendants.map((node) => node.x));
  const contentWidth = Math.max(HORIZONTAL_GAP, maximumX - minimumX);
  const contentHeight = Math.max(
    VERTICAL_GAP,
    ...descendants.map((node) => node.y),
  );
  const width = Math.max(EMPTY_WIDTH, contentWidth + LAYOUT_PADDING * 2);
  const height = Math.max(EMPTY_HEIGHT, contentHeight + LAYOUT_PADDING * 2);
  const offsetX = width / 2 - (minimumX + maximumX) / 2;
  const offsetY = (height - contentHeight) / 2;
  const nodes = descendants.map((node) => ({
    id: node.data.id,
    node: node.data,
    x: node.x + offsetX,
    y: node.y + offsetY,
  }));
  const positionedById = new Map(nodes.map((node) => [node.id, node]));
  const links = laidOutRoot.links().map((link) => {
    const source = positionedById.get(link.source.data.id)!;
    const target = positionedById.get(link.target.data.id)!;
    return {
      id: JSON.stringify([source.id, target.id]),
      source,
      target,
    };
  });

  return { nodes, links, width, height };
}
