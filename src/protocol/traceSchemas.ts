import { z } from 'zod';

import { TRACE_PROTOCOL_VERSION } from './protocolVersion';

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

export const TRACE_LIMITS = {
  commands: 50_000,
  collectionItems: 20_000,
  matrixRows: 2_000,
  matrixColumns: 2_000,
  matrixCells: 1_000_000,
  stringLength: 16_384,
} as const;

const boundedStringSchema = z.string().max(TRACE_LIMITS.stringLength);

const nonEmptyStringSchema = boundedStringSchema.trim().min(1);

const indexSchema = z.number().int().nonnegative();

const nodeIdSchema = nonEmptyStringSchema;

const edgeIdSchema = nonEmptyStringSchema;

const markerSchema = nonEmptyStringSchema;

function boundedArray<Schema extends z.ZodType>(schema: Schema) {
  return z.array(schema).max(TRACE_LIMITS.collectionItems);
}

export const traceStructureSchema = z.enum([
  'array',
  'matrix',
  'tree',
  'graph',
  'stack',
  'queue',
  'linked-list',
  'hash-table',
]);

export const traceValueSchema = z.union([
  boundedStringSchema,
  z.number().finite(),
]);

export const traceSourceLocationSchema = z
  .object({
    file: nonEmptyStringSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    endColumn: z.number().int().positive().optional(),
  })
  .strict()
  .refine((source) => source.line !== undefined || source.file !== undefined, {
    message: 'Source location must provide at least a file or line.',
  })
  .refine(
    (source) => source.column === undefined || source.line !== undefined,
    { message: 'Source column requires a source line.' },
  )
  .refine(
    (source) => source.endColumn === undefined || source.endLine !== undefined,
    { message: 'Source end column requires a source end line.' },
  )
  .refine(
    (source) => source.endLine === undefined || source.line !== undefined,
    { message: 'Source end line requires a source start line.' },
  )
  .refine(
    (source) =>
      source.line === undefined ||
      source.endLine === undefined ||
      source.endLine > source.line ||
      (source.endLine === source.line &&
        (source.column === undefined ||
          source.endColumn === undefined ||
          source.endColumn >= source.column)),
    { message: 'Source range must not end before it starts.' },
  );

const traceCommandBaseShape = {
  source: traceSourceLocationSchema.optional(),
};

/* -------------------------------------------------------------------------- */
/* Matrix                                                                      */
/* -------------------------------------------------------------------------- */

export const matrixPositionSchema = z
  .object({
    row: indexSchema,
    column: indexSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

export const treeNodeSchema = z
  .object({
    id: nodeIdSchema,
    value: traceValueSchema.optional(),
    label: boundedStringSchema.optional(),
    children: boundedArray(nodeIdSchema),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Graph                                                                       */
/* -------------------------------------------------------------------------- */

export const graphNodeSchema = z
  .object({
    id: nodeIdSchema,
    value: traceValueSchema.optional(),
    label: boundedStringSchema.optional(),
  })
  .strict();

export const graphEdgeSchema = z
  .object({
    id: edgeIdSchema,
    from: nodeIdSchema,
    to: nodeIdSchema,
    weight: z.number().finite().optional(),
    directed: z.boolean().optional(),
  })
  .strict();

export const graphLayoutSchema = z.enum(['circular', 'fixed']);

export const graphPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

const graphPositionsSchema = z
  .record(nonEmptyStringSchema, graphPositionSchema)
  .refine(
    (positions) =>
      Object.keys(positions).length <= TRACE_LIMITS.collectionItems,
    { message: 'Graph positions exceed the protocol collection limit.' },
  );

/* -------------------------------------------------------------------------- */
/* Linked List                                                                 */
/* -------------------------------------------------------------------------- */

export const linkedListKindSchema = z.enum([
  'singly',
  'doubly',
  'circular-singly',
  'circular-doubly',
]);

export const linkedListNodeSchema = z
  .object({
    id: nodeIdSchema,
    value: traceValueSchema,
    nextId: nodeIdSchema.nullable(),
    previousId: nodeIdSchema.nullable().optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Hash Table                                                                  */
/* -------------------------------------------------------------------------- */

export const hashTableStrategySchema = z.enum([
  'chaining',
  'linear-probing',
  'quadratic-probing',
  'double-hashing',
]);

export const hashTableEntrySchema = z
  .object({
    id: nonEmptyStringSchema,
    key: traceValueSchema,
    value: traceValueSchema,
    bucketIndex: indexSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

export const sceneInitCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('scene.init'),
    structure: traceStructureSchema,
    title: nonEmptyStringSchema.optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Array                                                                       */
/* -------------------------------------------------------------------------- */

export const arrayCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.create'),
    values: boundedArray(traceValueSchema),
    labels: boundedArray(boundedStringSchema).optional(),
  })
  .strict();

export const arrayCompareCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.compare'),
    indices: z.tuple([indexSchema, indexSchema]),
  })
  .strict();

export const arraySwapCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.swap'),
    indices: z.tuple([indexSchema, indexSchema]),
  })
  .strict();

export const arraySetCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.set'),
    index: indexSchema,
    value: traceValueSchema,
  })
  .strict();

export const arrayMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.mark'),
    indices: boundedArray(indexSchema),
    marker: markerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Matrix / Grid                                                               */
/* -------------------------------------------------------------------------- */

export const matrixCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.create'),
    values: z
      .array(z.array(traceValueSchema).max(TRACE_LIMITS.matrixColumns))
      .max(TRACE_LIMITS.matrixRows)
      .refine(
        (rows) =>
          rows.reduce((cells, row) => cells + row.length, 0) <=
          TRACE_LIMITS.matrixCells,
        { message: 'Matrix exceeds the protocol cell limit.' },
      ),
  })
  .strict();

export const matrixCompareCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.compare'),
    positions: z.tuple([matrixPositionSchema, matrixPositionSchema]),
  })
  .strict();

export const matrixSwapCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.swap'),
    positions: z.tuple([matrixPositionSchema, matrixPositionSchema]),
  })
  .strict();

export const matrixSetCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.set'),
    position: matrixPositionSchema,
    value: traceValueSchema,
  })
  .strict();

export const matrixMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.mark'),
    positions: boundedArray(matrixPositionSchema),
    marker: markerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

export const treeCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.create'),
    rootId: nodeIdSchema.nullable(),
    nodes: boundedArray(treeNodeSchema),
  })
  .strict();

export const treeSetRootCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.setRoot'),
    rootId: nodeIdSchema.nullable(),
  })
  .strict();

export const treeAddNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.addNode'),
    node: treeNodeSchema,
  })
  .strict();

export const treeRemoveNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.removeNode'),
    nodeId: nodeIdSchema,
  })
  .strict();

export const treeSetChildrenCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.setChildren'),
    nodeId: nodeIdSchema,
    children: boundedArray(nodeIdSchema),
  })
  .strict();

export const treeSetValueCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.setValue'),
    nodeId: nodeIdSchema,
    value: traceValueSchema,
  })
  .strict();

export const treeCompareCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.compare'),
    nodeIds: z.tuple([nodeIdSchema, nodeIdSchema]),
  })
  .strict();

export const treeSwapValuesCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.swapValues'),
    nodeIds: z.tuple([nodeIdSchema, nodeIdSchema]),
  })
  .strict();

export const treeVisitCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.visit'),
    nodeId: nodeIdSchema,
  })
  .strict();

export const treeMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.mark'),
    nodeIds: boundedArray(nodeIdSchema),
    marker: markerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Graph                                                                       */
/* -------------------------------------------------------------------------- */

export const graphCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.create'),
    nodes: boundedArray(graphNodeSchema),
    edges: boundedArray(graphEdgeSchema),
    layout: graphLayoutSchema.optional(),
    positions: graphPositionsSchema.optional(),
  })
  .strict();

export const graphAddNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.addNode'),
    node: graphNodeSchema,
    position: graphPositionSchema.optional(),
  })
  .strict();

export const graphRemoveNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.removeNode'),
    nodeId: nodeIdSchema,
  })
  .strict();

export const graphAddEdgeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.addEdge'),
    edge: graphEdgeSchema,
  })
  .strict();

export const graphRemoveEdgeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.removeEdge'),
    edgeId: edgeIdSchema,
  })
  .strict();

export const graphSetNodeValueCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.setNodeValue'),
    nodeId: nodeIdSchema,
    value: traceValueSchema,
  })
  .strict();

export const graphSetEdgeWeightCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.setEdgeWeight'),
    edgeId: edgeIdSchema,
    weight: z.number().finite(),
  })
  .strict();

export const graphVisitNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.visitNode'),
    nodeId: nodeIdSchema,
  })
  .strict();

export const graphVisitEdgeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.visitEdge'),
    edgeId: edgeIdSchema,
  })
  .strict();

export const graphMarkNodesCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.markNodes'),
    nodeIds: boundedArray(nodeIdSchema),
    marker: markerSchema,
  })
  .strict();

export const graphMarkEdgesCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.markEdges'),
    edgeIds: boundedArray(edgeIdSchema),
    marker: markerSchema,
  })
  .strict();

export const graphDistanceCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.distance'),
    nodeId: nodeIdSchema,
    distance: z.number().finite().nullable(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Stack                                                                       */
/* -------------------------------------------------------------------------- */

export const stackCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('stack.create'),
    values: boundedArray(traceValueSchema),
  })
  .strict();

export const stackPushCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('stack.push'),
    value: traceValueSchema,
  })
  .strict();

export const stackPopCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('stack.pop'),
  })
  .strict();

export const stackPeekCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('stack.peek'),
  })
  .strict();

export const stackMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('stack.mark'),
    indices: boundedArray(indexSchema),
    marker: markerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Queue                                                                       */
/* -------------------------------------------------------------------------- */

export const queueCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('queue.create'),
    values: boundedArray(traceValueSchema),
  })
  .strict();

export const queueEnqueueCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('queue.enqueue'),
    value: traceValueSchema,
  })
  .strict();

export const queueDequeueCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('queue.dequeue'),
  })
  .strict();

export const queueDequeueBackCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('queue.dequeueBack'),
  })
  .strict();

export const queuePeekCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('queue.peek'),
  })
  .strict();

export const queueMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('queue.mark'),
    indices: boundedArray(indexSchema),
    marker: markerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Linked List                                                                 */
/* -------------------------------------------------------------------------- */

export const linkedListCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.create'),
    kind: linkedListKindSchema,
    headId: nodeIdSchema.nullable(),
    tailId: nodeIdSchema.nullable(),
    nodes: boundedArray(linkedListNodeSchema),
  })
  .strict();

export const linkedListAddNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.addNode'),
    node: linkedListNodeSchema,
  })
  .strict();

export const linkedListRemoveNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.removeNode'),
    nodeId: nodeIdSchema,
  })
  .strict();

export const linkedListSetHeadCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.setHead'),
    nodeId: nodeIdSchema.nullable(),
  })
  .strict();

export const linkedListSetTailCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.setTail'),
    nodeId: nodeIdSchema.nullable(),
  })
  .strict();

export const linkedListSetNextCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.setNext'),
    nodeId: nodeIdSchema,
    nextId: nodeIdSchema.nullable(),
  })
  .strict();

export const linkedListSetPreviousCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.setPrevious'),
    nodeId: nodeIdSchema,
    previousId: nodeIdSchema.nullable(),
  })
  .strict();

export const linkedListSetValueCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.setValue'),
    nodeId: nodeIdSchema,
    value: traceValueSchema,
  })
  .strict();

export const linkedListVisitCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.visit'),
    nodeId: nodeIdSchema,
  })
  .strict();

export const linkedListMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.mark'),
    nodeIds: boundedArray(nodeIdSchema),
    marker: markerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Hash Table                                                                  */
/* -------------------------------------------------------------------------- */

export const hashTableCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('hash-table.create'),
    bucketCount: z.number().int().positive().max(TRACE_LIMITS.collectionItems),
    strategy: hashTableStrategySchema,
    entries: boundedArray(hashTableEntrySchema),
  })
  .strict();

export const hashTableSetCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('hash-table.set'),
    entry: hashTableEntrySchema,
  })
  .strict();

export const hashTableDeleteCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('hash-table.delete'),
    entryId: nonEmptyStringSchema,
  })
  .strict();

export const hashTableMoveCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('hash-table.move'),
    entryId: nonEmptyStringSchema,
    bucketIndex: indexSchema,
  })
  .strict();

export const hashTableVisitBucketCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('hash-table.visitBucket'),
    bucketIndex: indexSchema,
  })
  .strict();

export const hashTableVisitEntryCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('hash-table.visitEntry'),
    entryId: nonEmptyStringSchema,
  })
  .strict();

export const hashTableMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('hash-table.mark'),
    entryIds: boundedArray(nonEmptyStringSchema),
    marker: markerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* General                                                                     */
/* -------------------------------------------------------------------------- */

export const messageCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('message'),
    text: nonEmptyStringSchema,
    level: z.enum(['info', 'warning', 'error']).optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Complete Trace Command                                                      */
/* -------------------------------------------------------------------------- */

export const traceCommandSchema = z.discriminatedUnion('type', [
  sceneInitCommandSchema,

  arrayCreateCommandSchema,
  arrayCompareCommandSchema,
  arraySwapCommandSchema,
  arraySetCommandSchema,
  arrayMarkCommandSchema,

  matrixCreateCommandSchema,
  matrixCompareCommandSchema,
  matrixSwapCommandSchema,
  matrixSetCommandSchema,
  matrixMarkCommandSchema,

  treeCreateCommandSchema,
  treeSetRootCommandSchema,
  treeAddNodeCommandSchema,
  treeRemoveNodeCommandSchema,
  treeSetChildrenCommandSchema,
  treeSetValueCommandSchema,
  treeCompareCommandSchema,
  treeSwapValuesCommandSchema,
  treeVisitCommandSchema,
  treeMarkCommandSchema,

  graphCreateCommandSchema,
  graphAddNodeCommandSchema,
  graphRemoveNodeCommandSchema,
  graphAddEdgeCommandSchema,
  graphRemoveEdgeCommandSchema,
  graphSetNodeValueCommandSchema,
  graphSetEdgeWeightCommandSchema,
  graphVisitNodeCommandSchema,
  graphVisitEdgeCommandSchema,
  graphMarkNodesCommandSchema,
  graphMarkEdgesCommandSchema,
  graphDistanceCommandSchema,

  stackCreateCommandSchema,
  stackPushCommandSchema,
  stackPopCommandSchema,
  stackPeekCommandSchema,
  stackMarkCommandSchema,

  queueCreateCommandSchema,
  queueEnqueueCommandSchema,
  queueDequeueCommandSchema,
  queueDequeueBackCommandSchema,
  queuePeekCommandSchema,
  queueMarkCommandSchema,

  linkedListCreateCommandSchema,
  linkedListAddNodeCommandSchema,
  linkedListRemoveNodeCommandSchema,
  linkedListSetHeadCommandSchema,
  linkedListSetTailCommandSchema,
  linkedListSetNextCommandSchema,
  linkedListSetPreviousCommandSchema,
  linkedListSetValueCommandSchema,
  linkedListVisitCommandSchema,
  linkedListMarkCommandSchema,

  hashTableCreateCommandSchema,
  hashTableSetCommandSchema,
  hashTableDeleteCommandSchema,
  hashTableMoveCommandSchema,
  hashTableVisitBucketCommandSchema,
  hashTableVisitEntryCommandSchema,
  hashTableMarkCommandSchema,

  messageCommandSchema,
]);

export const traceSchema = z
  .array(traceCommandSchema)
  .max(TRACE_LIMITS.commands);

export const traceEnvelopeSchema = z
  .object({
    version: z.literal(TRACE_PROTOCOL_VERSION),
    commands: traceSchema,
  })
  .strict();
