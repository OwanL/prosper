import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { loadCheckpoint, saveCheckpoint } from '../src/server/checkpoint.ts';
import { BALANCE } from '../src/world/config.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { advanceTree, prepareTreeCandidates } from '../src/world/tree-controller.ts';
import { updateCommunityWeight } from '../src/citizen/tree-memory.ts';
import { initializeDispositions } from '../src/citizen/tree-selection.ts';
import { mindSchema } from '../src/server/autonomy-checkpoint.ts';
import type { CitizenMind } from '../src/shared/tree-types.ts';
import type { DecisionObservation } from '../src/shared/types.ts';
const fresh = (): CitizenMind => ({ version: 1, dispositions: initializeDispositions(1), memories: [], memoriesOmitted: 0, tasks: [], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 600 });
const attack = (n: number, tick = 0) => ({ id: `event-${n}`, tick, kind: 'attack', citizenId: 'a', targetId: 'v', text: 'attack', audience: ['a', 'v', 'w', 'remote'] } as DecisionObservation['alerts'][number]);
const advance = (m: CitizenMind, id: string, tick: number, alerts = [attack(1)], witness = false) => updateCommunityWeight(m, { tick, citizen: { id }, alerts }, () => witness);
describe('personal community safety weight', () => {
  it.each([false, true])('continues byte-exact disk checkpoints with community present=%s', present => {
    const world = createWorld({ seed: 17, population: 2, autonomy: false });
    for (const citizen of Object.values(world.citizens)) {
      citizen.mind = fresh();
      if (present) advance(citizen.mind, citizen.id, world.tick, [{ ...attack(1), targetId: citizen.id }]);
    }
    const directory = mkdtempSync(join(tmpdir(), 'prosper-community-'));
    try {
      const path = join(directory, 'checkpoint.json');
      saveCheckpoint(path, { version: 1, savedAt: new Date().toISOString(), world,
        runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } });
      const restored = loadCheckpoint(path)!.world;
      expect(restored).toEqual(world);
      for (const current of [world, restored]) {
        tickWorld(current, 10);
        for (const citizen of Object.values(current.citizens)) advanceTree(current, citizen);
      }
      expect(restored).toEqual(world);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('uses real attack occurrence sight, not late visibility or audience membership', () => {
    const world = createWorld({ seed: 7, population: 4, autonomy: false });
    const [actor, victim, witness, remote] = Object.values(world.citizens);
    for (const citizen of [actor, victim, witness]) { citizen.x = 2; citizen.y = 2; }
    remote.x = world.width - 2; remote.y = world.height - 2;
    updateKnowledge(world);
    expect(dispatch(world, actor.id, { type: 'attack', targetId: victim.id }).ok).toBe(true);
    tickWorld(world, BALANCE.attackTicks);
    const incident = world.events.find(e => e.kind === 'attack')!;
    expect(incident).toBeDefined();
    expect(incident.audience).toContain(witness.id);
    expect(incident.audience).not.toContain(remote.id);
    for (const citizen of [actor, victim, witness, remote]) citizen.mind = fresh();
    // Explicit delivery to a distant audience is not evidence of sight.
    incident.audience!.push(remote.id);
    for (const citizen of [actor, victim, witness, remote]) advanceTree(world, citizen);
    expect(actor.mind!.community!.weight).toBe(0);
    expect(victim.mind!.community!.weight).toBe(.5);
    expect(witness.mind!.community!.weight).toBe(.25);
    expect(remote.mind!.community!.weight).toBe(0);
    tickWorld(world);
    remote.x = incident.x!; remote.y = incident.y!;
    remote.mind = fresh(); updateKnowledge(world);
    advanceTree(world, remote);
    expect(remote.mind.community!.weight).toBe(0);
    witness.x = remote.x = world.width - 2; witness.y = remote.y = world.height - 2;
    witness.mind = fresh();
    // Retain only dated occurrence-tile evidence, independent of current sight.
    witness.knowledge = { occurrence: { ...Object.values(witness.knowledge)[0]!, x: incident.x!, y: incident.y!, seenTick: incident.tick } };
    advanceTree(world, witness);
    expect(witness.mind.community!.weight).toBeCloseTo(.25 - 1 / 1200);
  });
  it('boosts feasible constructive territory candidates without boosting other goals', () => {
    const world = createWorld({ seed: 7, population: 2 });
    const citizen = Object.values(world.citizens)[0]!;
    citizen.mind = fresh(); citizen.inventory = { 'wood:1': 100, 'fibre:1': 100 }; citizen.gold = 1000;
    updateKnowledge(world);
    const baseline = prepareTreeCandidates(observe(world, citizen.id));
    citizen.mind.community = { weight: 1, tick: world.tick, eventCursor: 0 };
    const boosted = prepareTreeCandidates(observe(world, citizen.id));
    expect(baseline.some(c => c.task.definitionId === 'CreateTerritory')).toBe(true);
    for (let i = 0; i < baseline.length; i++) {
      const boost = ({ JoinTerritory: .75, CreateTerritory: .25, ExpandTerritory: .5 } as Record<string, number>)[baseline[i]!.task.definitionId] ?? 0;
      expect(boosted[i]!.forecast.benefit - baseline[i]!.forecast.benefit).toBeCloseTo(boost);
    }
  });
  it('distinguishes victim, actor, actual witness and uninformed audience', () => {
    for (const [id, witnessed, expected] of [['v', false, .5], ['a', false, 0], ['a', true, 0], ['w', true, .25], ['remote', false, 0], ['unseen', false, 0]] as const) {
      const m = fresh(); advance(m, id, 0, id === 'unseen' ? [] : [attack(1)], witnessed);
      expect(m.community?.weight).toBe(expected);
    }
  });
  it('dates delivered victim alerts at occurrence rather than delivery', () => {
    const mind = fresh();
    advance(mind, 'v', 300, [attack(1, 0)]);
    expect(mind.community!.weight).toBe(.25);
    advance(mind, 'v', 300, [attack(1, 0), attack(2, 300)]);
    expect(mind.community!.weight).toBe(.75);
    advance(mind, 'v', 300, [attack(1, 0), attack(2, 300)]);
    expect(mind.community!.weight).toBe(.75);
  });
  it('deduplicates retained alerts, caps and fades exactly to zero', () => {
    const m = fresh(); advance(m, 'v', 0, [attack(1), attack(2), attack(3)]);
    expect(m.community?.weight).toBe(1);
    advance(m, 'v', 600, [attack(1), attack(2), attack(3)]);
    expect(m.community?.weight).toBe(.5);
    advance(m, 'v', 1200, [attack(1), attack(2), attack(3)]);
    expect(m.community?.weight).toBe(0);
  });
  it('matches per-tick updates and round trips without adding fields to old checkpoints', () => {
    const a = fresh(); advance(a, 'v', 0);
    const b = mindSchema.parse(JSON.parse(JSON.stringify(a))) as CitizenMind;
    for (let tick = 1; tick <= 600; tick++) advance(a, 'v', tick);
    advance(b, 'v', 600);
    expect(a.community?.weight).toBeCloseTo(b.community!.weight, 12);
    expect(a.community?.eventCursor).toBe(b.community?.eventCursor);
    expect(mindSchema.parse(fresh()).community).toBeUndefined();
  });
});
