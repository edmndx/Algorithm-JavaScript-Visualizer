import type { TraceSourceLocation } from '../traceTypes';

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
  | 'MATRIX_AXIS_LABEL_COUNT_MISMATCH'
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
  | 'GRAPH_DUPLICATE_NODE_ID'
  | 'GRAPH_DUPLICATE_EDGE_ID'
  | 'GRAPH_FRONTIER_DUPLICATE'
  | 'GRAPH_NODE_NOT_FOUND'
  | 'GRAPH_EDGE_NOT_FOUND'
  | 'GRAPH_PREDECESSOR_EDGE_NOT_FOUND'
  | 'GRAPH_EDGE_NODE_NOT_FOUND'
  | 'GRAPH_FIXED_POSITIONS_REQUIRED'
  | 'GRAPH_FIXED_POSITION_MISSING'
  | 'GRAPH_POSITION_UNKNOWN_NODE'
  | 'GRAPH_CIRCULAR_POSITIONS_NOT_ALLOWED'
  | 'LINKED_LIST_DUPLICATE_NODE_ID'
  | 'LINKED_LIST_NODE_NOT_FOUND'
  | 'LINKED_LIST_REFERENCE_NOT_FOUND'
  | 'LINKED_LIST_INVALID_HEAD_TAIL'
  | 'LINKED_LIST_INVALID_TOPOLOGY';

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
