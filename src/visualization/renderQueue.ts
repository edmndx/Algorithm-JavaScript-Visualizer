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
const PADDING = 28;
const PITCH = ITEM_WIDTH + ITEM_GAP;
// Presentation history only: scene data continues to come from the reducer.
const previousQueues = new WeakMap<
  SVGSVGElement,
  {
    scene: QueueSceneState;
    left: number;
    right: number;
  }
>();

export const renderQueue: D3RenderFunction<QueueSceneState> = (
  svg,
  scene,
  options,
) => {
  const selection = select(svg);
  const hadRoot = !selection.select('g.visualization-queue').empty();
  const previous = hadRoot ? previousQueues.get(svg) : undefined;
  const sameIds = (ids: readonly string[]) =>
    ids.length === scene.itemIds.length &&
    ids.every((id, index) => id === scene.itemIds[index]);
  const mayAnimate =
    previous !== undefined &&
    options?.animate !== false &&
    previous.scene.isPlaceholder !== true;
  const enqueue =
    mayAnimate &&
    scene.nextItemId === previous.scene.nextItemId + 1 &&
    sameIds([
      ...previous.scene.itemIds,
      `queue-item-${previous.scene.nextItemId}`,
    ]);
  const removal =
    mayAnimate &&
    scene.nextItemId === previous.scene.nextItemId &&
    scene.lastRemoval !== null &&
    scene.lastRemoval.itemId !== previous.scene.lastRemoval?.itemId &&
    scene.lastRemoval.itemId ===
      (scene.lastRemoval.end === 'front'
        ? previous.scene.itemIds[0]
        : previous.scene.itemIds.at(-1)) &&
    sameIds(
      scene.lastRemoval.end === 'front'
        ? previous.scene.itemIds.slice(1)
        : previous.scene.itemIds.slice(0, -1),
    );
  const adjacent =
    mayAnimate && (enqueue || removal || sameIds(previous.scene.itemIds));
  selection.selectAll('*').interrupt();
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
  // Motion padding contains a one-cell entrance/exit; it is not a label gutter.
  const width = Math.max(480, contentWidth + 2 * (PADDING + PITCH));
  const height = Math.max(200, PADDING * 2 + ITEM_HEIGHT);
  const left = adjacent ? previous.left : (contentWidth - width) / 2;
  const right = adjacent
    ? Math.max(previous.right, contentWidth + PADDING + PITCH)
    : left + width;
  previousQueues.set(svg, { scene, left, right });
  updateVisualizationViewBox(
    svg,
    `${left} 0 ${right - left} ${height}`,
    adjacent,
    'after-items',
  );
  const root = selection
    .selectAll<SVGGElement, null>('g.visualization-queue')
    .data([null])
    .join('g')
    .attr('class', 'visualization-queue')
    .attr('transform', `translate(0, ${(height - ITEM_HEIGHT) / 2})`);

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

  const groups = root
    .selectAll<SVGGElement, QueueItemDatum>('g.visualization-queue-item')
    .data(items, (item) => item.id)
    .join(
      (enter) => {
        const group = enter
          .append('g')
          .attr('class', 'visualization-queue-item')
          .style('opacity', enqueue ? 0 : 1)
          .attr('transform', (item) =>
            enqueue
              ? `translate(${item.index * PITCH + PITCH}, 0)`
              : `translate(${item.index * (ITEM_WIDTH + ITEM_GAP)}, 0)`,
          );
        group.append('rect').attr('class', 'visualization-cell');
        group.append('text').attr('class', 'visualization-value');
        group.append('text').attr('class', 'visualization-marker');
        return group;
      },
      (update) => update,
      (exit) => {
        const semanticExit = exit.filter(
          (item) => removal && item.id === scene.lastRemoval?.itemId,
        );
        exit
          .filter((item) => !removal || item.id !== scene.lastRemoval?.itemId)
          .remove();
        const transition = semanticExit
          .transition()
          .duration(VISUALIZATION_TRANSITION_MS)
          .style('opacity', 0)
          .remove();
        transition.attrTween(
          'transform',
          createTransformTween<QueueItemDatum>(
            (item) =>
              `translate(${
                scene.lastRemoval?.end === 'rear'
                  ? (item.index + 1) * (ITEM_WIDTH + ITEM_GAP)
                  : -ITEM_WIDTH - ITEM_GAP
              }, 0)`,
          ),
        );
        return exit;
      },
    )
    .attr('data-item-id', (item) => item.id)
    .classed('visualization-peeked', (item) => item.isPeeked)
    .classed('visualization-marked', (item) => item.markerNames.length > 0);

  if (enqueue || removal) {
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
  } else {
    groups
      .style('opacity', 1)
      .attr('transform', (item) => `translate(${item.index * PITCH}, 0)`);
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
};
