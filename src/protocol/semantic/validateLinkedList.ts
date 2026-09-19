import type { LinkedListKind, TraceCommand } from '../traceTypes';
import {
  addIssue,
  addLinkedListNodeNotFoundIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

type LinkedListSemanticNode = {
  readonly id: string;
  readonly nextId: string | null;
  readonly previousId?: string | null | undefined;
};

type LinkedListSemanticState = {
  kind: LinkedListKind;
  headId: string | null;
  tailId: string | null;
  nodes: Map<string, LinkedListSemanticNode>;
};

export function validateLinkedListTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'linked-list.create') {
    addMissingCreateIssue(
      issues,
      createCommand,
      'linked-list',
      'linked-list.create',
    );

    return;
  }

  const state: LinkedListSemanticState = {
    kind: createCommand.kind,
    headId: createCommand.headId,
    tailId: createCommand.tailId,
    nodes: new Map(),
  };

  for (const node of createCommand.nodes) {
    if (state.nodes.has(node.id)) {
      addIssue(
        issues,
        1,
        'LINKED_LIST_DUPLICATE_NODE_ID',
        `Linked-list node ID "${node.id}" appears more than once.`,
      );

      continue;
    }

    state.nodes.set(node.id, {
      id: node.id,
      nextId: node.nextId,
      previousId: node.previousId,
    });
  }

  validateLinkedListTopology(state, 1, issues, true);

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
      case 'linked-list.addNode':
        if (state.nodes.has(command.node.id)) {
          addIssue(
            issues,
            commandIndex,
            'LINKED_LIST_DUPLICATE_NODE_ID',
            `Linked-list node ID "${command.node.id}" already exists.`,
          );

          break;
        }

        if (
          !validateLinkedListNodeReferences(
            command.node,
            state,
            commandIndex,
            issues,
          )
        ) {
          break;
        }

        state.nodes.set(command.node.id, {
          id: command.node.id,
          nextId: command.node.nextId,
          previousId: command.node.previousId,
        });
        break;

      case 'linked-list.removeNode':
        if (!state.nodes.has(command.nodeId)) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        if (
          state.headId === command.nodeId ||
          state.tailId === command.nodeId ||
          linkedListNodeIsReferenced(state.nodes, command.nodeId)
        ) {
          addIssue(
            issues,
            commandIndex,
            'LINKED_LIST_NODE_REFERENCED',
            `Linked-list node "${command.nodeId}" cannot be removed while it is still referenced by the list.`,
          );

          break;
        }

        state.nodes.delete(command.nodeId);
        break;

      case 'linked-list.setHead':
        if (command.nodeId !== null && !state.nodes.has(command.nodeId)) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        state.headId = command.nodeId;
        break;

      case 'linked-list.setTail':
        if (command.nodeId !== null && !state.nodes.has(command.nodeId)) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        state.tailId = command.nodeId;
        break;

      case 'linked-list.setNext': {
        const node = state.nodes.get(command.nodeId);

        if (node === undefined) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        if (command.nextId !== null && !state.nodes.has(command.nextId)) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nextId);

          break;
        }

        if (isCircularLinkedList(state.kind) && command.nextId === null) {
          addIssue(
            issues,
            commandIndex,
            'LINKED_LIST_CIRCULAR_NULL_POINTER',
            'Circular linked-list nodes cannot have a null next pointer.',
          );

          break;
        }

        state.nodes.set(command.nodeId, {
          ...node,
          nextId: command.nextId,
        });
        break;
      }

      case 'linked-list.setPrevious': {
        const node = state.nodes.get(command.nodeId);

        if (node === undefined) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        if (!isDoublyLinkedList(state.kind)) {
          addIssue(
            issues,
            commandIndex,
            'LINKED_LIST_INVALID_PREVIOUS_POINTER',
            `Linked-list kind "${state.kind}" does not support previous pointers.`,
          );

          break;
        }

        if (
          command.previousId !== null &&
          !state.nodes.has(command.previousId)
        ) {
          addLinkedListNodeNotFoundIssue(
            issues,
            commandIndex,
            command.previousId,
          );

          break;
        }

        if (state.kind === 'circular-doubly' && command.previousId === null) {
          addIssue(
            issues,
            commandIndex,
            'LINKED_LIST_CIRCULAR_NULL_POINTER',
            'Circular doubly linked-list nodes cannot have a null previous pointer.',
          );

          break;
        }

        state.nodes.set(command.nodeId, {
          ...node,
          previousId: command.previousId,
        });
        break;
      }

      case 'linked-list.setValue':
      case 'linked-list.visit':
        if (!state.nodes.has(command.nodeId)) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        }
        break;

      case 'linked-list.mark':
        for (const nodeId of command.nodeIds) {
          if (!state.nodes.has(nodeId)) {
            addLinkedListNodeNotFoundIssue(issues, commandIndex, nodeId);
          }
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'linked-list',
          'linked-list.create',
          issues,
        );
    }
  }

  validateLinkedListTopology(state, commands.length - 1, issues, false);
}

function validateLinkedListTopology(
  state: LinkedListSemanticState,
  commandIndex: number,
  issues: TraceSemanticIssue[],
  allowTwoInitialComponents: boolean,
): void {
  if (state.nodes.size === 0) {
    if (state.headId !== null || state.tailId !== null) {
      addIssue(
        issues,
        commandIndex,
        'LINKED_LIST_INVALID_HEAD_TAIL',
        'An empty linked list must have null head and tail IDs.',
      );
    }

    return;
  }

  if (state.headId === null || state.tailId === null) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_INVALID_HEAD_TAIL',
      'A non-empty linked list must have both a head and a tail.',
    );

    return;
  }

  if (!state.nodes.has(state.headId)) {
    addLinkedListNodeNotFoundIssue(issues, commandIndex, state.headId);

    return;
  }

  if (!state.nodes.has(state.tailId)) {
    addLinkedListNodeNotFoundIssue(issues, commandIndex, state.tailId);

    return;
  }

  for (const node of state.nodes.values()) {
    validateLinkedListNodeReferences(node, state, commandIndex, issues);
  }

  if (isCircularLinkedList(state.kind)) {
    validateCircularLinkedList(state, commandIndex, issues);
  } else {
    validateLinearLinkedList(
      state,
      commandIndex,
      issues,
      allowTwoInitialComponents && state.kind === 'singly',
    );
  }

  if (isDoublyLinkedList(state.kind)) {
    validateDoublyLinkedListPointers(state, commandIndex, issues);
  }
}

function validateLinearLinkedList(
  state: LinkedListSemanticState,
  commandIndex: number,
  issues: TraceSemanticIssue[],
  allowTwoComponents: boolean,
): void {
  if (state.headId === null || state.tailId === null) {
    return;
  }

  const visited = new Set<string>();
  let currentId: string | null = state.headId;
  let lastId: string | null = null;

  while (currentId !== null) {
    if (visited.has(currentId)) {
      addIssue(
        issues,
        commandIndex,
        'LINKED_LIST_INVALID_TOPOLOGY',
        'Non-circular linked list contains a cycle.',
      );

      return;
    }

    const node = state.nodes.get(currentId);

    if (node === undefined) {
      return;
    }

    visited.add(currentId);
    lastId = currentId;
    currentId = node.nextId;
  }

  if (lastId !== state.tailId) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_INVALID_HEAD_TAIL',
      `Linked-list tail "${state.tailId}" is not the final node reachable from the head.`,
    );
  }

  if (
    visited.size !== state.nodes.size &&
    !(
      allowTwoComponents &&
      lastId === state.tailId &&
      formsOneDetachedLinearComponent(state.nodes, visited)
    )
  ) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_INVALID_TOPOLOGY',
      'Not every linked-list node is reachable from the head.',
    );
  }
}

function formsOneDetachedLinearComponent(
  nodes: LinkedListSemanticState['nodes'],
  primaryIds: ReadonlySet<string>,
): boolean {
  const detachedIds = new Set(
    [...nodes.keys()].filter((nodeId) => !primaryIds.has(nodeId)),
  );
  if (detachedIds.size === 0) return false;

  const incomingCounts = new Map([...detachedIds].map((nodeId) => [nodeId, 0]));
  for (const nodeId of detachedIds) {
    const nextId = nodes.get(nodeId)?.nextId;
    if (nextId === null) continue;
    if (nextId === undefined || !detachedIds.has(nextId)) return false;

    const incomingCount = (incomingCounts.get(nextId) ?? 0) + 1;
    if (incomingCount > 1) return false;
    incomingCounts.set(nextId, incomingCount);
  }

  const roots = [...incomingCounts].filter(([, count]) => count === 0);
  const rootId = roots[0]?.[0];
  if (roots.length !== 1 || rootId === undefined) return false;

  const visited = new Set<string>();
  let currentId: string | null = rootId;
  while (currentId !== null) {
    if (visited.has(currentId)) return false;
    const node = nodes.get(currentId);
    if (node === undefined || !detachedIds.has(currentId)) return false;

    visited.add(currentId);
    currentId = node.nextId;
  }

  return visited.size === detachedIds.size;
}

function validateCircularLinkedList(
  state: LinkedListSemanticState,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): void {
  if (state.headId === null || state.tailId === null) {
    return;
  }

  const visited = new Set<string>();
  let currentId = state.headId;
  let previousId: string | null = null;

  while (!visited.has(currentId)) {
    const node = state.nodes.get(currentId);

    if (node === undefined) {
      return;
    }

    visited.add(currentId);
    previousId = currentId;

    if (node.nextId === null) {
      addIssue(
        issues,
        commandIndex,
        'LINKED_LIST_CIRCULAR_NULL_POINTER',
        `Circular linked-list node "${node.id}" has a null next pointer.`,
      );

      return;
    }

    currentId = node.nextId;
  }

  if (currentId !== state.headId) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_INVALID_TOPOLOGY',
      'Circular linked list contains a cycle that does not return to the head.',
    );
  }

  if (visited.size !== state.nodes.size) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_INVALID_TOPOLOGY',
      'Not every circular linked-list node is reachable from the head.',
    );
  }

  if (previousId !== state.tailId) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_INVALID_HEAD_TAIL',
      `Circular linked-list tail "${state.tailId}" must be the node immediately before the head.`,
    );
  }
}

function validateDoublyLinkedListPointers(
  state: LinkedListSemanticState,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): void {
  for (const node of state.nodes.values()) {
    if (node.nextId !== null) {
      const nextNode = state.nodes.get(node.nextId);

      if (nextNode !== undefined && nextNode.previousId !== node.id) {
        addIssue(
          issues,
          commandIndex,
          'LINKED_LIST_INVALID_PREVIOUS_POINTER',
          `Node "${nextNode.id}" must point back to "${node.id}" through previousId.`,
        );
      }
    }

    if (node.previousId !== null && node.previousId !== undefined) {
      const previousNode = state.nodes.get(node.previousId);

      if (previousNode !== undefined && previousNode.nextId !== node.id) {
        addIssue(
          issues,
          commandIndex,
          'LINKED_LIST_INVALID_PREVIOUS_POINTER',
          `Node "${previousNode.id}" must point forward to "${node.id}" through nextId.`,
        );
      }
    }
  }

  if (
    state.kind === 'doubly' &&
    state.headId !== null &&
    state.tailId !== null
  ) {
    const head = state.nodes.get(state.headId);
    const tail = state.nodes.get(state.tailId);

    if (
      head !== undefined &&
      head.previousId !== null &&
      head.previousId !== undefined
    ) {
      addIssue(
        issues,
        commandIndex,
        'LINKED_LIST_INVALID_PREVIOUS_POINTER',
        'The head of a non-circular doubly linked list must have a null previous pointer.',
      );
    }

    if (tail !== undefined && tail.nextId !== null) {
      addIssue(
        issues,
        commandIndex,
        'LINKED_LIST_INVALID_TOPOLOGY',
        'The tail of a non-circular doubly linked list must have a null next pointer.',
      );
    }
  }
}

function validateLinkedListNodeReferences(
  node: LinkedListSemanticNode,
  state: LinkedListSemanticState,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): boolean {
  let valid = true;

  if (
    node.nextId !== null &&
    !state.nodes.has(node.nextId) &&
    node.nextId !== node.id
  ) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_REFERENCE_NOT_FOUND',
      `Linked-list node "${node.id}" references missing next node "${node.nextId}".`,
    );

    valid = false;
  }

  if (
    node.previousId !== null &&
    node.previousId !== undefined &&
    !state.nodes.has(node.previousId) &&
    node.previousId !== node.id
  ) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_REFERENCE_NOT_FOUND',
      `Linked-list node "${node.id}" references missing previous node "${node.previousId}".`,
    );

    valid = false;
  }

  if (
    !isDoublyLinkedList(state.kind) &&
    node.previousId !== null &&
    node.previousId !== undefined
  ) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_INVALID_PREVIOUS_POINTER',
      `Linked-list kind "${state.kind}" must not use previous pointers.`,
    );

    valid = false;
  }

  if (isCircularLinkedList(state.kind) && node.nextId === null) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_CIRCULAR_NULL_POINTER',
      `Circular linked-list node "${node.id}" cannot have a null next pointer.`,
    );

    valid = false;
  }

  if (
    state.kind === 'circular-doubly' &&
    (node.previousId === null || node.previousId === undefined)
  ) {
    addIssue(
      issues,
      commandIndex,
      'LINKED_LIST_CIRCULAR_NULL_POINTER',
      `Circular doubly linked-list node "${node.id}" cannot have a null previous pointer.`,
    );

    valid = false;
  }

  return valid;
}

function linkedListNodeIsReferenced(
  nodes: ReadonlyMap<string, LinkedListSemanticNode>,
  nodeId: string,
): boolean {
  for (const node of nodes.values()) {
    if (node.nextId === nodeId || node.previousId === nodeId) {
      return true;
    }
  }

  return false;
}

function isCircularLinkedList(kind: LinkedListKind): boolean {
  return kind === 'circular-singly' || kind === 'circular-doubly';
}

function isDoublyLinkedList(kind: LinkedListKind): boolean {
  return kind === 'doubly' || kind === 'circular-doubly';
}
