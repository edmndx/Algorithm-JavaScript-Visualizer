import { scaleLinear } from 'd3';

import type { GraphSceneState } from '../scene';

type GraphNode = GraphSceneState['nodes'][number];
type GraphEdge = GraphSceneState['edges'][number];

export type PositionedGraphNode = {
  readonly id: string;
  readonly node: GraphNode;
  readonly x: number;
  readonly y: number;
};

export type PositionedGraphEdge = {
  readonly id: string;
  readonly edge: GraphEdge;
  readonly source: PositionedGraphNode;
  readonly target: PositionedGraphNode;
};

export type GraphLayout = {
  readonly nodes: readonly PositionedGraphNode[];
  readonly edges: readonly PositionedGraphEdge[];
  readonly width: number;
  readonly height: number;
};

const GRAPH_WIDTH = 640;
const GRAPH_HEIGHT = 420;
const GRAPH_PADDING = 64;

export function createGraphLayout(scene: GraphSceneState): GraphLayout {
  let nodes: readonly PositionedGraphNode[];

  if (scene.layout === 'fixed') {
    if (scene.positions === null) {
      throw new Error('A fixed graph requires positions in SceneState.');
    }
    const positions = scene.positions;

    const suppliedPositions = scene.nodes.map((node) => {
      const position = positions[node.id];
      if (position === undefined) {
        throw new Error(
          `Graph position for node "${node.id}" is missing from SceneState.`,
        );
      }
      return position;
    });
    const xValues = suppliedPositions.map((position) => position.x);
    const yValues = suppliedPositions.map((position) => position.y);
    const minimumX = xValues.length === 0 ? 0 : Math.min(...xValues);
    const maximumX = xValues.length === 0 ? 0 : Math.max(...xValues);
    const minimumY = yValues.length === 0 ? 0 : Math.min(...yValues);
    const maximumY = yValues.length === 0 ? 0 : Math.max(...yValues);
    const sourceWidth = maximumX - minimumX;
    const sourceHeight = maximumY - minimumY;
    const availableWidth = GRAPH_WIDTH - GRAPH_PADDING * 2;
    const availableHeight = GRAPH_HEIGHT - GRAPH_PADDING * 2;
    const scaleCandidates = [
      ...(sourceWidth > 0 ? [availableWidth / sourceWidth] : []),
      ...(sourceHeight > 0 ? [availableHeight / sourceHeight] : []),
    ];
    const uniformScale =
      scaleCandidates.length === 0 ? 1 : Math.min(...scaleCandidates);
    const sourceCenterX = minimumX + sourceWidth / 2;
    const sourceCenterY = minimumY + sourceHeight / 2;
    nodes = scene.nodes.map((node, index) => {
      const position = suppliedPositions[index];
      if (position === undefined) {
        throw new Error('Graph position lookup failed during layout.');
      }
      return {
        id: node.id,
        node,
        x: GRAPH_WIDTH / 2 + (position.x - sourceCenterX) * uniformScale,
        y: GRAPH_HEIGHT / 2 + (position.y - sourceCenterY) * uniformScale,
      };
    });
  } else {
    const centerX = GRAPH_WIDTH / 2;
    const centerY = GRAPH_HEIGHT / 2;
    const radius = Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) / 2 - GRAPH_PADDING;
    const angleScale = scaleLinear()
      .domain([0, Math.max(1, scene.nodes.length)])
      .range([-Math.PI / 2, (Math.PI * 3) / 2]);
    nodes = scene.nodes.map((node, index) => {
      const angle = angleScale(index);
      return {
        id: node.id,
        node,
        x:
          scene.nodes.length === 1
            ? centerX
            : centerX + Math.cos(angle) * radius,
        y:
          scene.nodes.length === 1
            ? centerY
            : centerY + Math.sin(angle) * radius,
      };
    });
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (nodesById.size !== nodes.length) {
    throw new Error('Graph SceneState contains duplicate node IDs.');
  }
  const edges = scene.edges.map((edge) => {
    const source = nodesById.get(edge.from);
    const target = nodesById.get(edge.to);
    if (source === undefined || target === undefined) {
      throw new Error(
        `Graph edge "${edge.id}" references a missing SceneState node.`,
      );
    }
    return { id: edge.id, edge, source, target };
  });

  return {
    nodes,
    edges,
    width: GRAPH_WIDTH,
    height: GRAPH_HEIGHT,
  };
}
