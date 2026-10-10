import type { Point } from '../shared/types';

export interface Viewport { x: number; y: number; width: number; height: number }
export const clampZoom = (zoom: number) => Math.min(5, Math.max(1, Number.isFinite(zoom) ? zoom : 1));

/** SVG presentation coordinates, never simulation coordinates. */
export function boundViewport(view: Viewport, width: number, height: number): Viewport {
  const w = Math.min(width, Math.max(0.001, view.width));
  const h = Math.min(height, Math.max(0.001, view.height));
  return { x: Math.max(0, Math.min(width - w, view.x)), y: Math.max(0, Math.min(height - h, view.y)), width: w, height: h };
}

export function panViewport(view: Viewport, delta: Point, width: number, height: number) {
  return boundViewport({ ...view, x: view.x + delta.x, y: view.y + delta.y }, width, height);
}

export function zoomViewport(view: Viewport, anchor: Point, zoom: number, width: number, height: number) {
  const w = width / clampZoom(zoom), h = Math.min(height, w * view.height / view.width);
  return boundViewport({ x: anchor.x - (anchor.x - view.x) / view.width * w, y: anchor.y - (anchor.y - view.y) / view.height * h, width: w, height: h }, width, height);
}
