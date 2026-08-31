import { select } from 'd3';

import type { ArraySceneState } from '../scene';
import type { D3RenderFunction } from './D3Scene';

type ArrayItemDatum = {
  readonly id: string;
  readonly index: number;
  readonly value: string;
  readonly label: string | null;
  readonly markerNames: readonly string[];
  readonly isCompared: boolean;
};

const CELL_WIDTH = 72;
const CELL_HEIGHT = 56;
const CELL_GAP = 12;
const HORIZONTAL_PADDING = 32;
const TOP_PADDING = 48;
const BOTTOM_PADDING = 56;

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

export const renderArray: D3RenderFunction<ArraySceneState> = (svg, scene) => {
  const markerNames = collectMarkerNames(scene.markers);
  const comparedIndices = new Set(scene.comparedIndices ?? []);
  const data: readonly ArrayItemDatum[] = scene.values.map((value, index) => {
    const id = scene.itemIds[index];
    if (id === undefined) {
      throw new Error(`Array item identity at index ${index} is missing.`);
    }
    return {
      id,
      index,
      value: String(value),
      label: scene.labels[index] ?? null,
      markerNames: markerNames.get(index) ?? [],
      isCompared: comparedIndices.has(index),
    };
  });
  const contentWidth =
    data.length === 0
      ? CELL_WIDTH
      : data.length * CELL_WIDTH + (data.length - 1) * CELL_GAP;
  const width = contentWidth + HORIZONTAL_PADDING * 2;
  const height = TOP_PADDING + CELL_HEIGHT + BOTTOM_PADDING;
  const root = select(svg)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .selectAll<SVGGElement, null>('g.visualization-array')
    .data([null])
    .join('g')
    .attr('class', 'visualization-array');

  const items = root
    .selectAll<SVGGElement, ArrayItemDatum>('g.visualization-array-item')
    .data(data, (datum) => datum.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-array-item');
        group.append('rect').attr('class', 'visualization-cell');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-index');
        group.append('text').attr('class', 'visualization-label');
        group.append('text').attr('class', 'visualization-marker');
        return group;
      },
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr('data-item-id', (datum) => datum.id)
    .attr(
      'transform',
      (datum) =>
        `translate(${HORIZONTAL_PADDING + datum.index * (CELL_WIDTH + CELL_GAP)}, ${TOP_PADDING})`,
    )
    .classed('visualization-compared', (datum) => datum.isCompared)
    .classed('visualization-marked', (datum) => datum.markerNames.length > 0);

  items
    .select<SVGRectElement>('rect.visualization-cell')
    .attr('width', CELL_WIDTH)
    .attr('height', CELL_HEIGHT)
    .attr('rx', 8);

  items
    .select<SVGTextElement>('text.visualization-value')
    .attr('x', CELL_WIDTH / 2)
    .attr('y', CELL_HEIGHT / 2)
    .attr('dy', '0.35em')
    .text((datum) => datum.value);

  items
    .select<SVGTextElement>('text.visualization-index')
    .attr('x', CELL_WIDTH / 2)
    .attr('y', CELL_HEIGHT + 22)
    .text((datum) => datum.index);

  items
    .select<SVGTextElement>('text.visualization-label')
    .attr('x', CELL_WIDTH / 2)
    .attr('y', -14)
    .text((datum) => datum.label ?? '');

  items
    .select<SVGTextElement>('text.visualization-marker')
    .attr('x', CELL_WIDTH / 2)
    .attr('y', CELL_HEIGHT + 42)
    .text((datum) => datum.markerNames.join(', '));
};
