import { select } from 'd3';

import type { HashTableSceneState } from '../scene';
import { VISUALIZATION_TRANSITION_MS, type D3RenderFunction } from './D3Scene';
import { createTransformTween } from './transformTween';
import { updateVisualizationViewBox } from './viewBoxTransition';

type HashTableEntry = HashTableSceneState['entries'][number];

type PositionedHashEntry = {
  readonly entry: HashTableEntry;
  readonly position: number;
  readonly markerNames: readonly string[];
  readonly isVisited: boolean;
};

type HashConnector = {
  readonly id: string;
  readonly bucketIndex: number;
  readonly position: number;
};

const BUCKET_WIDTH = 72;
const ENTRY_WIDTH = 152;
const ROW_HEIGHT = 72;
const CELL_HEIGHT = 54;
const ENTRY_GAP = 30;
const CONNECTOR_GAP = 34;
const PADDING = 32;

export function groupHashTableEntries(
  scene: HashTableSceneState,
): readonly (readonly HashTableEntry[])[] {
  const entriesByBucket: HashTableEntry[][] = [];
  for (let index = 0; index < scene.bucketCount; index += 1) {
    entriesByBucket.push([]);
  }

  for (const entry of scene.entries) {
    const bucket = entriesByBucket[entry.bucketIndex];
    if (bucket === undefined) {
      throw new Error(
        `Hash-table entry "${entry.id}" references bucket ${entry.bucketIndex}, which is outside SceneState bucketCount ${scene.bucketCount}.`,
      );
    }
    bucket.push(entry);
  }

  return entriesByBucket;
}

export const renderHashTable: D3RenderFunction<HashTableSceneState> = (
  svg,
  scene,
) => {
  const entriesByBucket = groupHashTableEntries(scene);

  const markerNames = new Map<string, string[]>();
  for (const [name, entryIds] of Object.entries(scene.markers)) {
    for (const entryId of entryIds) {
      const names = markerNames.get(entryId) ?? [];
      names.push(name);
      markerNames.set(entryId, names);
    }
  }

  const visitedBuckets = new Set(scene.visitedBucketIndices);
  const visitedEntries = new Set(scene.visitedEntryIds);
  const positionedEntries: PositionedHashEntry[] = [];
  const connectors: HashConnector[] = [];
  let maximumEntries = 0;

  for (const [bucketIndex, entries] of entriesByBucket.entries()) {
    maximumEntries = Math.max(maximumEntries, entries.length);
    for (const [position, entry] of entries.entries()) {
      positionedEntries.push({
        entry,
        position,
        markerNames: markerNames.get(entry.id) ?? [],
        isVisited: visitedEntries.has(entry.id),
      });
      connectors.push({
        id: entry.id,
        bucketIndex,
        position,
      });
    }
  }

  const entriesWidth = Math.max(
    ENTRY_WIDTH,
    maximumEntries * ENTRY_WIDTH + Math.max(0, maximumEntries - 1) * ENTRY_GAP,
  );
  const width =
    PADDING * 2 + BUCKET_WIDTH + CONNECTOR_GAP + entriesWidth + ENTRY_GAP;
  const height =
    PADDING * 2 + Math.max(ROW_HEIGHT, scene.bucketCount * ROW_HEIGHT);
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-hash-table').empty();
  updateVisualizationViewBox(svg, `0 0 ${width} ${height}`, hadRoot);
  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-hash-table')
    .data([null])
    .join('g')
    .attr('class', 'visualization-hash-table')
    .attr('transform', `translate(${PADDING}, ${PADDING})`);

  const bucketGroups = root
    .selectAll<SVGGElement, number>('g.visualization-hash-bucket')
    .data(Array.from({ length: scene.bucketCount }, (_, index) => index))
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-hash-bucket')
          .attr(
            'transform',
            (bucketIndex) => `translate(0, ${bucketIndex * ROW_HEIGHT})`,
          );
        group.append('rect').attr('class', 'visualization-cell');
        group.append('text').attr('class', 'visualization-value');
        return group;
      },
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr('data-bucket-index', (bucketIndex) => bucketIndex)
    .classed('visualization-visited', (bucketIndex) =>
      visitedBuckets.has(bucketIndex),
    );
  bucketGroups
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .attrTween(
      'transform',
      createTransformTween<number>(
        (bucketIndex) => `translate(0, ${bucketIndex * ROW_HEIGHT})`,
      ),
    );
  bucketGroups
    .select<SVGRectElement>('rect.visualization-cell')
    .attr('width', BUCKET_WIDTH)
    .attr('height', CELL_HEIGHT)
    .attr('rx', 8);
  bucketGroups
    .select<SVGTextElement>('text.visualization-value')
    .attr('x', BUCKET_WIDTH / 2)
    .attr('y', CELL_HEIGHT / 2)
    .attr('dy', '0.35em')
    .text((bucketIndex) => bucketIndex);

  const connectorX1 = (connector: HashConnector): number =>
    connector.position === 0
      ? BUCKET_WIDTH
      : BUCKET_WIDTH +
        CONNECTOR_GAP +
        connector.position * (ENTRY_WIDTH + ENTRY_GAP) -
        ENTRY_GAP;
  const connectorX2 = (connector: HashConnector): number =>
    BUCKET_WIDTH +
    CONNECTOR_GAP +
    connector.position * (ENTRY_WIDTH + ENTRY_GAP);
  const connectorY = (connector: HashConnector): number =>
    connector.bucketIndex * ROW_HEIGHT + CELL_HEIGHT / 2;
  const connectorLines = root
    .selectAll<SVGLineElement, HashConnector>(
      'line.visualization-hash-connector',
    )
    .data(connectors, (connector) => connector.id)
    .join(
      (enter) =>
        enter
          .append('line')
          .attr('x1', (connector) =>
            hadRoot ? BUCKET_WIDTH : connectorX1(connector),
          )
          .attr('x2', (connector) =>
            hadRoot ? BUCKET_WIDTH : connectorX2(connector),
          )
          .attr('y1', connectorY)
          .attr('y2', connectorY)
          .style('opacity', hadRoot ? 0 : 1),
      (update) => update,
      (exit) =>
        exit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .attr('x1', BUCKET_WIDTH)
          .attr('x2', BUCKET_WIDTH)
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-entry-id', (connector) => connector.id)
    .attr('class', 'visualization-edge visualization-hash-connector');
  connectorLines
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attr('x1', connectorX1)
    .attr('x2', connectorX2)
    .attr('y1', connectorY)
    .attr('y2', connectorY);

  const entryGroups = root
    .selectAll<SVGGElement, PositionedHashEntry>('g.visualization-hash-entry')
    .data(positionedEntries, (positioned) => positioned.entry.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-hash-entry')
          .style('opacity', hadRoot ? 0 : 1)
          .attr(
            'transform',
            (positioned) =>
              `translate(${hadRoot ? BUCKET_WIDTH : BUCKET_WIDTH + CONNECTOR_GAP + positioned.position * (ENTRY_WIDTH + ENTRY_GAP)}, ${positioned.entry.bucketIndex * ROW_HEIGHT})`,
          );
        group.append('rect').attr('class', 'visualization-node');
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
            createTransformTween<PositionedHashEntry>(
              (positioned) =>
                `translate(${BUCKET_WIDTH}, ${positioned.entry.bucketIndex * ROW_HEIGHT})`,
            ),
          )
          .style('opacity', 0)
          .remove(),
    )
    .attr('data-entry-id', (positioned) => positioned.entry.id)
    .classed('visualization-visited', (positioned) => positioned.isVisited)
    .classed(
      'visualization-marked',
      (positioned) => positioned.markerNames.length > 0,
    );
  entryGroups
    .transition()
    .duration(VISUALIZATION_TRANSITION_MS)
    .style('opacity', 1)
    .attrTween(
      'transform',
      createTransformTween<PositionedHashEntry>(
        (positioned) =>
          `translate(${BUCKET_WIDTH + CONNECTOR_GAP + positioned.position * (ENTRY_WIDTH + ENTRY_GAP)}, ${positioned.entry.bucketIndex * ROW_HEIGHT})`,
      ),
    );
  entryGroups
    .select<SVGRectElement>('rect.visualization-node')
    .attr('width', ENTRY_WIDTH)
    .attr('height', CELL_HEIGHT)
    .attr('rx', 8);
  entryGroups
    .select<SVGTextElement>('text.visualization-value')
    .attr('x', ENTRY_WIDTH / 2)
    .attr('y', CELL_HEIGHT / 2 - 4)
    .attr('dy', '0.35em')
    .text(
      (positioned) =>
        `${String(positioned.entry.key)} → ${String(positioned.entry.value)}`,
    );
  entryGroups
    .select<SVGTextElement>('text.visualization-marker')
    .attr('x', ENTRY_WIDTH / 2)
    .attr('y', CELL_HEIGHT - 7)
    .text((positioned) => positioned.markerNames.join(', '));
};
