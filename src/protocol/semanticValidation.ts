import type { TraceCommand } from './traceTypes';
import { addIssue } from './semantic/semanticIssues';
import type {
  TraceSemanticIssue,
  TraceSemanticValidationResult,
} from './semantic/semanticTypes';
import { validateArrayTrace } from './semantic/validateArray';
import { validateGraphTrace } from './semantic/validateGraph';
import { validateHashTableTrace } from './semantic/validateHashTable';
import { validateLinkedListTrace } from './semantic/validateLinkedList';
import { validateMatrixTrace } from './semantic/validateMatrix';
import { validateQueueTrace } from './semantic/validateQueue';
import { validateStackTrace } from './semantic/validateStack';
import { validateTreeTrace } from './semantic/validateTree';

export type {
  TraceSemanticIssue,
  TraceSemanticIssueCode,
  TraceSemanticValidationResult,
} from './semantic/semanticTypes';

export function validateTraceSemantics(
  commands: readonly TraceCommand[],
): TraceSemanticValidationResult {
  const issues: TraceSemanticIssue[] = [];

  if (commands.length === 0) {
    addIssue(
      issues,
      -1,
      'EMPTY_TRACE',
      'Trace must contain at least scene.init and a structure creation command.',
    );

    return { ok: false, issues };
  }

  const firstCommand = commands[0];

  if (firstCommand?.type !== 'scene.init') {
    addIssue(
      issues,
      0,
      'MISSING_SCENE_INIT',
      'The first trace command must be scene.init.',
    );

    return { ok: false, issues };
  }

  switch (firstCommand.structure) {
    case 'array':
      validateArrayTrace(commands, issues);
      break;
    case 'matrix':
      validateMatrixTrace(commands, issues);
      break;
    case 'tree':
      validateTreeTrace(commands, issues);
      break;
    case 'graph':
      validateGraphTrace(commands, issues);
      break;
    case 'stack':
      validateStackTrace(commands, issues);
      break;
    case 'queue':
      validateQueueTrace(commands, issues);
      break;
    case 'linked-list':
      validateLinkedListTrace(commands, issues);
      break;
    case 'hash-table':
      validateHashTableTrace(commands, issues);
      break;
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
