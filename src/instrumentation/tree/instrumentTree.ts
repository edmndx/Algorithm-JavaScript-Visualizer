import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
} from '../ast';
import { applySourceEdits, lineIndentation, type SourceEdit } from '../edits';
import type { ValidVisualizationSource } from '../sourceContract';
import { analyzeTree } from './analyzeTree';
import { readStaticTree } from './staticTree';
import type { TreeCandidate } from './treeTypes';

export function instrumentTree(
  source: string,
  contract: ValidVisualizationSource,
): string | null {
  const { program } = contract;
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const declaration = contract.declaration;
  const initializer = declaration.declarations[0]?.init;
  if (initializer?.type !== 'ObjectExpression') return null;

  const nodes = readStaticTree(initializer, contract.identifier, { nextId: 0 });
  if (nodes === null) return null;

  const candidate = analyzeTree(program, declaration, nodes);
  if (candidate === null) return null;
  if (
    candidate.traversal.kind === 'bounds-check' &&
    candidate.nodes.some(({ value }) => typeof value !== 'number')
  ) {
    return null;
  }

  const allocateIdentifier = createIdentifierAllocator(program, '__traceTree');
  const nodeIds = allocateIdentifier();
  const operationHelper = allocateIdentifier();
  const weakMapEntries = candidate.nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const traceNodes = candidate.nodes
    .map(
      ({ id, value, children }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, children: ${JSON.stringify(children)} }`,
    )
    .join(', ');
  const helperSource =
    candidate.traversal.kind === 'maximum-depth'
      ? `const ${operationHelper} = (node, depth, line) => { trace.setDepth({ nodeId: ${nodeIds}.get(node), depth, source: { line } }); return depth; };\n`
      : candidate.traversal.kind === 'bounds-check'
        ? `const ${operationHelper} = (node, lower, upper, violates, line) => { trace.checkBounds({ nodeId: ${nodeIds}.get(node), lower: Number.isFinite(lower) ? lower : null, upper: Number.isFinite(upper) ? upper : null, matches: !violates, source: { line } }); return violates; };\n`
        : '';
  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'tree', source: { line: ${candidate.declarationLine} } });\n` +
        `const ${nodeIds} = new WeakMap([${weakMapEntries}]);\n` +
        helperSource +
        `trace.createTree({ rootId: ${JSON.stringify(candidate.nodes[0]?.id)}, nodes: [${traceNodes}], source: { line: ${candidate.declarationLine} } });\n`,
    },
    operationEdit(source, candidate.traversal, nodeIds, operationHelper),
  ];

  return applySourceEdits(source, edits);
}

function operationEdit(
  source: string,
  traversal: TreeCandidate['traversal'],
  nodeIds: string,
  helper: string,
): SourceEdit {
  switch (traversal.kind) {
    case 'visit': {
      const indentation = lineIndentation(
        source,
        traversal.visit.insertionPoint.start,
      );
      return {
        start: traversal.visit.insertionPoint.start,
        end: traversal.visit.insertionPoint.start,
        text: `trace.visit({ nodeId: ${nodeIds}.get(${traversal.visit.target.name}), source: { line: ${traversal.visit.line} } });\n${indentation}`,
      };
    }

    case 'maximum-depth':
      return {
        start: traversal.expression.start,
        end: traversal.expression.end,
        text: `${helper}(${traversal.target.name}, ${source.slice(traversal.expression.start, traversal.expression.end)}, ${traversal.line})`,
      };

    case 'bounds-check':
      return {
        start: traversal.condition.start,
        end: traversal.condition.end,
        text: `${helper}(${traversal.target.name}, ${traversal.lower.name}, ${traversal.upper.name}, ${source.slice(traversal.condition.start, traversal.condition.end)}, ${traversal.line})`,
      };
  }
}
