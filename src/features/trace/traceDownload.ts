import type { FrameTrace } from '../../protocol/frameTrace';

export function downloadTraceFile(
  algorithmName: string,
  input: FrameTrace,
): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(input)], { type: 'application/json' }),
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
