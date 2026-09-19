import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
} from '../ast';
import { applySourceEdits, type SourceEdit } from '../edits';
import type { ValidVisualizationSource } from '../sourceContract';
import { analyzeList } from './analyzeReversal';
import { linkedListTraceInitializationSource } from './linkedListTraceSource';
import { analyzeMerge, instrumentMerge } from './mergeLinkedLists';
import { instrumentReadOnlyList } from './readOnlyList';
import { findAllListDeclarations } from './staticLinkedList';
import type { ListCandidate } from './linkedListTypes';

export function instrumentLinkedList(
  source: string,
  contract: ValidVisualizationSource,
): string | null {
  const { program } = contract;
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const mergeDeclarations = findAllListDeclarations(program);
  if (mergeDeclarations.length > 1) {
    const merge = analyzeMerge(program, contract, mergeDeclarations);
    return merge === null ? null : instrumentMerge(source, program, merge);
  }

  const declarations = mergeDeclarations.filter(
    ({ declaration }) => declaration === contract.declaration,
  );
  const candidates = declarations
    .map(({ declaration, nodes }) => analyzeList(program, declaration, nodes))
    .filter((candidate): candidate is ListCandidate => candidate !== null);

  if (candidates.length === 0) {
    return instrumentReadOnlyList(source, program, declarations);
  }
  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  if (candidate === undefined) return null;

  const allocate = createIdentifierAllocator(program, '__traceList');
  const nodeIds = allocate();
  const finalize = allocate();
  const lastNode = candidate.nodes.at(-1);
  if (lastNode === undefined) return null;

  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        linkedListTraceInitializationSource(
          nodeIds,
          candidate.nodes,
          lastNode.id,
          candidate.declarationLine,
        ) +
        `const ${finalize} = (head, line) => { trace.setHead({ nodeId: ${nodeIds}.get(head), source: { line } }); trace.setTail({ nodeId: ${nodeIds}.get(${candidate.root}), source: { line } }); return head; };\n`,
    },
    ...candidate.assignments.map(({ statement, node, next, line }) => ({
      start: statement.end,
      end: statement.end,
      text: `\ntrace.setNext({ nodeId: ${nodeIds}.get(${node.name}), nextId: ${next === null ? 'null' : `${next.name} === null ? null : ${nodeIds}.get(${next.name})`}, source: { line: ${line} } });`,
    })),
    {
      start: candidate.initialCall.call.start,
      end: candidate.initialCall.call.end,
      text: `${finalize}(${source.slice(candidate.initialCall.call.start, candidate.initialCall.call.end)}, ${candidate.initialCall.line})`,
    },
  ];

  return applySourceEdits(source, edits);
}
