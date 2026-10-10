import { describe, expect, it } from 'vitest';
import {
  ENGINE_DEFAULTS,
  ENGINE_LAYOUT_KEY,
  OLD_LAYOUT_KEY,
  MAP_MINIMUM,
  fitEngineLayout,
  readEngineLayout,
  resetEngineLayout,
  saveEngineLayout,
} from '../src/ui/EngineLayout';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe('world-first engine layout', () => {
  it('starts with pixel defaults independent of the old dashboard layout', () => {
    const store = storage();
    store.setItem(OLD_LAYOUT_KEY, JSON.stringify({ columns: [5, 90, 5] }));
    expect(readEngineLayout(store)).toEqual(ENGINE_DEFAULTS);
    expect(fitEngineLayout(ENGINE_DEFAULTS, 1440, 800)).toMatchObject({
      left: 220,
      right: 300,
      dock: 240,
      mapWidth: 908,
      mapHeight: 554,
    });
  });
  it('persists independent sizes and collapse state', () => {
    const store = storage();
    const sizes = { ...ENGINE_DEFAULTS, left: 260, right: 340, dock: 180, rightClosed: true };
    saveEngineLayout(store, sizes);
    expect(readEngineLayout(store)).toEqual(sizes);
    const fit = fitEngineLayout(sizes, 1200, 740);
    expect(fit.right).toBe(28);
    expect(fit.left).toBe(260);
    expect(fit.mapWidth).toBe(900);
  });
  it('protects real central width and map-height reserve against oversized saved panels', () => {
    for (const width of [901, 1024, 1280, 1920]) {
      for (const height of [480, 600, 800, 1080]) {
        const fit = fitEngineLayout(
          { ...ENGINE_DEFAULTS, left: 480, right: 600, dock: 560 },
          width,
          height,
        );
        expect(fit.mapWidth).toBeGreaterThanOrEqual(MAP_MINIMUM.width - 0.001);
        expect(fit.mapHeight).toBeGreaterThanOrEqual(MAP_MINIMUM.height - 0.001);
        expect(fit.left + fit.right + fit.mapWidth + 12).toBeCloseTo(width);
        expect(fit.dock + fit.mapHeight + 6).toBeCloseTo(height);
      }
    }
  });
  it('collapses independently without forgetting expanded sizes', () => {
    const saved = { ...ENGINE_DEFAULTS, leftClosed: true, dockClosed: true };
    const fit = fitEngineLayout(saved, 1200, 740);
    expect(fit).toMatchObject({ left: 28, right: 300, dock: 28 });
    expect(saved.left).toBe(220);
    expect(saved.dock).toBe(240);
  });
  it('rejects malformed storage and clamps finite sizes', () => {
    const store = storage();
    store.setItem(ENGINE_LAYOUT_KEY, 'broken');
    expect(readEngineLayout(store)).toEqual(ENGINE_DEFAULTS);
    store.setItem(
      ENGINE_LAYOUT_KEY,
      JSON.stringify({ left: -3, right: 50000, dock: '240', leftClosed: 'yes' }),
    );
    expect(readEngineLayout(store)).toEqual({ ...ENGINE_DEFAULTS, left: 160, right: 600 });
  });
  it('reset clears both new and legacy keys without touching other preferences', () => {
    const store = storage();
    store.setItem(ENGINE_LAYOUT_KEY, '{}');
    store.setItem(OLD_LAYOUT_KEY, '{}');
    store.setItem('prosper.ui.selected', 'ada');
    expect(resetEngineLayout(store)).toEqual(ENGINE_DEFAULTS);
    expect(store.getItem(ENGINE_LAYOUT_KEY)).toBeNull();
    expect(store.getItem(OLD_LAYOUT_KEY)).toBeNull();
    expect(store.getItem('prosper.ui.selected')).toBe('ada');
  });
  it('storage failures do not break layout', () => {
    const denied = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readEngineLayout(denied)).toEqual(ENGINE_DEFAULTS);
    expect(() => saveEngineLayout(denied, ENGINE_DEFAULTS)).not.toThrow();
    expect(resetEngineLayout(denied)).toEqual(ENGINE_DEFAULTS);
  });
});
