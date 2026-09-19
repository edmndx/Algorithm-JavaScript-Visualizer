import { select } from 'd3';

import type { SceneState } from '../scene';

export function renderContext(svg: SVGSVGElement, scene: SceneState): void {
  const context = scene.context;
  const root = select(svg)
    .selectAll<SVGGElement, null>('g.visualization-context')
    .data([null])
    .join('g')
    .attr('class', 'visualization-context')
    .attr('transform', 'translate(12, 18)');

  const labels: string[] = [];
  if (context.input?.kind === 'sequence') {
    if (context.input.range !== undefined)
      labels.push(`range: ${context.input.range.join('..')}`);
    for (const [name, index] of Object.entries(context.input.pointers ?? {}))
      labels.push(`${name}: ${index}`);
  } else if (context.input?.kind === 'grid') {
    labels.push(
      `grid: ${context.input.values.map((row) => row.map(String).join(' ')).join(' / ')}`,
    );
  }
  for (const [name, value] of Object.entries(context.metrics))
    labels.push(`${name}: ${String(value)}`);

  root
    .selectAll<SVGTextElement, string>('text.visualization-context-line')
    .data(labels)
    .join('text')
    .attr('class', 'visualization-context-line')
    .attr('x', 0)
    .attr('y', (_, index) => index * 16)
    .text((label) => label);
}
