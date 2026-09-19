import { compareValues } from '../protocol/compareValues';
import {
  FRAME_TRACE_BYTE_LIMIT,
  validateEmittedFrame,
  validateFrameInitialization,
  validateFrameTrace,
  type FrameTrace,
} from '../protocol/frameTrace';
import { TRACE_LIMITS } from '../protocol/traceSchemas';
import type { ComparisonOperator, TraceValue } from '../protocol/traceTypes';

type Frame = FrameTrace['frames'][number];
type ReturnFact = Extract<Frame['operation'], { type: 'return' }>['value'];
type Initialization = FrameTrace['initialization'];
type Structure = FrameTrace['source']['structure'];

export class FrameTracerError extends Error {
  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'INVALID_STATE' | 'COMMAND_LIMIT',
    message: string,
  ) {
    super(message);
    this.name = 'FrameTracerError';
  }
}

export function createFrameTracer(source: string, structure: Structure) {
  let header: Omit<FrameTrace, 'frames'> | null = null;
  const frames: Frame[] = [];
  let serializedBytes = 0;
  let commandCount = 2;
  const scopeIds = [0];

  function emitFrame(frame: Frame): number {
    if (header === null)
      throw new FrameTracerError(
        'INVALID_STATE',
        'Frame tracer is not initialized.',
      );
    if (scopeIds.length === 0)
      throw new FrameTracerError(
        'INVALID_STATE',
        'Algorithm scope is already closed.',
      );
    if (
      frame.commands.some(
        (command) =>
          command.type === 'scope.enter' || command.type === 'scope.leave',
      )
    )
      throw new FrameTracerError(
        'INVALID_ARGUMENT',
        'Scope commands are derived from source operations.',
      );
    const scopeCommand =
      frame.operation.type === 'call'
        ? {
            type: 'scope.enter' as const,
            id: frames.length + 1,
            target: frame.operation.target,
          }
        : frame.operation.type === 'return'
          ? { type: 'scope.leave' as const, id: scopeIds.at(-1)! }
          : null;
    const scopedFrame =
      scopeCommand === null
        ? frame
        : {
            ...frame,
            commands:
              frame.operation.type === 'call'
                ? [scopeCommand, ...frame.commands]
                : [...frame.commands, scopeCommand],
          };
    if (frames.length >= 50_000)
      throw new FrameTracerError('COMMAND_LIMIT', 'Frame limit exceeded.');
    if (commandCount + scopedFrame.commands.length > TRACE_LIMITS.commands)
      throw new FrameTracerError(
        'COMMAND_LIMIT',
        'Trace command limit exceeded.',
      );
    const result = validateEmittedFrame(header, scopedFrame);
    if (!result.ok)
      throw new FrameTracerError('INVALID_ARGUMENT', result.message);
    const validated = result.frame;
    const frameBytes = new TextEncoder().encode(
      JSON.stringify(validated),
    ).byteLength;
    if (
      serializedBytes + frameBytes + (frames.length > 0 ? 1 : 0) >
      FRAME_TRACE_BYTE_LIMIT
    )
      throw new FrameTracerError(
        'COMMAND_LIMIT',
        'Frame trace exceeds the serialized-byte limit.',
      );
    frames.push(structuredClone(validated));
    if (frame.operation.type === 'call') scopeIds.push(frames.length);
    if (frame.operation.type === 'return') scopeIds.pop();
    serializedBytes += frameBytes + (frames.length > 1 ? 1 : 0);
    commandCount += validated.commands.length;
    return frames.length;
  }

  return {
    initialize(first: Initialization[0], second: Initialization[1]): void {
      if (header !== null)
        throw new FrameTracerError(
          'INVALID_STATE',
          'Frame tracer is already initialized.',
        );
      const result = validateFrameInitialization({ text: source, structure }, [
        first,
        second,
      ]);
      if (!result.ok)
        throw new FrameTracerError('INVALID_ARGUMENT', result.message);
      header = structuredClone(result.header);
      serializedBytes = result.serializedBytes;
    },
    frame: emitFrame,
    completeImplicitReturn(
      callId: number,
      value: unknown,
      location: Frame['source'],
      from?: string,
      to?: string | null,
    ): boolean {
      if (
        !Number.isInteger(callId) ||
        frames[callId - 1]?.operation.type !== 'call'
      )
        throw new FrameTracerError('INVALID_ARGUMENT', 'Unknown call scope.');
      if (scopeIds.at(-1) !== callId) {
        if (scopeIds.includes(callId))
          throw new FrameTracerError(
            'INVALID_STATE',
            'Call scope still has an active child.',
          );
        return false;
      }
      emitFrame({
        source: location,
        operation: {
          type: 'return',
          value: captureReturnFact(value) as ReturnFact,
          ...(from === undefined ? {} : { from, to: to ?? null }),
        },
        commands: [],
      });
      return true;
    },
    checkGraphNeighbor(
      seen: ReadonlySet<string>,
      neighbor: string,
      current: string,
      location: Frame['source'],
      role: 'discovered' | 'visited' = 'discovered',
    ): boolean {
      if (structure !== 'graph')
        throw new FrameTracerError(
          'INVALID_STATE',
          'Graph neighbor checks require a Graph scene.',
        );
      const found = seen.has(neighbor);
      emitFrame({
        source: location,
        operation: {
          type: 'collection',
          action: 'check',
          role,
          item: neighbor,
          outcome: found,
        },
        commands: [
          { type: 'graph.visitEdge', edgeId: `${current}->${neighbor}` },
          {
            type: 'graph.markEdges',
            marker: 'current',
            edgeIds: [`${current}->${neighbor}`],
          },
          { type: 'graph.markNodes', marker: 'candidate', nodeIds: [neighbor] },
        ],
      });
      return found;
    },
    compareScalar(
      left: TraceValue,
      right: TraceValue,
      operator: ComparisonOperator,
      location: Frame['source'],
      leftLabel: string,
      rightLabel: string,
      commands: Frame['commands'] = [],
    ): boolean {
      const result = compareValues(left, right, operator);
      emitFrame({
        source: location,
        operation: {
          type: 'compare',
          operator,
          left: { label: leftLabel, value: left },
          right: { label: rightLabel, value: right },
          result,
        },
        commands,
      });
      return result;
    },
    compareArray(
      values: readonly TraceValue[],
      index: number,
      value: TraceValue,
      operator: ComparisonOperator,
      location: Frame['source'],
      leftLabel: string,
      rightLabel: string,
    ): boolean {
      const left = values[index];
      if (left === undefined)
        throw new FrameTracerError(
          'INVALID_ARGUMENT',
          `Comparison index ${index} is outside the array.`,
        );
      const result = compareValues(left, value, operator);
      emitFrame({
        source: location,
        operation: {
          type: 'compare',
          operator,
          left: { label: leftLabel, value: left },
          right: { label: rightLabel, value },
          result,
        },
        commands: [
          { type: 'array.focus', index },
          { type: 'array.compareValue', index, value, operator },
        ],
      });
      return result;
    },
    returnValue<Value>(
      value: Value,
      location: Frame['source'],
      role?: string,
    ): Value {
      emitFrame({
        source: location,
        operation: {
          type: 'return',
          value: captureReturnFact(value) as ReturnFact,
          ...(role === undefined ? {} : { role }),
        },
        commands: [],
      });
      return value;
    },
    getTrace(): FrameTrace {
      if (scopeIds.length !== 0)
        throw new FrameTracerError(
          'INVALID_STATE',
          'Algorithm scope did not return.',
        );
      if (header === null)
        throw new FrameTracerError(
          'INVALID_STATE',
          'Frame tracer is not initialized.',
        );
      const result = validateFrameTrace({ ...header, frames });
      if (!result.ok)
        throw new FrameTracerError('INVALID_ARGUMENT', result.message);
      return structuredClone(result.trace);
    },
  };
}

function captureReturnFact(value: unknown): unknown {
  if (value === undefined) return { kind: 'undefined' };
  if (value === Infinity) return { kind: 'positive-infinity' };
  if (value === -Infinity) return { kind: 'negative-infinity' };
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return captureReturnArray(value, true);
  if (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    if (Object.keys(value).length > TRACE_LIMITS.collectionItems)
      throw new FrameTracerError(
        'COMMAND_LIMIT',
        'Return map exceeds the collection limit.',
      );
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!('value' in descriptor))
        throw new FrameTracerError(
          'INVALID_ARGUMENT',
          'Accessor return values are unsupported.',
        );
      result[key] = captureReturnAtom(descriptor.value);
    }
    if (Object.getOwnPropertySymbols(value).length > 0)
      throw new FrameTracerError(
        'INVALID_ARGUMENT',
        'Symbol return keys are unsupported.',
      );
    return result;
  }
  throw new FrameTracerError('INVALID_ARGUMENT', 'Unsupported return value.');
}

function captureReturnArray(
  value: readonly unknown[],
  allowRows: boolean,
): unknown[] {
  if (value.length > TRACE_LIMITS.collectionItems)
    throw new FrameTracerError(
      'COMMAND_LIMIT',
      'Return array exceeds the collection limit.',
    );
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined)
      throw new FrameTracerError(
        'INVALID_ARGUMENT',
        'Sparse return arrays are unsupported.',
      );
    if (!('value' in descriptor))
      throw new FrameTracerError(
        'INVALID_ARGUMENT',
        'Accessor return values are unsupported.',
      );
    const item = descriptor.value;
    if (allowRows && Array.isArray(item))
      return captureReturnArray(item, false);
    return captureReturnAtom(item);
  });
}

function captureReturnAtom(value: unknown): unknown {
  if (value !== null && typeof value === 'object')
    throw new FrameTracerError(
      'INVALID_ARGUMENT',
      'Nested return objects are unsupported.',
    );
  return captureReturnFact(value);
}
