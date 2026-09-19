import { z } from 'zod';

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

const pointerNameSchema = nonEmptyStringSchema;
const arrayMarkerSchema = z.enum(['best', 'cand', 'selected', 'pivot']);
export const matrixMarkerSchema = z.enum(['cur', 'top', 'left', 'diag', 'try']);
const treeMarkerSchema = z.enum(['path', 'target', 'result', 'left', 'right']);
const graphMarkerSchema = z.enum(['current', 'candidate', 'path']);
const linkedListMarkerSchema = z.literal('result');
const arrayPointerRoles = new Set([
  'L',
  'R',
  'M',
  'P',
  'W',
  'i',
  'j',
  'bufL',
  'bufR',
  'scan',
  'boundary',
]);

function boundedArray<Schema extends z.ZodType>(schema: Schema) {
  return z.array(schema).max(TRACE_LIMITS.collectionItems);
}

export const traceStructureSchema = z.enum([
  'array',
  'matrix',
  'tree',
  'graph',
  'linked-list',
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

const traceCommandBaseShape = {};

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
  'circular-singly',
  'cycle-singly',
]);

export const linkedListNodeSchema = z
  .object({
    id: nodeIdSchema,
    value: traceValueSchema,
    nextId: nodeIdSchema.nullable(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

const sceneInitCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('scene.init'),
    structure: traceStructureSchema,
  })
  .strict();

const scopeEnterCommandSchema = z.strictObject({
  type: z.literal('scope.enter'),
  id: z.number().int().positive().max(50_000),
  target: nonEmptyStringSchema,
});

const scopeLeaveCommandSchema = z.strictObject({
  type: z.literal('scope.leave'),
  id: z.number().int().nonnegative().max(50_000),
});

/* -------------------------------------------------------------------------- */
/* Array                                                                       */
/* -------------------------------------------------------------------------- */

const arrayCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.create'),
    values: boundedArray(traceValueSchema),
    labels: boundedArray(boundedStringSchema).optional(),
  })
  .strict();

const arrayCompareCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.compare'),
    indices: z.tuple([indexSchema, indexSchema]),
  })
  .strict();

const arraySwapCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.swap'),
    indices: z.tuple([indexSchema, indexSchema]),
  })
  .strict();

const arraySetCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.set'),
    index: indexSchema,
    value: traceValueSchema,
  })
  .strict();

const arrayMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('array.mark'),
    indices: boundedArray(indexSchema),
    marker: arrayMarkerSchema,
  })
  .strict();

const arrayFocusCommandSchema = z
  .object({
    ...traceCommandBaseShape,
    type: z.literal('array.focus'),
    index: indexSchema.nullable().optional(),
    pointers: z
      .record(pointerNameSchema, z.number().int().min(-1))
      .refine(
        (pointers) =>
          Object.keys(pointers).every((name) => arrayPointerRoles.has(name)),
        'Unknown array pointer role.',
      )
      .optional(),
    range: z.tuple([indexSchema, indexSchema]).optional(),
  })
  .strict();

const arrayCompareValueCommandSchema = z
  .object({
    ...traceCommandBaseShape,
    type: z.literal('array.compareValue'),
    index: indexSchema,
    value: traceValueSchema,
    operator: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Matrix / Grid                                                               */
/* -------------------------------------------------------------------------- */

const matrixCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.create'),
    rowLabels: z
      .array(boundedStringSchema)
      .max(TRACE_LIMITS.matrixRows)
      .optional(),
    columnLabels: z
      .array(boundedStringSchema)
      .max(TRACE_LIMITS.matrixColumns)
      .optional(),
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

const matrixCompareCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.compare'),
    positions: z.tuple([matrixPositionSchema, matrixPositionSchema]),
  })
  .strict();

const matrixSetCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.set'),
    position: matrixPositionSchema,
    value: traceValueSchema,
  })
  .strict();

const matrixMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('matrix.mark'),
    positions: boundedArray(matrixPositionSchema),
    marker: matrixMarkerSchema,
  })
  .strict();

const matrixVisitCommandSchema = z
  .object({
    ...traceCommandBaseShape,
    type: z.literal('matrix.visit'),
    position: matrixPositionSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

const treeCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.create'),
    rootId: nodeIdSchema.nullable(),
    nodes: boundedArray(treeNodeSchema),
  })
  .strict();

const treeCompareCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.compare'),
    nodeIds: z.tuple([nodeIdSchema, nodeIdSchema]),
  })
  .strict();

const treeVisitCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.visit'),
    nodeId: nodeIdSchema,
  })
  .strict();

const treeMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('tree.mark'),
    nodeIds: boundedArray(nodeIdSchema),
    marker: treeMarkerSchema,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Graph                                                                       */
/* -------------------------------------------------------------------------- */

const graphCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.create'),
    nodes: boundedArray(graphNodeSchema),
    edges: boundedArray(graphEdgeSchema),
    layout: graphLayoutSchema.optional(),
    positions: graphPositionsSchema.optional(),
  })
  .strict();

const graphVisitNodeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.visitNode'),
    nodeId: nodeIdSchema,
  })
  .strict();

const graphDiscoverNodeCommandSchema = z.strictObject({
  type: z.literal('graph.discoverNode'),
  nodeId: nodeIdSchema,
});

const graphPredecessorCommandSchema = z.strictObject({
  type: z.literal('graph.predecessor'),
  nodeId: nodeIdSchema,
  predecessorId: nodeIdSchema.nullable(),
});

const graphVisitEdgeCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.visitEdge'),
    edgeId: edgeIdSchema,
  })
  .strict();

const graphMarkNodesCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.markNodes'),
    nodeIds: boundedArray(nodeIdSchema),
    marker: graphMarkerSchema,
  })
  .strict();

const graphMarkEdgesCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.markEdges'),
    edgeIds: boundedArray(edgeIdSchema),
    marker: graphMarkerSchema,
  })
  .strict();

const graphDistanceCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('graph.distance'),
    nodeId: nodeIdSchema,
    distance: z.number().finite().nullable(),
  })
  .strict();

const graphNodeMetricCommandSchema = z
  .object({
    ...traceCommandBaseShape,
    type: z.literal('graph.nodeMetric'),
    nodeId: nodeIdSchema,
    name: z.literal('indegree'),
    value: z.number().finite(),
  })
  .strict();

const graphFrontierCommandSchema = z
  .object({
    ...traceCommandBaseShape,
    type: z.literal('graph.frontier'),
    nodeIds: boundedArray(nodeIdSchema),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Linked List                                                                 */
/* -------------------------------------------------------------------------- */

const linkedListCreateCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.create'),
    kind: linkedListKindSchema,
    headId: nodeIdSchema.nullable(),
    tailId: nodeIdSchema.nullable(),
    nodes: boundedArray(linkedListNodeSchema),
  })
  .strict();

const linkedListMarkCommandSchema = z
  .object({
    ...traceCommandBaseShape,

    type: z.literal('linked-list.mark'),
    nodeIds: boundedArray(nodeIdSchema),
    marker: linkedListMarkerSchema,
  })
  .strict();

const linkedListPointerCommandSchema = z
  .object({
    ...traceCommandBaseShape,
    type: z.literal('linked-list.pointer'),
    name: z.enum(['slow', 'fast']),
    nodeId: nodeIdSchema.nullable(),
  })
  .strict();

const linkedListCompareIdentityCommandSchema = z.strictObject({
  ...traceCommandBaseShape,
  type: z.literal('linked-list.compareIdentity'),
  nodeIds: z.tuple([nodeIdSchema, nodeIdSchema]),
  operator: z.enum(['eq', 'neq']),
});

/* -------------------------------------------------------------------------- */
/* General                                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Complete Trace Command                                                      */
/* -------------------------------------------------------------------------- */

export const traceCommandSchema = z.discriminatedUnion('type', [
  sceneInitCommandSchema,
  scopeEnterCommandSchema,
  scopeLeaveCommandSchema,

  arrayCreateCommandSchema,
  arrayCompareCommandSchema,
  arraySwapCommandSchema,
  arraySetCommandSchema,
  arrayMarkCommandSchema,
  arrayFocusCommandSchema,
  arrayCompareValueCommandSchema,

  matrixCreateCommandSchema,
  matrixCompareCommandSchema,
  matrixSetCommandSchema,
  matrixMarkCommandSchema,
  matrixVisitCommandSchema,

  treeCreateCommandSchema,
  treeCompareCommandSchema,
  treeVisitCommandSchema,
  treeMarkCommandSchema,

  graphCreateCommandSchema,
  graphVisitNodeCommandSchema,
  graphDiscoverNodeCommandSchema,
  graphPredecessorCommandSchema,
  graphVisitEdgeCommandSchema,
  graphMarkNodesCommandSchema,
  graphMarkEdgesCommandSchema,
  graphDistanceCommandSchema,
  graphNodeMetricCommandSchema,
  graphFrontierCommandSchema,

  linkedListCreateCommandSchema,
  linkedListMarkCommandSchema,
  linkedListPointerCommandSchema,
  linkedListCompareIdentityCommandSchema,
]);
