import { select } from 'd3';

import type { StackSceneState } from '../scene';
import type { D3RenderFunction } from './D3Scene';
import { indexMarkerNames } from './indexMarkerNames';
import { createTransformTween } from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';
import { VISUALIZATION_TRANSITION_MS } from './visualizationTransition';
import { renderContext } from './renderContext';

type StackItemDatum = {
  readonly id: string;
  readonly index: number;
  readonly value: string;
  readonly markerNames: readonly string[];
  readonly isPeeked: boolean;
  readonly comparisonResult: boolean | null;
};

const ITEM_WIDTH = 208;
const ITEM_HEIGHT = 44;
const ITEM_GAP = 6;
const HEADER_HEIGHT = 28;
const PADDING = 28;
const VIEW_WIDTH = 420;
const VIEW_HEIGHT = 360;
const BASE_ITEM_Y = 220;
const PEEK_LIFT = 6;
const COMPARISON_LIFT = 12;
const COMPARISON_SCALE = 1.025;

function stackItemTransform(
  index: number,
  state: 'normal' | 'peeked' | 'compared' = 'normal',
): string {
  const lift =
    state === 'compared' ? COMPARISON_LIFT : state === 'peeked' ? PEEK_LIFT : 0;
  const base = `translate(0, ${-index * (ITEM_HEIGHT + ITEM_GAP) - lift})`;
  return state === 'compared'
    ? `${base} translate(${ITEM_WIDTH / 2}, ${ITEM_HEIGHT / 2}) scale(${COMPARISON_SCALE}) translate(${-ITEM_WIDTH / 2}, ${-ITEM_HEIGHT / 2})`
    : base;
}

export const renderStack: D3RenderFunction<StackSceneState> = (
  svg,
  scene,
  options,
) => {
  const animate = options?.animate !== false;
  const markerNames = indexMarkerNames(scene.markers);

  const items: readonly StackItemDatum[] = scene.values.map((value, index) => {
    const id = scene.itemIds[index];
    if (id === undefined) {
      throw new Error(`Stack item identity at index ${index} is missing.`);
    }
    return {
      id,
      index,
      value: String(value),
      markerNames: markerNames.get(index) ?? [],
      isPeeked: scene.peekedIndex === index,
      comparisonResult:
        scene.comparison?.stackIndex === index
          ? scene.comparison.matches
          : null,
    };
  });
  const topItemY = -(items.length - 1) * (ITEM_HEIGHT + ITEM_GAP);
  const minimumY = Math.min(
    0,
    BASE_ITEM_Y + topItemY - HEADER_HEIGHT - PADDING,
  );
  const maximumY = Math.max(VIEW_HEIGHT, BASE_ITEM_Y + ITEM_HEIGHT + PADDING);
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-stack').empty();
  updateVisualizationViewBox(
    svg,
    `0 ${minimumY} ${VIEW_WIDTH} ${maximumY - minimumY}`,
    hadRoot && animate,
  );
  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-stack')
    .data([null])
    .join('g')
    .attr('class', 'visualization-stack')
    .attr(
      'transform',
      `translate(${(VIEW_WIDTH - ITEM_WIDTH) / 2}, ${BASE_ITEM_Y})`,
    );
  const frameTop = topItemY - 8;
  const frameBottom = ITEM_HEIGHT + 8;
  const frameRight = ITEM_WIDTH + 8;
  const frameRadius = 8;

  root
    .selectAll<SVGPathElement, null>('path.visualization-stack-background')
    .data(items.length === 0 ? [] : [null])
    .join('path')
    .attr('class', 'visualization-stack-background')
    .attr(
      'd',
      [
        `M -8 ${frameTop}`,
        `H ${frameRight}`,
        `V ${frameBottom - frameRadius}`,
        `Q ${frameRight} ${frameBottom} ${frameRight - frameRadius} ${frameBottom}`,
        `H ${-8 + frameRadius}`,
        `Q -8 ${frameBottom} -8 ${frameBottom - frameRadius}`,
        `V ${frameTop}`,
        'Z',
      ].join(' '),
    );

  root
    .selectAll<SVGPathElement, null>('path.visualization-stack-frame')
    .data(items.length === 0 ? [] : [null])
    .join('path')
    .attr('class', 'visualization-structure-frame visualization-stack-frame')
    .attr(
      'd',
      [
        `M -8 ${frameTop}`,
        `V ${frameBottom - frameRadius}`,
        `Q -8 ${frameBottom} ${-8 + frameRadius} ${frameBottom}`,
        `H ${frameRight - frameRadius}`,
        `Q ${frameRight} ${frameBottom} ${frameRight} ${frameBottom - frameRadius}`,
        `V ${frameTop}`,
      ].join(' '),
    );

  const groups = root
    .selectAll<SVGGElement, StackItemDatum>('g.visualization-stack-item')
    .data(items, (item) => item.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-stack-item')
          .style('opacity', hadRoot && animate ? 0 : 1)
          .attr('transform', (item) =>
            hadRoot && animate
              ? stackItemTransform(item.index + 1)
              : stackDatumTransform(item),
          );
        group.append('rect').attr('class', 'visualization-cell');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-marker');
        return group;
      },
      (update) => update,
      (exit) => {
        if (!animate) return exit.remove();
        return exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attrTween(
            'transform',
            createTransformTween<StackItemDatum>((item) =>
              stackItemTransform(item.index + 1),
            ),
          )
          .style('opacity', 0)
          .remove();
      },
    )
    .attr('data-item-id', (item) => item.id)
    .classed('visualization-peeked', (item) => item.isPeeked)
    .classed('visualization-compared', (item) => item.comparisonResult !== null)
    .classed(
      'visualization-comparison-true',
      (item) => item.comparisonResult === true,
    )
    .classed(
      'visualization-comparison-false',
      (item) => item.comparisonResult === false,
    )
    .classed('visualization-marked', (item) => item.markerNames.length > 0);

  if (animate) {
    groups
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .style('opacity', 1)
      .attrTween(
        'transform',
        createTransformTween<StackItemDatum>(stackDatumTransform),
      );
  } else {
    groups
      .interrupt()
      .style('opacity', 1)
      .attr('transform', stackDatumTransform);
  }

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
  renderContext(svg, scene);
};

function stackDatumTransform(item: StackItemDatum): string {
  return stackItemTransform(
    item.index,
    item.comparisonResult !== null
      ? 'compared'
      : item.isPeeked
        ? 'peeked'
        : 'normal',
  );
}
