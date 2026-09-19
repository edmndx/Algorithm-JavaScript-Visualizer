import type { TraceCommand } from '../traceTypes';
import {
  addIssue,
  addMissingCreateIssue,
  addTreeNodeNotFoundIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

type TreeSemanticNode = {
  readonly id: string;
  readonly children: readonly string[];
};

type TreeSemanticState = {
  rootId: string | null;
  nodes: Map<string, TreeSemanticNode>;
};

export function validateTreeTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'tree.create') {
    addMissingCreateIssue(issues, createCommand, 'tree', 'tree.create');

    return;
  }

  const state: TreeSemanticState = {
    rootId: createCommand.rootId,
    nodes: new Map(),
  };

  for (const node of createCommand.nodes) {
    if (state.nodes.has(node.id)) {
      addIssue(
        issues,
        1,
        'TREE_DUPLICATE_NODE_ID',
        `Tree node ID "${node.id}" appears more than once.`,
      );

      continue;
    }

    state.nodes.set(node.id, {
      id: node.id,
      children: node.children,
    });
  }

  validateTreeTopology(state, 1, issues, true, true);

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
      case 'tree.setRoot':
        if (command.rootId !== null && !state.nodes.has(command.rootId)) {
          addIssue(
            issues,
            commandIndex,
            'TREE_ROOT_NOT_FOUND',
            `Tree root "${command.rootId}" does not exist.`,
          );

          break;
        }

        state.rootId = command.rootId;

        validateTreeTopology(state, commandIndex, issues, false, false);
        break;

      case 'tree.addNode':
        if (state.nodes.has(command.node.id)) {
          addIssue(
            issues,
            commandIndex,
            'TREE_DUPLICATE_NODE_ID',
            `Tree node ID "${command.node.id}" already exists.`,
          );

          break;
        }

        state.nodes.set(command.node.id, {
          id: command.node.id,
          children: command.node.children,
        });

        validateTreeTopology(state, commandIndex, issues, false, false);
        break;

      case 'tree.removeNode':
        if (!state.nodes.has(command.nodeId)) {
          addTreeNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        if (state.rootId === command.nodeId) {
          addIssue(
            issues,
            commandIndex,
            'TREE_ROOT_REMOVAL',
            `Tree root "${command.nodeId}" cannot be removed before changing the root.`,
          );

          break;
        }

        if (isTreeNodeReferenced(state.nodes, command.nodeId)) {
          addIssue(
            issues,
            commandIndex,
            'TREE_NODE_REFERENCED',
            `Tree node "${command.nodeId}" cannot be removed while another node references it as a child.`,
          );

          break;
        }

        state.nodes.delete(command.nodeId);
        break;

      case 'tree.setChildren': {
        const node = state.nodes.get(command.nodeId);

        if (node === undefined) {
          addTreeNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        state.nodes.set(command.nodeId, {
          ...node,
          children: [...command.children],
        });

        validateTreeTopology(state, commandIndex, issues, false, false);
        break;
      }

      case 'tree.setValue':
      case 'tree.visit':
      case 'tree.setDepth':
        if (!state.nodes.has(command.nodeId)) {
          addTreeNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        }
        break;

      case 'tree.checkBounds':
        if (!state.nodes.has(command.nodeId)) {
          addTreeNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        }
        if (
          command.lower !== null &&
          command.upper !== null &&
          command.lower >= command.upper
        ) {
          addIssue(
            issues,
            commandIndex,
            'TREE_INVALID_BOUNDS',
            'Tree lower bound must be less than the upper bound.',
          );
        }
        break;

      case 'tree.compare':
      case 'tree.swapValues':
      case 'tree.mark':
        for (const nodeId of command.nodeIds) {
          if (!state.nodes.has(nodeId)) {
            addTreeNodeNotFoundIssue(issues, commandIndex, nodeId);
          }
        }

        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'tree',
          'tree.create',
          issues,
        );
    }
  }

  validateTreeTopology(state, commands.length - 1, issues, true, true);
}

function validateTreeTopology(
  state: TreeSemanticState,
  commandIndex: number,
  issues: TraceSemanticIssue[],
  requireRoot: boolean,
  requireConnected: boolean,
): void {
  if (state.nodes.size === 0) {
    if (state.rootId !== null && !state.nodes.has(state.rootId)) {
      addIssue(
        issues,
        commandIndex,
        'TREE_ROOT_NOT_FOUND',
        `Tree root "${state.rootId}" does not exist.`,
      );
    }

    return;
  }

  if (requireRoot && state.rootId === null) {
    addIssue(
      issues,
      commandIndex,
      'TREE_ROOT_REQUIRED',
      'A non-empty tree must have a root.',
    );
  }

  if (state.rootId !== null && !state.nodes.has(state.rootId)) {
    addIssue(
      issues,
      commandIndex,
      'TREE_ROOT_NOT_FOUND',
      `Tree root "${state.rootId}" does not exist.`,
    );
  }

  const parentCounts = new Map<string, number>();

  for (const node of state.nodes.values()) {
    const uniqueChildren = new Set<string>();

    for (const childId of node.children) {
      if (uniqueChildren.has(childId)) {
        addIssue(
          issues,
          commandIndex,
          'TREE_DUPLICATE_CHILD_ID',
          `Tree node "${node.id}" references child "${childId}" more than once.`,
        );

        continue;
      }

      uniqueChildren.add(childId);

      if (!state.nodes.has(childId)) {
        addIssue(
          issues,
          commandIndex,
          'TREE_CHILD_NOT_FOUND',
          `Tree node "${node.id}" references missing child "${childId}".`,
        );

        continue;
      }

      parentCounts.set(childId, (parentCounts.get(childId) ?? 0) + 1);
    }
  }

  for (const [nodeId, parentCount] of parentCounts) {
    if (parentCount > 1) {
      addIssue(
        issues,
        commandIndex,
        'TREE_MULTIPLE_PARENTS',
        `Tree node "${nodeId}" has more than one parent.`,
      );
    }
  }

  if (state.rootId !== null && (parentCounts.get(state.rootId) ?? 0) > 0) {
    addIssue(
      issues,
      commandIndex,
      'TREE_ROOT_HAS_PARENT',
      `Tree root "${state.rootId}" cannot have a parent.`,
    );
  }

  if (treeContainsCycle(state.nodes)) {
    addIssue(
      issues,
      commandIndex,
      'TREE_CYCLE',
      'Tree topology contains a cycle.',
    );
  }

  if (
    requireConnected &&
    state.rootId !== null &&
    state.nodes.has(state.rootId)
  ) {
    const reachable = collectReachableTreeNodes(state.nodes, state.rootId);

    for (const nodeId of state.nodes.keys()) {
      if (!reachable.has(nodeId)) {
        addIssue(
          issues,
          commandIndex,
          'TREE_UNREACHABLE_NODE',
          `Tree node "${nodeId}" is not reachable from root "${state.rootId}".`,
        );
      }
    }
  }
}

function treeContainsCycle(
  nodes: ReadonlyMap<string, TreeSemanticNode>,
): boolean {
  const completed = new Set<string>();

  for (const startId of nodes.keys()) {
    if (completed.has(startId)) continue;

    const active = new Set<string>();
    const stack: Array<{ nodeId: string; expanded: boolean }> = [
      { nodeId: startId, expanded: false },
    ];

    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) continue;

      if (frame.expanded) {
        active.delete(frame.nodeId);
        completed.add(frame.nodeId);
        continue;
      }

      if (active.has(frame.nodeId)) return true;
      if (completed.has(frame.nodeId)) continue;

      const node = nodes.get(frame.nodeId);
      if (node === undefined) continue;

      active.add(frame.nodeId);
      stack.push({ nodeId: frame.nodeId, expanded: true });

      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const childId = node.children[index];
        if (childId !== undefined && nodes.has(childId)) {
          stack.push({ nodeId: childId, expanded: false });
        }
      }
    }
  }

  return false;
}

function collectReachableTreeNodes(
  nodes: ReadonlyMap<string, TreeSemanticNode>,
  rootId: string,
): Set<string> {
  const reachable = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const nodeId = stack.pop();

    if (nodeId === undefined || reachable.has(nodeId)) {
      continue;
    }

    const node = nodes.get(nodeId);

    if (node === undefined) {
      continue;
    }

    reachable.add(nodeId);

    for (const childId of node.children) {
      stack.push(childId);
    }
  }

  return reachable;
}

function isTreeNodeReferenced(
  nodes: ReadonlyMap<string, TreeSemanticNode>,
  nodeId: string,
): boolean {
  for (const node of nodes.values()) {
    if (node.children.includes(nodeId)) {
      return true;
    }
  }

  return false;
}
