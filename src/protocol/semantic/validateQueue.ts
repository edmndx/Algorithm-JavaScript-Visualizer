import type { TraceCommand } from '../traceTypes';
import {
  addIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

export function validateQueueTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'queue.create') {
    addMissingCreateIssue(issues, createCommand, 'queue', 'queue.create');

    return;
  }

  let queueLength = createCommand.values.length;

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
      case 'queue.enqueue':
        queueLength += 1;
        break;

      case 'queue.dequeue':
      case 'queue.dequeueBack':
        if (queueLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'QUEUE_UNDERFLOW',
            'Cannot dequeue from an empty queue.',
          );

          break;
        }

        queueLength -= 1;
        break;

      case 'queue.peek':
        if (queueLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'QUEUE_UNDERFLOW',
            'Cannot peek at an empty queue.',
          );
        }
        break;

      case 'queue.mark':
        for (const index of command.indices) {
          if (index >= queueLength) {
            addIssue(
              issues,
              commandIndex,
              'QUEUE_INDEX_OUT_OF_BOUNDS',
              `Queue index ${index} is outside a queue of length ${queueLength}.`,
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
          'queue',
          'queue.create',
          issues,
        );
    }
  }
}
