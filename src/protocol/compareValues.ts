import type { ComparisonOperator, TraceValue } from './traceTypes';

export function compareValues(
  left: TraceValue,
  right: TraceValue,
  operator: ComparisonOperator,
): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
  }
}
