import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Citizen, House, Point, StructuredMemory, TreeTaskState, World } from '../src/shared/types';
import { createWorld, dispatch, ensureComposedBody } from '../src/world/core';
import { updateKnowledge, observe } from '../src/world/observation';
import { Scene } from '../src/ui/Scene';
import { Inspector } from '../src/ui/CitizenInspector';
import { projectSpectatorWorld } from '../src/server/snapshot';
import {
  markedTerritories,
  membershipIn,
  projectObservation,
  projectWorld,
  territoryColor,
  citizenColor,
} from '../src/ui/model';

const P = (x: number, y: number): Point => ({ x, y });

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));
afterEach(() => vi.unstubAllGlobals());

function composedFixture() {
  // Manual composed mode follows the established composed-test fixture pattern;
  // it avoids depending on createWorld's controller plumbing while runtime
  // wiring evolves. Bodies rest and mint seeded mind shells like a fresh world.
  const world = createWorld({ seed: 11, population: 4 });
  world.controllerMode = 'composed';
  const [founder, other] = Object.values(world.citizens);
  for (const citizen of Object.values(world.citizens)) {
    ensureComposedBody(world, citizen);
    citizen.inventory = { 'food:1': 12, 'wood:1': 60, 'wood:2': 30, 'fibre:1': 30 };
  }
  return { world, founder, other };
}

const know = (citizen: Citizen, points: Point[]) => {
  for (const point of points)
    citizen.knowledge[`${point.x},${point.y}`] = {
      x: point.x,
      y: point.y,
      seenTick: 0,
      citizens: [],
      deposits: [],
      buildings: [],
      loot: [],
    };
};

function foundTerritory(world: World, founder: Citizen): void {
  const tiles = [
    P(founder.x - 1, founder.y - 1),
    P(founder.x, founder.y - 1),
    P(founder.x - 1, founder.y - 2),
  ];
  know(founder, tiles);
  // Route through the real dispatcher; territory founding settles synchronously.
  const result = dispatch(world, founder.id, { type: 'create-territory', tiles, woodTier: 1 });
  expect(result.ok).toBe(true);
  expect(Object.keys(world.signs ?? {})).toHaveLength(3);
}

function placeHouse(world: World, ownerId: string, x: number, y: number): House {
  const house: House = {
    id: `house-${x}-${y}`,
    ownerId,
    x,
    y,
    tier: 1,
    health: 100,
    maxHealth: 100,
  };
  (world.houses ??= {})[house.id] = house;
  return house;
}

function renderScene(model: ReturnType<typeof projectWorld>, selected: string, territories = true) {
  return renderToStaticMarkup(
    createElement(Scene, {
      model,
      selected,
      select: () => {},
      follow: false,
      labels: false,
      running: false,
      territories,
    }),
  );
}

describe('composed world projection', () => {
  it('projects marked-tile territories, signs and houses as scene evidence', () => {
    const { world, founder } = composedFixture();
    foundTerritory(world, founder);
    const house = placeHouse(world, founder.id, founder.x, founder.y + 1);
    const model = projectWorld(world);
    expect(model.territories).toHaveLength(1);
    expect(model.territories![0].ownerId).toBe(founder.id);
    expect(model.signs).toHaveLength(3);
    expect(model.houses).toHaveLength(1);
    expect(model.claims ?? []).toHaveLength(0);
    const markup = renderScene(model, founder.id);
    expect((markup.match(/territory-tile-/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain('Marked territory of');
    expect(markup).toContain('Territory sign of');
    expect(markup).toContain(house.id);
    expect(markup).toContain('House of');
    // The composed world renders membership coloring, not legacy claim shapes.
    expect(markup).not.toContain('data-testid="claim-');
    expect(markup).not.toContain('data-testid="contested-overlap"');
  });

  it('colors marked tiles by owner and membership instead of legacy claims', () => {
    const { world, founder } = composedFixture();
    foundTerritory(world, founder);
    const model = projectWorld(world);
    expect(markedTerritories(model)).toHaveLength(3);
    const territory = model.territories![0];
    expect(membershipIn(territory, founder.id)).toBe('owner');
    expect(membershipIn(territory, 'stranger')).toBe('none');
    const markup = renderScene(model, founder.id);
    expect(markup).toContain(`Marked territory of ${founder.name}`);
    expect(markup).toContain('selected: owner');
    expect(markup).toContain('fill-opacity="0.48"');
    const member = model.citizens.find(({ value }) => value.id === founder.id)!.value;
    expect(citizenColor(member)).toBe(territoryColor(territory));
    expect(markup).toContain(`fill="${citizenColor(member)}"`);
    expect(world.citizens[founder.id].color).toBe(member.color);
  });

  it('unaffiliated selection sees foreign territory tints dashed but readable', () => {
    const { world, founder, other } = composedFixture();
    foundTerritory(world, founder);
    const markup = renderScene(projectWorld(world), other.id);
    expect(markup).toContain('selected: none');
    expect(markup).toContain('outside membership');
    expect(markup).toContain('stroke-dasharray="0.12 0.1"');
  });
});

describe('knowledge view privacy for composed civic data', () => {
  it('projects observation civic data with dated remembered evidence', () => {
    const dimensions = { width: 10, height: 10 };
    const sign = {
      id: 'sign-1',
      territoryId: 'territory-1',
      x: 4,
      y: 4,
      woodTier: 1 as const,
      health: 16,
      maxHealth: 16,
    };
    const house = {
      id: 'house-1',
      ownerId: 'a',
      x: 4,
      y: 4,
      tier: 2 as const,
      health: 90,
      maxHealth: 100,
    };
    const territory = { id: 'territory-1', ownerId: 'a', createdTick: 0, members: {}, admissions: [] };
    const observation = {
      tick: 30,
      citizen: { id: 'b' },
      visible: [],
      remembered: [
        { x: 4, y: 4, seenTick: 12, citizens: [], deposits: [], buildings: [], loot: [] },
      ],
      territories: [territory],
      signs: [sign],
      houses: [house],
    };
    const model = projectObservation(observation as never, dimensions);
    expect(model.territories).toHaveLength(1);
    expect(model.signs![0]).toMatchObject({ remembered: true, seenTick: 12 });
    expect(model.houses![0]).toMatchObject({ remembered: true, seenTick: 12 });
    expect(markedTerritories(model)).toHaveLength(1);
  });

  it('keeps foreign territory evidence out of an unrelated observer scene', () => {
    const { world, founder, other } = composedFixture();
    foundTerritory(world, founder);
    updateKnowledge(world);
    const far = observe(world, other.id);
    expect(far.signs ?? []).toHaveLength(0);
    expect(far.territories ?? []).toHaveLength(0);
    const farModel = projectObservation(far, world);
    expect(farModel.signs).toHaveLength(0);
    const farMarkup = renderScene(farModel, other.id);
    expect(farMarkup).not.toContain('territory-tile-');
    // The founder's own observation exposes the territory through known signs.
    const near = observe(world, founder.id);
    expect((near.signs ?? []).length).toBeGreaterThan(0);
    const nearModel = projectObservation(near, world);
    expect(nearModel.signs!.length).toBe((near.signs ?? []).length);
    const nearMarkup = renderScene(nearModel, founder.id);
    expect(nearMarkup).toContain('territory-tint');
    const hidden = renderScene(nearModel, founder.id, false);
    expect(hidden).not.toContain('territory-tint');
    expect(hidden).not.toContain('territory-tile-');
    // Borders do not erase known signs or the rest of the knowledge map.
    expect(hidden).toContain('Territory sign of');
    expect(renderScene(projectWorld(world), founder.id, false)).not.toContain('territory-tile-');
  });
});

describe('composed citizen dossier', () => {
  it('shows ten dispositions, current task, rest and meaningful memories', () => {
    const { founder } = composedFixture();
    const task: TreeTaskState = {
      id: 'task-1',
      definitionId: 'gather-wood',
      request: {
        id: 'request-1',
        resource: 'wood',
        tier: 1,
        quantity: 4,
        allowMarket: true,
        purpose: 'Stock firewood for the household',
        urgency: 'routine',
      },
      phase: 'harvesting',
      status: 'running',
      startedTick: 3,
      lastProgressTick: 5,
      delivered: 2,
      receiptIds: [],
      ownedOrderIds: [],
      ancestry: [],
    };
    founder.mind!.tasks = [task];
    founder.mind!.activeTaskId = 'task-1';
    const memory: StructuredMemory = {
      id: 'memory-1',
      tick: 40,
      kind: 'trade',
      otherId: 'citizen-2',
      text: 'Sold wood to a neighbour at the market.',
    };
    founder.mind!.memories = [memory];
    founder.mind!.memoriesOmitted = 2;
    founder.rest = { value: 42, sleepingHouseId: 'house-1' };
    const markup = renderToStaticMarkup(
      createElement(Inspector, { citizen: founder, unavailable: true, cancel: () => {}, result: '' }),
    );
    expect(markup).toContain('data-testid="mind-dossier"');
    // Exactly ten disposition labels in a stable order.
    const dispositionsMarkup = markup.split('data-testid="mind-dispositions"')[1];
    const labelsMarkup = dispositionsMarkup.slice(0, dispositionsMarkup.indexOf('</div>'));
    expect(labelsMarkup.match(/aria-label="/g)).toHaveLength(10);
    expect(labelsMarkup).toContain('Risk Tolerance');
    expect(labelsMarkup).toContain('Economic Independence');
    expect(labelsMarkup).toContain('Family Orientation');
    expect(markup).toContain('mind-current-task');
    expect(markup).toContain('Stock firewood for the household');
    expect(markup).toContain('delivered 2 / 4 wood T1');
    expect(markup).toContain('aria-label="Rest"');
    expect(markup).toContain('data-testid="rest-sleeping"');
    expect(markup).toContain('house-1');
    expect(markup).toContain('mind-memories');
    expect(markup).toContain('Sold wood to a neighbour at the market.');
    expect(markup).toContain('Tick 40 · trade · with citizen-2');
    expect(markup).toContain('2 older memories evicted from controller history');
  });

  it('shows composed citizens at rest and keeps legacy citizens unchanged', () => {
    const legacy = createWorld({ seed: 3, population: 2 });
    const [citizen] = Object.values(legacy.citizens);
    citizen.inventory = { 'wood:1': 10, 'fibre:1': 10 };
    const markup = renderToStaticMarkup(
      createElement(Inspector, { citizen, unavailable: true, cancel: () => {}, result: '' }),
    );
    expect(markup).not.toContain('aria-label="Rest"');
    expect(markup).not.toContain('mind-dossier');
    expect(markup).not.toContain('mind-memories');
    const composed = createWorld({ seed: 3, population: 2 });
    composed.controllerMode = 'composed';
    const [composedCitizen] = Object.values(composed.citizens);
    ensureComposedBody(composed, composedCitizen);
    composedCitizen.rest = { value: 88 };
    const composedMarkup = renderToStaticMarkup(
      createElement(Inspector, {
        citizen: composedCitizen,
        unavailable: true,
        cancel: () => {},
        result: '',
      }),
    );
    expect(composedMarkup).toContain('aria-label="Rest"');
    expect(composedMarkup).toContain('88 / 100');
    expect(composedMarkup).toContain('mind-dossier');
    expect(composedMarkup).toContain('No active task');
  });

  it('renders stripped spectator summaries and gates retained controller history independently', () => {
    const { world, founder } = composedFixture();
    const citizen = projectSpectatorWorld(world, true).citizens[founder.id];
    const props = { citizen, unavailable: true, cancel: () => {}, result: '' };
    const off = renderToStaticMarkup(createElement(Inspector, props));
    expect(off).toContain('mind-dispositions');
    expect(off).toContain('No active task');
    expect(off).not.toContain('tree-diagnostics');
    const on = renderToStaticMarkup(createElement(Inspector, { ...props, decisionTreeDebug: true }));
    expect(on).toContain('Retained controller history');
    expect(on).toContain('mind-dispositions');
    const stripped = projectSpectatorWorld(world).citizens[founder.id];
    expect(renderToStaticMarkup(createElement(Inspector, { ...props, citizen: stripped, decisionTreeDebug: true })))
      .not.toContain('tree-diagnostics');
    expect(projectWorld(projectSpectatorWorld(world)).citizens).toHaveLength(projectWorld(world).citizens.length);
  });

  it('minds render without memory rows when the notebook is empty', () => {
    const { founder } = composedFixture();
    const markup = renderToStaticMarkup(
      createElement(Inspector, { citizen: founder, unavailable: true, cancel: () => {}, result: '' }),
    );
    expect(markup).toContain('No active task');
    expect(markup).toContain('No mind memories recorded');
  });
});