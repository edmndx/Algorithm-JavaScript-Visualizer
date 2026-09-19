import type { TraceCommand, TraceStructure } from '../traceTypes';
import type {
  TraceSemanticIssue,
  TraceSemanticIssueCode,
} from './semanticTypes';

export function addMissingCreateIssue(
  issues: TraceSemanticIssue[],
  command: TraceCommand | undefined,
  structure: TraceStructure,
  expectedType: TraceCommand['type'],
): void {
  if (command === undefined) {
    addIssue(
      issues,
      1,
      'MISSING_STRUCTURE_CREATE',
      `A "${structure}" trace must contain ${expectedType} as its second command.`,
    );

    return;
  }

  addIssue(
    issues,
    1,
    'WRONG_STRUCTURE_CREATE',
    `A "${structure}" trace must use ${expectedType} as its second command, but received "${command.type}".`,
  );
}

export function addUnexpectedCommandIssue(
  command: TraceCommand,
  commandIndex: number,
  structure: TraceStructure,
  createType: TraceCommand['type'],
  issues: TraceSemanticIssue[],
): void {
  if (
    command.type === 'input.focus' ||
    command.type === 'input.set' ||
    command.type === 'metrics.set'
  ) {
    return;
  }
  if (command.type === 'scene.init') {
    addIssue(
      issues,
      commandIndex,
      'DUPLICATE_SCENE_INIT',
      'scene.init may only appear as the first command.',
    );

    return;
  }

  if (command.type === createType) {
    addIssue(
      issues,
      commandIndex,
      'DUPLICATE_STRUCTURE_CREATE',
      `${createType} may only appear as the second command.`,
    );

    return;
  }

  addIssue(
    issues,
    commandIndex,
    'WRONG_STRUCTURE_COMMAND',
    `Command "${command.type}" is not valid in a "${structure}" trace.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Shared issue helpers                                                        */
/* -------------------------------------------------------------------------- */

export function addTreeNodeNotFoundIssue(
  issues: TraceSemanticIssue[],
  commandIndex: number,
  nodeId: string,
): void {
  addIssue(
    issues,
    commandIndex,
    'TREE_NODE_NOT_FOUND',
    `Tree node "${nodeId}" does not exist.`,
  );
}

export function addGraphNodeNotFoundIssue(
  issues: TraceSemanticIssue[],
  commandIndex: number,
  nodeId: string,
): void {
  addIssue(
    issues,
    commandIndex,
    'GRAPH_NODE_NOT_FOUND',
    `Graph node "${nodeId}" does not exist.`,
  );
}

export function addGraphEdgeNotFoundIssue(
  issues: TraceSemanticIssue[],
  commandIndex: number,
  edgeId: string,
): void {
  addIssue(
    issues,
    commandIndex,
    'GRAPH_EDGE_NOT_FOUND',
    `Graph edge "${edgeId}" does not exist.`,
  );
}

export function addLinkedListNodeNotFoundIssue(
  issues: TraceSemanticIssue[],
  commandIndex: number,
  nodeId: string,
): void {
  addIssue(
    issues,
    commandIndex,
    'LINKED_LIST_NODE_NOT_FOUND',
    `Linked-list node "${nodeId}" does not exist.`,
  );
}

export function addHashTableEntryNotFoundIssue(
  issues: TraceSemanticIssue[],
  commandIndex: number,
  entryId: string,
): void {
  addIssue(
    issues,
    commandIndex,
    'HASH_TABLE_ENTRY_NOT_FOUND',
    `Hash-table entry "${entryId}" does not exist.`,
  );
}

export function addIssue(
  issues: TraceSemanticIssue[],
  commandIndex: number,
  code: TraceSemanticIssueCode,
  message: string,
): void {
  issues.push({
    commandIndex,
    code,
    message,
  });
}
