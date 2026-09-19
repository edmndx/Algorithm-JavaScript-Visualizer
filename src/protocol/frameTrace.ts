import { validateTraceSemantics } from './semanticValidation';
import { TRACE_LIMITS } from './traceSchemas';
import {
  frameSchema,
  frameTraceSchema,
  frameTraceHeaderSchema,
  type FrameTrace,
  type FrameTraceHeader,
  type Frame,
  type FactAtom,
} from './frameTraceSchemas';

export type { FrameTrace } from './frameTraceSchemas';

export const FRAME_TRACE_BYTE_LIMIT = 16 * 1024 * 1024;

const comparisonCommands = new Set([
  'array.compare',
  'array.compareValue',
  'array.focus',
  'array.mark',
  'matrix.compare',
  'matrix.mark',
  'tree.compare',
  'tree.mark',
  'graph.markNodes',
  'graph.markEdges',
  'linked-list.compareIdentity',
  'linked-list.mark',
]);

type FrameTraceResult =
  | { readonly ok: true; readonly trace: FrameTrace }
  | { readonly ok: false; readonly message: string };

export function validateFrameTrace(input: unknown): FrameTraceResult {
  const parsed = frameTraceSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid frame trace.',
    };
  const trace = parsed.data;
  if (serializedSize(trace) > FRAME_TRACE_BYTE_LIMIT)
    return {
      ok: false,
      message: 'Frame trace exceeds the serialized-byte limit.',
    };
  const headerError = validateHeader(trace);
  if (headerError !== null) return { ok: false, message: headerError };
  const lines = trace.source.text.split(/\r\n|\r|\n/);
  for (const frame of trace.frames) {
    const result = validateFrameFacts(frame, lines, trace.source.structure);
    if (!result.ok) return result;
  }
  const history = validateFrameHistory(trace);
  if (!history.ok) return history;
  const commands = [
    ...trace.initialization,
    ...trace.frames.flatMap((frame) => frame.commands),
  ];
  if (commands.length > TRACE_LIMITS.commands)
    return { ok: false, message: 'Trace command limit exceeded.' };
  const semantics = validateCommands(commands);
  return semantics.ok ? { ok: true, trace } : semantics;
}

type ValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export function validateFrameInitialization(
  source: FrameTrace['source'],
  initialization: unknown,
):
  | {
      readonly ok: true;
      readonly header: FrameTraceHeader;
      readonly serializedBytes: number;
    }
  | { readonly ok: false; readonly message: string } {
  const parsed = frameTraceHeaderSchema.safeParse({
    version: '2',
    source,
    initialization,
  });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid frame trace.',
    };
  const header = parsed.data;
  const serializedBytes = serializedSize({ ...header, frames: [] });
  if (serializedBytes > FRAME_TRACE_BYTE_LIMIT)
    return {
      ok: false,
      message: 'Frame trace exceeds the serialized-byte limit.',
    };
  const headerError = validateHeader(header);
  if (headerError !== null) return { ok: false, message: headerError };
  const semantics = validateCommands(header.initialization);
  return semantics.ok ? { ok: true, header, serializedBytes } : semantics;
}

export function validateEmittedFrame(
  header: FrameTraceHeader,
  input: unknown,
):
  | { readonly ok: true; readonly frame: Frame }
  | { readonly ok: false; readonly message: string } {
  const parsed = frameSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid frame.',
    };
  const frame = parsed.data;
  const facts = validateFrameFacts(
    frame,
    header.source.text.split(/\r\n|\r|\n/),
    header.source.structure,
  );
  if (!facts.ok) return facts;
  const commands = [...header.initialization, ...frame.commands];
  if (commands.length > TRACE_LIMITS.commands)
    return { ok: false, message: 'Trace command limit exceeded.' };
  const semantics = validateCommands(commands);
  return semantics.ok ? { ok: true, frame } : semantics;
}

function serializedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validateHeader(header: FrameTraceHeader): string | null {
  if (new TextEncoder().encode(header.source.text).byteLength > 256_000)
    return 'Original source exceeds the byte limit.';
  const [initialize, create] = header.initialization;
  return initialize.type !== 'scene.init' ||
    initialize.structure !== header.source.structure ||
    create.type !== `${header.source.structure}.create`
    ? 'Invalid primary scene initialization.'
    : null;
}

function validateCommands(commands: Frame['commands']): ValidationResult {
  const semantics = validateTraceSemantics(commands);
  return semantics.ok
    ? { ok: true }
    : {
        ok: false,
        message: semantics.issues[0]?.message ?? 'Invalid scene commands.',
      };
}

// Frame-local facts do not assume a completed call stack or prior array values.
function validateFrameFacts(
  frame: Frame,
  lines: readonly string[],
  structure: FrameTrace['source']['structure'],
): ValidationResult {
  const first = frame.commands[0];
  const last = frame.commands.at(-1);
  if (
    frame.operation.type === 'call' &&
    (first?.type !== 'scope.enter' || first.target !== frame.operation.target)
  )
    return { ok: false, message: 'Call frame must enter its source scope.' };
  if (frame.operation.type === 'return' && last?.type !== 'scope.leave')
    return { ok: false, message: 'Return frame must leave the active scope.' };
  if (
    frame.commands.some(
      (command, commandIndex) =>
        (command.type === 'scope.enter' &&
          (frame.operation.type !== 'call' || commandIndex !== 0)) ||
        (command.type === 'scope.leave' &&
          (frame.operation.type !== 'return' ||
            commandIndex !== frame.commands.length - 1)),
    )
  )
    return {
      ok: false,
      message: 'Scope command is not attached to its source action.',
    };
  if (structure === 'array') {
    const swaps = frame.commands.filter(
      (command) => command.type === 'array.swap',
    );
    if (frame.operation.type === 'swap') {
      const command = swaps[0];
      const [first, second] = frame.operation.indices;
      const [beforeFirst, beforeSecond] = frame.operation.before;
      const [afterFirst, afterSecond] = frame.operation.after;
      if (
        swaps.length !== 1 ||
        command?.indices[0] !== first ||
        command.indices[1] !== second ||
        afterFirst !== beforeSecond ||
        afterSecond !== beforeFirst
      )
        return {
          ok: false,
          message: 'Swap fact disagrees with primary array state.',
        };
    } else if (swaps.length > 0)
      return {
        ok: false,
        message: 'Array swap requires a swap source operation.',
      };
  }
  const { line, column, endLine, endColumn } = frame.source;
  const start = lines[line - 1];
  const end = lines[endLine - 1];
  if (
    start === undefined ||
    end === undefined ||
    column > start.length + 1 ||
    endColumn > end.length + 1
  ) {
    return {
      ok: false,
      message: 'Frame source is outside the original document.',
    };
  }
  if (frame.operation.type === 'control') {
    const target = frame.operation.target;
    const targetStart = lines[target.line - 1];
    const targetEnd = lines[target.endLine - 1];
    if (
      targetStart === undefined ||
      targetEnd === undefined ||
      target.column > targetStart.length + 1 ||
      target.endColumn > targetEnd.length + 1 ||
      target.line > line ||
      target.endLine < endLine ||
      line !== endLine ||
      start.slice(column - 1, endColumn - 1) !== `${frame.operation.action};` ||
      !/^\s*(?:for|while|do)\b/.test(targetStart.slice(target.column - 1))
    )
      return {
        ok: false,
        message: 'Control transfer does not match its original loop.',
      };
  }
  if (frame.operation.type === 'compare' && !comparisonAgrees(frame.operation))
    return {
      ok: false,
      message: 'Comparison facts disagree with their operands.',
    };
  if (
    frame.operation.type === 'assign' &&
    frame.operation.calculation !== undefined &&
    !calculationAgrees(frame.operation)
  )
    return {
      ok: false,
      message: 'Arithmetic facts disagree with the stored assignment.',
    };
  if (
    frame.operation.type === 'compare' &&
    frame.commands.some((command) => !comparisonCommands.has(command.type))
  )
    return {
      ok: false,
      message: 'Comparison frame contains a non-comparison scene mutation.',
    };
  if (
    frame.commands.some(
      (command) =>
        (command.type === 'array.set' || command.type === 'matrix.set') &&
        (frame.operation.type !== 'assign' ||
          frame.operation.value !== command.value),
    )
  )
    return {
      ok: false,
      message: 'Scene write disagrees with its assignment fact.',
    };
  if (
    frame.commands.some(
      (command) =>
        (command.type === 'graph.discoverNode' &&
          (frame.operation.type !== 'collection' ||
            frame.operation.action !== 'add' ||
            frame.operation.role !== 'discovered' ||
            frame.operation.item !== command.nodeId)) ||
        (command.type === 'graph.predecessor' &&
          (frame.operation.type !== 'assign' ||
            frame.operation.value !== command.predecessorId)),
    )
  )
    return {
      ok: false,
      message: 'Graph scene command disagrees with its source operation.',
    };
  return { ok: true };
}

// History rules apply to complete imports and the final runtime snapshot.
function validateFrameHistory(trace: FrameTrace): ValidationResult {
  const scopes = [0];
  const create = trace.initialization[1];
  const arrayValues =
    create.type === 'array.create' ? [...create.values] : null;
  for (const [index, frame] of trace.frames.entries()) {
    if (scopes.length === 0)
      return { ok: false, message: 'Frame follows the completed root scope.' };
    const first = frame.commands[0];
    const last = frame.commands.at(-1);
    if (frame.operation.type === 'call') {
      if (first?.type !== 'scope.enter' || first.id !== index + 1)
        return {
          ok: false,
          message: 'Call frame must enter its source scope.',
        };
      scopes.push(first.id);
    } else if (frame.operation.type === 'return') {
      if (last?.type !== 'scope.leave' || last.id !== scopes.at(-1))
        return {
          ok: false,
          message: 'Return frame must leave the active scope.',
        };
      scopes.pop();
    }
    if (arrayValues !== null) {
      if (frame.operation.type === 'swap') {
        const {
          indices: [first, second],
          before,
          after,
        } = frame.operation;
        if (
          arrayValues[first] !== before[0] ||
          arrayValues[second] !== before[1]
        )
          return {
            ok: false,
            message: 'Swap fact disagrees with primary array state.',
          };
        arrayValues[first] = after[0];
        arrayValues[second] = after[1];
      }
      for (const command of frame.commands)
        if (command.type === 'array.set')
          arrayValues[command.index] = command.value;
    }
  }
  return scopes.length === 0
    ? { ok: true }
    : { ok: false, message: 'Trace ends before the root scope returns.' };
}

function calculationAgrees(
  operation: Extract<
    FrameTrace['frames'][number]['operation'],
    { type: 'assign' }
  >,
): boolean {
  const calculation = operation.calculation;
  if (calculation === undefined) return true;
  const { before, value } = operation;
  const operand = calculation.operand.value;
  if (
    typeof before !== 'number' ||
    typeof value !== 'number' ||
    typeof operand !== 'number'
  )
    return false;
  return (
    (calculation.kind === 'add' ? before + operand : before - operand) === value
  );
}

function comparisonAgrees(
  operation: Extract<
    FrameTrace['frames'][number]['operation'],
    { readonly type: 'compare' }
  >,
): boolean {
  const left = comparableValue(operation.left.value);
  const right = comparableValue(operation.right.value);
  const bothStrings = typeof left === 'string' && typeof right === 'string';
  const a = bothStrings ? left : Number(left);
  const b = bothStrings ? right : Number(right);
  let result: boolean;
  switch (operation.operator) {
    case 'eq':
      result = equalityAgrees(operation.left.value, operation.right.value);
      break;
    case 'neq':
      result = !equalityAgrees(operation.left.value, operation.right.value);
      break;
    case 'lt':
      result = a < b;
      break;
    case 'lte':
      result = a <= b;
      break;
    case 'gt':
      result = a > b;
      break;
    case 'gte':
      result = a >= b;
      break;
  }
  return result === operation.result;
}

function equalityAgrees(left: FactAtom, right: FactAtom): boolean {
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  )
    return left === right;
  return (
    left.kind === right.kind &&
    (left.kind !== 'node-reference' ||
      (right.kind === 'node-reference' && left.id === right.id))
  );
}

function comparableValue(
  value: FactAtom,
): string | number | boolean | null | undefined {
  if (typeof value !== 'object' || value === null) return value;
  switch (value.kind) {
    case 'undefined':
      return undefined;
    case 'positive-infinity':
      return Infinity;
    case 'negative-infinity':
      return -Infinity;
    case 'node-reference':
      return value.id;
  }
}
