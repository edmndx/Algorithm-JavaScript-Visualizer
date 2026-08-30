import { parseJavaScript } from './ast';
import { instrumentArray } from './instrumentArray';
import { instrumentGraph } from './instrumentGraph';
import { instrumentHashTable } from './instrumentHashTable';
import { instrumentLinkedList } from './instrumentLinkedList';
import { instrumentMatrix } from './instrumentMatrix';
import { instrumentQueue } from './instrumentQueue';
import { instrumentStack } from './instrumentStack';
import { instrumentTree } from './instrumentTree';
import type {
  InstrumentableStructure,
  InstrumentationResult,
} from './instrumentationTypes';

export function instrumentJavaScript(
  source: string,
  structure: InstrumentableStructure,
): InstrumentationResult {
  const program = parseJavaScript(source);
  if (program === null) return { status: 'unsupported', source };

  let instrumented: string | null;
  switch (structure) {
    case 'array':
      instrumented = instrumentArray(source, program);
      break;
    case 'matrix':
      instrumented = instrumentMatrix(source, program);
      break;
    case 'stack':
      instrumented = instrumentStack(source, program);
      break;
    case 'queue':
      instrumented = instrumentQueue(source, program);
      break;
    case 'graph':
      instrumented = instrumentGraph(source, program);
      break;
    case 'hash-table':
      instrumented = instrumentHashTable(source, program);
      break;
    case 'tree':
      instrumented = instrumentTree(source, program);
      break;
    case 'linked-list':
      instrumented = instrumentLinkedList(source, program);
      break;
  }

  return instrumented === null
    ? { status: 'unsupported', source }
    : { status: 'instrumented', source: instrumented };
}
