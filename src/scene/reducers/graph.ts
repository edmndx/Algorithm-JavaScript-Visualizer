import type { GraphPosition, TraceCommand } from '../../protocol/traceTypes';
import { assertNever, assertSceneStructure } from '../sceneReducerError';
import type { GraphSceneState, SceneState } from '../sceneState';
import { appendUnique, requireEntity } from './entityCollection';

type GraphCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'graph.create'
      | 'graph.visitNode'
      | 'graph.discoverNode'
      | 'graph.predecessor'
      | 'graph.visitEdge'
      | 'graph.markNodes'
      | 'graph.markEdges'
      | 'graph.distance'
      | 'graph.nodeMetric'
      | 'graph.frontier';
  }
>;

export function reduceGraph(
  scene: SceneState,
  command: GraphCommand,
): GraphSceneState {
  assertSceneStructure(scene, 'graph', command.type);

  switch (command.type) {
    case 'graph.create':
      return {
        ...scene,
        nodes: command.nodes.map((node) => ({ ...node })),
        edges: command.edges.map((edge) => ({ ...edge })),
        layout: command.layout ?? 'circular',
        positions:
          command.positions === undefined
            ? null
            : cloneGraphPositions(command.positions),
        visitedNodeIds: [],
        visitedEdgeIds: [],
        discoveredNodeIds: [],
        predecessors: {},
        nodeMarkers: {},
        edgeMarkers: {},
        distances: {},
        nodeMetrics: {},
        frontier: [],
        currentNodeId: null,
        currentEdgeId: null,
      };

    case 'graph.visitNode':
      return {
        ...scene,
        currentNodeId: command.nodeId,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
      };

    case 'graph.discoverNode':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Graph node "${command.nodeId}" does not exist.`,
      );
      return {
        ...scene,
        discoveredNodeIds: appendUnique(
          scene.discoveredNodeIds,
          command.nodeId,
        ),
      };

    case 'graph.predecessor':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Graph node "${command.nodeId}" does not exist.`,
      );
      return {
        ...scene,
        predecessors: {
          ...scene.predecessors,
          [command.nodeId]: command.predecessorId,
        },
      };

    case 'graph.visitEdge':
      return {
        ...scene,
        currentEdgeId: command.edgeId,
        visitedEdgeIds: appendUnique(scene.visitedEdgeIds, command.edgeId),
      };

    case 'graph.nodeMetric': {
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Graph node "${command.nodeId}" does not exist.`,
      );
      return {
        ...scene,
        nodeMetrics: {
          ...scene.nodeMetrics,
          [command.nodeId]: {
            ...(scene.nodeMetrics[command.nodeId] ?? {}),
            [command.name]: command.value,
          },
        },
      };
    }

    case 'graph.frontier':
      for (const nodeId of command.nodeIds)
        requireEntity(
          scene.nodes.some((node) => node.id === nodeId),
          `Graph node "${nodeId}" does not exist.`,
        );
      return { ...scene, frontier: [...command.nodeIds] };

    case 'graph.markNodes':
      return {
        ...scene,
        nodeMarkers: {
          ...scene.nodeMarkers,
          [command.marker]: [...command.nodeIds],
        },
      };

    case 'graph.markEdges':
      return {
        ...scene,
        edgeMarkers: {
          ...scene.edgeMarkers,
          [command.marker]: [...command.edgeIds],
        },
      };

    case 'graph.distance':
      return {
        ...scene,
        distances: {
          ...scene.distances,
          [command.nodeId]: command.distance,
        },
      };

    default:
      return assertNever(command);
  }
}

function cloneGraphPositions(
  positions: Readonly<Record<string, GraphPosition>>,
): Readonly<Record<string, GraphPosition>> {
  return Object.fromEntries(
    Object.entries(positions).map(([nodeId, position]) => [
      nodeId,
      { ...position },
    ]),
  );
}
