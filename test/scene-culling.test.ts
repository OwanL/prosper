import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneModel } from '../src/ui/model';
import { Scene } from '../src/ui/Scene';

// Render the real scene at camera states without mounting animation/DOM effects.
const camera = vi.hoisted(() => ({ zoom: 1, pan: { x: 0, y: 0 } }));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useState: (initial: unknown) => react.useState(
      initial === 1 ? camera.zoom :
      initial && typeof initial === 'object' && 'x' in initial && 'y' in initial
        ? camera.pan : initial,
    ),
  };
});

function fixture(): SceneModel {
  const wrap = <T>(value: T) => ({ value, remembered: false, seenTick: 5 });
  return {
    width: 100, height: 100, tick: 5, tiles: null,
    citizens: Array.from({ length: 33 }, (_, i) => wrap({
      id: `citizen-${i}`, name: `Name ${i}`, x: i, y: 50,
      alive: true, health: 100, activity: 'idle', color: '#abcdef',
    })),
    deposits: [wrap({ id: 'deposit-edge', x: 0, y: 50, resource: 'wood', tier: 1, stock: 10, capacity: 10, regrowAt: 0 })],
    buildings: [wrap({ id: 'building-edge', x: 0, y: 50, kind: 'wall', tier: 1, health: 100, maxHealth: 100, ownerId: null, materials: {} })],
    houses: [wrap({ id: 'house-edge', x: 0, y: 50, tier: 1, health: 100, maxHealth: 100, ownerId: 'citizen-0' })],
    signs: [wrap({ id: 'sign-edge', x: 0, y: 50, territoryId: 'territory', woodTier: 1, health: 100, maxHealth: 100 })],
    loot: [wrap({ id: 'loot-edge', x: 0, y: 50, citizenName: 'Lost Citizen' })],
    claims: [{ id: 'claim-edge', ownerId: 'citizen-0', areas: [0, 40, 60, 60], resource: 'wood', stance: 'exclusive', accessPrice: 0, createdTick: 0, expiresTick: 100 }],
  };
}

function render(model = fixture(), layers = true) {
  return renderToStaticMarkup(createElement(Scene, {
    model, selected: 'citizen-0', select: () => {}, follow: false,
    labels: layers, running: false, territories: layers, resources: layers,
  }));
}

describe('scene camera does not cull world content', () => {
  beforeEach(() => {
    camera.zoom = 1;
    camera.pan = { x: 0, y: 0 };
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [1, 0, 0],
    [5, 0, 0],
    [5, -37.2, 0], // Left edge 2.8: origin outside old 2-unit margin; claim intersects.
    [5, 35, -35],
  ])('retains entities and intersecting territory at zoom %s / pan %s,%s', (zoom, x, y) => {
    camera.zoom = zoom;
    camera.pan = { x, y };
    const html = render();
    for (const id of ['deposit-edge', 'building-edge', 'house-edge', 'sign-edge', 'loot-edge', 'citizen-0'])
      expect(html).toContain(`data-entity-id="${id}"`);
    expect(html).toContain('data-testid="claim-claim-edge"');
    expect(html).toContain('class="territory-labels"');
    expect(html.match(/class="nameplate"/g)).toHaveLength(33);
    expect(html).toContain('class="resource-overlay"');
  });

  it('keeps user layer switches and knowledge projections authoritative', () => {
    expect(render(fixture(), false)).not.toContain('class="nameplate"');
    expect(render(fixture(), false)).not.toContain('claim-claim-edge');
    expect(render(fixture(), false)).not.toContain('class="resource-overlay"');
    const knowledge = { ...fixture(), tiles: [], deposits: [], buildings: [], houses: [], signs: [], loot: [], citizens: [] };
    const html = render(knowledge);
    expect(html).not.toContain('data-entity-id=');
    expect(html).not.toContain('claim-claim-edge');
    expect(html).not.toContain('spectator-terrain');
  });
});
