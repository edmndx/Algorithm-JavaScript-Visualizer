import type {
  GraphEdge,
  GraphLayout,
  GraphNode,
  HashTableEntry,
  LinkedListKind,
  LinkedListNode,
  TraceCommand,
  TraceSourceLocation,
  TraceStructure,
  TraceValue,
  TreeNode,
} from './traceTypes';

/* -------------------------------------------------------------------------- */
/* Validation result                                                           */
/* -------------------------------------------------------------------------- */

export type TraceSemanticIssueCode =
  | 'EMPTY_TRACE'
  | 'MISSING_SCENE_INIT'
  | 'MISSING_STRUCTURE_CREATE'
  | 'WRONG_STRUCTURE_CREATE'
  | 'DUPLICATE_SCENE_INIT'
  | 'DUPLICATE_STRUCTURE_CREATE'
  | 'WRONG_STRUCTURE_COMMAND'
  | 'ARRAY_LABEL_COUNT_MISMATCH'
  | 'ARRAY_INDEX_OUT_OF_BOUNDS'
  | 'MATRIX_NOT_RECTANGULAR'
  | 'MATRIX_POSITION_OUT_OF_BOUNDS'
  | 'TREE_DUPLICATE_NODE_ID'
  | 'TREE_DUPLICATE_CHILD_ID'
  | 'TREE_ROOT_REQUIRED'
  | 'TREE_ROOT_NOT_FOUND'
  | 'TREE_ROOT_HAS_PARENT'
  | 'TREE_CHILD_NOT_FOUND'
  | 'TREE_NODE_NOT_FOUND'
  | 'TREE_MULTIPLE_PARENTS'
  | 'TREE_CYCLE'
  | 'TREE_UNREACHABLE_NODE'
  | 'TREE_NODE_REFERENCED'
  | 'TREE_ROOT_REMOVAL'
  | 'GRAPH_DUPLICATE_NODE_ID'
  | 'GRAPH_DUPLICATE_EDGE_ID'
  | 'GRAPH_NODE_NOT_FOUND'
  | 'GRAPH_EDGE_NOT_FOUND'
  | 'GRAPH_EDGE_NODE_NOT_FOUND'
  | 'GRAPH_FIXED_POSITIONS_REQUIRED'
  | 'GRAPH_FIXED_POSITION_MISSING'
  | 'GRAPH_POSITION_UNKNOWN_NODE'
  | 'GRAPH_CIRCULAR_POSITIONS_NOT_ALLOWED'
  | 'GRAPH_FIXED_ADD_NODE_POSITION_REQUIRED'
  | 'GRAPH_CIRCULAR_ADD_NODE_POSITION_NOT_ALLOWED'
  | 'GRAPH_NODE_HAS_EDGES'
  | 'STACK_UNDERFLOW'
  | 'STACK_INDEX_OUT_OF_BOUNDS'
  | 'QUEUE_UNDERFLOW'
  | 'QUEUE_INDEX_OUT_OF_BOUNDS'
  | 'LINKED_LIST_DUPLICATE_NODE_ID'
  | 'LINKED_LIST_NODE_NOT_FOUND'
  | 'LINKED_LIST_REFERENCE_NOT_FOUND'
  | 'LINKED_LIST_INVALID_PREVIOUS_POINTER'
  | 'LINKED_LIST_INVALID_HEAD_TAIL'
  | 'LINKED_LIST_INVALID_TOPOLOGY'
  | 'LINKED_LIST_NODE_REFERENCED'
  | 'LINKED_LIST_CIRCULAR_NULL_POINTER'
  | 'HASH_TABLE_DUPLICATE_ENTRY_ID'
  | 'HASH_TABLE_DUPLICATE_KEY'
  | 'HASH_TABLE_ENTRY_NOT_FOUND'
  | 'HASH_TABLE_BUCKET_OUT_OF_BOUNDS';

export type TraceSemanticIssue = {
  readonly commandIndex: number;
  readonly code: TraceSemanticIssueCode;
  readonly message: string;
  readonly path?: readonly PropertyKey[];
  readonly source?: TraceSourceLocation;
};

export type TraceSemanticValidationResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly issues: readonly TraceSemanticIssue[];
    };

/* -------------------------------------------------------------------------- */
/* Semantic state                                                              */
/* -------------------------------------------------------------------------- */

type TreeSemanticState = {
  rootId: string | null;
  nodes: Map<string, TreeNode>;
};

type GraphSemanticState = {
  layout: GraphLayout;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
};

type LinkedListSemanticState = {
  kind: LinkedListKind;
  headId: string | null;
  tailId: string | null;
  nodes: Map<string, LinkedListNode>;
};

type HashTableSemanticState = {
  bucketCount: number;
  entries: Map<string, HashTableEntry>;
};

/* -------------------------------------------------------------------------- */
/* Public validator                                                            */
/* -------------------------------------------------------------------------- */

export function validateTraceSemantics(
  commands: readonly TraceCommand[],
): TraceSemanticValidationResult {
  const issues: TraceSemanticIssue[] = [];

  if (commands.length === 0) {
    addIssue(
      issues,
      -1,
      'EMPTY_TRACE',
      'Trace must contain at least scene.init and a structure creation command.',
    );

    return createResult(issues);
  }

  const firstCommand = commands[0];

  if (firstCommand?.type !== 'scene.init') {
    addIssue(
      issues,
      0,
      'MISSING_SCENE_INIT',
      'The first trace command must be scene.init.',
    );

    return createResult(issues);
  }

  switch (firstCommand.structure) {
    case 'array':
      validateArrayTrace(commands, issues);
      break;

    case 'matrix':
      validateMatrixTrace(commands, issues);
      break;

    case 'tree':
      validateTreeTrace(commands, issues);
      break;

    case 'graph':
      validateGraphTrace(commands, issues);
      break;

    case 'stack':
      validateStackTrace(commands, issues);
      break;

    case 'queue':
      validateQueueTrace(commands, issues);
      break;

    case 'linked-list':
      validateLinkedListTrace(commands, issues);
      break;

    case 'hash-table':
      validateHashTableTrace(commands, issues);
      break;
  }

  return createResult(issues);
}

/* -------------------------------------------------------------------------- */
/* Array                                                                       */
/* -------------------------------------------------------------------------- */

function validateArrayTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'array.create') {
    addMissingCreateIssue(issues, createCommand, 'array', 'array.create');

    return;
  }

  if (
    createCommand.labels !== undefined &&
    createCommand.labels.length !== createCommand.values.length
  ) {
    addIssue(
      issues,
      1,
      'ARRAY_LABEL_COUNT_MISMATCH',
      'Array labels must contain exactly one label for every array value.',
    );
  }

  const arrayLength = createCommand.values.length;

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
      case 'array.compare':
      case 'array.swap':
        for (const index of command.indices) {
          validateArrayIndex(index, arrayLength, commandIndex, issues);
        }
        break;

      case 'array.set':
        validateArrayIndex(command.index, arrayLength, commandIndex, issues);
        break;

      case 'array.mark':
        for (const index of command.indices) {
          validateArrayIndex(index, arrayLength, commandIndex, issues);
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'array',
          'array.create',
          issues,
        );
    }
  }
}

function validateArrayIndex(
  index: number,
  arrayLength: number,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): void {
  if (index >= arrayLength) {
    addIssue(
      issues,
      commandIndex,
      'ARRAY_INDEX_OUT_OF_BOUNDS',
      `Array index ${index} is outside an array of length ${arrayLength}.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Matrix                                                                      */
/* -------------------------------------------------------------------------- */

function validateMatrixTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'matrix.create') {
    addMissingCreateIssue(issues, createCommand, 'matrix', 'matrix.create');

    return;
  }

  const rowCount = createCommand.values.length;
  const columnCount =
    createCommand.values.length > 0
      ? (createCommand.values[0]?.length ?? 0)
      : 0;

  for (const row of createCommand.values) {
    if (row.length !== columnCount) {
      addIssue(
        issues,
        1,
        'MATRIX_NOT_RECTANGULAR',
        'Matrix rows must all contain the same number of columns.',
      );

      break;
    }
  }

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
      case 'matrix.compare':
      case 'matrix.swap':
        for (const position of command.positions) {
          validateMatrixPosition(
            position.row,
            position.column,
            rowCount,
            columnCount,
            commandIndex,
            issues,
          );
        }
        break;

      case 'matrix.set':
        validateMatrixPosition(
          command.position.row,
          command.position.column,
          rowCount,
          columnCount,
          commandIndex,
          issues,
        );
        break;

      case 'matrix.mark':
        for (const position of command.positions) {
          validateMatrixPosition(
            position.row,
            position.column,
            rowCount,
            columnCount,
            commandIndex,
            issues,
          );
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'matrix',
          'matrix.create',
          issues,
        );
    }
  }
}

function validateMatrixPosition(
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): void {
  if (row >= rowCount || column >= columnCount) {
    addIssue(
      issues,
      commandIndex,
      'MATRIX_POSITION_OUT_OF_BOUNDS',
      `Matrix position (${row}, ${column}) is outside the ${rowCount} x ${columnCount} matrix.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

function validateTreeTrace(
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

    state.nodes.set(node.id, node);
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

        state.nodes.set(command.node.id, command.node);

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

      case 'tree.setValue': {
        const node = state.nodes.get(command.nodeId);

        if (node === undefined) {
          addTreeNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        state.nodes.set(command.nodeId, {
          ...node,
          value: command.value,
        });
        break;
      }

      case 'tree.compare':
      case 'tree.swapValues':
        for (const nodeId of command.nodeIds) {
          if (!state.nodes.has(nodeId)) {
            addTreeNodeNotFoundIssue(issues, commandIndex, nodeId);
          }
        }

        if (
          command.type === 'tree.swapValues' &&
          state.nodes.has(command.nodeIds[0]) &&
          state.nodes.has(command.nodeIds[1])
        ) {
          const firstNode = state.nodes.get(command.nodeIds[0]);
          const secondNode = state.nodes.get(command.nodeIds[1]);

          if (firstNode !== undefined && secondNode !== undefined) {
            state.nodes.set(firstNode.id, {
              ...firstNode,
              value: secondNode.value,
            });

            state.nodes.set(secondNode.id, {
              ...secondNode,
              value: firstNode.value,
            });
          }
        }
        break;

      case 'tree.visit':
        if (!state.nodes.has(command.nodeId)) {
          addTreeNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        }
        break;

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

function treeContainsCycle(nodes: ReadonlyMap<string, TreeNode>): boolean {
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
  nodes: ReadonlyMap<string, TreeNode>,
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
  nodes: ReadonlyMap<string, TreeNode>,
  nodeId: string,
): boolean {
  for (const node of nodes.values()) {
    if (node.children.includes(nodeId)) {
      return true;
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Graph                                                                       */
/* -------------------------------------------------------------------------- */

function validateGraphTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'graph.create') {
    addMissingCreateIssue(issues, createCommand, 'graph', 'graph.create');

    return;
  }

  const state: GraphSemanticState = {
    layout: createCommand.layout ?? 'circular',
    nodes: new Map(),
    edges: new Map(),
  };

  for (const node of createCommand.nodes) {
    if (state.nodes.has(node.id)) {
      addIssue(
        issues,
        1,
        'GRAPH_DUPLICATE_NODE_ID',
        `Graph node ID "${node.id}" appears more than once.`,
      );

      continue;
    }

    state.nodes.set(node.id, node);
  }

  for (const edge of createCommand.edges) {
    if (state.edges.has(edge.id)) {
      addIssue(
        issues,
        1,
        'GRAPH_DUPLICATE_EDGE_ID',
        `Graph edge ID "${edge.id}" appears more than once.`,
      );

      continue;
    }

    if (validateGraphEdgeReferences(edge, state.nodes, 1, issues)) {
      state.edges.set(edge.id, edge);
    }
  }

  validateGraphPositions(
    state.layout,
    createCommand.positions,
    state.nodes,
    1,
    issues,
  );

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
      case 'graph.addNode':
        if (state.layout === 'fixed' && command.position === undefined) {
          addIssue(
            issues,
            commandIndex,
            'GRAPH_FIXED_ADD_NODE_POSITION_REQUIRED',
            'graph.addNode requires a position for a fixed-layout graph.',
          );

          break;
        }

        if (state.layout === 'circular' && command.position !== undefined) {
          addIssue(
            issues,
            commandIndex,
            'GRAPH_CIRCULAR_ADD_NODE_POSITION_NOT_ALLOWED',
            'graph.addNode must not provide a fixed position for a circular-layout graph.',
          );

          break;
        }

        if (state.nodes.has(command.node.id)) {
          addIssue(
            issues,
            commandIndex,
            'GRAPH_DUPLICATE_NODE_ID',
            `Graph node ID "${command.node.id}" already exists.`,
          );

          break;
        }

        state.nodes.set(command.node.id, command.node);
        break;

      case 'graph.removeNode':
        if (!state.nodes.has(command.nodeId)) {
          addGraphNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        if (graphNodeHasEdges(state.edges, command.nodeId)) {
          addIssue(
            issues,
            commandIndex,
            'GRAPH_NODE_HAS_EDGES',
            `Graph node "${command.nodeId}" cannot be removed while edges still reference it.`,
          );

          break;
        }

        state.nodes.delete(command.nodeId);
        break;

      case 'graph.addEdge':
        if (state.edges.has(command.edge.id)) {
          addIssue(
            issues,
            commandIndex,
            'GRAPH_DUPLICATE_EDGE_ID',
            `Graph edge ID "${command.edge.id}" already exists.`,
          );

          break;
        }

        if (
          validateGraphEdgeReferences(
            command.edge,
            state.nodes,
            commandIndex,
            issues,
          )
        ) {
          state.edges.set(command.edge.id, command.edge);
        }
        break;

      case 'graph.removeEdge':
        if (!state.edges.has(command.edgeId)) {
          addGraphEdgeNotFoundIssue(issues, commandIndex, command.edgeId);

          break;
        }

        state.edges.delete(command.edgeId);
        break;

      case 'graph.setNodeValue': {
        const node = state.nodes.get(command.nodeId);

        if (node === undefined) {
          addGraphNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        state.nodes.set(command.nodeId, {
          ...node,
          value: command.value,
        });
        break;
      }

      case 'graph.setEdgeWeight': {
        const edge = state.edges.get(command.edgeId);

        if (edge === undefined) {
          addGraphEdgeNotFoundIssue(issues, commandIndex, command.edgeId);

          break;
        }

        state.edges.set(command.edgeId, {
          ...edge,
          weight: command.weight,
        });
        break;
      }

      case 'graph.visitNode':
      case 'graph.distance':
        if (!state.nodes.has(command.nodeId)) {
          addGraphNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        }
        break;

      case 'graph.visitEdge':
        if (!state.edges.has(command.edgeId)) {
          addGraphEdgeNotFoundIssue(issues, commandIndex, command.edgeId);
        }
        break;

      case 'graph.markNodes':
        for (const nodeId of command.nodeIds) {
          if (!state.nodes.has(nodeId)) {
            addGraphNodeNotFoundIssue(issues, commandIndex, nodeId);
          }
        }
        break;

      case 'graph.markEdges':
        for (const edgeId of command.edgeIds) {
          if (!state.edges.has(edgeId)) {
            addGraphEdgeNotFoundIssue(issues, commandIndex, edgeId);
          }
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'graph',
          'graph.create',
          issues,
        );
    }
  }
}

function validateGraphEdgeReferences(
  edge: GraphEdge,
  nodes: ReadonlyMap<string, GraphNode>,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): boolean {
  let valid = true;

  if (!nodes.has(edge.from)) {
    addIssue(
      issues,
      commandIndex,
      'GRAPH_EDGE_NODE_NOT_FOUND',
      `Graph edge "${edge.id}" references missing source node "${edge.from}".`,
    );

    valid = false;
  }

  if (!nodes.has(edge.to)) {
    addIssue(
      issues,
      commandIndex,
      'GRAPH_EDGE_NODE_NOT_FOUND',
      `Graph edge "${edge.id}" references missing destination node "${edge.to}".`,
    );

    valid = false;
  }

  return valid;
}

function validateGraphPositions(
  layout: GraphLayout,
  positions:
    | Readonly<Record<string, { readonly x: number; readonly y: number }>>
    | undefined,
  nodes: ReadonlyMap<string, GraphNode>,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): void {
  if (layout === 'circular') {
    if (positions !== undefined) {
      addIssue(
        issues,
        commandIndex,
        'GRAPH_CIRCULAR_POSITIONS_NOT_ALLOWED',
        'Circular graph layout must not provide fixed node positions.',
      );
    }

    return;
  }

  if (positions === undefined) {
    addIssue(
      issues,
      commandIndex,
      'GRAPH_FIXED_POSITIONS_REQUIRED',
      'Fixed graph layout requires a position for every node.',
    );

    return;
  }

  for (const nodeId of nodes.keys()) {
    if (positions[nodeId] === undefined) {
      addIssue(
        issues,
        commandIndex,
        'GRAPH_FIXED_POSITION_MISSING',
        `Fixed graph layout is missing a position for node "${nodeId}".`,
      );
    }
  }

  for (const nodeId of Object.keys(positions)) {
    if (!nodes.has(nodeId)) {
      addIssue(
        issues,
        commandIndex,
        'GRAPH_POSITION_UNKNOWN_NODE',
        `Graph position references unknown node "${nodeId}".`,
      );
    }
  }
}

function graphNodeHasEdges(
  edges: ReadonlyMap<string, GraphEdge>,
  nodeId: string,
): boolean {
  for (const edge of edges.values()) {
    if (edge.from === nodeId || edge.to === nodeId) {
      return true;
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Stack                                                                       */
/* -------------------------------------------------------------------------- */

function validateStackTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'stack.create') {
    addMissingCreateIssue(issues, createCommand, 'stack', 'stack.create');

    return;
  }

  let stackLength = createCommand.values.length;

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
      case 'stack.push':
        stackLength += 1;
        break;

      case 'stack.pop':
        if (stackLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'STACK_UNDERFLOW',
            'Cannot pop from an empty stack.',
          );

          break;
        }

        stackLength -= 1;
        break;

      case 'stack.peek':
        if (stackLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'STACK_UNDERFLOW',
            'Cannot peek at an empty stack.',
          );
        }
        break;

      case 'stack.mark':
        for (const index of command.indices) {
          if (index >= stackLength) {
            addIssue(
              issues,
              commandIndex,
              'STACK_INDEX_OUT_OF_BOUNDS',
              `Stack index ${index} is outside a stack of length ${stackLength}.`,
            );
          }
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'stack',
          'stack.create',
          issues,
        );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                       */
/* -------------------------------------------------------------------------- */

function validateQueueTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'queue.create') {
    addMissingCreateIssue(issues, createCommand, 'queue', 'queue.create');

    return;
  }

  let queueLength = createCommand.values.length;

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
      case 'queue.enqueue':
        queueLength += 1;
        break;

      case 'queue.dequeue':
      case 'queue.dequeueBack':
        if (queueLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'QUEUE_UNDERFLOW',
            'Cannot dequeue from an empty queue.',
          );

          break;
        }

        queueLength -= 1;
        break;

      case 'queue.peek':
        if (queueLength === 0) {
          addIssue(
            issues,
            commandIndex,
            'QUEUE_UNDERFLOW',
            'Cannot peek at an empty queue.',
          );
        }
        break;

      case 'queue.mark':
        for (const index of command.indices) {
          if (index >= queueLength) {
            addIssue(
              issues,
              commandIndex,
              'QUEUE_INDEX_OUT_OF_BOUNDS',
              `Queue index ${index} is outside a queue of length ${queueLength}.`,
            );
          }
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'queue',
          'queue.create',
          issues,
        );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Linked list                                                                 */
/* -------------------------------------------------------------------------- */

function validateLinkedListTrace(
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

    state.nodes.set(node.id, node);
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

        state.nodes.set(command.node.id, command.node);
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

      case 'linked-list.setValue': {
        const node = state.nodes.get(command.nodeId);

        if (node === undefined) {
          addLinkedListNodeNotFoundIssue(issues, commandIndex, command.nodeId);

          break;
        }

        state.nodes.set(command.nodeId, {
          ...node,
          value: command.value,
        });
        break;
      }

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
  node: LinkedListNode,
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
  nodes: ReadonlyMap<string, LinkedListNode>,
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

/* -------------------------------------------------------------------------- */
/* Hash table                                                                  */
/* -------------------------------------------------------------------------- */

function validateHashTableTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'hash-table.create') {
    addMissingCreateIssue(
      issues,
      createCommand,
      'hash-table',
      'hash-table.create',
    );

    return;
  }

  const state: HashTableSemanticState = {
    bucketCount: createCommand.bucketCount,
    entries: new Map(),
  };

  const keys = new Map<TraceValue, string>();

  for (const entry of createCommand.entries) {
    if (state.entries.has(entry.id)) {
      addIssue(
        issues,
        1,
        'HASH_TABLE_DUPLICATE_ENTRY_ID',
        `Hash-table entry ID "${entry.id}" appears more than once.`,
      );

      continue;
    }

    const existingKeyId = keys.get(entry.key);

    if (existingKeyId !== undefined) {
      addIssue(
        issues,
        1,
        'HASH_TABLE_DUPLICATE_KEY',
        `Hash-table key "${String(entry.key)}" appears more than once.`,
      );

      continue;
    }

    if (
      !validateHashTableBucket(entry.bucketIndex, state.bucketCount, 1, issues)
    ) {
      continue;
    }

    state.entries.set(entry.id, entry);
    keys.set(entry.key, entry.id);
  }

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
      case 'hash-table.set': {
        const existingEntry = state.entries.get(command.entry.id);
        const keyOwner = keys.get(command.entry.key);

        if (keyOwner !== undefined && keyOwner !== command.entry.id) {
          addIssue(
            issues,
            commandIndex,
            'HASH_TABLE_DUPLICATE_KEY',
            `Hash-table key "${String(command.entry.key)}" already belongs to entry "${keyOwner}".`,
          );

          break;
        }

        if (
          !validateHashTableBucket(
            command.entry.bucketIndex,
            state.bucketCount,
            commandIndex,
            issues,
          )
        ) {
          break;
        }

        if (existingEntry !== undefined) {
          keys.delete(existingEntry.key);
        }

        state.entries.set(command.entry.id, command.entry);

        keys.set(command.entry.key, command.entry.id);
        break;
      }

      case 'hash-table.delete': {
        const entry = state.entries.get(command.entryId);

        if (entry === undefined) {
          addHashTableEntryNotFoundIssue(issues, commandIndex, command.entryId);

          break;
        }

        state.entries.delete(command.entryId);
        keys.delete(entry.key);
        break;
      }

      case 'hash-table.move': {
        const entry = state.entries.get(command.entryId);

        if (entry === undefined) {
          addHashTableEntryNotFoundIssue(issues, commandIndex, command.entryId);

          break;
        }

        if (
          !validateHashTableBucket(
            command.bucketIndex,
            state.bucketCount,
            commandIndex,
            issues,
          )
        ) {
          break;
        }

        state.entries.set(command.entryId, {
          ...entry,
          bucketIndex: command.bucketIndex,
        });
        break;
      }

      case 'hash-table.visitBucket':
        validateHashTableBucket(
          command.bucketIndex,
          state.bucketCount,
          commandIndex,
          issues,
        );
        break;

      case 'hash-table.visitEntry':
        if (!state.entries.has(command.entryId)) {
          addHashTableEntryNotFoundIssue(issues, commandIndex, command.entryId);
        }
        break;

      case 'hash-table.mark':
        for (const entryId of command.entryIds) {
          if (!state.entries.has(entryId)) {
            addHashTableEntryNotFoundIssue(issues, commandIndex, entryId);
          }
        }
        break;

      case 'message':
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'hash-table',
          'hash-table.create',
          issues,
        );
    }
  }
}

function validateHashTableBucket(
  bucketIndex: number,
  bucketCount: number,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): boolean {
  if (bucketIndex >= bucketCount) {
    addIssue(
      issues,
      commandIndex,
      'HASH_TABLE_BUCKET_OUT_OF_BOUNDS',
      `Hash-table bucket ${bucketIndex} is outside a table containing ${bucketCount} buckets.`,
    );

    return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Shared command validation                                                   */
/* -------------------------------------------------------------------------- */

function addMissingCreateIssue(
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

function addUnexpectedCommandIssue(
  command: TraceCommand,
  commandIndex: number,
  structure: TraceStructure,
  createType: TraceCommand['type'],
  issues: TraceSemanticIssue[],
): void {
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

function addTreeNodeNotFoundIssue(
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

function addGraphNodeNotFoundIssue(
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

function addGraphEdgeNotFoundIssue(
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

function addLinkedListNodeNotFoundIssue(
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

function addHashTableEntryNotFoundIssue(
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

function addIssue(
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

/* -------------------------------------------------------------------------- */
/* Result                                                                      */
/* -------------------------------------------------------------------------- */

function createResult(
  issues: readonly TraceSemanticIssue[],
): TraceSemanticValidationResult {
  if (issues.length === 0) {
    return {
      ok: true,
    };
  }

  return {
    ok: false,
    issues,
  };
}
