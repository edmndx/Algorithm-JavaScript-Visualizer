import type { z } from 'zod';

import type {
  graphEdgeSchema,
  graphLayoutSchema,
  graphNodeSchema,
  graphPositionSchema,
  hashTableEntrySchema,
  hashTableStrategySchema,
  linkedListKindSchema,
  linkedListNodeSchema,
  matrixPositionSchema,
  traceCommandSchema,
  traceEnvelopeSchema,
  traceSourceLocationSchema,
  traceStructureSchema,
  traceValueSchema,
  treeNodeSchema,
} from './traceSchemas';

type DeepReadonly<Value> = Value extends string | number | boolean | null
  ? Value
  : Value extends readonly unknown[]
    ? { readonly [Index in keyof Value]: DeepReadonly<Value[Index]> }
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

export type TraceStructure = z.infer<typeof traceStructureSchema>;
export type TraceValue = z.infer<typeof traceValueSchema>;
export type TraceSourceLocation = DeepReadonly<
  z.infer<typeof traceSourceLocationSchema>
>;
export type TraceCommandBase = {
  readonly source?: TraceSourceLocation;
};
export type MatrixPosition = DeepReadonly<z.infer<typeof matrixPositionSchema>>;
export type TreeNode = DeepReadonly<z.infer<typeof treeNodeSchema>>;
export type GraphNode = DeepReadonly<z.infer<typeof graphNodeSchema>>;
export type GraphEdge = DeepReadonly<z.infer<typeof graphEdgeSchema>>;
export type GraphLayout = z.infer<typeof graphLayoutSchema>;
export type GraphPosition = DeepReadonly<z.infer<typeof graphPositionSchema>>;
export type LinkedListKind = z.infer<typeof linkedListKindSchema>;
export type LinkedListNode = DeepReadonly<z.infer<typeof linkedListNodeSchema>>;
export type HashTableStrategy = z.infer<typeof hashTableStrategySchema>;
export type HashTableEntry = DeepReadonly<z.infer<typeof hashTableEntrySchema>>;

export type TraceCommand = DeepReadonly<z.infer<typeof traceCommandSchema>>;
export type TraceEnvelope = DeepReadonly<z.infer<typeof traceEnvelopeSchema>>;

type CommandOf<Type extends TraceCommand['type']> = Extract<
  TraceCommand,
  { readonly type: Type }
>;

export type SceneInitCommand = CommandOf<'scene.init'>;
export type ArrayCreateCommand = CommandOf<'array.create'>;
export type ArrayCompareCommand = CommandOf<'array.compare'>;
export type ArraySwapCommand = CommandOf<'array.swap'>;
export type ArraySetCommand = CommandOf<'array.set'>;
export type ArrayMarkCommand = CommandOf<'array.mark'>;
export type MatrixCreateCommand = CommandOf<'matrix.create'>;
export type MatrixCompareCommand = CommandOf<'matrix.compare'>;
export type MatrixSwapCommand = CommandOf<'matrix.swap'>;
export type MatrixSetCommand = CommandOf<'matrix.set'>;
export type MatrixMarkCommand = CommandOf<'matrix.mark'>;
export type TreeCreateCommand = CommandOf<'tree.create'>;
export type TreeSetRootCommand = CommandOf<'tree.setRoot'>;
export type TreeAddNodeCommand = CommandOf<'tree.addNode'>;
export type TreeRemoveNodeCommand = CommandOf<'tree.removeNode'>;
export type TreeSetChildrenCommand = CommandOf<'tree.setChildren'>;
export type TreeSetValueCommand = CommandOf<'tree.setValue'>;
export type TreeCompareCommand = CommandOf<'tree.compare'>;
export type TreeSwapValuesCommand = CommandOf<'tree.swapValues'>;
export type TreeVisitCommand = CommandOf<'tree.visit'>;
export type TreeMarkCommand = CommandOf<'tree.mark'>;
export type GraphCreateCommand = CommandOf<'graph.create'>;
export type GraphAddNodeCommand = CommandOf<'graph.addNode'>;
export type GraphRemoveNodeCommand = CommandOf<'graph.removeNode'>;
export type GraphAddEdgeCommand = CommandOf<'graph.addEdge'>;
export type GraphRemoveEdgeCommand = CommandOf<'graph.removeEdge'>;
export type GraphSetNodeValueCommand = CommandOf<'graph.setNodeValue'>;
export type GraphSetEdgeWeightCommand = CommandOf<'graph.setEdgeWeight'>;
export type GraphVisitNodeCommand = CommandOf<'graph.visitNode'>;
export type GraphVisitEdgeCommand = CommandOf<'graph.visitEdge'>;
export type GraphMarkNodesCommand = CommandOf<'graph.markNodes'>;
export type GraphMarkEdgesCommand = CommandOf<'graph.markEdges'>;
export type GraphDistanceCommand = CommandOf<'graph.distance'>;
export type StackCreateCommand = CommandOf<'stack.create'>;
export type StackPushCommand = CommandOf<'stack.push'>;
export type StackPopCommand = CommandOf<'stack.pop'>;
export type StackPeekCommand = CommandOf<'stack.peek'>;
export type StackMarkCommand = CommandOf<'stack.mark'>;
export type QueueCreateCommand = CommandOf<'queue.create'>;
export type QueueEnqueueCommand = CommandOf<'queue.enqueue'>;
export type QueueDequeueCommand = CommandOf<'queue.dequeue'>;
export type QueuePeekCommand = CommandOf<'queue.peek'>;
export type QueueMarkCommand = CommandOf<'queue.mark'>;
export type LinkedListCreateCommand = CommandOf<'linked-list.create'>;
export type LinkedListAddNodeCommand = CommandOf<'linked-list.addNode'>;
export type LinkedListRemoveNodeCommand = CommandOf<'linked-list.removeNode'>;
export type LinkedListSetHeadCommand = CommandOf<'linked-list.setHead'>;
export type LinkedListSetTailCommand = CommandOf<'linked-list.setTail'>;
export type LinkedListSetNextCommand = CommandOf<'linked-list.setNext'>;
export type LinkedListSetPreviousCommand = CommandOf<'linked-list.setPrevious'>;
export type LinkedListSetValueCommand = CommandOf<'linked-list.setValue'>;
export type LinkedListVisitCommand = CommandOf<'linked-list.visit'>;
export type LinkedListMarkCommand = CommandOf<'linked-list.mark'>;
export type HashTableCreateCommand = CommandOf<'hash-table.create'>;
export type HashTableSetCommand = CommandOf<'hash-table.set'>;
export type HashTableDeleteCommand = CommandOf<'hash-table.delete'>;
export type HashTableMoveCommand = CommandOf<'hash-table.move'>;
export type HashTableVisitBucketCommand = CommandOf<'hash-table.visitBucket'>;
export type HashTableVisitEntryCommand = CommandOf<'hash-table.visitEntry'>;
export type HashTableMarkCommand = CommandOf<'hash-table.mark'>;
export type MessageCommand = CommandOf<'message'>;
