import { hasUnsafeInstrumentationSyntax } from '../ast';
import { applySourceEdits, lineIndentation, type SourceEdit } from '../edits';
import type { ValidVisualizationSource } from '../sourceContract';
import { analyzeGraph } from './analyzeGraph';
import { readStaticGraph } from './staticGraph';

export function instrumentGraph(
  source: string,
  contract: ValidVisualizationSource,
): string | null {
  const { program } = contract;
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const declaration = contract.declaration;
  const initializer = declaration.declarations[0]?.init;
  if (initializer?.type !== 'ObjectExpression') return null;

  const nodes = readStaticGraph(initializer);
  if (nodes === null) return null;

  const candidate = analyzeGraph(contract, declaration, nodes);
  if (candidate === null) return null;

  const traceNodes = candidate.nodes
    .map(
      ({ id }) => `{ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)} }`,
    )
    .join(', ');
  const traceEdges = candidate.nodes
    .flatMap(({ id: from, neighbors }) =>
      neighbors.map(
        (to) =>
          `{ id: ${JSON.stringify(edgeId(from, to))}, from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, directed: true }`,
      ),
    )
    .join(', ');
  const nodeIndentation = lineIndentation(
    source,
    candidate.traversal.nodeVisitPoint.start,
  );
  const edgeIndentation = lineIndentation(
    source,
    candidate.traversal.edgeVisitPoint.start,
  );
  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'graph', source: { line: ${candidate.declarationLine} } });\n` +
        `trace.createGraph({ nodes: [${traceNodes}], edges: [${traceEdges}], layout: 'circular', source: { line: ${candidate.declarationLine} } });\n`,
    },
    {
      start: candidate.traversal.nodeVisitPoint.start,
      end: candidate.traversal.nodeVisitPoint.start,
      text:
        `trace.visit({ nodeId: ${candidate.traversal.node.name}, source: { line: ${candidate.traversal.nodeVisitLine} } });\n` +
        nodeIndentation,
    },
    {
      start: candidate.traversal.edgeVisitPoint.start,
      end: candidate.traversal.edgeVisitPoint.start,
      text:
        `trace.visitEdge({ edgeId: ${candidate.traversal.node.name} + '->' + ${candidate.traversal.neighbor.name}, source: { line: ${candidate.traversal.edgeVisitLine} } });\n` +
        edgeIndentation,
    },
  ];

  return applySourceEdits(source, edits);
}

function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}
