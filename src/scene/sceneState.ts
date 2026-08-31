import type {
  GraphEdge,
  GraphLayout,
  GraphNode,
  GraphPosition,
  HashTableEntry,
  HashTableStrategy,
  LinkedListKind,
  LinkedListNode,
  MatrixPosition,
  TraceStructure,
  TraceValue,
  TreeNode,
} from '../protocol/traceTypes';

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

export type SceneMessage = {
  readonly text: string;
  readonly level: 'info' | 'warning' | 'error';
};

export type SceneStateBase = {
  readonly title: string | null;
  readonly message: SceneMessage | null;
  readonly isPlaceholder?: true;
};

/* -------------------------------------------------------------------------- */
/* Empty scene                                                                 */
/* -------------------------------------------------------------------------- */

export type EmptySceneState = SceneStateBase & {
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

  readonly markers: Readonly<Record<string, readonly number[]>>;
};

/* -------------------------------------------------------------------------- */
/* Matrix / grid                                                               */
/* -------------------------------------------------------------------------- */

export type MatrixSceneState = SceneStateBase & {
  readonly structure: 'matrix';

  readonly values: readonly (readonly TraceValue[])[];
  readonly itemIds: readonly (readonly string[])[];

  readonly comparedPositions: readonly [MatrixPosition, MatrixPosition] | null;

  readonly markers: Readonly<Record<string, readonly MatrixPosition[]>>;
};

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

export type TreeSceneState = SceneStateBase & {
  readonly structure: 'tree';

  readonly rootId: string | null;
  readonly nodes: readonly TreeNode[];

  readonly comparedNodeIds: readonly [string, string] | null;

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

  readonly nodeMarkers: Readonly<Record<string, readonly string[]>>;

  readonly edgeMarkers: Readonly<Record<string, readonly string[]>>;

  readonly distances: Readonly<Record<string, number | null>>;
};

/* -------------------------------------------------------------------------- */
/* Stack                                                                       */
/* -------------------------------------------------------------------------- */

export type StackSceneState = SceneStateBase & {
  readonly structure: 'stack';

  readonly values: readonly TraceValue[];
  readonly itemIds: readonly string[];
  readonly nextItemId: number;

  readonly peekedIndex: number | null;

  readonly markers: Readonly<Record<string, readonly number[]>>;
};

/* -------------------------------------------------------------------------- */
/* Queue                                                                       */
/* -------------------------------------------------------------------------- */

export type QueueSceneState = SceneStateBase & {
  readonly structure: 'queue';

  readonly values: readonly TraceValue[];
  readonly itemIds: readonly string[];
  readonly nextItemId: number;

  readonly peekedIndex: number | null;

  readonly markers: Readonly<Record<string, readonly number[]>>;
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

  readonly visitedNodeIds: readonly string[];

  readonly markers: Readonly<Record<string, readonly string[]>>;
};

/* -------------------------------------------------------------------------- */
/* Hash table                                                                  */
/* -------------------------------------------------------------------------- */

export type HashTableSceneState = SceneStateBase & {
  readonly structure: 'hash-table';

  readonly bucketCount: number;
  readonly strategy: HashTableStrategy;

  readonly entries: readonly HashTableEntry[];

  readonly visitedBucketIndices: readonly number[];
  readonly visitedEntryIds: readonly string[];

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
  | StackSceneState
  | QueueSceneState
  | LinkedListSceneState
  | HashTableSceneState;

/* -------------------------------------------------------------------------- */
/* Scene creation                                                              */
/* -------------------------------------------------------------------------- */

export function createInitialScene(): EmptySceneState {
  return {
    structure: null,
    title: null,
    message: null,
  };
}

export function createInitializedScene(
  structure: TraceStructure,
  title: string | null = null,
): Exclude<SceneState, EmptySceneState> {
  const base = {
    title,
    message: null,
  } as const;

  switch (structure) {
    case 'array':
      return {
        ...base,
        structure,
        values: [],
        itemIds: [],
        labels: [],
        comparedIndices: null,
        markers: {},
      };
    case 'matrix':
      return {
        ...base,
        structure,
        values: [],
        itemIds: [],
        comparedPositions: null,
        markers: {},
      };
    case 'tree':
      return {
        ...base,
        structure,
        rootId: null,
        nodes: [],
        comparedNodeIds: null,
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
        nodeMarkers: {},
        edgeMarkers: {},
        distances: {},
      };
    case 'stack':
      return {
        ...base,
        structure,
        values: [],
        itemIds: [],
        nextItemId: 0,
        peekedIndex: null,
        markers: {},
      };
    case 'queue':
      return {
        ...base,
        structure,
        values: [],
        itemIds: [],
        nextItemId: 0,
        peekedIndex: null,
        markers: {},
      };
    case 'linked-list':
      return {
        ...base,
        structure,
        kind: 'singly',
        headId: null,
        tailId: null,
        nodes: [],
        visitedNodeIds: [],
        markers: {},
      };
    case 'hash-table':
      return {
        ...base,
        structure,
        bucketCount: 0,
        strategy: 'chaining',
        entries: [],
        visitedBucketIndices: [],
        visitedEntryIds: [],
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

/* -------------------------------------------------------------------------- */
/* Type helpers                                                                */
/* -------------------------------------------------------------------------- */

export function hasSceneStructure(
  scene: SceneState,
): scene is Exclude<SceneState, EmptySceneState> {
  return scene.structure !== null;
}

export function isSceneStructure<Structure extends TraceStructure>(
  scene: SceneState,
  structure: Structure,
): scene is Extract<SceneState, { readonly structure: Structure }> {
  return scene.structure === structure;
}
