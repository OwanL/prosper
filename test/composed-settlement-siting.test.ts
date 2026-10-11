import { expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { stepTreeTask } from '../src/citizen/tree-actions.ts';
import { settlementSiteCost, settlementOwners } from '../src/citizen/tree-spatial.ts';
import type { DecisionObservation } from '../src/shared/types.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

function fixture() {
  const w = createWorld({ seed: 17, population: 2, autonomy: false });
  const [a, b] = Object.values(w.citizens);
  a!.x = 10; a!.y = 10;
  const o = observe(w, a!.id) as DecisionObservation;
  o.visible = [11, 15, 30].map(x => ({ x, y: 10, seenTick: o.tick, buildings: [], citizens: [], deposits: [], loot: [] }));
  o.remembered = [];
  o.territories = [{ id: 'ours', ownerId: a!.id, createdTick: 0, members: {
    [a!.id]: { citizenId: a!.id, joinedTick: 0, sequence: 0 },
    [b!.id]: { citizenId: b!.id, joinedTick: 0, sequence: 1 },
  }, admissions: [] }];
  o.signs = [{ id: 'sign', territoryId: 'ours', x: 15, y: 10, woodTier: 1, health: 100, maxHealth: 100 }];
  return { o, b: b! };
}
function build(o: DecisionObservation, target?: { x: number; y: number }, definitionId = 'BuildHouse') {
  const task = { id: 't', definitionId, targetId: definitionId === 'ExpandTerritory' ? 'ours' : undefined, ancestry: [], phase: '', status: 'running', startedTick: 0,
    lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [], target,
    request: { id: 'r', resource: 'wood', tier: 1, quantity: 1, allowMarket: false, purpose: 'house', urgency: 'routine' },
  } as TreeTaskState;
  return stepTreeTask(o, task).command;
}
it('prefers member land strongly but allows distance to outweigh it', () => {
  const { o } = fixture();
  expect(build(o)).toMatchObject({ x: 15, y: 10 });
  o.signs![0]!.x = 30;
  expect(build(o)).toMatchObject({ x: 11, y: 10 });
  expect(settlementSiteCost(o, { x: 30, y: 10 })).toBeGreaterThan(settlementSiteCost(o, { x: 11, y: 10 }));
});
it('retains eligible committed sites; rejects known foreign marks', () => {
  const { o } = fixture();
  expect(build(o, { x: 11, y: 10 })).toMatchObject({ x: 11, y: 10 });
  o.signs!.push({ ...o.signs![0]!, id: 'foreign', territoryId: 'foreign', x: 11 });
  expect(build(o, { x: 11, y: 10 })).toMatchObject({ x: 15, y: 10 });
});
it('finds connected frontier beyond the former 64 candidate cutoff and permits member buildings', () => {
  const { o, b } = fixture();
  o.citizen.inventory['wood:1'] = 10;
  o.mapSize = { width: 100, height: 100 };
  o.signs![0]!.x = 40; o.signs![0]!.y = 40;
  o.visible = Array.from({ length: 80 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), seenTick: o.tick, buildings: [], citizens: [], deposits: [], loot: [] }));
  o.visible = [...o.visible, { x: 41, y: 40, seenTick: o.tick, citizens: [], deposits: [], loot: [], buildings: [{ id: 'member-wall', kind: 'wall', tier: 1, ownerId: b.id, x: 41, y: 40, health: 100, maxHealth: 100, materials: {} }] }];
  expect(build(o, undefined, 'ExpandTerritory')).toMatchObject({ type: 'expand-territory', tiles: [{ x: 41, y: 40 }] });
});
it('blocks construction on projected houses and replaces invalid committed sites', () => {
  const { o } = fixture();
  o.houses = [{ id: 'house', ownerId: o.citizen.id, x: 15, y: 10, tier: 1, health: 100, maxHealth: 100 }];
  expect(build(o, { x: 15, y: 10 })).toMatchObject({ x: 11, y: 10 });
});
it('excludes outsider houses and prefers member houses over deposits and blank frontier', () => {
  const { o, b } = fixture();
  o.citizen.inventory['wood:1'] = 10;
  o.signs![0]!.x = 12;
  o.visible = [11, 13].map(x => ({ x, y: 10, seenTick: o.tick, buildings: [], citizens: [], deposits: [], loot: [] }));
  o.houses = [{ id: 'house', ownerId: b.id, x: 13, y: 10, tier: 1, health: 100, maxHealth: 100 }];
  expect(build(o, undefined, 'ExpandTerritory')).toMatchObject({ tiles: [{ x: 13, y: 10 }] });
  o.houses[0]!.ownerId = 'outsider';
  expect(build(o, undefined, 'ExpandTerritory')).toMatchObject({ tiles: [{ x: 11, y: 10 }] });
});
it('does not infer private houses absent from the projection', () => {
  const { o } = fixture();
  o.houses = [];
  expect(build(o)).toEqual(build({ ...structuredClone(o), houses: undefined }));
});
it('shares permission only through the projected own roster and is deterministic', () => {
  const { o, b } = fixture();
  expect(settlementOwners(o).has(b.id)).toBe(true);
  expect(build(structuredClone(o))).toEqual(build(o));
  o.territories![0]!.members = {};
  expect(settlementOwners(o).has(b.id)).toBe(false);
});
