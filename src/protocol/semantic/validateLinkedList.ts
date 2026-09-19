import type { TraceCommand } from '../traceTypes';
import {
  addIssue,
  addLinkedListNodeNotFoundIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

export function validateLinkedListTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const create = commands[1];
  if (create?.type !== 'linked-list.create') {
    addMissingCreateIssue(issues, create, 'linked-list', 'linked-list.create');
    return;
  }

  const nodes = new Map<string, string | null>();
  for (const node of create.nodes) {
    if (nodes.has(node.id))
      addIssue(
        issues,
        1,
        'LINKED_LIST_DUPLICATE_NODE_ID',
        `Linked-list node ID "${node.id}" appears more than once.`,
      );
    else nodes.set(node.id, node.nextId);
  }
  for (const [id, nextId] of nodes)
    if (nextId !== null && !nodes.has(nextId))
      addIssue(
        issues,
        1,
        'LINKED_LIST_REFERENCE_NOT_FOUND',
        `Linked-list node "${id}" references missing next node "${nextId}".`,
      );

  if (nodes.size === 0) {
    if (create.headId !== null || create.tailId !== null)
      addIssue(
        issues,
        1,
        'LINKED_LIST_INVALID_HEAD_TAIL',
        'An empty linked list must have null head and tail IDs.',
      );
  } else if (
    create.headId === null ||
    create.tailId === null ||
    !nodes.has(create.headId) ||
    !nodes.has(create.tailId)
  ) {
    addIssue(
      issues,
      1,
      'LINKED_LIST_INVALID_HEAD_TAIL',
      'A non-empty linked list needs existing head and tail nodes.',
    );
  } else {
    const seen = new Set<string>();
    let current: string | null = create.headId;
    let last: string | null = null;
    while (current !== null && !seen.has(current) && nodes.has(current)) {
      seen.add(current);
      last = current;
      current = nodes.get(current) ?? null;
    }
    const validEnd =
      create.kind === 'singly'
        ? current === null
        : create.kind === 'circular-singly'
          ? current === create.headId
          : current !== null && current !== create.headId && seen.has(current);
    if (seen.size !== nodes.size || last !== create.tailId || !validEnd)
      addIssue(
        issues,
        1,
        'LINKED_LIST_INVALID_TOPOLOGY',
        'Linked-list links do not match the declared linear or cyclic topology.',
      );
  }

  for (let index = 2; index < commands.length; index += 1) {
    const command = commands[index];
    if (command === undefined) continue;
    switch (command.type) {
      case 'linked-list.pointer':
        if (command.nodeId !== null && !nodes.has(command.nodeId))
          addLinkedListNodeNotFoundIssue(issues, index, command.nodeId);
        break;
      case 'linked-list.mark':
      case 'linked-list.compareIdentity':
        for (const nodeId of command.nodeIds)
          if (!nodes.has(nodeId))
            addLinkedListNodeNotFoundIssue(issues, index, nodeId);
        break;
      default:
        addUnexpectedCommandIssue(
          command,
          index,
          'linked-list',
          'linked-list.create',
          issues,
        );
    }
  }
}
