import type {
  GraphEdge,
  GraphLayout,
  GraphNode,
  GraphPosition,
  LinkedListKind,
  LinkedListNode,
  MatrixPosition,
  MatrixMarker,
  ComparisonOperator,
  TraceStructure,
  TraceValue,
  TreeNode,
} from '../protocol/traceTypes';

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

type SceneStateBase = {
  readonly scopeStack: readonly {
    readonly id: number;
    readonly target: string | null;
    readonly callerFocus?: ArraySceneState['focus'];
  }[];
  readonly isPlaceholder?: true;
};

/* -------------------------------------------------------------------------- */
/* Empty scene                                                                 */
/* -------------------------------------------------------------------------- */

type EmptySceneState = SceneStateBase & {
  readonly structure: null;
};

/* -------------------------------------------------------------------------- */
/* Array                                                                       */
/* -------------------------------------------------------------------------- */

export type ArraySceneState = SceneStateBase & {
  readonly structure: 'array';

  readonly values: readonly TraceValue[];
  readonly itemIds: readonly string[];
  readonly labels: readonly string[];

  readonly comparedIndices: readonly [number, number] | null;
  readonly focus: {
    readonly index: number | null;
    readonly pointers: Readonly<Record<string, number>>;
    readonly range: readonly [number, number] | null;
  };
  readonly valueComparison: {
    readonly index: number;
    readonly value: TraceValue;
    readonly operator: ComparisonOperator;
    readonly matches: boolean;
  } | null;

  readonly markers: Readonly<Record<string, readonly number[]>>;
};

/* -------------------------------------------------------------------------- */
/* Matrix / grid                                                               */
/* -------------------------------------------------------------------------- */

export type MatrixSceneState = SceneStateBase & {
  readonly structure: 'matrix';

  readonly values: readonly (readonly TraceValue[])[];
  readonly itemIds: readonly (readonly string[])[];
  readonly rowLabels?: readonly string[];
  readonly columnLabels?: readonly string[];

  readonly comparedPositions: readonly [MatrixPosition, MatrixPosition] | null;
  readonly visitedPositions: readonly MatrixPosition[];

  readonly markers: Readonly<
    Partial<Record<MatrixMarker, readonly MatrixPosition[]>>
  >;
};

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

export type TreeSceneState = SceneStateBase & {
  readonly structure: 'tree';

  readonly rootId: string | null;
  readonly nodes: readonly TreeNode[];

  readonly comparedNodeIds: readonly [string, string] | null;

  readonly currentNodeId: string | null;

  readonly visitedNodeIds: readonly string[];

  readonly markers: Readonly<Record<string, readonly string[]>>;
};

/* -------------------------------------------------------------------------- */
/* Graph                                                                       */
/* -------------------------------------------------------------------------- */

export type GraphSceneState = SceneStateBase & {
  readonly structure: 'graph';

  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];

  readonly layout: GraphLayout;

  readonly positions: Readonly<Record<string, GraphPosition>> | null;

  readonly visitedNodeIds: readonly string[];
  readonly visitedEdgeIds: readonly string[];
  readonly discoveredNodeIds: readonly string[];
  readonly predecessors: Readonly<Record<string, string | null>>;

  readonly nodeMarkers: Readonly<Record<string, readonly string[]>>;

  readonly edgeMarkers: Readonly<Record<string, readonly string[]>>;

  readonly distances: Readonly<Record<string, number | null>>;
  readonly nodeMetrics: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly frontier: readonly string[];
  readonly currentNodeId: string | null;
  readonly currentEdgeId: string | null;
};

/* -------------------------------------------------------------------------- */
/* Linked list                                                                 */
/* -------------------------------------------------------------------------- */

export type LinkedListSceneState = SceneStateBase & {
  readonly structure: 'linked-list';

  readonly kind: LinkedListKind;

  readonly headId: string | null;
  readonly tailId: string | null;

  readonly nodes: readonly LinkedListNode[];

  readonly pointers: Readonly<Record<string, string | null>>;
  readonly comparison: {
    readonly nodeIds: readonly [string, string];
    readonly operator: ComparisonOperator;
    readonly matches: boolean;
    readonly identity?: true;
  } | null;

  readonly markers: Readonly<Record<string, readonly string[]>>;
};

/* -------------------------------------------------------------------------- */
/* Complete scene state                                                        */
/* -------------------------------------------------------------------------- */

export type SceneState =
  | EmptySceneState
  | ArraySceneState
  | MatrixSceneState
  | TreeSceneState
  | GraphSceneState
  | LinkedListSceneState;

/* -------------------------------------------------------------------------- */
/* Scene creation                                                              */
/* -------------------------------------------------------------------------- */

export function createInitialScene(): EmptySceneState {
  return {
    structure: null,
    scopeStack: [],
  };
}

export function createInitializedScene(
  structure: TraceStructure,
): Exclude<SceneState, EmptySceneState> {
  const base = { scopeStack: [{ id: 0, target: null }] } as const;

  switch (structure) {
    case 'array':
      return {
        ...base,
        structure,
        values: [],
        itemIds: [],
        labels: [],
        comparedIndices: null,
        focus: { index: null, pointers: {}, range: null },
        valueComparison: null,
        markers: {},
      };
    case 'matrix':
      return {
        ...base,
        structure,
        values: [],
        itemIds: [],
        comparedPositions: null,
        visitedPositions: [],
        markers: {},
      };
    case 'tree':
      return {
        ...base,
        structure,
        rootId: null,
        nodes: [],
        comparedNodeIds: null,
        currentNodeId: null,
        visitedNodeIds: [],
        markers: {},
      };
    case 'graph':
      return {
        ...base,
        structure,
        nodes: [],
        edges: [],
        layout: 'circular',
        positions: null,
        visitedNodeIds: [],
        visitedEdgeIds: [],
        discoveredNodeIds: [],
        predecessors: {},
        nodeMarkers: {},
        edgeMarkers: {},
        distances: {},
        nodeMetrics: {},
        frontier: [],
        currentNodeId: null,
        currentEdgeId: null,
      };
    case 'linked-list':
      return {
        ...base,
        structure,
        kind: 'singly',
        headId: null,
        tailId: null,
        nodes: [],
        pointers: {},
        comparison: null,
        markers: {},
      };
  }
}

export function createPlaceholderScene(
  structure: TraceStructure,
): Exclude<SceneState, EmptySceneState> {
  return {
    ...createInitializedScene(structure),
    isPlaceholder: true,
  };
}
