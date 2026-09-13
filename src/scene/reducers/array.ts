import type { TraceCommand } from '../../protocol/traceTypes';
import {
  assertNever,
  assertSceneStructure,
  SceneReducerError,
} from '../sceneReducerError';
import type { ArraySceneState, SceneState } from '../sceneState';

type ArrayCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'array.create'
      | 'array.compare'
      | 'array.swap'
      | 'array.set'
      | 'array.mark';
  }
>;

export function reduceArray(
  scene: SceneState,
  command: ArrayCommand,
): ArraySceneState {
  assertSceneStructure(scene, 'array', command.type);

  switch (command.type) {
    case 'array.create':
      return {
        ...scene,
        values: [...command.values],
        itemIds: createItemIds(command.values.length),
        labels: command.labels === undefined ? [] : [...command.labels],
        comparedIndices: null,
        markers: {},
      };

    case 'array.compare':
      return {
        ...scene,
        comparedIndices: [...command.indices],
      };

    case 'array.swap': {
      const [firstIndex, secondIndex] = command.indices;
      const values = [...scene.values];
      const itemIds = [...scene.itemIds];

      assertIndex(firstIndex, values.length, command.type);
      assertIndex(secondIndex, values.length, command.type);

      const firstValue = values[firstIndex];
      const secondValue = values[secondIndex];

      if (firstValue === undefined || secondValue === undefined) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested array indices.`,
        );
      }

      values[firstIndex] = secondValue;
      values[secondIndex] = firstValue;

      const firstItemId = itemIds[firstIndex];
      const secondItemId = itemIds[secondIndex];

      if (firstItemId === undefined || secondItemId === undefined) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested array identities.`,
        );
      }

      itemIds[firstIndex] = secondItemId;
      itemIds[secondIndex] = firstItemId;

      return { ...scene, values, itemIds };
    }

    case 'array.set': {
      assertIndex(command.index, scene.values.length, command.type);
      const values = [...scene.values];
      values[command.index] = command.value;
      return { ...scene, values };
    }

    case 'array.mark':
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

function assertIndex(
  index: number,
  length: number,
  commandType: TraceCommand['type'],
): void {
  if (index < 0 || index >= length) {
    throw new SceneReducerError(
      'INDEX_OUT_OF_BOUNDS',
      `Command "${commandType}" references index ${index} outside a collection of length ${length}.`,
    );
  }
}

function createItemIds(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `array-item-${index}`);
}
