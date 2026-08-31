import { select } from 'd3';

import {
  VISUALIZATION_TRANSITION_MS,
  VISUALIZATION_VIEW_BOX_TRANSITION,
} from './visualizationTransition';

type ViewBox = readonly [number, number, number, number];

function parseViewBox(value: string | null): ViewBox | null {
  if (value === null) return null;
  const parts = value.trim().split(/\s+/).map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isFinite(part)) ||
    parts[2]! <= 0 ||
    parts[3]! <= 0
  ) {
    return null;
  }
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function serializeViewBox(viewBox: ViewBox): string {
  return viewBox.join(' ');
}

export function updateVisualizationViewBox(
  svg: SVGSVGElement,
  target: string,
  retainPreviousBounds: boolean,
): void {
  const selection = select(svg);
  selection.interrupt(VISUALIZATION_VIEW_BOX_TRANSITION);
  const previous = parseViewBox(selection.attr('viewBox'));
  const next = parseViewBox(target);
  if (!retainPreviousBounds || previous === null || next === null) {
    selection.attr('viewBox', target);
    return;
  }

  const minimumX = Math.min(previous[0], next[0]);
  const minimumY = Math.min(previous[1], next[1]);
  const maximumX = Math.max(previous[0] + previous[2], next[0] + next[2]);
  const maximumY = Math.max(previous[1] + previous[3], next[1] + next[3]);
  selection
    .attr(
      'viewBox',
      serializeViewBox([
        minimumX,
        minimumY,
        maximumX - minimumX,
        maximumY - minimumY,
      ]),
    )
    .transition(VISUALIZATION_VIEW_BOX_TRANSITION)
    .delay(VISUALIZATION_TRANSITION_MS)
    .duration(0)
    .attr('viewBox', target);
}
