import type { TraceCommand } from '../../protocol/traceTypes';
import { SceneReducerError } from '../sceneReducerError';
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
      | 'linked-list.mark';
  }
>;

export function reduceLinkedList(
  scene: SceneState,
  command: LinkedListCommand,
): LinkedListSceneState {
  if (scene.structure === null) {
    throw new SceneReducerError(
      'STRUCTURE_NOT_INITIALIZED',
      `Cannot apply "${command.type}" before scene.init.`,
    );
  }

  if (scene.structure !== 'linked-list') {
    throw new SceneReducerError(
      'STRUCTURE_MISMATCH',
      `Cannot apply "${command.type}" to a "${scene.structure}" scene.`,
    );
  }

  switch (command.type) {
    case 'linked-list.create':
      return {
        ...scene,
        kind: command.kind,
        headId: command.headId,
        tailId: command.tailId,
        nodes: command.nodes.map((node) => ({ ...node })),
        visitedNodeIds: [],
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

function assertNever(value: never): never {
  throw new Error(`Unhandled protocol value: ${JSON.stringify(value)}`);
}
