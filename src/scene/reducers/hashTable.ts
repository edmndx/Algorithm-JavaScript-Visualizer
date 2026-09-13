import type { TraceCommand } from '../../protocol/traceTypes';
import { SceneReducerError } from '../sceneReducerError';
import type { HashTableSceneState, SceneState } from '../sceneState';
import {
  appendUnique,
  removeIdFromMarkers,
  requireEntity,
  updateEntityById,
} from './entityCollection';

type HashTableCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'hash-table.create'
      | 'hash-table.set'
      | 'hash-table.delete'
      | 'hash-table.move'
      | 'hash-table.visitBucket'
      | 'hash-table.visitEntry'
      | 'hash-table.mark';
  }
>;

export function reduceHashTable(
  scene: SceneState,
  command: HashTableCommand,
): HashTableSceneState {
  if (scene.structure === null) {
    throw new SceneReducerError(
      'STRUCTURE_NOT_INITIALIZED',
      `Cannot apply "${command.type}" before scene.init.`,
    );
  }

  if (scene.structure !== 'hash-table') {
    throw new SceneReducerError(
      'STRUCTURE_MISMATCH',
      `Cannot apply "${command.type}" to a "${scene.structure}" scene.`,
    );
  }

  switch (command.type) {
    case 'hash-table.create':
      return {
        ...scene,
        bucketCount: command.bucketCount,
        strategy: command.strategy,
        entries: command.entries.map((entry) => ({ ...entry })),
        visitedBucketIndices: [],
        visitedEntryIds: [],
        markers: {},
      };

    case 'hash-table.set': {
      const existingIndex = scene.entries.findIndex(
        (entry) => entry.id === command.entry.id,
      );

      if (existingIndex === -1) {
        return {
          ...scene,
          entries: [...scene.entries, { ...command.entry }],
        };
      }

      const entries = [...scene.entries];
      entries[existingIndex] = { ...command.entry };
      return { ...scene, entries };
    }

    case 'hash-table.delete':
      requireEntity(
        scene.entries.some((entry) => entry.id === command.entryId),
        `Hash-table entry "${command.entryId}" does not exist.`,
      );

      return {
        ...scene,
        entries: scene.entries.filter((entry) => entry.id !== command.entryId),
        visitedEntryIds: scene.visitedEntryIds.filter(
          (entryId) => entryId !== command.entryId,
        ),
        markers: removeIdFromMarkers(scene.markers, command.entryId),
      };

    case 'hash-table.move': {
      const entries = updateEntityById(
        scene.entries,
        command.entryId,
        (entry) => ({ ...entry, bucketIndex: command.bucketIndex }),
        'Hash-table entry',
      );
      return { ...scene, entries };
    }

    case 'hash-table.visitBucket':
      return {
        ...scene,
        visitedBucketIndices: appendUnique(
          scene.visitedBucketIndices,
          command.bucketIndex,
        ),
      };

    case 'hash-table.visitEntry':
      return {
        ...scene,
        visitedEntryIds: appendUnique(scene.visitedEntryIds, command.entryId),
      };

    case 'hash-table.mark':
      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.entryIds],
        },
      };

    default:
      return assertNever(command);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled protocol value: ${JSON.stringify(value)}`);
}
