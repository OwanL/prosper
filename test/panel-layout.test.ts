import { describe, expect, it } from 'vitest';
import {
  clampTracks,
  DEFAULT_LAYOUT,
  PANEL_LAYOUT_KEY,
  readLayout,
  resizeTracks,
  saveLayout,
} from '../src/ui/PanelResize';

describe('spectator panel layout', () => {
  it('resizes only adjacent tracks and respects both limits', () => {
    expect(resizeTracks([48, 25, 27], 0, 100, [30, 20, 20])).toEqual([53, 20, 27]);
    expect(resizeTracks([48, 25, 27], 0, -100, [30, 20, 20])).toEqual([30, 43, 27]);
    expect(resizeTracks([34, 33, 33], 1, 2, [10, 10, 10])).toEqual([34, 35, 31]);
  });
  it('clamps restored sizes on smaller viewports without overflowing', () => {
    const result = clampTracks([80, 10, 10], [30, 25, 25]);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    expect(result[1]).toBeGreaterThanOrEqual(25);
    expect(result[2]).toBeGreaterThanOrEqual(25);
    const tiny = clampTracks([80, 10, 10], [90, 90, 90]);
    expect(tiny.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    expect(tiny.every((n) => n > 0)).toBe(true);
  });
  it('persists and restores a layout independently of world state', () => {
    let key = '';
    let saved = '';
    const layout = { ...DEFAULT_LAYOUT, columns: [50, 20, 30] };
    saveLayout(
      {
        setItem: (k, value) => {
          key = k;
          saved = value;
        },
      },
      layout,
    );
    expect(key).toBe(PANEL_LAYOUT_KEY);
    expect(readLayout({ getItem: () => saved })).toEqual(layout);
  });
  it('ignores corrupt storage and invalid tracks while retaining valid groups', () => {
    for (const saved of [
      'broken',
      'null',
      'false',
      '"string"',
      '{"columns":[-1,50,51]}',
      '{"columns":[1,2]}',
    ]) {
      expect(readLayout({ getItem: () => saved })).toEqual(DEFAULT_LAYOUT);
    }
    expect(readLayout({ getItem: () => '{"columns":[50,20,30],"world":[0,50,50]}' })).toEqual({
      ...DEFAULT_LAYOUT,
      columns: [50, 20, 30],
    });
    expect(readLayout({ getItem: () => '{"columns":[1e999,20,30]}' })).toEqual(DEFAULT_LAYOUT);
  });
  it('remains usable when storage access fails', () => {
    expect(
      readLayout({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_LAYOUT);
    expect(() =>
      saveLayout(
        {
          setItem: () => {
            throw new Error('quota');
          },
        },
        DEFAULT_LAYOUT,
      ),
    ).not.toThrow();
  });
});
