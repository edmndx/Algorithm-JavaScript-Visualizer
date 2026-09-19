import type { TraceCommand } from '../../protocol';
import { serializeTraceFile } from './traceSerialization';

export function downloadTraceFile(
  algorithmName: string,
  commands: readonly TraceCommand[],
): void {
  const url = URL.createObjectURL(
    new Blob([serializeTraceFile(commands)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${algorithmName}-trace.json`;
  document.body.append(link);

  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
