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

        state.nodes.add(command.node.id);
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
          state.edges.set(command.edge.id, {
            id: command.edge.id,
            from: command.edge.from,
            to: command.edge.to,
          });
        }
        break;

      case 'graph.removeEdge':
        if (!state.edges.has(command.edgeId)) {
          addGraphEdgeNotFoundIssue(issues, commandIndex, command.edgeId);

          break;
        }

        state.edges.delete(command.edgeId);
        break;

      case 'graph.setNodeValue':
      case 'graph.visitNode':
      case 'graph.distance':
        if (!state.nodes.has(command.nodeId)) {
          addGraphNodeNotFoundIssue(issues, commandIndex, command.nodeId);
        }
        break;

      case 'graph.setEdgeWeight':
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
  edge: GraphSemanticEdge,
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

function graphNodeHasEdges(
  edges: ReadonlyMap<string, GraphSemanticEdge>,
  nodeId: string,
): boolean {
  for (const edge of edges.values()) {
    if (edge.from === nodeId || edge.to === nodeId) {
      return true;
    }
  }

  return false;
}
