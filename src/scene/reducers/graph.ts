import type { GraphPosition, TraceCommand } from '../../protocol/traceTypes';
import { assertNever, assertSceneStructure } from '../sceneReducerError';
import type { GraphSceneState, SceneState } from '../sceneState';
import {
  appendUnique,
  removeIdFromMarkers,
  requireEntity,
  updateEntityById,
} from './entityCollection';

type GraphCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'graph.create'
      | 'graph.addNode'
      | 'graph.removeNode'
      | 'graph.addEdge'
      | 'graph.removeEdge'
      | 'graph.setNodeValue'
      | 'graph.setEdgeWeight'
      | 'graph.visitNode'
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
        nodeMarkers: {},
        edgeMarkers: {},
        distances: {},
        nodeMetrics: {},
        frontier: [],
        currentNodeId: null,
        currentEdgeId: null,
      };

    case 'graph.addNode':
      return {
        ...scene,
        nodes: [...scene.nodes, { ...command.node }],
        positions:
          scene.layout === 'fixed' && command.position !== undefined
            ? {
                ...(scene.positions ?? {}),
                [command.node.id]: { ...command.position },
              }
            : scene.positions,
      };

    case 'graph.removeNode':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Graph node "${command.nodeId}" does not exist.`,
      );

      return {
        ...scene,
        nodes: scene.nodes.filter((node) => node.id !== command.nodeId),
        visitedNodeIds: scene.visitedNodeIds.filter(
          (nodeId) => nodeId !== command.nodeId,
        ),
        nodeMarkers: removeIdFromMarkers(scene.nodeMarkers, command.nodeId),
        distances: removeRecordKey(scene.distances, command.nodeId),
        positions:
          scene.positions === null
            ? null
            : removeRecordKey(scene.positions, command.nodeId),
      };

    case 'graph.addEdge':
      return { ...scene, edges: [...scene.edges, { ...command.edge }] };

    case 'graph.removeEdge':
      requireEntity(
        scene.edges.some((edge) => edge.id === command.edgeId),
        `Graph edge "${command.edgeId}" does not exist.`,
      );

      return {
        ...scene,
        edges: scene.edges.filter((edge) => edge.id !== command.edgeId),
        visitedEdgeIds: scene.visitedEdgeIds.filter(
          (edgeId) => edgeId !== command.edgeId,
        ),
        edgeMarkers: removeIdFromMarkers(scene.edgeMarkers, command.edgeId),
      };

    case 'graph.setNodeValue': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, value: command.value }),
        'Graph node',
      );
      return { ...scene, nodes };
    }

    case 'graph.setEdgeWeight': {
      const edges = updateEntityById(
        scene.edges,
        command.edgeId,
        (edge) => ({ ...edge, weight: command.weight }),
        'Graph edge',
      );
      return { ...scene, edges };
    }

    case 'graph.visitNode':
      return {
        ...scene,
        currentNodeId: command.nodeId,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
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

function removeRecordKey<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Readonly<Record<string, Value>> {
  const next = { ...record };
  delete next[key];
  return next;
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
