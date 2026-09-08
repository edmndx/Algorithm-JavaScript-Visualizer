import { interpolateNumber, select } from 'd3';
import { applyZoomToViewBox, clampZoom, type ViewBox } from './viewport';

import {
  VISUALIZATION_TRANSITION_MS,
  VISUALIZATION_VIEW_BOX_TRANSITION,
} from './visualizationTransition';

type Viewport = { base: ViewBox; zoom: number };
const viewports = new WeakMap<SVGSVGElement, Viewport>();

function getViewport(svg: SVGSVGElement): Viewport {
  let viewport = viewports.get(svg);
  if (viewport === undefined) {
    viewport = {
      base: parseViewBox(svg.getAttribute('viewBox')) ?? [0, 0, 800, 500],
      zoom: 1,
    };
    viewports.set(svg, viewport);
  }
  return viewport;
}

export function setVisualizationZoom(svg: SVGSVGElement, zoom: number): void {
  const viewport = getViewport(svg);
  viewport.zoom = clampZoom(zoom);
  svg.setAttribute(
    'viewBox',
    serializeViewBox(applyZoomToViewBox(viewport.base, viewport.zoom)),
  );
}

function setBase(svg: SVGSVGElement, viewport: Viewport, base: ViewBox): void {
  viewport.base = base;
  svg.setAttribute(
    'viewBox',
    serializeViewBox(applyZoomToViewBox(base, viewport.zoom)),
  );
}

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
  timing: 'retain' | 'after-items' = 'retain',
): void {
  const selection = select(svg);
  selection.interrupt(VISUALIZATION_VIEW_BOX_TRANSITION);
  const viewport = getViewport(svg);
  const previous = viewport.base;
  const next = parseViewBox(target);
  if (next === null) throw new RangeError('Invalid visualization viewBox.');
  if (!retainPreviousBounds) {
    setBase(svg, viewport, next);
    return;
  }

  if (timing === 'after-items') {
    if (serializeViewBox(previous) !== target) {
      selection
        .transition(VISUALIZATION_VIEW_BOX_TRANSITION)
        .delay(VISUALIZATION_TRANSITION_MS)
        .duration(VISUALIZATION_TRANSITION_MS)
        .tween('viewBox', () => {
          const interpolate = next.map((value, index) =>
            interpolateNumber(viewport.base[index]!, value),
          );
          return (progress) => {
            setBase(svg, viewport, [
              interpolate[0]!(progress),
              interpolate[1]!(progress),
              interpolate[2]!(progress),
              interpolate[3]!(progress),
            ]);
          };
        });
    }
    return;
  }

  const minimumX = Math.min(previous[0], next[0]);
  const minimumY = Math.min(previous[1], next[1]);
  const maximumX = Math.max(previous[0] + previous[2], next[0] + next[2]);
  const maximumY = Math.max(previous[1] + previous[3], next[1] + next[3]);
  setBase(svg, viewport, [
    minimumX,
    minimumY,
    maximumX - minimumX,
    maximumY - minimumY,
  ]);
  selection
    .transition(VISUALIZATION_VIEW_BOX_TRANSITION)
    .delay(VISUALIZATION_TRANSITION_MS)
    .duration(0)
    .on('end', () => setBase(svg, viewport, next));
}
