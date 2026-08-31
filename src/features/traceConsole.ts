import type { TraceCommand } from '../protocol';
import type { ConsoleEntry } from '../runner/runner';

export function createTraceOperationEntries(
  commands: readonly TraceCommand[],
  currentStep: number,
): readonly ConsoleEntry[] {
  return commands.slice(0, currentStep).map((command, sequence) => ({
    sequence,
    level: 'log',
    text: formatTraceOperationType(command.type),
  }));
}

export function formatTraceOperationType(type: TraceCommand['type']): string {
  if (type === 'scene.init') return 'Initialize';

  const separatorIndex = type.indexOf('.');
  const operation =
    separatorIndex === -1 ? type : type.slice(separatorIndex + 1);
  const words = operation.replace(
    /[A-Z]/g,
    (character) => ` ${character.toLowerCase()}`,
  );

  return words.charAt(0).toUpperCase() + words.slice(1);
}
