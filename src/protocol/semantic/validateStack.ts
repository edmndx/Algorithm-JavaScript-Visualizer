import type { TraceCommand } from '../traceTypes';
import {
  addIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

export function validateStackTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'stack.create') {
    addMissingCreateIssue(issues, createCommand, 'stack', 'stack.create');

    return;
  }

  let stackLength = createCommand.values.length;

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
      case 'stack.push':
        stackLength += 1;
        break;

      case 'stack.pop':
        if (stackLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'STACK_UNDERFLOW',
            'Cannot pop from an empty stack.',
          );

          break;
        }

        stackLength -= 1;
        break;

      case 'stack.peek':
        if (stackLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'STACK_UNDERFLOW',
            'Cannot peek at an empty stack.',
          );
        }
        break;

      case 'stack.compare':
        if (stackLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'STACK_UNDERFLOW',
            'Cannot compare against an empty stack.',
          );
        }
        break;

      case 'stack.mark':
        for (const index of command.indices) {
          if (index >= stackLength) {
            addIssue(
              issues,
              commandIndex,
              'STACK_INDEX_OUT_OF_BOUNDS',
              `Stack index ${index} is outside a stack of length ${stackLength}.`,
            );
          }
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'stack',
          'stack.create',
          issues,
        );
    }
  }
}
