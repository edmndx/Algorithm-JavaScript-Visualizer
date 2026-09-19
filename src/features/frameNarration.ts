import type { FrameTrace } from '../protocol/frameTrace';
import type { ConsoleEntry } from './traceConsole';

const comparisonSymbols = {
  eq: '===',
  neq: '!==',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
} as const;

export function formatFrameOperation(
  operation: FrameTrace['frames'][number]['operation'],
): string {
  switch (operation.type) {
    case 'read':
      return `Read ${operation.operand.label} = ${formatFact(operation.operand.value)}.`;
    case 'compare': {
      const left = formatFact(operation.left.value);
      const right = formatFact(operation.right.value);
      return `Compare ${operation.left.label} = ${left} with ${operation.right.label} = ${right} → ${left} ${comparisonSymbols[operation.operator]} ${right} is ${operation.result}.`;
    }
    case 'assign':
      if (operation.calculation !== undefined) {
        const { kind, operand } = operation.calculation;
        return kind === 'add'
          ? `Add ${operand.label} = ${formatFact(operand.value)} to ${operation.target} ${formatFact(operation.before)} → ${formatFact(operation.value)}.`
          : `Subtract ${operand.label} = ${formatFact(operand.value)} from ${operation.target} ${formatFact(operation.before)} → ${formatFact(operation.value)}.`;
      }
      return `Set ${operation.target} from ${formatFact(operation.before)} to ${formatFact(operation.value)}.`;
    case 'swap':
      return `Swap indices ${operation.indices[0]} and ${operation.indices[1]}: ${formatFact(operation.before[0])} and ${formatFact(operation.before[1])}.`;
    case 'return':
      if (
        operation.from !== undefined &&
        operation.role !== undefined &&
        operation.value !== null
      )
        return `Return ${operation.role} ${formatFact(operation.value)} from ${operation.from}${operation.to === null || operation.to === undefined ? '' : ` to ${operation.to}`}.`;
      if (operation.from !== undefined)
        return operation.to === null || operation.to === undefined
          ? `Return from ${operation.from}.`
          : `Return from ${operation.from} to ${operation.to}.`;
      return `Return ${operation.role === undefined ? '' : `${operation.role} `}${formatFact(operation.value)}.`;
    case 'call':
      return operation.from === null
        ? `Call ${operation.callee}(${operation.target}).`
        : `Recurse from ${operation.from} to ${operation.target}.`;
    case 'control':
      return operation.action === 'break'
        ? 'Break out of the loop.'
        : 'Continue with the next loop candidate.';
    case 'collection': {
      const item =
        typeof operation.item === 'string'
          ? operation.item
          : formatFact(operation.item);
      switch (operation.action) {
        case 'enqueue':
          return `Enqueue ${item} in the frontier.`;
        case 'dequeue':
          return `Dequeue ${item} from the frontier.`;
        case 'append':
          return `Visit ${item} and append it to traversal.`;
        case 'add':
          return operation.role === 'selection'
            ? `Select ${item}.`
            : operation.role === 'visited'
              ? `Visit ${item} and mark it as visited.`
              : `Mark ${item} as discovered.`;
        case 'remove':
          return `Remove ${item} from the ${operation.role}.`;
        case 'check':
          return `Check ${item} → ${operation.outcome ? `already ${operation.role === 'visited' ? 'visited' : 'discovered'}; skip it` : 'unvisited'}.`;
      }
    }
  }
}

function formatFact(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatFact).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    if ('kind' in value) {
      if (value.kind === 'undefined') return 'undefined';
      if (value.kind === 'positive-infinity') return 'Infinity';
      if (value.kind === 'negative-infinity') return '-Infinity';
      if (value.kind === 'node-reference' && 'id' in value)
        return `node ${String(value.id)}`;
    }
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}:${formatFact(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createFrameNarrationEntries(
  trace: FrameTrace,
  currentStep: number,
): readonly ConsoleEntry[] {
  return trace.frames
    .slice(0, currentStep)
    .map((frame, index) => ({
      sequence: index + 1,
      level: 'log' as const,
      text: formatFrameOperation(frame.operation),
      source: frame.source,
    }))
    .reverse();
}
