import type { TraceCommand } from '../traceTypes';
import {
  addIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

export function validateArrayTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'array.create') {
    addMissingCreateIssue(issues, createCommand, 'array', 'array.create');

    return;
  }

  if (
    createCommand.labels !== undefined &&
    createCommand.labels.length !== createCommand.values.length
  ) {
    addIssue(
      issues,
      1,
      'ARRAY_LABEL_COUNT_MISMATCH',
      'Array labels must contain exactly one label for every array value.',
    );
  }

  const arrayLength = createCommand.values.length;

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
      case 'array.compare':
      case 'array.swap':
      case 'array.mark':
        for (const index of command.indices) {
          validateArrayIndex(index, arrayLength, commandIndex, issues);
        }
        break;

      case 'array.set':
        validateArrayIndex(command.index, arrayLength, commandIndex, issues);
        break;

      case 'array.focus':
        if (command.index !== undefined && command.index !== null)
          validateArrayIndex(command.index, arrayLength, commandIndex, issues);
        for (const index of Object.values(command.pointers ?? {}))
          validateArrayIndex(index, arrayLength, commandIndex, issues);
        if (command.range !== undefined)
          for (const index of command.range)
            validateArrayIndex(index, arrayLength, commandIndex, issues);
        break;

      case 'array.compareValue':
        validateArrayIndex(command.index, arrayLength, commandIndex, issues);
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'array',
          'array.create',
          issues,
        );
    }
  }
}

function validateArrayIndex(
  index: number,
  arrayLength: number,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): void {
  if (index >= arrayLength) {
    addIssue(
      issues,
      commandIndex,
      'ARRAY_INDEX_OUT_OF_BOUNDS',
      `Array index ${index} is outside an array of length ${arrayLength}.`,
    );
  }
}
