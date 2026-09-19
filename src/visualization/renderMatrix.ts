import { select } from 'd3';

import type { MatrixSceneState } from '../scene';
import { VISUALIZATION_TRANSITION_MS, type D3RenderFunction } from './D3Scene';
import { createTransformTween } from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';

type MatrixCellDatum = {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly value: string;
  readonly markerNames: readonly string[];
  readonly isCompared: boolean;
};

const CELL_SIZE = 64;
const CELL_GAP = 10;
const AXIS_GUTTER = 36;
const PADDING = 32;

function positionKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function matrixCellTransform(cell: MatrixCellDatum, rowOffset = 0): string {
  return `translate(${cell.column * (CELL_SIZE + CELL_GAP)}, ${(cell.row + rowOffset) * (CELL_SIZE + CELL_GAP)})`;
}

export const renderMatrix: D3RenderFunction<MatrixSceneState> = (
  svg,
  scene,
) => {
  const markerNames = new Map<string, string[]>();
  for (const [name, positions] of Object.entries(scene.markers)) {
    for (const position of positions) {
      const key = positionKey(position.row, position.column);
      const names = markerNames.get(key) ?? [];
      names.push(name);
      markerNames.set(key, names);
    }
  }

  const comparedKeys = new Set(
    (scene.comparedPositions ?? []).map((position) =>
      positionKey(position.row, position.column),
    ),
  );
  const cells: MatrixCellDatum[] = [];
  let columnCount = 0;

  for (const [row, values] of scene.values.entries()) {
    columnCount = Math.max(columnCount, values.length);
    for (const [column, value] of values.entries()) {
      const key = positionKey(row, column);
      const id = scene.itemIds[row]?.[column];
      if (id === undefined) {
        throw new Error(
          `Matrix item identity at (${row}, ${column}) is missing.`,
        );
      }
      cells.push({
        id,
        row,
        column,
        value: String(value),
        markerNames: markerNames.get(key) ?? [],
        isCompared: comparedKeys.has(key),
      });
    }
  }

  const rowCount = scene.values.length;
  const gridWidth = Math.max(CELL_SIZE, columnCount * (CELL_SIZE + CELL_GAP));
  const gridHeight = Math.max(CELL_SIZE, rowCount * (CELL_SIZE + CELL_GAP));
  const width = PADDING * 2 + AXIS_GUTTER + gridWidth;
  const height = PADDING * 2 + AXIS_GUTTER + gridHeight;
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-matrix').empty();
  updateVisualizationViewBox(svg, `0 0 ${width} ${height}`, hadRoot);
  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-matrix')
    .data([null])
    .join('g')
    .attr('class', 'visualization-matrix')
    .attr(
      'transform',
      `translate(${PADDING + AXIS_GUTTER}, ${PADDING + AXIS_GUTTER})`,
    );

  root
    .selectAll<SVGTextElement, number>('text.visualization-matrix-column')
    .data(Array.from({ length: columnCount }, (_, index) => index))
    .join('text')
    .attr('class', 'visualization-index visualization-matrix-column')
    .attr('x', (column) => column * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2)
    .attr('y', -16)
    .text((column) => column);

  root
    .selectAll<SVGTextElement, number>('text.visualization-matrix-row')
    .data(Array.from({ length: rowCount }, (_, index) => index))
    .join('text')
    .attr('class', 'visualization-index visualization-matrix-row')
    .attr('x', -20)
    .attr('y', (row) => row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2)
    .attr('dy', '0.35em')
    .text((row) => row);

  const groups = root
    .selectAll<SVGGElement, MatrixCellDatum>('g.visualization-matrix-cell')
    .data(cells, (cell) => cell.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-matrix-cell')
          .style('opacity', hadRoot ? 0 : 1)
          .attr('transform', (cell) =>
            matrixCellTransform(cell, hadRoot ? -1 : 0),
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
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-item-id', (cell) => cell.id)
    .classed('visualization-compared', (cell) => cell.isCompared)
    .classed('visualization-marked', (cell) => cell.markerNames.length > 0);

  groups
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'transform',
      createTransformTween<MatrixCellDatum>((cell) =>
        matrixCellTransform(cell),
      ),
    );

  groups
    .select<SVGRectElement>('rect.visualization-cell')
    .attr('width', CELL_SIZE)
    .attr('height', CELL_SIZE)
    .attr('rx', 8);
  groups
    .select<SVGTextElement>('text.visualization-value')
    .attr('x', CELL_SIZE / 2)
    .attr('y', CELL_SIZE / 2 - 5)
    .attr('dy', '0.35em')
    .text((cell) => cell.value);
  groups
    .select<SVGTextElement>('text.visualization-marker')
    .attr('x', CELL_SIZE / 2)
    .attr('y', CELL_SIZE - 8)
    .text((cell) => cell.markerNames.join(', '));
};
