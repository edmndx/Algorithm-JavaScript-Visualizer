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
export type InputContext = Extract<
  DeepReadonly<z.infer<typeof traceCommandSchema>>,
  { readonly type: 'scene.init' }
>['context'] extends infer Context
  ? Context extends { readonly input?: infer Input }
    ? NonNullable<Input>
    : never
  : never;
export type StackComparisonOperator = Extract<
  TraceCommand,
  { readonly type: 'stack.compare' }
>['operator'];
export type ComparisonOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
