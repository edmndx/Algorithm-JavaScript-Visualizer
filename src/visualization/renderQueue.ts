import { select } from 'd3';

import type { QueueSceneState } from '../scene';
import { VISUALIZATION_TRANSITION_MS, type D3RenderFunction } from './D3Scene';
import { createTransformTween } from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';

type QueueItemDatum = {
  readonly id: string;
  readonly index: number;
  readonly value: string;
  readonly markerNames: readonly string[];
  readonly isPeeked: boolean;
};

const ITEM_WIDTH = 56;
const ITEM_HEIGHT = 48;
const ITEM_GAP = 6;
const LABEL_GUTTER = 62;
const PADDING = 28;

export const renderQueue: D3RenderFunction<QueueSceneState> = (svg, scene) => {
  const markerNames = new Map<number, string[]>();
  for (const [name, indices] of Object.entries(scene.markers)) {
    for (const index of indices) {
      const names = markerNames.get(index) ?? [];
      names.push(name);
      markerNames.set(index, names);
    }
  }

  const items: readonly QueueItemDatum[] = scene.values.map((value, index) => {
    const id = scene.itemIds[index];
    if (id === undefined) {
      throw new Error(`Queue item identity at index ${index} is missing.`);
    }
    return {
      id,
      index,
      value: String(value),
      markerNames: markerNames.get(index) ?? [],
      isPeeked: scene.peekedIndex === index,
    };
  });
  const contentWidth = Math.max(
    ITEM_WIDTH,
    items.length * ITEM_WIDTH + Math.max(0, items.length - 1) * ITEM_GAP,
  );
  const contentBlockWidth = LABEL_GUTTER * 2 + contentWidth;
  const width = Math.max(480, PADDING * 2 + contentBlockWidth);
  const height = Math.max(200, PADDING * 2 + ITEM_HEIGHT);
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-queue').empty();
  updateVisualizationViewBox(svg, `0 0 ${width} ${height}`, hadRoot);
  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-queue')
    .data([null])
    .join('g')
    .attr('class', 'visualization-queue')
    .attr(
      'transform',
      `translate(${PADDING + LABEL_GUTTER}, ${(height - ITEM_HEIGHT) / 2})`,
    );

  root
    .selectAll<SVGRectElement, null>('rect.visualization-queue-frame')
    .data(items.length === 0 ? [] : [null])
    .join('rect')
    .attr('class', 'visualization-structure-frame visualization-queue-frame')
    .attr('x', -8)
    .attr('y', -8)
    .attr('width', contentWidth + 16)
    .attr('height', ITEM_HEIGHT + 16)
    .attr('rx', 8);

  root
    .selectAll<SVGTextElement, string>('text.visualization-queue-direction')
    .data(['front', 'rear'])
    .join('text')
    .attr(
      'class',
      (direction) =>
        `visualization-direction-label visualization-queue-direction visualization-queue-${direction}`,
    )
    .attr('x', (direction) => (direction === 'front' ? -16 : contentWidth + 16))
    .attr('y', ITEM_HEIGHT / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', (direction) =>
      direction === 'front' ? 'end' : 'start',
    )
    .text((direction) => (direction === 'front' ? 'HEAD' : 'TAIL'));

  const groups = root
    .selectAll<SVGGElement, QueueItemDatum>('g.visualization-queue-item')
    .data(items, (item) => item.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-queue-item')
          .style('opacity', hadRoot ? 0 : 1)
          .attr('transform', (item) =>
            hadRoot
              ? `translate(${contentWidth + ITEM_GAP}, 0)`
              : `translate(${item.index * (ITEM_WIDTH + ITEM_GAP)}, 0)`,
          );
        group.append('rect').attr('class', 'visualization-cell');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-marker');
        return group;
      },
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attrTween(
            'transform',
            createTransformTween<QueueItemDatum>(
              () => `translate(${-ITEM_WIDTH - ITEM_GAP}, 0)`,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-item-id', (item) => item.id)
    .classed('visualization-peeked', (item) => item.isPeeked)
    .classed('visualization-marked', (item) => item.markerNames.length > 0);

  groups
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'transform',
      createTransformTween<QueueItemDatum>(
        (item) => `translate(${item.index * (ITEM_WIDTH + ITEM_GAP)}, 0)`,
      ),
    );

  groups
    .select<SVGRectElement>('rect.visualization-cell')
    .attr('width', ITEM_WIDTH)
    .attr('height', ITEM_HEIGHT)
    .attr('rx', 6);
  groups
    .select<SVGTextElement>('text.visualization-value')
    .attr('x', ITEM_WIDTH / 2)
    .attr('y', ITEM_HEIGHT / 2 - 2)
    .attr('dy', '0.35em')
    .text((item) => item.value);
  groups
    .select<SVGTextElement>('text.visualization-marker')
    .attr('x', ITEM_WIDTH / 2)
    .attr('y', ITEM_HEIGHT - 5)
    .text((item) => item.markerNames.join(', '));
};
