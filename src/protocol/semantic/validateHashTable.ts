import type { TraceCommand, TraceValue } from '../traceTypes';
import {
  addHashTableEntryNotFoundIssue,
  addIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

type HashTableSemanticState = {
  bucketCount: number;
  entries: Map<string, TraceValue>;
};

export function validateHashTableTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'hash-table.create') {
    addMissingCreateIssue(
      issues,
      createCommand,
      'hash-table',
      'hash-table.create',
    );

    return;
  }

  const state: HashTableSemanticState = {
    bucketCount: createCommand.bucketCount,
    entries: new Map(),
  };

  const keys = new Map<TraceValue, string>();

  for (const entry of createCommand.entries) {
    if (state.entries.has(entry.id)) {
      addIssue(
        issues,
        1,
        'HASH_TABLE_DUPLICATE_ENTRY_ID',
        `Hash-table entry ID "${entry.id}" appears more than once.`,
      );

      continue;
    }

    const existingKeyId = keys.get(entry.key);

    if (existingKeyId !== undefined) {
      addIssue(
        issues,
        1,
        'HASH_TABLE_DUPLICATE_KEY',
        `Hash-table key "${String(entry.key)}" appears more than once.`,
      );

      continue;
    }

    if (
      !validateHashTableBucket(entry.bucketIndex, state.bucketCount, 1, issues)
    ) {
      continue;
    }

    state.entries.set(entry.id, entry.key);
    keys.set(entry.key, entry.id);
  }

  for (
    let commandIndex = 2;
    commandIndex < commands.length;
    commandIndex += 1
  ) {
    const command = commands[commandIndex];

    if (command === undefined) {
      continue;
    }

    switch (command.type) {
      case 'hash-table.set': {
        const existingKey = state.entries.get(command.entry.id);
        const keyOwner = keys.get(command.entry.key);

        if (keyOwner !== undefined && keyOwner !== command.entry.id) {
          addIssue(
            issues,
            commandIndex,
            'HASH_TABLE_DUPLICATE_KEY',
            `Hash-table key "${String(command.entry.key)}" already belongs to entry "${keyOwner}".`,
          );

          break;
        }

        if (
          !validateHashTableBucket(
            command.entry.bucketIndex,
            state.bucketCount,
            commandIndex,
            issues,
          )
        ) {
          break;
        }

        if (existingKey !== undefined) {
          keys.delete(existingKey);
        }

        state.entries.set(command.entry.id, command.entry.key);

        keys.set(command.entry.key, command.entry.id);
        break;
      }

      case 'hash-table.delete': {
        const key = state.entries.get(command.entryId);

        if (key === undefined) {
          addHashTableEntryNotFoundIssue(issues, commandIndex, command.entryId);

          break;
        }

        state.entries.delete(command.entryId);
        keys.delete(key);
        break;
      }

      case 'hash-table.move': {
        if (!state.entries.has(command.entryId)) {
          addHashTableEntryNotFoundIssue(issues, commandIndex, command.entryId);

          break;
        }

        if (
          !validateHashTableBucket(
            command.bucketIndex,
            state.bucketCount,
            commandIndex,
            issues,
          )
        ) {
          break;
        }

        break;
      }

      case 'hash-table.visitBucket':
        validateHashTableBucket(
          command.bucketIndex,
          state.bucketCount,
          commandIndex,
          issues,
        );
        break;

      case 'hash-table.visitEntry':
        if (!state.entries.has(command.entryId)) {
          addHashTableEntryNotFoundIssue(issues, commandIndex, command.entryId);
        }
        break;

      case 'hash-table.mark':
        for (const entryId of command.entryIds) {
          if (!state.entries.has(entryId)) {
            addHashTableEntryNotFoundIssue(issues, commandIndex, entryId);
          }
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'hash-table',
          'hash-table.create',
          issues,
        );
    }
  }
}

function validateHashTableBucket(
  bucketIndex: number,
  bucketCount: number,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): boolean {
  if (bucketIndex >= bucketCount) {
    addIssue(
      issues,
      commandIndex,
      'HASH_TABLE_BUCKET_OUT_OF_BOUNDS',
      `Hash-table bucket ${bucketIndex} is outside a table containing ${bucketCount} buckets.`,
    );

    return false;
  }

  return true;
}
