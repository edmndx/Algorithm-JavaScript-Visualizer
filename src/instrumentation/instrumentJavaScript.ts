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
import { validateVisualizationSource } from './sourceContract';

export function instrumentJavaScript(
  source: string,
  structure: InstrumentableStructure,
): InstrumentationResult {
  const contract = validateVisualizationSource(source, structure);
  if (contract.status === 'syntax-error')
    return { status: 'unsupported', source };
  if (contract.status === 'invalid') {
    return {
      status: 'source-contract-error',
      source,
      diagnostic: contract.diagnostic,
    };
  }

  const { program } = contract;

  let instrumented: string | null;
  switch (structure) {
    case 'array':
      instrumented = instrumentArray(source, program, contract);
      break;
    case 'matrix':
      instrumented = instrumentMatrix(source, program, contract);
      break;
    case 'stack':
      instrumented = instrumentStack(source, program, contract);
      break;
    case 'queue':
      instrumented = instrumentQueue(source, program, contract);
      break;
    case 'graph':
      instrumented = instrumentGraph(source, program, contract);
      break;
    case 'hash-table':
      instrumented = instrumentHashTable(source, program, contract);
      break;
    case 'tree':
      instrumented = instrumentTree(source, program, contract);
      break;
    case 'linked-list':
      instrumented = instrumentLinkedList(source, program, contract);
      break;
  }

  return instrumented === null
    ? { status: 'unsupported', source }
    : { status: 'instrumented', source: instrumented };
}
