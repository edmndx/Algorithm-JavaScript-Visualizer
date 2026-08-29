import type { Expression } from 'acorn';

export type SourceEdit = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export function applySourceEdits(
  source: string,
  edits: readonly SourceEdit[],
): string | null {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let nextStart = source.length;
  let result = source;

  for (const edit of ordered) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > nextStart ||
      edit.end > source.length
    ) {
      return null;
    }

    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    nextStart = edit.start;
  }

  return result;
}

export function expressionSource(
  source: string,
  expression: Expression,
): string {
  return source.slice(expression.start, expression.end);
}

export function lineIndentation(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^\s*$/.test(prefix) ? prefix : '';
}
