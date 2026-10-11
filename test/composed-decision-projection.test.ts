import { describe, expect, it, vi } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, observeDecision, updateKnowledge } from '../src/world/observation.ts';
import { advanceTree, prepareTreeCandidates } from '../src/world/tree-controller.ts';
import * as observation from '../src/world/observation.ts';
import type { Citizen, CitizenObservation, DecisionObservation, TreeTaskState, World } from '../src/shared/types.ts';
import type { Territory } from '../src/shared/territory-types.ts';

/** The composed decision projection removes ONLY the duplicate self notebook:
 * the full projection's citizen.knowledge is exactly visible+remembered (fresh
 * current-sight copies at visible keys, stored rows elsewhere), so
 * observeDecision omits citizen.knowledge, ascii and entityIndex while staying
 * byte-equal to the forced full projection on every observable field, in every
 * real world state (busy, remembered-only, starving, dead). */

const key = (x: number, y: number) => `${x},${y}`;
const stripNotebook = (full: CitizenObservation) => {
  const { ascii: _ascii, entityIndex: _entityIndex, ...rest } = full;
  const citizen = { ...rest.citizen } as Partial<Citizen>;
  delete citizen.knowledge;
  return { ...rest, citizen };
};
const asDecision = (projection: unknown) => projection as DecisionObservation;
function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}
function composedWorld(seed: number, population: number): { world: World; citizens: Citizen[] } {
  const world = createWorld({ seed, population, controllerMode: 'composed', autonomy: false });
  return { world, citizens: Object.values(world.citizens) };
}
/** Settle any in-flight action with real committed ticks. */
function settle(world: World, citizen: Citizen): void {
  for (let ticks = 0; ticks < 2000 && citizen.action; ticks++) tickWorld(world, 1);
  expect(citizen.action).toBeNull();
}
function territoryIdOf(world: World): string {
  return Object.keys(world.territories!)[0]!;
}

describe('projected notebook invariant (falsifiable audit claim)', () => {
  it('projected notebook keys are exactly visible+remembered, with current-sight tile copies', () => {
    const { world, citizens: [a] } = composedWorld(7, 3);
    updateKnowledge(world);
    dispatch(world, a.id, { type: 'move', x: Math.max(0, a.x - 30), y: a.y });
    settle(world, a);
    updateKnowledge(world);
    const full = observe(world, a.id, { includeText: false });
    expect(full.visible.length).toBeGreaterThan(0);
    expect(full.remembered.length).toBeGreaterThan(0);
    const notebookKeys = Object.keys(full.citizen.knowledge).sort();
    const windowKeys = [...new Set([...full.visible, ...full.remembered].map(tile => key(tile.x, tile.y)))].sort();
    expect(notebookKeys).toEqual(windowKeys);
    // Current sight, not stale committed truth: visible keys hold the freshly
    // computed tile copies; remembered keys hold the stored committed rows.
    for (const tile of full.visible) expect(full.citizen.knowledge[key(tile.x, tile.y)]).toEqual(tile);
    for (const tile of full.remembered) expect(full.citizen.knowledge[key(tile.x, tile.y)]).toEqual(tile);
  });

  it('historical citizen.knowledge territory filter is a no-op on real projections', () => {
    const { world, citizens: [a] } = composedWorld(7, 3);
    updateKnowledge(world);
    dispatch(world, a.id, { type: 'move', x: Math.max(0, a.x - 30), y: a.y });
    settle(world, a);
    updateKnowledge(world);
    const full = observe(world, a.id, { includeText: false });
    const decision = observeDecision(world, a.id);
    // Old filter (projected notebook lookup) versus decision visible/remembered.
    expect(full.visible.filter(tile => !!full.citizen.knowledge[key(tile.x, tile.y)])).toEqual(decision.visible);
    expect(full.remembered.filter(tile => !!full.citizen.knowledge[key(tile.x, tile.y)])).toEqual(decision.remembered);
  });

  it('civic facts stay visible-sight-only; foreign rosters stay private in both projections', () => {
    const { world, citizens: [owner, foreign] } = composedWorld(11, 3);
    owner.inventory = { 'food:1': 12, 'wood:1': 60 };
    foreign.x = (owner.x + 40) % world.width;
    updateKnowledge(world);
    expect(dispatch(world, owner.id, { type: 'create-territory', tiles: [ { x: owner.x, y: owner.y } ], woodTier: 1 }).ok).toBe(true);
    updateKnowledge(world);
    for (const id of [owner.id, foreign.id]) {
      const full = observe(world, id, { includeText: false });
      const decision = observeDecision(world, id);
      expect(decision.territories).toEqual(full.territories);
      expect(decision.signs).toEqual(full.signs);
      expect(decision.houses).toEqual(full.houses);
      expect('knowledge' in decision.citizen).toBe(false);
    }
    const territory: Territory = Object.values(world.territories!)[0]!;
    // Own projection carries the full membership; the foreign projection hides
    // the roster and votes even with unseen facts in world truth.
    territory.members['unseen-member'] = { citizenId: 'unseen-member', joinedTick: 0, sequence: 9 };
    territory.admissions.push({ id: 'adm-1', applicantId: 'unseen-member', requestedTick: 0, expiresTick: 100, votes: { someone: true }, status: 'pending' });
    const foreignDecision = observeDecision(world, foreign.id);
    expect(foreignDecision.territories ?? []).toHaveLength(0);
    expect(observe(world, foreign.id, { includeText: false }).territories).toEqual(foreignDecision.territories);
    const ownerDecision = observeDecision(world, owner.id);
    expect(ownerDecision.territories![0]!.members[owner.id]).toBeDefined();
    // Tile memories carry no dated civic snapshots in either projection, and the
    // sign projection carries no membership.
    const sign = ownerDecision.signs![0]!;
    expect(sign.territoryId).toBe(territoryIdOf(world));
    expect('members' in (sign as object)).toBe(false);
  });
});

describe('decision projection differential against forced full observe', () => {
  it.each(['idle', 'busy', 'remembered', 'starving', 'dead'] as const)('strip-equals full observe for %s citizens', scenario => {
    const { world, citizens: [a] } = composedWorld(123, 3);
    if (scenario === 'busy' || scenario === 'starving') {
      dispatch(world, a.id, { type: 'move', x: a.x === 0 ? 1 : a.x - 1, y: a.y });
      expect(a.action).not.toBeNull();
    }
    if (scenario === 'remembered') {
      dispatch(world, a.id, { type: 'move', x: a.x < world.width / 2 ? world.width - 1 : 0, y: a.y < world.height / 2 ? world.height - 1 : 0 });
      settle(world, a);
    }
    if (scenario === 'starving') a.fullness = 0;
    if (scenario === 'dead') a.alive = false;
    updateKnowledge(world);
    const before = JSON.stringify(world);
    deepFreeze(world);
    const full = observe(world, a.id, { includeText: false });
    const decision = observeDecision(world, a.id);
    // Byte-level strip equality (key order included) and structural equality.
    expect(JSON.stringify(stripNotebook(full))).toBe(JSON.stringify(decision));
    expect(stripNotebook(full)).toEqual(decision);
    expect('knowledge' in decision.citizen).toBe(false);
    expect(decision.ascii).toBeUndefined();
    expect(decision.entityIndex).toBeUndefined();
    // No writeback: frozen world unchanged by either projection.
    expect(JSON.stringify(world)).toBe(before);
    // Independent clones: mutating the decision never leaks into world truth.
    const fresh = observeDecision(world, a.id);
    fresh.citizen.inventory['food:1'] = 9999;
    (fresh.citizen.mind?.receipts as unknown[] | undefined)?.push({ id: 'leak' });
    if (fresh.remembered[0]) {
      expect(fresh.remembered[0]).toBe(a.knowledge[key(fresh.remembered[0].x, fresh.remembered[0].y)]);
      expect(() => {
        // @ts-expect-error Internal captured memories are readonly, unlike public observe.
        fresh.remembered[0].seenTick = -1;
      }).toThrow(TypeError);
    }
    if (fresh.markets[0]) fresh.markets[0].escrowGold = -5;
    expect(JSON.stringify(world)).toBe(before);
    const reference = observeDecision(world, a.id);
    expect(reference.citizen.inventory['food:1']).toBe(decision.citizen.inventory['food:1']);
    expect(reference.citizen.mind?.receipts).toEqual(decision.citizen.mind?.receipts);
    expect(stripNotebook(observe(world, a.id, { includeText: false }))).toEqual(reference);
  });

  it('keeps the public default projection unchanged: notebook and text stay present', () => {
    const { world, citizens: [a] } = composedWorld(5, 2);
    updateKnowledge(world);
    const full = observe(world, a.id);
    expect('knowledge' in full.citizen).toBe(true);
    expect(full.ascii.length).toBeGreaterThan(0);
    expect(full.entityIndex).toBeDefined();
  });
});

describe('immutable captured decision memories', () => {
  it('retains paused rows across refresh, keeps public copies mutable, and evaluates real actions without writes', () => {
    const { world, citizens: [a] } = composedWorld(37, 3);
    updateKnowledge(world);
    const origin = { x: a.x, y: a.y };
    a.x = a.x < world.width / 2 ? world.width - 1 : 0;
    a.y = a.y < world.height / 2 ? world.height - 1 : 0;
    updateKnowledge(world);
    const paused = observeDecision(world, a.id);
    expect(paused.remembered.length).toBeGreaterThan(0);
    const captured = structuredClone(paused);
    for (const tile of paused.remembered) {
      expect(Object.isFrozen(tile)).toBe(true);
      for (const entities of [tile.deposits, tile.buildings, tile.citizens, tile.loot]) {
        expect(Object.isFrozen(entities)).toBe(true);
        for (const entity of entities) expect(Object.isFrozen(entity)).toBe(true);
      }
    }
    const publicView = observe(world, a.id);
    publicView.remembered[0].seenTick = -123;
    publicView.citizen.knowledge[key(origin.x, origin.y)].citizens.length = 0;
    expect(paused).toEqual(captured);
    for (const tile of Object.values(a.knowledge)) deepFreeze(tile);
    expect(() => prepareTreeCandidates(paused)).not.toThrow();
    expect(() => advanceTree(world, a)).not.toThrow();
    a.x = origin.x; a.y = origin.y;
    for (let tick = 0; tick < 8; tick++) {
      tickWorld(world);
      updateKnowledge(world);
      expect(observeDecision(world, a.id)).toEqual(stripNotebook(observe(world, a.id, { includeText: false })));
      expect(paused).toEqual(captured);
    }
    expect(a.knowledge[key(origin.x, origin.y)]).not.toBe(paused.remembered.find(tile => key(tile.x, tile.y) === key(origin.x, origin.y)));
  });
});

describe('controller integrates the decision projection', () => {
  it('the composed adapter projects through observeDecision, never through full observe', () => {
    const { world, citizens: [a] } = composedWorld(9, 3);
    updateKnowledge(world);
    const observeSpy = vi.spyOn(observation, 'observe');
    const decisionSpy = vi.spyOn(observation, 'observeDecision');
    try {
      advanceTree(world, a);
      expect(decisionSpy.mock.calls.some(([, id]) => id === a.id)).toBe(true);
      expect(observeSpy.mock.calls.some(([, id]) => id === a.id)).toBe(false);
      // Busy fast path stays in force: entry alone while physical work runs.
      dispatch(world, a.id, { type: 'sleep', targetRest: 100 });
      if (!a.action) dispatch(world, a.id, { type: 'move', x: Math.min(world.width - 1, a.x + 1), y: a.y });
      expect(a.action).not.toBeNull();
      decisionSpy.mockClear();
      advanceTree(world, a);
      expect(a.action).not.toBeNull();
      expect(decisionSpy.mock.calls.some(([, id]) => id === a.id)).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });

  it('selection reads the same candidates from full and decision projections', () => {
    const { world, citizens: [a] } = composedWorld(21, 3);
    updateKnowledge(world);
    const full = observe(world, a.id, { includeText: false });
    const decision = observeDecision(world, a.id);
    expect(prepareTreeCandidates(asDecision(stripNotebook(full)))).toEqual(prepareTreeCandidates(decision));
  });

  it('territory decisions match forced-full integration tick by tick, marking only known tiles', () => {
    const { world, citizens: [a] } = composedWorld(11, 3);
    a.inventory = { 'food:1': 12, 'wood:1': 60 };
    updateKnowledge(world);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [ { x: a.x, y: a.y } ], woodTier: 1 }).ok).toBe(true);
    updateKnowledge(world);
    const territoryId = territoryIdOf(world);
    const expand: TreeTaskState = {
      id: 'expand', definitionId: 'ExpandTerritory',
      request: { id: 'expand', resource: 'wood', tier: 1, quantity: 1, purpose: 'Grow the marked land', urgency: 'routine', allowMarket: false },
      ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: territoryId,
    };
    a.mind!.tasks = [expand];
    a.mind!.activeTaskId = expand.id;
    const slow = structuredClone(world);
    const proposedTiles = new Set<string>();
    // Drive the controller explicitly, keeping independent background trading
    // from listing the expansion's wood before the marking action reserves it.
    const authority = { citizens: Object.fromEntries(Object.keys(world.citizens).map(id => [id, 'direct' as const])) };
    for (let tick = 0; tick < 40 && expand.status === 'running'; tick++) {
      advanceTree(world, a);
      const fullSpy = vi.spyOn(observation, 'observeDecision').mockImplementation((w, id) => asDecision(stripNotebook(observe(w, id, { includeText: false }))));
      try { advanceTree(slow, slow.citizens[a.id]); } finally { fullSpy.mockRestore(); }
      tickWorld(world, 1, { authority });
      tickWorld(slow, 1, { authority });
      expect(world, `authoritative differential at tick ${tick + 1}`).toEqual(slow);
      for (const entry of a.mind!.trace)
        if (entry.command && 'tiles' in entry.command)
          for (const tile of entry.command.tiles) proposedTiles.add(key(tile.x, tile.y));
      updateKnowledge(world); updateKnowledge(slow);
    }
    // The action window really exercised the replaced known-set filter.
    expect(expand.status).toBe('succeeded');
    expect(proposedTiles.size).toBeGreaterThan(0);
    // Every marked tile lies in the citizen's own decision projection window.
    const decision = observeDecision(world, a.id);
    const known = new Set([...decision.visible, ...decision.remembered].map(tile => key(tile.x, tile.y)));
    for (const tile of proposedTiles) expect(known.has(tile)).toBe(true);
  });
});