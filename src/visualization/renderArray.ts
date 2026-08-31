import { scaleLinear, select } from 'd3';

import type { ArraySceneState } from '../scene';
import { VISUALIZATION_TRANSITION_MS, type D3RenderFunction } from './D3Scene';
import { createTransformTween } from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';

type ArrayItemDatum = {
  readonly id: string;
  readonly index: number;
  readonly value: string;
  readonly label: string | null;
  readonly markerNames: readonly string[];
  readonly isCompared: boolean;
  readonly y: number;
  readonly height: number;
  readonly valueKind: 'numeric' | 'nonnumeric';
};

const BAR_WIDTH = 48;
const BAR_GAP = 16;
const CHART_HEIGHT = 280;
const NONNUMERIC_HEIGHT = 92;
const HORIZONTAL_PADDING = 40;
const TOP_PADDING = 48;
const BOTTOM_PADDING = 62;

function collectMarkerNames(
  markers: ArraySceneState['markers'],
): ReadonlyMap<number, readonly string[]> {
  const namesByIndex = new Map<number, string[]>();

  for (const [name, indices] of Object.entries(markers)) {
    for (const index of indices) {
      const names = namesByIndex.get(index) ?? [];
      names.push(name);
      namesByIndex.set(index, names);
    }
  }

  return namesByIndex;
}

function arrayValueY(datum: ArrayItemDatum, baselineY: number): number {
  if (datum.valueKind === 'nonnumeric') {
    return datum.y + datum.height / 2;
  }
  return datum.y < baselineY ? datum.y - 10 : datum.y + datum.height + 18;
}

export const renderArray: D3RenderFunction<ArraySceneState> = (svg, scene) => {
  const markerNames = collectMarkerNames(scene.markers);
  const comparedIndices = new Set(scene.comparedIndices ?? []);
  const numericValues = scene.values.filter(
    (value): value is number => typeof value === 'number',
  );
  const minimum = Math.min(0, ...numericValues);
  const maximum = Math.max(0, ...numericValues);
  const numericDomain: readonly [number, number] =
    minimum === maximum ? [-1, 1] : [minimum, maximum];
  const yScale = scaleLinear()
    .domain(numericDomain)
    .range([TOP_PADDING + CHART_HEIGHT, TOP_PADDING]);
  const baselineY = yScale(0);
  const data: readonly ArrayItemDatum[] = scene.values.map((value, index) => {
    const id = scene.itemIds[index];
    if (id === undefined) {
      throw new Error(`Array item identity at index ${index} is missing.`);
    }
    const numeric = typeof value === 'number';
    const valueY = numeric ? yScale(value) : baselineY;
    return {
      id,
      index,
      value: String(value),
      label: scene.labels[index] ?? null,
      markerNames: markerNames.get(index) ?? [],
      isCompared: comparedIndices.has(index),
      y: numeric
        ? Math.min(valueY, baselineY)
        : TOP_PADDING + (CHART_HEIGHT - NONNUMERIC_HEIGHT) / 2,
      height: numeric ? Math.abs(valueY - baselineY) : NONNUMERIC_HEIGHT,
      valueKind: numeric ? 'numeric' : 'nonnumeric',
    };
  });
  const contentWidth =
    data.length === 0
      ? BAR_WIDTH * 4
      : data.length * BAR_WIDTH + (data.length - 1) * BAR_GAP;
  const width = contentWidth + HORIZONTAL_PADDING * 2;
  const height = TOP_PADDING + CHART_HEIGHT + BOTTOM_PADDING;
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-array').empty();
  updateVisualizationViewBox(svg, `0 0 ${width} ${height}`, hadRoot);
  const definitions = selection
    .selectAll<SVGDefsElement, null>('defs.visualization-array-definitions')
    .data([null])
    .join('defs')
    .attr('class', 'visualization-array-definitions');
  const gradients = definitions
    .selectAll<SVGLinearGradientElement, 'blue' | 'red'>(
      'linearGradient.visualization-array-gradient',
    )
    .data(['blue', 'red'], (color) => color)
    .join('linearGradient')
    .attr('class', 'visualization-array-gradient')
    .attr('id', (color) => `visualization-array-${color}-gradient`)
    .attr('x1', '0%')
    .attr('y1', '100%')
    .attr('x2', '0%')
    .attr('y2', '0%');
  gradients
    .selectAll<SVGStopElement, string>('stop')
    .data(['0%', '100%'])
    .join('stop')
    .attr('offset', (offset) => offset);
  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-array')
    .data([null])
    .join('g')
    .attr('class', 'visualization-array');

  root
    .selectAll<SVGLineElement, null>('line.visualization-array-baseline')
    .data(data.length === 0 ? [] : [null])
    .join('line')
    .attr('class', 'visualization-array-baseline')
    .attr('data-visible', 'true')
    .attr('x1', HORIZONTAL_PADDING)
    .attr('x2', width - HORIZONTAL_PADDING)
    .attr('y1', baselineY)
    .attr('y2', baselineY);

  root
    .selectAll<SVGTextElement, null>('text.visualization-empty-structure')
    .data(data.length === 0 ? [null] : [])
    .join('text')
    .attr('class', 'visualization-empty-structure')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .text('EMPTY ARRAY');

  const items = root
    .selectAll<SVGGElement, ArrayItemDatum>('g.visualization-array-item')
    .data(data, (datum) => datum.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-array-item')
          .attr(
            'transform',
            (datum) =>
              `translate(${HORIZONTAL_PADDING + datum.index * (BAR_WIDTH + BAR_GAP)}, 0)`,
          );
        group.append('rect').attr('class', 'visualization-bar');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-index');
        group.append('text').attr('class', 'visualization-label');
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
            createTransformTween<ArrayItemDatum>(
              (datum) =>
                `translate(${HORIZONTAL_PADDING + datum.index * (BAR_WIDTH + BAR_GAP)}, -16)`,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-item-id', (datum) => datum.id)
    .classed('visualization-compared', (datum) => datum.isCompared)
    .classed('visualization-marked', (datum) => datum.markerNames.length > 0);

  items
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .attrTween(
      'transform',
      createTransformTween<ArrayItemDatum>(
        (datum) =>
          `translate(${HORIZONTAL_PADDING + datum.index * (BAR_WIDTH + BAR_GAP)}, 0)`,
      ),
    );

  const bars = items
    .select<SVGRectElement>('rect.visualization-bar')
    .attr('data-value-kind', (datum) => datum.valueKind)
    .attr('x', 0)
    .attr('width', BAR_WIDTH)
    .attr('rx', 4);
  if (hadRoot) {
    bars
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attr('y', (datum) => datum.y)
      .attr('height', (datum) => datum.height);
  } else {
    bars.attr('y', (datum) => datum.y).attr('height', (datum) => datum.height);
  }

  const valueLabels = items
    .select<SVGTextElement>('text.visualization-value')
    .attr('x', BAR_WIDTH / 2)
    .attr('dy', (datum) => (datum.valueKind === 'nonnumeric' ? '0.35em' : null))
    .text((datum) => datum.value);
  if (hadRoot) {
    valueLabels
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attr('y', (datum) => arrayValueY(datum, baselineY));
  } else {
    valueLabels.attr('y', (datum) => arrayValueY(datum, baselineY));
  }

  items
    .select<SVGTextElement>('text.visualization-index')
    .attr('x', BAR_WIDTH / 2)
    .attr('y', TOP_PADDING + CHART_HEIGHT + 22)
    .text((datum) => datum.index);

  items
    .select<SVGTextElement>('text.visualization-label')
    .attr('x', BAR_WIDTH / 2)
    .attr('y', 24)
    .text((datum) => datum.label ?? '');

  items
    .select<SVGTextElement>('text.visualization-marker')
    .attr('x', BAR_WIDTH / 2)
    .attr('y', TOP_PADDING + CHART_HEIGHT + 42)
    .text((datum) => datum.markerNames.join(', '));
};
