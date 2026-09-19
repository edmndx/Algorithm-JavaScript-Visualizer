import { createContext } from 'react';

export type ViewBox = readonly [number, number, number, number];
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.2;
export const VisualizationZoomContext = createContext(1);

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom)
    ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
    : 1;
}

export function applyZoomToViewBox(base: ViewBox, zoom: number): ViewBox {
  if (
    base.some((value) => !Number.isFinite(value)) ||
    base[2] <= 0 ||
    base[3] <= 0
  ) {
    throw new RangeError(
      'Visualization bounds must be finite with positive dimensions.',
    );
  }
  const scale = clampZoom(zoom);
  const width = base[2] / scale;
  const height = base[3] / scale;
  return [
    base[0] + (base[2] - width) / 2,
    base[1] + (base[3] - height) / 2,
    width,
    height,
  ];
}
