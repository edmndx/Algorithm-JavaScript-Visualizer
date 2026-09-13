import type { TraceCommand } from '../../protocol/traceTypes';
import {
  assertNever,
  assertSceneStructure,
  SceneReducerError,
} from '../sceneReducerError';
import type { QueueSceneState, SceneState } from '../sceneState';

type QueueCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'queue.create'
      | 'queue.enqueue'
      | 'queue.dequeue'
      | 'queue.dequeueBack'
      | 'queue.peek'
      | 'queue.mark';
  }
>;

export function reduceQueue(
  scene: SceneState,
  command: QueueCommand,
): QueueSceneState {
  assertSceneStructure(scene, 'queue', command.type);

  switch (command.type) {
    case 'queue.create':
      return {
        ...scene,
        values: [...command.values],
        itemIds: createItemIds(command.values.length),
        nextItemId: command.values.length,
        lastRemoval: null,
        peekedIndex: null,
        markers: {},
      };

    case 'queue.enqueue':
      return {
        ...scene,
        values: [...scene.values, command.value],
        itemIds: [...scene.itemIds, `queue-item-${scene.nextItemId}`],
        nextItemId: scene.nextItemId + 1,
        peekedIndex: null,
      };

    case 'queue.dequeue': {
      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'QUEUE_UNDERFLOW',
          'Cannot dequeue from an empty queue.',
        );
      }

      const itemId = scene.itemIds[0];
      if (itemId === undefined) {
        throw new SceneReducerError(
          'ENTITY_NOT_FOUND',
          'Queue front identity is missing.',
        );
      }

      return {
        ...scene,
        values: scene.values.slice(1),
        itemIds: scene.itemIds.slice(1),
        lastRemoval: { itemId, end: 'front' },
        peekedIndex: null,
        markers: shiftIndicesAfterRemoval(scene.markers, 0),
      };
    }

    case 'queue.dequeueBack': {
      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'QUEUE_UNDERFLOW',
          'Cannot dequeue from an empty queue.',
        );
      }

      const removedIndex = scene.values.length - 1;
      const itemId = scene.itemIds[removedIndex];
      if (itemId === undefined) {
        throw new SceneReducerError(
          'ENTITY_NOT_FOUND',
          'Queue rear identity is missing.',
        );
      }

      return {
        ...scene,
        values: scene.values.slice(0, -1),
        itemIds: scene.itemIds.slice(0, -1),
        lastRemoval: { itemId, end: 'rear' },
        peekedIndex: null,
        markers: shiftIndicesAfterRemoval(scene.markers, removedIndex),
      };
    }

    case 'queue.peek':
      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'QUEUE_UNDERFLOW',
          'Cannot peek at an empty queue.',
        );
      }

      return { ...scene, peekedIndex: 0 };

    case 'queue.mark':
      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.indices],
        },
      };

    default:
      return assertNever(command);
  }
}

function createItemIds(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `queue-item-${index}`);
}

function shiftIndicesAfterRemoval(
  markers: Readonly<Record<string, readonly number[]>>,
  removedIndex: number,
): Readonly<Record<string, readonly number[]>> {
  return Object.fromEntries(
    Object.entries(markers).map(([marker, indices]) => [
      marker,
      indices
        .filter((index) => index !== removedIndex)
        .map((index) => (index > removedIndex ? index - 1 : index)),
    ]),
  );
}
