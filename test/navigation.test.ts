import { describe, expect, it } from 'vitest';
import { boundViewport, clampZoom, panViewport, zoomViewport } from '../src/ui/navigation';

describe('presentation camera navigation', () => {
  it('bounds zoom to 1–5 including invalid input', () => {
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(99)).toBe(5);
    expect(clampZoom(NaN)).toBe(1);
  });
  it('anchors zoom at the pointer without advancing any world state', () => {
    const view = { x: 0, y: 0, width: 100, height: 80 };
    const anchor = { x: 40, y: 20 };
    const next = zoomViewport(view, anchor, 2, 100, 80);
    expect((anchor.x - next.x) / next.width).toBe(0.4);
    expect((anchor.y - next.y) / next.height).toBe(0.25);
    expect(view).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });
  it('clamps pan immediately so reversing at an edge is responsive', () => {
    const view = { x: 20, y: 10, width: 50, height: 40 };
    const edge = panViewport(view, { x: 10000, y: -10000 }, 100, 80);
    expect(edge).toEqual({ x: 50, y: 0, width: 50, height: 40 });
    expect(panViewport(edge, { x: -2, y: 2 }, 100, 80)).toEqual({ x: 48, y: 2, width: 50, height: 40 });
    expect(boundViewport({ x: -4, y: -5, width: 200, height: 200 }, 100, 80)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });
  it('retains cinematic presentation aspect on takeover', () => {
    const view = { x: 10, y: 20, width: 50, height: 20 };
    const anchor = { x: 35, y: 30 };
    const next = zoomViewport(view, anchor, 4, 100, 80);
    expect(next).toEqual({ x: 22.5, y: 25, width: 25, height: 10 });
  });
});
