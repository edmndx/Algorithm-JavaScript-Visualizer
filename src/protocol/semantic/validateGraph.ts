import type { GraphLayout, TraceCommand } from '../traceTypes';
import {
  addGraphEdgeNotFoundIssue,
  addGraphNodeNotFoundIssue,
  addIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

type GraphSemanticEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly directed: boolean;
};

type GraphSemanticState = {
  layout: GraphLayout;
  nodes: Set<string>;
  edges: Map<string, GraphSemanticEdge>;
};

export function validateGraphTrace(
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
    nodes: new Set(),
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

    state.nodes.add(node.id);
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
      state.edges.set(edge.id, {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        directed: edge.directed === true,
      });
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
      case 'graph.visitNode':
      case 'graph.discoverNode':
      case 'graph.distance':
      case 'graph.nodeMetric':
        if (!state.nodes.has(command.nodeId)) {
          addGraphNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        }
        break;

      case 'graph.predecessor':
        if (!state.nodes.has(command.nodeId))
          addGraphNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        if (command.predecessorId !== null) {
          if (!state.nodes.has(command.predecessorId))
            addGraphNodeNotFoundIssue(
              issues,
              commandIndex,
              command.predecessorId,
            );
          else if (
            ![...state.edges.values()].some(
              (edge) =>
                edge.directed &&
                edge.from === command.predecessorId &&
                edge.to === command.nodeId,
            )
          )
            addIssue(
              issues,
              commandIndex,
              'GRAPH_PREDECESSOR_EDGE_NOT_FOUND',
              `No directed edge from "${command.predecessorId}" to "${command.nodeId}" exists.`,
            );
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

      case 'graph.frontier': {
        const seen = new Set<string>();
        for (const nodeId of command.nodeIds) {
          if (!state.nodes.has(nodeId))
            addGraphNodeNotFoundIssue(issues, commandIndex, nodeId);
          if (seen.has(nodeId))
            addIssue(
              issues,
              commandIndex,
              'GRAPH_FRONTIER_DUPLICATE',
              `Graph frontier repeats node "${nodeId}".`,
            );
          seen.add(nodeId);
        }
        break;
      }

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
  edge: Pick<GraphSemanticEdge, 'id' | 'from' | 'to'>,
  nodes: ReadonlySet<string>,
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
  nodes: ReadonlySet<string>,
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
