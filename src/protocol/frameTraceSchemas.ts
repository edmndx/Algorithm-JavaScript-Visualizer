import { z } from 'zod';

import {
  TRACE_LIMITS,
  traceCommandSchema,
  traceStructureSchema,
  traceValueSchema,
} from './traceSchemas';

const sourceSpanSchema = z
  .object({
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
  })
  .strict()
  .refine(
    ({ line, column, endLine, endColumn }) =>
      endLine > line || (endLine === line && endColumn >= column),
    'Source span ends before it starts.',
  );

const primitiveFactSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const specialFactSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('undefined') }),
  z.strictObject({ kind: z.literal('positive-infinity') }),
  z.strictObject({ kind: z.literal('negative-infinity') }),
  z.strictObject({
    kind: z.literal('node-reference'),
    id: z.string().min(1).max(TRACE_LIMITS.stringLength),
  }),
]);

const factAtomSchema = z.union([primitiveFactSchema, specialFactSchema]);
const factValueSchema = z.union([
  factAtomSchema,
  z.array(factAtomSchema).max(TRACE_LIMITS.collectionItems),
  z
    .array(z.array(factAtomSchema).max(TRACE_LIMITS.collectionItems))
    .max(TRACE_LIMITS.collectionItems),
  z.record(z.string().min(1).max(TRACE_LIMITS.stringLength), factAtomSchema),
]);

const operandSchema = z
  .object({
    label: z.string().min(1).max(TRACE_LIMITS.stringLength),
    value: factAtomSchema,
  })
  .strict();

const comparisonSchema = z
  .object({
    type: z.literal('compare'),
    operator: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']),
    left: operandSchema,
    right: operandSchema,
    result: z.boolean(),
  })
  .strict();

const readSchema = z.strictObject({
  type: z.literal('read'),
  operand: operandSchema,
});

const assignmentSchema = z
  .object({
    type: z.literal('assign'),
    target: z.string().min(1).max(TRACE_LIMITS.stringLength),
    before: factValueSchema,
    value: factValueSchema,
    calculation: z
      .strictObject({
        kind: z.enum(['add', 'subtract']),
        operand: operandSchema,
      })
      .optional(),
  })
  .strict();

const swapSchema = z.strictObject({
  type: z.literal('swap'),
  indices: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
  before: z.tuple([traceValueSchema, traceValueSchema]),
  after: z.tuple([traceValueSchema, traceValueSchema]),
});

const returnSchema = z
  .object({
    type: z.literal('return'),
    value: factValueSchema,
    role: z.string().min(1).max(TRACE_LIMITS.stringLength).optional(),
    from: z.string().min(1).max(TRACE_LIMITS.stringLength).optional(),
    to: z.string().min(1).max(TRACE_LIMITS.stringLength).nullable().optional(),
  })
  .strict();

const callSchema = z.strictObject({
  type: z.literal('call'),
  callee: z.string().min(1).max(TRACE_LIMITS.stringLength),
  from: z.string().min(1).max(TRACE_LIMITS.stringLength).nullable(),
  target: z.string().min(1).max(TRACE_LIMITS.stringLength),
});

const controlSchema = z.strictObject({
  type: z.literal('control'),
  action: z.enum(['break', 'continue']),
  target: sourceSpanSchema,
});

const collectionSchema = z
  .strictObject({
    type: z.literal('collection'),
    action: z.enum(['enqueue', 'dequeue', 'append', 'add', 'check', 'remove']),
    role: z.enum([
      'frontier',
      'discovered',
      'visited',
      'traversal',
      'selection',
    ]),
    item: factAtomSchema,
    outcome: z.boolean().optional(),
  })
  .refine(
    ({ action, outcome }) => (action === 'check') === (outcome !== undefined),
    'Collection checks require an outcome; mutations must not invent one.',
  );

const semanticOperationSchema = z.discriminatedUnion('type', [
  comparisonSchema,
  readSchema,
  assignmentSchema,
  swapSchema,
  returnSchema,
  callSchema,
  collectionSchema,
  controlSchema,
]);

const commandSchema = traceCommandSchema;

export const frameSchema = z
  .object({
    source: sourceSpanSchema,
    operation: semanticOperationSchema,
    commands: z.array(commandSchema).max(TRACE_LIMITS.commands),
  })
  .strict();

export const frameTraceSchema = z
  .object({
    version: z.literal('2'),
    source: z
      .object({
        text: z.string().max(256_000),
        structure: traceStructureSchema,
      })
      .strict(),
    initialization: z.tuple([commandSchema, commandSchema]),
    frames: z.array(frameSchema).max(50_000),
  })
  .strict();

export type FrameTrace = z.infer<typeof frameTraceSchema>;

export const frameTraceHeaderSchema = frameTraceSchema.omit({ frames: true });
export type FrameTraceHeader = z.infer<typeof frameTraceHeaderSchema>;
export type Frame = FrameTrace['frames'][number];
export type FactAtom = z.infer<typeof factAtomSchema>;
