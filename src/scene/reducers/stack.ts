import type { TraceCommand } from '../../protocol/traceTypes';
import {
  assertNever,
  assertSceneStructure,
  SceneReducerError,
} from '../sceneReducerError';
import type { SceneState, StackSceneState } from '../sceneState';

type StackCommand = Extract<
  TraceCommand,
  {
    readonly type:
      'stack.create' | 'stack.push' | 'stack.pop' | 'stack.peek' | 'stack.mark';
  }
>;

export function reduceStack(
  scene: SceneState,
  command: StackCommand,
): StackSceneState {
  assertSceneStructure(scene, 'stack', command.type);

  switch (command.type) {
    case 'stack.create':
      return {
        ...scene,
        values: [...command.values],
        itemIds: createItemIds(command.values.length),
        nextItemId: command.values.length,
        peekedIndex: null,
        markers: {},
      };

    case 'stack.push':
      return {
        ...scene,
        values: [...scene.values, command.value],
        itemIds: [...scene.itemIds, `stack-item-${scene.nextItemId}`],
        nextItemId: scene.nextItemId + 1,
        peekedIndex: null,
      };

    case 'stack.pop':
      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'STACK_UNDERFLOW',
          'Cannot pop from an empty stack.',
        );
      }

      return {
        ...scene,
        values: scene.values.slice(0, -1),
        itemIds: scene.itemIds.slice(0, -1),
        peekedIndex: null,
        markers: removeIndicesAtOrAbove(scene.markers, scene.values.length - 1),
      };

    case 'stack.peek':
      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'STACK_UNDERFLOW',
          'Cannot peek at an empty stack.',
        );
      }

      return { ...scene, peekedIndex: scene.values.length - 1 };

    case 'stack.mark':
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
  return Array.from({ length: count }, (_, index) => `stack-item-${index}`);
}

function removeIndicesAtOrAbove(
  markers: Readonly<Record<string, readonly number[]>>,
  upperBound: number,
): Readonly<Record<string, readonly number[]>> {
  return Object.fromEntries(
    Object.entries(markers).map(([marker, indices]) => [
      marker,
      indices.filter((index) => index < upperBound),
    ]),
  );
}
