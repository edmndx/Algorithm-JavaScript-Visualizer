import { TRACE_PROTOCOL_VERSION } from '../protocol/protocolVersion';
import {
  validateTrace,
  type TraceValidationResult,
} from '../protocol/traceValidation';
import type {
  GraphPosition,
  TraceCommand,
  TraceSourceLocation,
  TraceStructure,
} from '../protocol/traceTypes';

import {
  createInitialScene,
  createInitializedScene,
  type SceneMessage,
  type SceneState,
} from './sceneState';

/* -------------------------------------------------------------------------- */
/* Reducer errors                                                              */
/* -------------------------------------------------------------------------- */

export type SceneReducerErrorCode =
  | 'DUPLICATE_SCENE_INIT'
  | 'STRUCTURE_NOT_INITIALIZED'
  | 'STRUCTURE_MISMATCH'
  | 'ENTITY_NOT_FOUND'
  | 'INDEX_OUT_OF_BOUNDS'
  | 'STACK_UNDERFLOW'
  | 'QUEUE_UNDERFLOW';

export class SceneReducerError extends Error {
  readonly code: SceneReducerErrorCode;

  constructor(code: SceneReducerErrorCode, message: string) {
    super(message);

    this.name = 'SceneReducerError';
    this.code = code;
  }
}

export type TraceReductionIssue = {
  readonly commandIndex: number;
  readonly code: SceneReducerErrorCode | 'UNEXPECTED_REDUCER_ERROR';
  readonly message: string;
  readonly path: readonly PropertyKey[];
  readonly source?: TraceSourceLocation;
};

export type TraceReductionResult =
  | {
      readonly ok: true;
      readonly version: typeof TRACE_PROTOCOL_VERSION;
      readonly commands: readonly TraceCommand[];
      readonly scene: SceneState;
    }
  | Exclude<TraceValidationResult, { readonly ok: true }>
  | {
      readonly ok: false;
      readonly stage: 'reducer';
      readonly issues: readonly [TraceReductionIssue];
    };

export function reduceTrace(input: unknown): TraceReductionResult {
  const validation = validateTrace(input);
  if (!validation.ok) return validation;

  let scene: SceneState = createInitialScene();

  for (const [commandIndex, command] of validation.commands.entries()) {
    try {
      scene = reduceTraceCommand(scene, command);
    } catch (error) {
      return {
        ok: false,
        stage: 'reducer',
        issues: [
          {
            commandIndex,
            code:
              error instanceof SceneReducerError
                ? error.code
                : 'UNEXPECTED_REDUCER_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown scene reducer error.',
            path: ['commands', commandIndex],
            source: command.source,
          },
        ],
      };
    }
  }

  return {
    ok: true,
    version: validation.version,
    commands: validation.commands,
    scene,
  };
}

/* -------------------------------------------------------------------------- */
/* Public reducer                                                              */
/* -------------------------------------------------------------------------- */

export function reduceTraceCommand(
  scene: SceneState,
  command: TraceCommand,
): SceneState {
  switch (command.type) {
    case 'scene.init':
      return reduceSceneInit(scene, command);

    case 'message':
      return {
        ...scene,
        message: createSceneMessage(command.text, command.level),
      };

    case 'array.create': {
      requireStructure(scene, 'array', command.type);

      return {
        ...scene,
        values: [...command.values],
        itemIds: createItemIds('array-item', command.values.length),
        labels: command.labels === undefined ? [] : [...command.labels],
        comparedIndices: null,
        markers: {},
      };
    }

    case 'array.compare': {
      requireStructure(scene, 'array', command.type);

      return {
        ...scene,
        comparedIndices: [...command.indices],
      };
    }

    case 'array.swap': {
      requireStructure(scene, 'array', command.type);

      const [firstIndex, secondIndex] = command.indices;
      const values = [...scene.values];
      const itemIds = [...scene.itemIds];

      assertIndex(firstIndex, values.length, command.type);

      assertIndex(secondIndex, values.length, command.type);

      const firstValue = values[firstIndex];
      const secondValue = values[secondIndex];

      if (firstValue === undefined || secondValue === undefined) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested array indices.`,
        );
      }

      values[firstIndex] = secondValue;
      values[secondIndex] = firstValue;

      const firstItemId = itemIds[firstIndex];
      const secondItemId = itemIds[secondIndex];

      if (firstItemId === undefined || secondItemId === undefined) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested array identities.`,
        );
      }

      itemIds[firstIndex] = secondItemId;
      itemIds[secondIndex] = firstItemId;

      return {
        ...scene,
        values,
        itemIds,
      };
    }

    case 'array.set': {
      requireStructure(scene, 'array', command.type);

      assertIndex(command.index, scene.values.length, command.type);

      const values = [...scene.values];

      values[command.index] = command.value;

      return {
        ...scene,
        values,
      };
    }

    case 'array.mark': {
      requireStructure(scene, 'array', command.type);

      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.indices],
        },
      };
    }

    case 'matrix.create': {
      requireStructure(scene, 'matrix', command.type);

      return {
        ...scene,
        values: cloneMatrix(command.values),
        itemIds: createMatrixItemIds(command.values),
        comparedPositions: null,
        markers: {},
      };
    }

    case 'matrix.compare': {
      requireStructure(scene, 'matrix', command.type);

      return {
        ...scene,
        comparedPositions: [
          { ...command.positions[0] },
          { ...command.positions[1] },
        ],
      };
    }

    case 'matrix.swap': {
      requireStructure(scene, 'matrix', command.type);

      const [firstPosition, secondPosition] = command.positions;

      assertMatrixPosition(
        scene.values,
        firstPosition.row,
        firstPosition.column,
        command.type,
      );

      assertMatrixPosition(
        scene.values,
        secondPosition.row,
        secondPosition.column,
        command.type,
      );

      const values = cloneMatrix(scene.values);
      const itemIds = cloneMatrix(scene.itemIds);

      const firstRow = values[firstPosition.row];
      const secondRow = values[secondPosition.row];
      const firstIdRow = itemIds[firstPosition.row];
      const secondIdRow = itemIds[secondPosition.row];

      if (
        firstRow === undefined ||
        secondRow === undefined ||
        firstIdRow === undefined ||
        secondIdRow === undefined
      ) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested matrix positions.`,
        );
      }

      const firstValue = firstRow[firstPosition.column];

      const secondValue = secondRow[secondPosition.column];
      const firstItemId = firstIdRow[firstPosition.column];
      const secondItemId = secondIdRow[secondPosition.column];

      if (
        firstValue === undefined ||
        secondValue === undefined ||
        firstItemId === undefined ||
        secondItemId === undefined
      ) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested matrix positions.`,
        );
      }

      firstRow[firstPosition.column] = secondValue;
      secondRow[secondPosition.column] = firstValue;
      firstIdRow[firstPosition.column] = secondItemId;
      secondIdRow[secondPosition.column] = firstItemId;

      return {
        ...scene,
        values,
        itemIds,
      };
    }

    case 'matrix.set': {
      requireStructure(scene, 'matrix', command.type);

      assertMatrixPosition(
        scene.values,
        command.position.row,
        command.position.column,
        command.type,
      );

      const values = cloneMatrix(scene.values);
      const row = values[command.position.row];

      if (row === undefined) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested matrix position.`,
        );
      }

      row[command.position.column] = command.value;

      return {
        ...scene,
        values,
      };
    }

    case 'matrix.mark': {
      requireStructure(scene, 'matrix', command.type);

      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: command.positions.map((position) => ({
            ...position,
          })),
        },
      };
    }

    case 'tree.create': {
      requireStructure(scene, 'tree', command.type);

      return {
        ...scene,
        rootId: command.rootId,
        nodes: command.nodes.map(cloneTreeNode),
        comparedNodeIds: null,
        visitedNodeIds: [],
        markers: {},
      };
    }

    case 'tree.setRoot': {
      requireStructure(scene, 'tree', command.type);

      return {
        ...scene,
        rootId: command.rootId,
      };
    }

    case 'tree.addNode': {
      requireStructure(scene, 'tree', command.type);

      return {
        ...scene,
        nodes: [...scene.nodes, cloneTreeNode(command.node)],
      };
    }

    case 'tree.removeNode': {
      requireStructure(scene, 'tree', command.type);

      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Tree node "${command.nodeId}" does not exist.`,
      );

      return {
        ...scene,
        nodes: scene.nodes.filter((node) => node.id !== command.nodeId),
        comparedNodeIds: scene.comparedNodeIds?.includes(command.nodeId)
          ? null
          : scene.comparedNodeIds,
        visitedNodeIds: scene.visitedNodeIds.filter(
          (nodeId) => nodeId !== command.nodeId,
        ),
        markers: removeIdFromMarkers(scene.markers, command.nodeId),
      };
    }

    case 'tree.setChildren': {
      requireStructure(scene, 'tree', command.type);

      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({
          ...node,
          children: [...command.children],
        }),
        'Tree node',
      );

      return {
        ...scene,
        nodes,
      };
    }

    case 'tree.setValue': {
      requireStructure(scene, 'tree', command.type);

      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({
          ...node,
          value: command.value,
        }),
        'Tree node',
      );

      return {
        ...scene,
        nodes,
      };
    }

    case 'tree.compare': {
      requireStructure(scene, 'tree', command.type);

      return {
        ...scene,
        comparedNodeIds: [...command.nodeIds],
      };
    }

    case 'tree.swapValues': {
      requireStructure(scene, 'tree', command.type);

      const [firstId, secondId] = command.nodeIds;

      const firstNode = scene.nodes.find((node) => node.id === firstId);

      const secondNode = scene.nodes.find((node) => node.id === secondId);

      requireEntity(
        firstNode !== undefined,
        `Tree node "${firstId}" does not exist.`,
      );

      requireEntity(
        secondNode !== undefined,
        `Tree node "${secondId}" does not exist.`,
      );

      const nodes = scene.nodes.map((node) => {
        if (node.id === firstId) {
          return {
            ...node,
            value: secondNode.value,
          };
        }

        if (node.id === secondId) {
          return {
            ...node,
            value: firstNode.value,
          };
        }

        return node;
      });

      return {
        ...scene,
        nodes,
      };
    }

    case 'tree.visit': {
      requireStructure(scene, 'tree', command.type);

      return {
        ...scene,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
      };
    }

    case 'tree.mark': {
      requireStructure(scene, 'tree', command.type);

      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.nodeIds],
        },
      };
    }

    case 'graph.create': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        nodes: command.nodes.map((node) => ({
          ...node,
        })),
        edges: command.edges.map((edge) => ({
          ...edge,
        })),
        layout: command.layout ?? 'circular',
        positions:
          command.positions === undefined
            ? null
            : cloneGraphPositions(command.positions),
        visitedNodeIds: [],
        visitedEdgeIds: [],
        nodeMarkers: {},
        edgeMarkers: {},
        distances: {},
      };
    }

    case 'graph.addNode': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        nodes: [...scene.nodes, { ...command.node }],
        positions:
          scene.layout === 'fixed' && command.position !== undefined
            ? {
                ...(scene.positions ?? {}),
                [command.node.id]: { ...command.position },
              }
            : scene.positions,
      };
    }

    case 'graph.removeNode': {
      requireStructure(scene, 'graph', command.type);

      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Graph node "${command.nodeId}" does not exist.`,
      );

      return {
        ...scene,
        nodes: scene.nodes.filter((node) => node.id !== command.nodeId),
        visitedNodeIds: scene.visitedNodeIds.filter(
          (nodeId) => nodeId !== command.nodeId,
        ),
        nodeMarkers: removeIdFromMarkers(scene.nodeMarkers, command.nodeId),
        distances: removeRecordKey(scene.distances, command.nodeId),
        positions:
          scene.positions === null
            ? null
            : removeRecordKey(scene.positions, command.nodeId),
      };
    }

    case 'graph.addEdge': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        edges: [...scene.edges, { ...command.edge }],
      };
    }

    case 'graph.removeEdge': {
      requireStructure(scene, 'graph', command.type);

      requireEntity(
        scene.edges.some((edge) => edge.id === command.edgeId),
        `Graph edge "${command.edgeId}" does not exist.`,
      );

      return {
        ...scene,
        edges: scene.edges.filter((edge) => edge.id !== command.edgeId),
        visitedEdgeIds: scene.visitedEdgeIds.filter(
          (edgeId) => edgeId !== command.edgeId,
        ),
        edgeMarkers: removeIdFromMarkers(scene.edgeMarkers, command.edgeId),
      };
    }

    case 'graph.setNodeValue': {
      requireStructure(scene, 'graph', command.type);

      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({
          ...node,
          value: command.value,
        }),
        'Graph node',
      );

      return {
        ...scene,
        nodes,
      };
    }

    case 'graph.setEdgeWeight': {
      requireStructure(scene, 'graph', command.type);

      const edges = updateEntityById(
        scene.edges,
        command.edgeId,
        (edge) => ({
          ...edge,
          weight: command.weight,
        }),
        'Graph edge',
      );

      return {
        ...scene,
        edges,
      };
    }

    case 'graph.visitNode': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
      };
    }

    case 'graph.visitEdge': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        visitedEdgeIds: appendUnique(scene.visitedEdgeIds, command.edgeId),
      };
    }

    case 'graph.markNodes': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        nodeMarkers: {
          ...scene.nodeMarkers,
          [command.marker]: [...command.nodeIds],
        },
      };
    }

    case 'graph.markEdges': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        edgeMarkers: {
          ...scene.edgeMarkers,
          [command.marker]: [...command.edgeIds],
        },
      };
    }

    case 'graph.distance': {
      requireStructure(scene, 'graph', command.type);

      return {
        ...scene,
        distances: {
          ...scene.distances,
          [command.nodeId]: command.distance,
        },
      };
    }

    case 'stack.create': {
      requireStructure(scene, 'stack', command.type);

      return {
        ...scene,
        values: [...command.values],
        itemIds: createItemIds('stack-item', command.values.length),
        nextItemId: command.values.length,
        peekedIndex: null,
        markers: {},
      };
    }

    case 'stack.push': {
      requireStructure(scene, 'stack', command.type);

      return {
        ...scene,
        values: [...scene.values, command.value],
        itemIds: [...scene.itemIds, `stack-item-${scene.nextItemId}`],
        nextItemId: scene.nextItemId + 1,
        peekedIndex: null,
      };
    }

    case 'stack.pop': {
      requireStructure(scene, 'stack', command.type);

      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'STACK_UNDERFLOW',
          'Cannot pop from an empty stack.',
        );
      }

      return {
        ...scene,
        values: scene.values.slice(0, -1),
        itemIds: scene.itemIds.slice(0, -1),
        peekedIndex: null,
        markers: removeIndicesAtOrAbove(scene.markers, scene.values.length - 1),
      };
    }

    case 'stack.peek': {
      requireStructure(scene, 'stack', command.type);

      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'STACK_UNDERFLOW',
          'Cannot peek at an empty stack.',
        );
      }

      return {
        ...scene,
        peekedIndex: scene.values.length - 1,
      };
    }

    case 'stack.mark': {
      requireStructure(scene, 'stack', command.type);

      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.indices],
        },
      };
    }

    case 'queue.create': {
      requireStructure(scene, 'queue', command.type);

      return {
        ...scene,
        values: [...command.values],
        itemIds: createItemIds('queue-item', command.values.length),
        nextItemId: command.values.length,
        peekedIndex: null,
        markers: {},
      };
    }

    case 'queue.enqueue': {
      requireStructure(scene, 'queue', command.type);

      return {
        ...scene,
        values: [...scene.values, command.value],
        itemIds: [...scene.itemIds, `queue-item-${scene.nextItemId}`],
        nextItemId: scene.nextItemId + 1,
        peekedIndex: null,
      };
    }

    case 'queue.dequeue': {
      requireStructure(scene, 'queue', command.type);

      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'QUEUE_UNDERFLOW',
          'Cannot dequeue from an empty queue.',
        );
      }

      return {
        ...scene,
        values: scene.values.slice(1),
        itemIds: scene.itemIds.slice(1),
        peekedIndex: null,
        markers: shiftIndicesAfterRemoval(scene.markers, 0),
      };
    }

    case 'queue.dequeueBack': {
      requireStructure(scene, 'queue', command.type);

      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'QUEUE_UNDERFLOW',
          'Cannot dequeue from an empty queue.',
        );
      }

      const removedIndex = scene.values.length - 1;

      return {
        ...scene,
        values: scene.values.slice(0, -1),
        itemIds: scene.itemIds.slice(0, -1),
        peekedIndex: null,
        markers: shiftIndicesAfterRemoval(scene.markers, removedIndex),
      };
    }

    case 'queue.peek': {
      requireStructure(scene, 'queue', command.type);

      if (scene.values.length === 0) {
        throw new SceneReducerError(
          'QUEUE_UNDERFLOW',
          'Cannot peek at an empty queue.',
        );
      }

      return {
        ...scene,
        peekedIndex: 0,
      };
    }

    case 'queue.mark': {
      requireStructure(scene, 'queue', command.type);

      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.indices],
        },
      };
    }

    case 'linked-list.create': {
      requireStructure(scene, 'linked-list', command.type);

      return {
        ...scene,
        kind: command.kind,
        headId: command.headId,
        tailId: command.tailId,
        nodes: command.nodes.map((node) => ({
          ...node,
        })),
        visitedNodeIds: [],
        markers: {},
      };
    }

    case 'linked-list.addNode': {
      requireStructure(scene, 'linked-list', command.type);

      return {
        ...scene,
        nodes: [...scene.nodes, { ...command.node }],
      };
    }

    case 'linked-list.removeNode': {
      requireStructure(scene, 'linked-list', command.type);

      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Linked-list node "${command.nodeId}" does not exist.`,
      );

      return {
        ...scene,
        nodes: scene.nodes.filter((node) => node.id !== command.nodeId),
        visitedNodeIds: scene.visitedNodeIds.filter(
          (nodeId) => nodeId !== command.nodeId,
        ),
        markers: removeIdFromMarkers(scene.markers, command.nodeId),
      };
    }

    case 'linked-list.setHead': {
      requireStructure(scene, 'linked-list', command.type);

      return {
        ...scene,
        headId: command.nodeId,
      };
    }

    case 'linked-list.setTail': {
      requireStructure(scene, 'linked-list', command.type);

      return {
        ...scene,
        tailId: command.nodeId,
      };
    }

    case 'linked-list.setNext': {
      requireStructure(scene, 'linked-list', command.type);

      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({
          ...node,
          nextId: command.nextId,
        }),
        'Linked-list node',
      );

      return {
        ...scene,
        nodes,
      };
    }

    case 'linked-list.setPrevious': {
      requireStructure(scene, 'linked-list', command.type);

      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({
          ...node,
          previousId: command.previousId,
        }),
        'Linked-list node',
      );

      return {
        ...scene,
        nodes,
      };
    }

    case 'linked-list.setValue': {
      requireStructure(scene, 'linked-list', command.type);

      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({
          ...node,
          value: command.value,
        }),
        'Linked-list node',
      );

      return {
        ...scene,
        nodes,
      };
    }

    case 'linked-list.visit': {
      requireStructure(scene, 'linked-list', command.type);

      return {
        ...scene,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
      };
    }

    case 'linked-list.mark': {
      requireStructure(scene, 'linked-list', command.type);

      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.nodeIds],
        },
      };
    }

    case 'hash-table.create': {
      requireStructure(scene, 'hash-table', command.type);

      return {
        ...scene,
        bucketCount: command.bucketCount,
        strategy: command.strategy,
        entries: command.entries.map((entry) => ({
          ...entry,
        })),
        visitedBucketIndices: [],
        visitedEntryIds: [],
        markers: {},
      };
    }

    case 'hash-table.set': {
      requireStructure(scene, 'hash-table', command.type);

      const existingIndex = scene.entries.findIndex(
        (entry) => entry.id === command.entry.id,
      );

      if (existingIndex === -1) {
        return {
          ...scene,
          entries: [...scene.entries, { ...command.entry }],
        };
      }

      const entries = [...scene.entries];

      entries[existingIndex] = {
        ...command.entry,
      };

      return {
        ...scene,
        entries,
      };
    }

    case 'hash-table.delete': {
      requireStructure(scene, 'hash-table', command.type);

      requireEntity(
        scene.entries.some((entry) => entry.id === command.entryId),
        `Hash-table entry "${command.entryId}" does not exist.`,
      );

      return {
        ...scene,
        entries: scene.entries.filter((entry) => entry.id !== command.entryId),
        visitedEntryIds: scene.visitedEntryIds.filter(
          (entryId) => entryId !== command.entryId,
        ),
        markers: removeIdFromMarkers(scene.markers, command.entryId),
      };
    }

    case 'hash-table.move': {
      requireStructure(scene, 'hash-table', command.type);

      const entries = updateEntityById(
        scene.entries,
        command.entryId,
        (entry) => ({
          ...entry,
          bucketIndex: command.bucketIndex,
        }),
        'Hash-table entry',
      );

      return {
        ...scene,
        entries,
      };
    }

    case 'hash-table.visitBucket': {
      requireStructure(scene, 'hash-table', command.type);

      return {
        ...scene,
        visitedBucketIndices: appendUnique(
          scene.visitedBucketIndices,
          command.bucketIndex,
        ),
      };
    }

    case 'hash-table.visitEntry': {
      requireStructure(scene, 'hash-table', command.type);

      return {
        ...scene,
        visitedEntryIds: appendUnique(scene.visitedEntryIds, command.entryId),
      };
    }

    case 'hash-table.mark': {
      requireStructure(scene, 'hash-table', command.type);

      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.entryIds],
        },
      };
    }

    default:
      return assertNever(command);
  }
}

/* -------------------------------------------------------------------------- */
/* Scene initialization                                                        */
/* -------------------------------------------------------------------------- */

function reduceSceneInit(
  scene: SceneState,
  command: Extract<TraceCommand, { readonly type: 'scene.init' }>,
): SceneState {
  if (scene.structure !== null) {
    throw new SceneReducerError(
      'DUPLICATE_SCENE_INIT',
      'scene.init can only be applied to an empty scene.',
    );
  }

  return createInitializedScene(command.structure, command.title ?? null);
}

/* -------------------------------------------------------------------------- */
/* Structure guards                                                           */
/* -------------------------------------------------------------------------- */

type StructuredScene = Exclude<
  SceneState,
  ReturnType<typeof createInitialScene>
>;

type SceneForStructure<Structure extends TraceStructure> = Extract<
  StructuredScene,
  { readonly structure: Structure }
>;

function requireStructure<Structure extends TraceStructure>(
  scene: SceneState,
  structure: Structure,
  commandType: TraceCommand['type'],
): asserts scene is SceneForStructure<Structure> {
  if (scene.structure === null) {
    throw new SceneReducerError(
      'STRUCTURE_NOT_INITIALIZED',
      `Cannot apply "${commandType}" before scene.init.`,
    );
  }

  if (scene.structure !== structure) {
    throw new SceneReducerError(
      'STRUCTURE_MISMATCH',
      `Cannot apply "${commandType}" to a "${scene.structure}" scene.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Matrix helpers                                                              */
/* -------------------------------------------------------------------------- */

function cloneMatrix<Value>(values: readonly (readonly Value[])[]): Value[][] {
  return values.map((row) => [...row]);
}

function assertMatrixPosition(
  matrix: readonly (readonly unknown[])[],
  row: number,
  column: number,
  commandType: TraceCommand['type'],
): void {
  const matrixRow = matrix[row];

  if (matrixRow === undefined || column >= matrixRow.length) {
    throw new SceneReducerError(
      'INDEX_OUT_OF_BOUNDS',
      `Command "${commandType}" references matrix position (${row}, ${column}) outside the current matrix.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Array helpers                                                               */
/* -------------------------------------------------------------------------- */

function assertIndex(
  index: number,
  length: number,
  commandType: TraceCommand['type'],
): void {
  if (index < 0 || index >= length) {
    throw new SceneReducerError(
      'INDEX_OUT_OF_BOUNDS',
      `Command "${commandType}" references index ${index} outside a collection of length ${length}.`,
    );
  }
}

function createItemIds(prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function createMatrixItemIds(
  values: readonly (readonly unknown[])[],
): readonly (readonly string[])[] {
  let itemIndex = 0;
  return values.map((row) =>
    row.map(() => {
      const id = `matrix-item-${itemIndex}`;
      itemIndex += 1;
      return id;
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Entity helpers                                                              */
/* -------------------------------------------------------------------------- */

function updateEntityById<Entity extends { readonly id: string }>(
  entities: readonly Entity[],
  id: string,
  update: (entity: Entity) => Entity,
  entityName: string,
): readonly Entity[] {
  let found = false;

  const updated = entities.map((entity) => {
    if (entity.id !== id) {
      return entity;
    }

    found = true;

    return update(entity);
  });

  if (!found) {
    throw new SceneReducerError(
      'ENTITY_NOT_FOUND',
      `${entityName} "${id}" does not exist.`,
    );
  }

  return updated;
}

function requireEntity(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new SceneReducerError('ENTITY_NOT_FOUND', message);
  }
}

/* -------------------------------------------------------------------------- */
/* Collection helpers                                                          */
/* -------------------------------------------------------------------------- */

function appendUnique<T>(values: readonly T[], value: T): readonly T[] {
  if (values.includes(value)) {
    return values;
  }

  return [...values, value];
}

function removeIdFromMarkers(
  markers: Readonly<Record<string, readonly string[]>>,
  id: string,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(markers).map(([marker, ids]) => [
      marker,
      ids.filter((currentId) => currentId !== id),
    ]),
  );
}

function removeIndicesAtOrAbove(
  markers: Readonly<Record<string, readonly number[]>>,
  upperBound: number,
): Readonly<Record<string, readonly number[]>> {
  return Object.fromEntries(
    Object.entries(markers).map(([marker, indices]) => [
      marker,
      indices.filter((index) => index < upperBound),
    ]),
  );
}

function shiftIndicesAfterRemoval(
  markers: Readonly<Record<string, readonly number[]>>,
  removedIndex: number,
): Readonly<Record<string, readonly number[]>> {
  return Object.fromEntries(
    Object.entries(markers).map(([marker, indices]) => [
      marker,
      indices
        .filter((index) => index !== removedIndex)
        .map((index) => (index > removedIndex ? index - 1 : index)),
    ]),
  );
}

function removeRecordKey<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Readonly<Record<string, Value>> {
  const next = {
    ...record,
  };

  delete next[key];

  return next;
}

/* -------------------------------------------------------------------------- */
/* Graph helpers                                                               */
/* -------------------------------------------------------------------------- */

function cloneGraphPositions(
  positions: Readonly<Record<string, GraphPosition>>,
): Readonly<Record<string, GraphPosition>> {
  return Object.fromEntries(
    Object.entries(positions).map(([nodeId, position]) => [
      nodeId,
      {
        ...position,
      },
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* Tree helpers                                                                */
/* -------------------------------------------------------------------------- */

function cloneTreeNode<
  Node extends {
    readonly id: string;
    readonly children: readonly string[];
  },
>(node: Node): Node {
  return {
    ...node,
    children: [...node.children],
  };
}

/* -------------------------------------------------------------------------- */
/* Message helpers                                                             */
/* -------------------------------------------------------------------------- */

function createSceneMessage(
  text: string,
  level: 'info' | 'warning' | 'error' | undefined,
): SceneMessage {
  return {
    text,
    level: level ?? 'info',
  };
}

/* -------------------------------------------------------------------------- */
/* Exhaustiveness                                                              */
/* -------------------------------------------------------------------------- */

function assertNever(value: never): never {
  throw new Error(`Unhandled protocol value: ${JSON.stringify(value)}`);
}
