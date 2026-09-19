import type {
  ComparisonOperator,
  TraceCommand,
  TraceValue,
} from '../../protocol/traceTypes';
import { assertNever, assertSceneStructure } from '../sceneReducerError';
import type { LinkedListSceneState, SceneState } from '../sceneState';
import {
  appendUnique,
  removeIdFromMarkers,
  requireEntity,
  updateEntityById,
} from './entityCollection';

type LinkedListCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'linked-list.create'
      | 'linked-list.addNode'
      | 'linked-list.removeNode'
      | 'linked-list.setHead'
      | 'linked-list.setTail'
      | 'linked-list.setNext'
      | 'linked-list.setPrevious'
      | 'linked-list.setValue'
      | 'linked-list.visit'
      | 'linked-list.mark'
      | 'linked-list.pointer'
      | 'linked-list.compare';
  }
>;

export function reduceLinkedList(
  scene: SceneState,
  command: LinkedListCommand,
): LinkedListSceneState {
  assertSceneStructure(scene, 'linked-list', command.type);

  switch (command.type) {
    case 'linked-list.create':
      return {
        ...scene,
        kind: command.kind,
        headId: command.headId,
        tailId: command.tailId,
        nodes: command.nodes.map((node) => ({ ...node })),
        visitedNodeIds: [],
        pointers: {},
        comparison: null,
        markers: {},
      };

    case 'linked-list.addNode':
      return { ...scene, nodes: [...scene.nodes, { ...command.node }] };

    case 'linked-list.removeNode':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Linked-list node "${command.nodeId}" does not exist.`,
      );

      return {
        ...scene,
        nodes: scene.nodes.filter((node) => node.id !== command.nodeId),
        visitedNodeIds: scene.visitedNodeIds.filter(
          (nodeId) => nodeId !== command.nodeId,
        ),
        markers: removeIdFromMarkers(scene.markers, command.nodeId),
      };

    case 'linked-list.setHead':
      return { ...scene, headId: command.nodeId };

    case 'linked-list.setTail':
      return { ...scene, tailId: command.nodeId };

    case 'linked-list.setNext': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, nextId: command.nextId }),
        'Linked-list node',
      );
      return { ...scene, nodes };
    }

    case 'linked-list.setPrevious': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, previousId: command.previousId }),
        'Linked-list node',
      );
      return { ...scene, nodes };
    }

    case 'linked-list.setValue': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, value: command.value }),
        'Linked-list node',
      );
      return { ...scene, nodes };
    }

    case 'linked-list.visit':
      return {
        ...scene,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
      };

    case 'linked-list.pointer':
      if (command.nodeId !== null)
        requireEntity(
          scene.nodes.some((node) => node.id === command.nodeId),
          `Linked-list node "${command.nodeId}" does not exist.`,
        );
      return {
        ...scene,
        pointers: { ...scene.pointers, [command.name]: command.nodeId },
      };

    case 'linked-list.compare': {
      const first = scene.nodes.find((node) => node.id === command.nodeIds[0]);
      const second = scene.nodes.find((node) => node.id === command.nodeIds[1]);
      requireEntity(
        first !== undefined,
        `Linked-list node "${command.nodeIds[0]}" does not exist.`,
      );
      requireEntity(
        second !== undefined,
        `Linked-list node "${command.nodeIds[1]}" does not exist.`,
      );
      return {
        ...scene,
        comparison: {
          nodeIds: [...command.nodeIds],
          operator: command.operator,
          matches: compare(first.value, second.value, command.operator),
        },
      };
    }

    case 'linked-list.mark':
      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.nodeIds],
        },
      };

    default:
      return assertNever(command);
  }
}

function compare(
  left: TraceValue,
  right: TraceValue,
  operator: ComparisonOperator,
): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
  }
}
