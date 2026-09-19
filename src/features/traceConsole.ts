import type { TraceCommand } from '../protocol';
import type { ConsoleEntry } from '../runner/runner';

export function createTraceOperationEntries(
  commands: readonly TraceCommand[],
): readonly ConsoleEntry[] {
  return commands
    .map((command, sequence) => ({
      sequence,
      level: 'log' as const,
      text: formatTraceOperationType(command.type),
    }))
    .reverse();
}

export function formatTraceOperationType(type: TraceCommand['type']): string {
  if (type === 'scene.init') return 'Initialize';
  if (type === 'stack.compare') return 'Peek';

  const separatorIndex = type.indexOf('.');
  const operation =
    separatorIndex === -1 ? type : type.slice(separatorIndex + 1);
  const words = operation.replace(
    /[A-Z]/g,
    (character) => ` ${character.toLowerCase()}`,
  );

  return words.charAt(0).toUpperCase() + words.slice(1);
}
