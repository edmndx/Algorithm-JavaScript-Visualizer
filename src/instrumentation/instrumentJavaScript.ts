import { instrumentArray } from './instrumentArray';
import { instrumentGraph } from './graph/instrumentGraph';
import { instrumentHashTable } from './instrumentHashTable';
import { instrumentLinkedList } from './linkedList/instrumentLinkedList';
import { instrumentMatrix } from './matrix/instrumentMatrix';
import { instrumentQueue } from './queue/instrumentQueue';
import { instrumentStack } from './instrumentStack';
import { instrumentTree } from './tree/instrumentTree';
import type { InstrumentableStructure } from './instrumentationTypes';
import {
  validateVisualizationSource,
  type SourceContractDiagnostic,
} from './sourceContract';

type InstrumentationResult =
  | {
      readonly status: 'instrumented' | 'unsupported';
      readonly source: string;
    }
  | {
      readonly status: 'source-contract-error';
      readonly source: string;
      readonly diagnostic: SourceContractDiagnostic;
    };

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

  let instrumented: string | null;
  switch (structure) {
    case 'array':
      instrumented = instrumentArray(source, contract);
      break;
    case 'matrix':
      instrumented = instrumentMatrix(source, contract);
      break;
    case 'stack':
      instrumented = instrumentStack(source, contract);
      break;
    case 'queue':
      instrumented = instrumentQueue(source, contract);
      break;
    case 'graph':
      instrumented = instrumentGraph(source, contract);
      break;
    case 'hash-table':
      instrumented = instrumentHashTable(source, contract);
      break;
    case 'tree':
      instrumented = instrumentTree(source, contract);
      break;
    case 'linked-list':
      instrumented = instrumentLinkedList(source, contract);
      break;
  }

  return instrumented === null
    ? { status: 'unsupported', source }
    : { status: 'instrumented', source: instrumented };
}
