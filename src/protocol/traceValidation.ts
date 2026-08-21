import { TRACE_PROTOCOL_VERSION } from './protocolVersion';
import {
  validateTraceSemantics,
  type TraceSemanticIssue,
} from './semanticValidation';
import { traceEnvelopeSchema } from './traceSchemas';
import type { TraceCommand } from './traceTypes';

export type TraceShapeIssue = {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
};

export type TraceValidationResult =
  | {
      readonly ok: true;
      readonly version: typeof TRACE_PROTOCOL_VERSION;
      readonly commands: readonly TraceCommand[];
    }
  | {
      readonly ok: false;
      readonly stage: 'shape';
      readonly issues: readonly TraceShapeIssue[];
    }
  | {
      readonly ok: false;
      readonly stage: 'semantic';
      readonly issues: readonly TraceSemanticIssue[];
    };

export function validateTrace(input: unknown): TraceValidationResult {
  const shapeResult = traceEnvelopeSchema.safeParse(input);

  if (!shapeResult.success) {
    return {
      ok: false,
      stage: 'shape',
      issues: shapeResult.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    };
  }

  const { commands, version } = shapeResult.data;
  const semanticResult = validateTraceSemantics(commands);

  if (!semanticResult.ok) {
    return {
      ok: false,
      stage: 'semantic',
      issues: semanticResult.issues.map((issue) => ({
        ...issue,
        path: ['commands', issue.commandIndex],
        source: commands[issue.commandIndex]?.source,
      })),
    };
  }

  return { ok: true, version, commands };
}
