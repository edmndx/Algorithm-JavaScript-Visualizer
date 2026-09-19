import type { AnyNode } from 'acorn';

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

export function sourceSpan(node: AnyNode): string {
  const loc = node.loc;
  if (loc == null) throw new Error('Missing original source location.');
  return `{ line: ${loc.start.line}, column: ${loc.start.column + 1}, endLine: ${loc.end.line}, endColumn: ${loc.end.column + 1} }`;
}

export function beforeNode(node: AnyNode, text: string): SourceEdit {
  return { start: node.start, end: node.start, text };
}

export function afterNode(node: AnyNode, text: string): SourceEdit {
  return { start: node.end, end: node.end, text };
}

export function replaceNode(node: AnyNode, text: string): SourceEdit {
  return { start: node.start, end: node.end, text };
}

export function frameCall(
  node: AnyNode,
  operation: string,
  commands: readonly string[] | string = [],
): string {
  const commandSource =
    typeof commands === 'string' ? commands : commands.join(', ');
  return `trace.frame({ source: ${sourceSpan(node)}, operation: ${operation}, commands: [${commandSource}] });`;
}
