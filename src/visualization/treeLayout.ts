import { hierarchy, tree } from 'd3';

import type { TreeSceneState } from '../scene';
import { MAX_VISUALIZATION_VIEWBOX_DIMENSION } from './visualizationLimits';

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

export type TreeLayout = {
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
const COMPONENT_GAP = HORIZONTAL_GAP;
const MAX_ROW_WIDTH = MAX_VISUALIZATION_VIEWBOX_DIMENSION - LAYOUT_PADDING * 2;

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
  if (nodesById.size !== scene.nodes.length) {
    throw new Error('Tree SceneState contains duplicate node IDs.');
  }
  if (scene.rootId !== null && !nodesById.has(scene.rootId)) {
    throw new Error(`Tree root "${scene.rootId}" is missing from SceneState.`);
  }

  const componentRoots = validateTreeTopology(scene.rootId, nodesById);
  const components = componentRoots.map((componentRoot) => {
    const hierarchyRoot = hierarchy(componentRoot, (node) =>
      node.children.map((childId) => {
        const child = nodesById.get(childId);
        if (child === undefined) {
          throw new Error(
            `Tree child "${childId}" is missing from SceneState.`,
          );
        }
        return child;
      }),
    );
    const laidOutRoot = tree<TreeNode>().nodeSize([
      HORIZONTAL_GAP,
      VERTICAL_GAP,
    ])(hierarchyRoot);
    const descendants = laidOutRoot.descendants();
    const minimumX = Math.min(...descendants.map((node) => node.x));
    const maximumX = Math.max(...descendants.map((node) => node.x));
    return {
      descendants,
      links: laidOutRoot.links(),
      minimumX,
      maximumX,
      maximumY: Math.max(...descendants.map((node) => node.y)),
      slotWidth: Math.max(HORIZONTAL_GAP, maximumX - minimumX),
    };
  });
  const rows: Array<{
    readonly components: (typeof components)[number][];
    contentWidth: number;
    contentHeight: number;
  }> = [];
  for (const component of components) {
    const currentRow = rows.at(-1);
    const nextWidth =
      (currentRow?.contentWidth ?? 0) +
      (currentRow === undefined ? 0 : COMPONENT_GAP) +
      component.slotWidth;
    if (currentRow === undefined || nextWidth > MAX_ROW_WIDTH) {
      rows.push({
        components: [component],
        contentWidth: component.slotWidth,
        contentHeight: Math.max(VERTICAL_GAP, component.maximumY),
      });
    } else {
      currentRow.components.push(component);
      currentRow.contentWidth = nextWidth;
      currentRow.contentHeight = Math.max(
        currentRow.contentHeight,
        component.maximumY,
      );
    }
  }
  const contentWidth = Math.max(...rows.map((row) => row.contentWidth));
  const contentHeight = rows.reduce(
    (total, row, index) =>
      total + row.contentHeight + (index === 0 ? 0 : COMPONENT_GAP),
    0,
  );
  const width = Math.max(EMPTY_WIDTH, contentWidth + LAYOUT_PADDING * 2);
  const height = Math.max(EMPTY_HEIGHT, contentHeight + LAYOUT_PADDING * 2);
  const positionedById = new Map<string, PositionedTreeNode>();
  const nodes: PositionedTreeNode[] = [];
  let rowOffsetY = (height - contentHeight) / 2;
  for (const row of rows) {
    let componentOffsetX = (width - row.contentWidth) / 2;
    for (const [index, component] of row.components.entries()) {
      if (index > 0) componentOffsetX += COMPONENT_GAP;
      const centerOffset =
        componentOffsetX +
        component.slotWidth / 2 -
        (component.minimumX + component.maximumX) / 2;
      for (const node of component.descendants) {
        const positionedNode: PositionedTreeNode = {
          id: node.data.id,
          node: node.data,
          x: node.x + centerOffset,
          y: node.y + rowOffsetY,
        };
        positionedById.set(positionedNode.id, positionedNode);
        nodes.push(positionedNode);
      }
      componentOffsetX += component.slotWidth;
    }
    rowOffsetY += row.contentHeight + COMPONENT_GAP;
  }
  const links = components
    .flatMap((component) => component.links)
    .map((link) => {
      const source = positionedById.get(link.source.data.id);
      const target = positionedById.get(link.target.data.id);
      if (source === undefined || target === undefined) {
        throw new Error(
          'Tree layout produced a link without positioned nodes.',
        );
      }
      return {
        id: JSON.stringify([source.id, target.id]),
        source,
        target,
      };
    });

  return { nodes, links, width, height };
}

function validateTreeTopology(
  rootId: string | null,
  nodesById: ReadonlyMap<string, TreeNode>,
): readonly TreeNode[] {
  const parentById = new Map<string, string>();

  for (const node of nodesById.values()) {
    const childIds = new Set<string>();
    for (const childId of node.children) {
      if (childIds.has(childId) || parentById.has(childId)) {
        throw new Error(`Tree node "${childId}" is referenced repeatedly.`);
      }
      if (!nodesById.has(childId)) {
        throw new Error(`Tree child "${childId}" is missing from SceneState.`);
      }
      childIds.add(childId);
      parentById.set(childId, node.id);
    }
  }
  if (rootId !== null && parentById.has(rootId)) {
    throw new Error(`Tree root "${rootId}" is referenced as a child.`);
  }

  const completedIds = new Set<string>();
  const activeIds = new Set<string>();

  function visit(nodeId: string): void {
    if (activeIds.has(nodeId)) {
      throw new Error(`Tree node "${nodeId}" is referenced repeatedly.`);
    }
    if (completedIds.has(nodeId)) return;

    const node = nodesById.get(nodeId);
    if (node === undefined) {
      throw new Error(`Tree child "${nodeId}" is missing from SceneState.`);
    }

    activeIds.add(nodeId);
    for (const childId of node.children) visit(childId);
    activeIds.delete(nodeId);
    completedIds.add(nodeId);
  }

  for (const nodeId of nodesById.keys()) visit(nodeId);

  const roots: TreeNode[] = [];
  if (rootId !== null) {
    const root = nodesById.get(rootId);
    if (root === undefined) {
      throw new Error(`Tree root "${rootId}" is missing from SceneState.`);
    }
    roots.push(root);
  }
  for (const node of nodesById.values()) {
    if (node.id !== rootId && !parentById.has(node.id)) roots.push(node);
  }
  return roots;
}
