import { describe, expect, it } from 'vitest';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { settleTerritoryDeath } from '../src/world/territory.ts';
import { ACTIONS, CONDITIONS } from '../src/citizen/tree-actions.ts';
import { communityBoost, communityVoteOpportunity, negativePersonalMajority } from '../src/citizen/tree-community.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

function fixture() {
  const world = createWorld({ population: 4 });
  world.controllerMode = 'composed';
  const [a, b, c, d] = Object.values(world.citizens);
  a.mind = { version: 1, dispositions: { ambition: .5, morals: .5, generosity: .5, riskTolerance: .5, patience: .5, sociability: .5, vengefulness: .5, familyOrientation: .5, enterprise: .5, economicIndependence: .5 }, memories: [], memoriesOmitted: 0, tasks: [], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 2400 };
  world.territories = { t: { id: 't', ownerId: a.id, createdTick: 0, admissions: [], members: Object.fromEntries([a,b,c,d].map((x, sequence) => [x.id, { citizenId: x.id, joinedTick: 0, sequence }])) } };
  world.reputations = { [a.id]: { [b.id]: 'disliked', [c.id]: 'hostile' }, [b.id]: { [a.id]: 'admired' } };
  const task: TreeTaskState = { id: 'leave', definitionId: 'LeaveTerritory', targetId: 't', ancestry: [], phase: '', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [], request: { id: 'r', resource: 'wood', tier: 1, quantity: 1, purpose: 'leave', urgency: 'routine', allowMarket: false } };
  return { world, a, b, c, d, task };
}

describe('personal community membership', () => {
  it('counts only strict negative majority, excluding self and including unknowns', () => {
    const {world,a,b,c,d} = fixture();
    expect(negativePersonalMajority(observe(world,a.id),'t')).toBe(true); // 2/3
    world.reputations![a.id][c.id] = 'neutral';
    expect(negativePersonalMajority(observe(world,a.id),'t')).toBe(false); // 1/3
    delete world.territories!.t.members[d.id];
    expect(negativePersonalMajority(observe(world,a.id),'t')).toBe(false); // 1/2
    delete world.territories!.t.members[c.id];
    expect(negativePersonalMajority(observe(world,a.id),'t')).toBe(true); // 1/1
    delete world.territories!.t.members[b.id];
    world.reputations![a.id][a.id] = 'hostile';
    expect(negativePersonalMajority(observe(world,a.id),'t')).toBe(false);
  });
  it('uses only actor opinions and settled living roster, without foreign roster access', () => {
    const {world,a,b,c,d} = fixture();
    expect(negativePersonalMajority(observe(world,b.id),'t')).toBe(false);
    c.alive = false; settleTerritoryDeath(world,c);
    expect(negativePersonalMajority(observe(world,a.id),'t')).toBe(false); // 1/2 after death
    delete world.territories!.t.members[d.id];
    world.signs = { s: { id: 's', territoryId: 't', x: d.x, y: d.y, woodTier: 1, health: 10, maxHealth: 10 } };
    const outsider = observe(world,d.id);
    expect(outsider.territories?.find(t => t.id === 't')?.members).toEqual({});
    expect(negativePersonalMajority(outsider,'t')).toBe(false);
  });
  it('rechecks stale leave tasks while raw spectator command remains available', () => {
    const {world,a,task} = fixture();
    expect(CONDITIONS.CanLeaveTerritory.evaluate(observe(world,a.id),task).ok).toBe(true);
    world.reputations![a.id] = {};
    const result = ACTIONS.LeaveTerritory.step(observe(world,a.id),task);
    expect(result.command).toBeUndefined(); expect(result.status).toBe('failed');
    expect(dispatch(world,a.id,{ type: 'leave-territory' }).ok).toBe(true);
  });
  it('supports old projections and bounded scalar boost', () => {
    expect(negativePersonalMajority({ citizen: { id: 'old' } },'t')).toBe(false);
    expect(communityBoost('join')).toBe(0);
    expect(communityBoost('join',1)).toBeGreaterThan(communityBoost('found',1));
    expect(communityBoost('join',99)).toBe(.75);
  });
  it('offers one nonblocking vote and suppresses recorded, expired and foreign votes', () => {
    const {world,a,b} = fixture();
    world.territories!.t.admissions = [1,2].map(i => ({ id: `v${i}`, applicantId: b.id, requestedTick: 0, expiresTick: 20, status: 'pending', votes: {} }));
    const o = observe(world,a.id);
    // Fresh composed worlds supply a mind; no optional community state is needed.
    expect(o.citizen.mind).toBeDefined();
    o.citizen.action = { id: 'busy' } as typeof o.citizen.action;
    expect(communityVoteOpportunity(o,0)?.type).toBe('vote-territory');
    for (const admission of o.territories![0].admissions) admission.votes[a.id] = false;
    expect(communityVoteOpportunity(o,0)).toBeUndefined();
    o.territories![0].admissions[0].votes = {}; o.tick = 20;
    expect(communityVoteOpportunity(o,0)).toBeUndefined();
    o.tick = 0; o.territories![0].members = {};
    expect(communityVoteOpportunity(o,0)).toBeUndefined();
  });
});
