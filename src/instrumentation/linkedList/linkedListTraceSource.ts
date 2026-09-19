import type { StaticListNode } from './linkedListTypes';

export function linkedListTraceInitializationSource(
  nodeIds: string,
  nodes: readonly StaticListNode[],
  tailId: string,
  line: number,
): string {
  const weakMapEntries = nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const traceNodes = nodes
    .map(
      ({ id, value, nextId }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, nextId: ${JSON.stringify(nextId)} }`,
    )
    .join(', ');

  return (
    `;\ntrace.initialize({ structure: 'linked-list', source: { line: ${line} } });\n` +
    `const ${nodeIds} = new WeakMap([${weakMapEntries}]);\n` +
    `trace.createLinkedList({ kind: 'singly', headId: ${JSON.stringify(nodes[0]?.id)}, tailId: ${JSON.stringify(tailId)}, nodes: [${traceNodes}], source: { line: ${line} } });\n`
  );
}
