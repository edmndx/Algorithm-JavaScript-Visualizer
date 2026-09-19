import type { TraceCommand } from '../../protocol/traceTypes';
import { assertNever, assertSceneStructure } from '../sceneReducerError';
import type { LinkedListSceneState, SceneState } from '../sceneState';
import { requireEntity } from './entityCollection';

type LinkedListCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'linked-list.create'
      | 'linked-list.mark'
      | 'linked-list.pointer'
      | 'linked-list.compareIdentity';
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
        pointers: {},
        comparison: null,
        markers: {},
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

    case 'linked-list.compareIdentity': {
      for (const nodeId of command.nodeIds)
        requireEntity(
          scene.nodes.some((node) => node.id === nodeId),
          `Linked-list node "${nodeId}" does not exist.`,
        );
      return {
        ...scene,
        comparison: {
          nodeIds: [...command.nodeIds],
          operator: command.operator,
          identity: true,
          matches:
            command.operator === 'eq'
              ? command.nodeIds[0] === command.nodeIds[1]
              : command.nodeIds[0] !== command.nodeIds[1],
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
