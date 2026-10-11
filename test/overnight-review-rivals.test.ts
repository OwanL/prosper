import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { enableAutonomy, setAutonomyPolicy } from '../src/world/autonomy.ts';
import { deliverSignal, relationship } from '../src/world/society.ts';
import { observe } from '../src/world/observation.ts';
import { projectObservation } from '../src/ui/model.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';
import { strategicDecisionSchema } from '../src/citizen/strategic-tools.ts';

describe('overnight review: explicit rivalry', () => {
  it('does not accept a family offer from a citizen named as a rival', () => {
    const world = createWorld({ seed: 17, population: 2 });
    const [citizen, rival] = Object.values(world.citizens);
    citizen.x = rival.x = 4;
    citizen.y = rival.y = 4;
    citizen.inventory = { 'food:2': 9 };
    rival.inventory = { 'food:2': 9 };

    enableAutonomy(world, citizen, { reproduction: 'seek', rivals: [rival.id] });
    enableAutonomy(world, rival, { reproduction: 'avoid' });
    relationship(citizen, rival.id).trust = 12;
    deliverSignal(world, rival, citizen, {
      kind: 'family-offer',
      x: citizen.x,
      y: citizen.y,
    });

    tickWorld(world, 20);

    expect(citizen.consent[rival.id]).toBeUndefined();
    expect(citizen.autonomy?.requestedPartnerId).toBeUndefined();
  });

  it('ignores historical family offers and clears pending courtship on a rival policy', () => {
    const world = createWorld({ seed: 29, population: 2 });
    const [citizen, rival] = Object.values(world.citizens);
    citizen.x = rival.x = 4;
    citizen.y = rival.y = 4;
    citizen.inventory = { 'food:2': 9 };
    rival.inventory = { 'food:2': 9 };

    enableAutonomy(world, citizen, { reproduction: 'seek' });
    enableAutonomy(world, rival, { reproduction: 'seek' });
    relationship(citizen, rival.id).trust = 30;
    relationship(rival, citizen.id).trust = 30;
    deliverSignal(world, rival, citizen, {
      kind: 'family-offer',
      x: citizen.x,
      y: citizen.y,
    });

    tickWorld(world, 20);
    expect(citizen.autonomy?.requestedPartnerId).toBeUndefined();
    expect(Object.values(world.citizens)).toHaveLength(2);

    setAutonomyPolicy(world, citizen, { rivals: [rival.id] });
    tickWorld(world, 120);

    expect(citizen.autonomy?.requestedPartnerId).toBeUndefined();
    expect(Object.values(world.citizens)).toHaveLength(2);
  });

  it('clears an explicit partner and territory while retaining inert historical consent', () => {
    expect(strategicDecisionSchema.safeParse({
      policy: { partnerId: null, territory: null, home: null },
    }).success).toBe(true);
    const world = createWorld({ seed: 33, population: 2 });
    const [citizen, partner] = Object.values(world.citizens);
    citizen.x = partner.x = 4;
    citizen.y = partner.y = 4;
    enableAutonomy(world, citizen, {
      reproduction: 'seek',
      partnerId: partner.id,
      territory: [1, 1, 2, 2],
      home: { x: 4, y: 4 },
    });
    relationship(citizen, partner.id).trust = 30;
    citizen.consent[partner.id] = world.tick + 100; // retained historical record
    citizen.autonomy!.requestedPartnerId = partner.id;
    citizen.autonomy!.meeting = { partnerId: partner.id, x: 4, y: 4, tick: world.tick };

    setAutonomyPolicy(world, citizen, { partnerId: null, territory: null, home: null });

    expect(citizen.autonomy!.policy.partnerId).toBeUndefined();
    expect(citizen.autonomy!.policy.territory).toBeUndefined();
    expect(citizen.autonomy!.policy.home).toBeUndefined();
    expect(citizen.consent[partner.id]).toBe(100);
    expect(citizen.autonomy!.requestedPartnerId).toBeUndefined();
    expect(citizen.autonomy!.meeting).toBeUndefined();
    expect(Object.values(world.claims ?? {}).some((claim) => claim.ownerId === citizen.id)).toBe(false);
  });

  it('round-trips policy revisions, claims and private social inboxes without showing them in the knowledge scene', () => {
    const world = createWorld({ seed: 31, population: 2, autonomy: true });
    const [citizen, other] = Object.values(world.citizens);
    citizen.review = { eventSequence: 0, foodRisk: 0, strategicTick: 77 };
    other.x = citizen.x;
    other.y = citizen.y;
    setAutonomyPolicy(world, citizen, { territory: [1, 1, 2, 2], rivals: [other.id] });
    deliverSignal(world, other, citizen, {
      kind: 'access-demand',
      amount: 7,
      reason: 'A private access request',
    });

    const checkpoint = validateCheckpoint({
      version: 1,
      savedAt: new Date().toISOString(),
      world: JSON.parse(JSON.stringify(world)),
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
    });
    expect(checkpoint.world).toEqual(world);
    expect(checkpoint.world.citizens[citizen.id].autonomy?.policyRevision).toBe(1);
    expect(checkpoint.world.citizens[citizen.id].review?.strategicTick).toBe(77);
    expect(checkpoint.world.claims?.[Object.keys(world.claims!)[0]]).toEqual(
      Object.values(world.claims!)[0],
    );

    const observerView = observe(world, other.id);
    expect(observerView.citizen.autonomy?.signals?.some((signal) => signal.reason === 'A private access request') ?? false).toBe(false);
    const scene = projectObservation(observerView, { width: world.width, height: world.height });
    expect(scene).not.toHaveProperty('claims');
    expect(scene).not.toHaveProperty('alliances');
    expect(JSON.stringify(scene)).not.toContain('A private access request');
  });

  it('keeps every autonomous citizen’s retained social and exploration memory bounded on any tick phase', () => {
    const world = createWorld({ seed: 37, autonomy: true });
    const citizen = Object.values(world.citizens).at(-1)!;
    const state = citizen.autonomy!;
    state.sentSignals ??= {};
    for (let index = 0; index < 700; index++) {
      state.visited[`tile-${index}`] = index;
      state.relationships[`person-${index}`] = {
        trust: index,
        grievance: 0,
        respect: 0,
        trades: 0,
        trespasses: 0,
        harm: 0,
        lastTick: index,
      };
      state.threatened[`threat-${index}`] = { tick: 0, reason: 'bounded test', demand: 0 };
      state.permits[`permit-${index}`] = 1000;
      state.sentSignals[`offer:person-${index}`] = 0;
    }
    state.signals = Array.from({ length: 24 }, (_, index) => ({
      from: `person-${index}`,
      tick: 0,
      kind: 'alliance-offer' as const,
    }));

    tickWorld(world, 4);

    expect(Object.keys(state.visited).length).toBeLessThanOrEqual(640);
    expect(Object.keys(state.relationships).length).toBeLessThanOrEqual(128);
    expect(Object.keys(state.threatened).length).toBeLessThanOrEqual(128);
    expect(Object.keys(state.permits).length).toBeLessThanOrEqual(128);
    expect(Object.keys(state.sentSignals ?? {}).length).toBeLessThanOrEqual(128);
    expect(state.signals?.length).toBeLessThanOrEqual(24);
  });
});
