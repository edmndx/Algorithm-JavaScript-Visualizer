import { select } from 'd3';

import type { MatrixSceneState } from '../scene';
import { matrixMarkerSchema } from '../protocol';
import type { MatrixMarker } from '../protocol';
import type { D3RenderFunction } from './D3Scene';
import { createTransformTween } from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';
import { VISUALIZATION_TRANSITION_MS } from './visualizationTransition';

type MatrixCellDatum = {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly value: string;
  readonly markerNames: readonly MatrixMarker[];
  readonly isVisited: boolean;
  readonly isCompared: boolean;
};

const CELL_SIZE = 64;
const CELL_GAP = 10;
const AXIS_GUTTER = 36;
const PADDING = 32;

function positionKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function matrixCellTransform(cell: MatrixCellDatum): string {
  return `translate(${cell.column * (CELL_SIZE + CELL_GAP)}, ${cell.row * (CELL_SIZE + CELL_GAP)})`;
}

export const renderMatrix: D3RenderFunction<MatrixSceneState> = (
  svg,
  scene,
  context,
) => {
  const markerNames = new Map<string, MatrixMarker[]>();
  for (const name of matrixMarkerSchema.options) {
    for (const position of scene.markers[name] ?? []) {
      const key = positionKey(position.row, position.column);
      const names = markerNames.get(key) ?? [];
      names.push(name);
      markerNames.set(key, names);
    }
  }

  const visitedKeys = new Set(
    scene.visitedPositions.map((position) =>
      positionKey(position.row, position.column),
    ),
  );

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
      const cellMarkerNames = markerNames.get(key) ?? [];
      cells.push({
        id,
        row,
        column,
        value: String(value),
        markerNames: cellMarkerNames,
        isVisited: visitedKeys.has(key),
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
  updateVisualizationViewBox(
    svg,
    `0 0 ${width} ${height}`,
    hadRoot && context?.animate === true,
  );
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
    .text((column) => scene.columnLabels?.[column] ?? column);

  root
    .selectAll<SVGTextElement, number>('text.visualization-matrix-row')
    .data(Array.from({ length: rowCount }, (_, index) => index))
    .join('text')
    .attr('class', 'visualization-index visualization-matrix-row')
    .attr('x', -20)
    .attr('y', (row) => row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2)
    .attr('dy', '0.35em')
    .text((row) => scene.rowLabels?.[row] ?? row);

  const groups = root
    .selectAll<SVGGElement, MatrixCellDatum>('g.visualization-matrix-cell')
    .data(cells, (cell) => cell.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-matrix-cell')
          .attr('transform', (cell) => matrixCellTransform(cell));
        group.append('rect').attr('class', 'visualization-cell');
        group.append('text').attr('class', 'visualization-number');
        return group;
      },
      (update) => update,
    )
    .attr('data-item-id', (cell) => cell.id)
    .style('opacity', 1)
    .classed('visualization-compared', (cell) => cell.isCompared)
    .classed('visualization-visited', (cell) => cell.isVisited);

  for (const marker of matrixMarkerSchema.options) {
    groups.classed(`visualization-matrix-${marker}`, (cell) =>
      cell.markerNames.includes(marker),
    );
  }

  if (context?.animate)
    groups
      .transition()
      .duration(VISUALIZATION_TRANSITION_MS)
      .attrTween(
        'transform',
        createTransformTween<MatrixCellDatum>((cell) =>
          matrixCellTransform(cell),
        ),
      );
  else groups.attr('transform', (cell) => matrixCellTransform(cell));

  groups
    .select<SVGRectElement>('rect.visualization-cell')
    .attr('width', CELL_SIZE)
    .attr('height', CELL_SIZE)
    .attr('rx', 8);
  groups
    .select<SVGTextElement>('text.visualization-number')
    .attr('x', CELL_SIZE / 2)
    .attr('y', CELL_SIZE / 2)
    .attr('dy', '0.35em')
    .text((cell) => cell.value);
};
