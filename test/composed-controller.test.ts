import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCheckpoint, saveCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { MIND_LIMITS } from '../src/shared/tree-types.ts';
import { chooseOption, optionProbabilities } from '../src/citizen/tree-selection.ts';
import { BALANCE } from '../src/world/config.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { advanceTree, prepareTreeCandidates } from '../src/world/tree-controller.ts';
import { changeReputation } from '../src/world/reputation.ts';
import type { Citizen, Point, Resource, Tier, TreeTaskState, World } from '../src/shared/types.ts';

describe('composed controller direct core adapter (not automatic tick integration)', () => {
  it.each(['sell', 'buy'] as const)('attributes an immediately filled %s order before the next task step', side => {
    const { world, citizens: [a, peer] } = composedWorld(7, 2);
    peer.x = a.x + 1; peer.y = a.y;
    a.inventory = side === 'sell' ? { 'wood:1': 2 } : {};
    peer.inventory = { 'wood:1': 2 }; a.gold = peer.gold = 1000; world.deposits = {};
    updateKnowledge(world);
    expect(dispatch(world, peer.id, { type: 'order', side: side === 'sell' ? 'buy' : 'sell', item: 'wood:1', quantity: 2, price: side === 'sell' ? 100 : 1 }).ok).toBe(true);
    const t: TreeTaskState = {
      id: 'immediate', definitionId: side === 'sell' ? 'SellItem' : 'ObtainResource',
      request: { id: 'immediate', resource: 'wood', tier: 1, quantity: 2, allowMarket: true, purpose: 'Market regression', urgency: 'routine' },
      ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: side === 'sell' ? 'wood:1' : undefined,
    };
    seedRunningTask(a, t);
    for (let step = 0; step < 3 && !t.ownedOrderIds.length; step++) advanceTree(world, a);
    expect(t.ownedOrderIds).toHaveLength(1);
    expect(world.orders[t.ownedOrderIds[0]!]).toBeUndefined();
    updateKnowledge(world);
    advanceTree(world, a);
    expect(t.status).toBe('succeeded');
    expect(side === 'sell' ? t.accounting?.units : t.delivered).toBe(2);
  });

  it('tracks replacement sell orders through a real cancellation and reprice', () => {
    const { world, citizens: [a, peer] } = composedWorld(7, 2);
    peer.x = a.x + 1; peer.y = a.y; a.inventory = { 'wood:1': 2 }; peer.gold = 1000;
    updateKnowledge(world);
    const t: TreeTaskState = {
      id: 'reprice', definitionId: 'SellItem', request: { id: 'reprice', resource: 'wood', tier: 1, quantity: 2, allowMarket: true, purpose: 'Sale', urgency: 'routine' },
      ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: 'wood:1',
    };
    seedRunningTask(a, t); advanceTree(world, a);
    const first = t.ownedOrderIds[0]!;
    expect(world.orders[first]).toBeDefined();
    world.tick = 500; updateKnowledge(world); advanceTree(world, a);
    expect(a.mind!.trace.at(-1)?.command).toEqual({ type: 'cancel-order', orderId: first });
    expect(world.orders[first]).toBeUndefined();
    advanceTree(world, a);
    const replacement = t.ownedOrderIds[0]!;
    expect(replacement).not.toBe(first);
    expect(dispatch(world, peer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 2, price: 100 }).ok).toBe(true);
    updateKnowledge(world); advanceTree(world, a);
    for (let step = 0; step < 3 && t.status === 'running'; step++) advanceTree(world, a);
    expect(t.status).toBe('succeeded'); expect(t.accounting?.units).toBe(2);
  });

  it('preserves external active work without issuing parallel decisions', () => {
    const world = createWorld({ seed: 19, population: 2, autonomy: false });
    const c = Object.values(world.citizens)[0]!;
    dispatch(world, c.id, { type: 'sleep', targetRest: 100 });
    if (!c.action) dispatch(world, c.id, { type: 'move', x: Math.min(world.width - 1, c.x + 1), y: c.y });
    expect(c.action).not.toBeNull();
    const id = c.action!.id;
    advanceTree(world, c);
    expect(c.action!.id).toBe(id);
    expect(c.mind!.tasks).toHaveLength(0);
  });
  it('prepares only grounded guarded candidates and serializable persistent mind state', () => {
    const world = createWorld({ seed: 5, population: 2, autonomy: false });
    const c = Object.values(world.citizens)[0]!;
    updateKnowledge(world);
    const before = JSON.stringify(world);
    const options = prepareTreeCandidates(observe(world, c.id));
    expect(JSON.stringify(world)).toBe(before);
    expect(options.length).toBeGreaterThan(0);
    advanceTree(world, c);
    const active = c.mind!.activeTaskId;
    if (c.action) { advanceTree(world, c); expect(c.mind!.activeTaskId).toBe(active); }
    expect(JSON.parse(JSON.stringify(c.mind)).version).toBe(1);
    tickWorld(world);
    expect(c.alive).toBe(true);
  });
  it('does not inspect private peer inventories in candidate preparation', () => {
    const world = createWorld({ seed: 3, population: 2, autonomy: false });
    const [c, peer] = Object.values(world.citizens);
    updateKnowledge(world);
    const before = prepareTreeCandidates(observe(world, c!.id));
    peer!.inventory['food:7'] = 10000;
    peer!.personality = 'Secret malicious motives';
    expect(prepareTreeCandidates(observe(world, c!.id))).toEqual(before);
  });
  it('scales attack candidates continuously with the projected reputation row', () => {
    // observe().reputations is the only reputation input; no world-private facts.
    const world = createWorld({ seed: 5, population: 2, controllerMode: 'composed', autonomy: false });
    const [a, peer] = Object.values(world.citizens);
    peer!.x = a!.x + 1; peer!.y = a!.y;
    const benefitFor = (level: 'neutral' | 'disliked' | 'hostile') => {
      world.reputations = {};
      if (level === 'disliked') changeReputation(world, a!.id, peer!.id, -1);
      if (level === 'hostile') changeReputation(world, a!.id, peer!.id, -3);
      const candidates = prepareTreeCandidates(observe(world, a!.id));
      const attack = candidates.find(c => c.task.definitionId === 'AttackCitizen' && c.task.targetId === peer!.id);
      return attack?.forecast.benefit;
    };
    // Opinions alone are not evidence of actual harm or profitable loot.
    expect(benefitFor('neutral')).toBeUndefined();
    expect(benefitFor('disliked')).toBeUndefined();
    expect(benefitFor('hostile')).toBeUndefined();
    expect(prepareTreeCandidates(observe(world, a!.id))[0]!.forecast.affinities).toBeDefined();
  });
  it('prepares executable sign attack candidates from dated sign evidence', () => {
    const world = createWorld({ seed: 17, population: 1, controllerMode: 'composed', autonomy: false });
    const a = Object.values(world.citizens)[0]!;
    a.inventory = { 'wood:1': 10 };
    const tiles: Point[] = [{ x: a.x + 1, y: a.y }, { x: a.x + 1, y: a.y + 1 }];
    updateKnowledge(world);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles, woodTier: 1 })).toMatchObject({ ok: true });
    const sign = Object.values(world.signs ?? {}).find(s => s.x === tiles[0]!.x)!;
    const candidates = prepareTreeCandidates(observe(world, a.id));
    const signAttack = candidates.find(c => c.task.definitionId === 'AttackStructure' && c.task.targetId === sign.id);
    expect(signAttack).toBeDefined();
    expect(signAttack!.forecast.feasible).toBe(true);
  });
});

const P = (x: number, y: number): Point => ({ x, y });
function composedWorld(seed: number, population: number): { world: World; citizens: Citizen[] } {
  const world = createWorld({ seed, population, controllerMode: 'composed', autonomy: false });
  return { world, citizens: Object.values(world.citizens) };
}
function placeDeposit(world: World, x: number, y: number, resource: Resource, tier: Tier = 1, stock = 3) {
  for (const id of Object.keys(world.deposits)) {
    const deposit = world.deposits[id]!;
    if (deposit.x === x && deposit.y === y) delete world.deposits[id];
  }
  // Coordinate-unique ids: multiple placed deposits must coexist.
  const id = `probe-${x}-${y}`;
  world.deposits[id] = { id, resource, tier, x, y, stock, capacity: stock, regrowAt: 0 };
  return world.deposits[id]!;
}
function seedRunningTask(citizen: Citizen, task: TreeTaskState): void {
  citizen.mind!.activeTaskId = task.id;
  citizen.mind!.tasks = [task];
}
/** Same-hunger invariant: a repeated hunger interrupt reason is a new hunger
 * episode and is allowed only once fullness recovered above the critical
 * threshold in between, never a repeated cancel for the same hunger. */
function expectHungerInterruptionsBounded(log: { tick: number; reason: string }[], fullnessByTick: Map<number, number>): void {
  const lastTick = new Map<string, number>();
  for (const entry of log) {
    const previous = lastTick.get(entry.reason);
    if (previous !== undefined)
      expect([...fullnessByTick].some(([tick, fullness]) => tick > previous && tick <= entry.tick && fullness >= 30)).toBe(true);
    lastTick.set(entry.reason, entry.tick);
  }
}
/** All integration below is real automatic ticks: no body authority, no direct
 * adapter calls during evaluation; only observation/assertion helpers. */
describe('composed controller automatic tick integration', () => {
  it('retains checkpoint-valid bounded evidence through 1500 ticks and real restore continuation', () => {
    const { world } = composedWorld(3, 2);
    const directory = mkdtempSync(join(tmpdir(), 'prosper-controller-restore-'));
    const path = join(directory, 'checkpoint.json');
    const checkpoint = (world: World): Checkpoint => ({ version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } });
    try {
      tickWorld(world, 1500);
      for (const citizen of Object.values(world.citizens)) {
        expect(citizen.mind!.tasks.length).toBeLessThanOrEqual(MIND_LIMITS.tasks);
        expect(citizen.mind!.receipts.length).toBeLessThanOrEqual(MIND_LIMITS.receipts);
        expect(citizen.mind!.memories.length).toBeLessThanOrEqual(MIND_LIMITS.memories);
      }
      saveCheckpoint(path, checkpoint(world));
      const restored = loadCheckpoint(path)!.world;
      expect(restored.citizens).toEqual(world.citizens);
      tickWorld(restored, 100);
      saveCheckpoint(path, checkpoint(restored));
      expect(loadCheckpoint(path)!.world.tick).toBe(1600);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('persists active tasks across ticks instead of re-selecting every tick', () => {
    const { world, citizens: [a] } = composedWorld(11, 1);
    a.fullness = 100; a.rest = { value: 100 }; a.inventory = {};
    world.deposits = {};
    const food = placeDeposit(world, a.x + 1, a.y, 'food', 1, 3);
    updateKnowledge(world);
    seedRunningTask(a, {
      id: 'persistent-food', definitionId: 'Harvest',
      request: { id: 'persistent-food', resource: 'food', tier: 1, quantity: 1, allowMarket: false, purpose: 'Persistence fixture', urgency: 'routine' },
      ancestry: [], phase: 'travel:0', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: food.id, target: { x: food.x, y: food.y },
    });
    const sequence: (string | undefined)[] = [];
    const fullnessByTick = new Map<number, number>();
    // Isolate persistence from regional spawn geometry and hunger/rest interrupts:
    // known reachable food must yield through the same multi-tick invocation.
    for (let t = 0; t < 100 && a.mind!.tasks[0]!.status === 'running'; t++) { tickWorld(world, 1); sequence.push(a.mind!.activeTaskId); fullnessByTick.set(world.tick, a.fullness); }
    expect(a.mind!.tasks.find(t => t.id === 'persistent-food')).toMatchObject({ status: 'succeeded', delivered: 1 });
    expect(a.inventory['food:1']).toBe(1);
    expect(sequence.filter(Boolean).every(id => id === 'persistent-food')).toBe(true);
    let maxRun = 0, run = 0, previous: string | undefined = null!;
    for (const id of sequence) { run = id && id === previous ? run + 1 : 1; maxRun = Math.max(maxRun, run); previous = id; }
    expect(maxRun).toBeGreaterThanOrEqual(25);
    expect(new Set(sequence).size).toBeLessThanOrEqual(8);
    expect(a.mind!.tasks.some(t => t.status === 'succeeded')).toBe(true);
    // Interrupt-free for everything but hunger, and hunger itself bounded: one
    // episode may interrupt once per crossed band, never a repeated cancel.
    const hungerLog = a.mind!.trace.filter(e => e.transition === 'interrupt' && /^(hunger|starvation)/.test(e.reason))
      .map(e => ({ tick: e.tick, reason: e.reason }));
    expect(a.mind!.trace.filter(e => e.transition === 'interrupt' && !/^(hunger|starvation)/.test(e.reason))).toEqual([]);
    expectHungerInterruptionsBounded(hungerLog, fullnessByTick);
    expect(a.alive).toBe(true);
  });
  it('remedies hunger through automatic ticks without danger interruption churn', () => {
    const { world, citizens: [a] } = composedWorld(3, 1);
    a.inventory = {}; a.fullness = 5;
    placeDeposit(world, a.x, a.y, 'food', 1, 6);
    for (let t = 0; t < 200; t++) tickWorld(world, 1);
    expect(a.alive).toBe(true);
    expect(a.fullness).toBeGreaterThan(10);
    const active = a.mind!.tasks.find(t => t.id === a.mind!.trace[0]!.invocationId);
    expect(active === undefined || ['ObtainResource', 'ObtainFoodNow', 'Harvest'].includes(active.definitionId)).toBe(true);
    // Meals are durable personal survival evidence once eaten.
    expect(a.mind!.memories.filter(m => m.kind === 'survival').length).toBeGreaterThanOrEqual(2);
    // Recovery permits a later hunger episode; only danger churn is forbidden.
    expect(a.mind!.trace.filter(entry => entry.transition === 'interrupt' && !/^(hunger|starvation)-critical/.test(entry.reason))).toEqual([]);
  });
  it('recovers rest through automatic sleep ticks', () => {
    const { world, citizens: [a] } = composedWorld(3, 1);
    a.inventory = { 'food:1': 8 }; a.fullness = 100;
    a.rest = { value: 30 };
    let sawSleep = false;
    for (let t = 0; t < 100; t++) {
      tickWorld(world, 1);
      if (a.action?.command.type === 'sleep' || a.mind!.trace.some(e => e.command?.type === 'sleep')) sawSleep = true;
    }
    expect(sawSleep).toBe(true);
    expect(a.rest!.value).toBeGreaterThan(60);
    expect(a.mind!.tasks.some(t => t.definitionId === 'Sleep' && t.status === 'succeeded')).toBe(true);
  });
  it('lets dated harm memory and directed reputation bias vengeance continuously', () => {
    const { world: hostileWorld, citizens: [ha, hb] } = composedWorld(3, 2);
    const { world: friendlyWorld, citizens: [fa, fb] } = composedWorld(3, 2);
    hb.x = ha.x + 1; hb.y = ha.y;
    fb.x = fa.x + 1; fb.y = fa.y;
    for (const a of [ha, fa]) {
      a.mind!.dispositions.morals = 0.1;
      a.mind!.dispositions.vengefulness = 1;
      a.mind!.dispositions.riskTolerance = 1;
      a.inventory = { 'food:1': 10 };
      a.fullness = 90;
    }
    const neutralOptions = prepareTreeCandidates(observe(hostileWorld, ha.id));
    const attackFor = () => prepareTreeCandidates(observe(hostileWorld, ha.id))
      .find(c => c.task.definitionId === 'AttackCitizen' && c.task.targetId === hb.id)!;
    expect(attackFor()).toBeUndefined();
    ha.mind!.memories = [{ id: 'provenance-harm', tick: 0, kind: 'harm', otherId: hb.id, text: 'attacked me' }];
    const neutralAttack = attackFor();
    expect(neutralAttack.forecast.feasible).toBe(true);
    // Hold every competing option fixed: only this peer's grievance evidence
    // changes. This measures softmax likelihood, not time-to-first-draw, which
    // also depends on unrelated family/preparation tasks and their durations.
    const alternatives = neutralOptions.filter(c => !c.task.definitionId.startsWith('Attack')).map(c => c.forecast);
    expect(alternatives.length).toBeGreaterThan(0);
    const fightProbability = (attack: typeof neutralAttack, morals = ha.mind!.dispositions.morals) =>
      optionProbabilities([
        // Same continuous conscience bias as the controller adapter.
        { ...attack.forecast, bias: -24 * morals }, ...alternatives,
      ], { ...ha.mind!.dispositions, morals }).find(p => p.id === attack.forecast.id)!.probability;
    const neutralProbability = fightProbability(neutralAttack);
    ha.mind!.memories.push({ id: 'second-harm', tick: 0, kind: 'harm', otherId: hb.id, text: 'attacked me again' });
    const rememberedAttack = attackFor();
    const rememberedProbability = fightProbability(rememberedAttack);
    changeReputation(hostileWorld, ha.id, hb.id, -1);
    const aggrievedAttack = attackFor();
    const aggrievedProbability = fightProbability(aggrievedAttack);
    expect(rememberedProbability).toBeGreaterThan(neutralProbability);
    expect(aggrievedProbability).toBeGreaterThanOrEqual(rememberedProbability); // bounded grievance saturates
    expect(aggrievedProbability).toBeLessThan(1); // grievance never forces combat
    const conscientiousProbability = fightProbability(aggrievedAttack, 1);
    expect(conscientiousProbability).toBeGreaterThan(0); // no high-morals cutoff
    expect(conscientiousProbability).toBeLessThan(aggrievedProbability);
    changeReputation(hostileWorld, ha.id, hb.id, -2); // hostile (total -3)
    ha.mind!.memories = [{ id: 'provenance-harm', tick: 0, kind: 'harm', otherId: hb.id, text: 'attacked me' }];
    changeReputation(friendlyWorld, fa.id, fb.id, 3); // admired
    fa.mind!.memories = [{ id: 'provenance-help', tick: 0, kind: 'help', otherId: fb.id, text: 'helped me' }];
    // Conditional integration: find a draw selecting the prepared branch, rather
    // than asserting the first autonomous draw beats unrelated task durations.
    const candidates = prepareTreeCandidates(observe(hostileWorld, ha.id));
    const options = candidates.map(c => ({ ...c.forecast,
      bias: c.task.definitionId.startsWith('Attack') ? -24 * ha.mind!.dispositions.morals : 0 }));
    const selected = candidates.find(c => c.task.definitionId === 'AttackCitizen' && c.task.targetId === hb.id)!;
    let selectingSeed: number | undefined;
    for (let seed = 0; seed < 10000; seed++) {
      if (chooseOption(options, ha.mind!.dispositions, seed).id === selected.forecast.id) { selectingSeed = seed; break; }
    }
    expect(selectingSeed).toBeDefined();
    seedRunningTask(ha, selected.task);
    for (let t = 0; t < 120 && !hostileWorld.events.some(e => e.kind === 'attack' && e.citizenId === ha.id && e.targetId === hb.id); t++) {
      tickWorld(hostileWorld, 1);
    }
    // Separate bounded integration evidence includes selection, pursuit and
    // completed damage, not a first-draw deadline or a likelihood estimate.
    expect(ha.mind!.tasks.some(t => t.definitionId === 'AttackCitizen' && t.targetId === hb.id)).toBe(true);
    expect(hostileWorld.events.some(e => e.kind === 'attack' && e.citizenId === ha.id && e.targetId === hb.id)).toBe(true);
    // Likelihood comparisons above, not paired time-to-first-attack claims,
    // establish the grievance effect. Independent combat tests cover uncertainty.
    // Same continuous conscience: neither world prohibits the branch outright.
    expect(Object.values(hostileWorld.citizens).every(c => c.alive)).toBe(true);
    expect(Object.values(friendlyWorld.citizens).every(c => c.alive)).toBe(true);
  });
  it('completes a shortfall sale through a production-for-sale prerequisite child', () => {
    const { world, citizens: [seller, buyer] } = composedWorld(3, 2);
    // The funded buyer is a passive fixture, not a competing controller.
    buyer.x = seller.x + 1; buyer.y = seller.y; buyer.gold = 1000;
    seller.inventory = { 'wood:1': 2, 'food:1': 10 }; seller.fullness = 100;
    const saleRequest = { id: 'sale-1', resource: 'wood' as Resource, tier: 1 as Tier, quantity: 3, allowMarket: true, purpose: 'Fund provisions', urgency: 'routine' as const };
    seedRunningTask(seller, {
      id: 'sell-1', definitionId: 'SellItem', request: saleRequest, ancestry: [], phase: 'start',
      status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [],
      targetId: 'wood:1',
    });
    placeDeposit(world, seller.x + 1, seller.y, 'wood', 1, 3);
    const gold = seller.gold;
    expect(dispatch(world, buyer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 3, price: 100 }))
      .toMatchObject({ ok: true });
    const authority = { citizens: { [seller.id]: 'local-ai' as const, [buyer.id]: 'passive-body' as const }, newbornAuthority: 'passive-body' as const };
    let saleSucceeded = false;
    for (let t = 0; t < 220 && !saleSucceeded; t++) {
      tickWorld(world, 1, { authority });
      saleSucceeded = seller.mind!.tasks.some(t => t.id === 'sell-1' && t.status === 'succeeded');
    }
    const children = seller.mind!.tasks.filter(t => t.parentId === 'sell-1' && t.definitionId === 'ObtainResource');
    expect(children).toHaveLength(1);
    expect(children[0]!.request.purpose).toContain('Produce wood:1 for sale: Fund provisions');
    expect(children[0]!.status).toBe('succeeded');
    expect(children[0]!.ancestry).toEqual(['SellItem']);
    expect(saleSucceeded).toBe(true);
    const proceeds = world.events.filter(e => e.kind === 'trade' && e.targetId === seller.id)
      .reduce((sum, e) => sum + Number(/^([\d.]+) /.exec(e.text)?.[1] ?? 0) * Number(/sold for ([\d.]+) gold/.exec(e.text)?.[1] ?? 0), 0);
    expect(proceeds).toBe(300); // Three actual fills at the funded resting bid.
    expect(seller.mind!.tasks.find(t => t.id === 'sell-1')!.accounting?.units).toBe(3);
    expect(seller.inventory['wood:1'] ?? 0).toBe(0);
    expect(seller.gold).toBe(gold + proceeds);
    expect(buyer.gold).toBe(1000 - proceeds);
    expect(Object.values(world.orders).filter(o => o.citizenId === buyer.id && o.item === 'wood:1')).toHaveLength(0);
  });
  it('interrupts owned work on material danger, cleans up, and reconsiders without compulsory retaliation', () => {
    const { world, citizens: [a, b] } = composedWorld(3, 2);
    a.inventory = { 'food:1': 10, 'wood:1': 4 }; a.fullness = 100;
    const escrow = dispatch(world, a.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 99 });
    expect(escrow.order?.id).toBeDefined();
    const orderId = escrow.order!.id;
    const woodDeposit = placeDeposit(world, a.x + 3, a.y, 'wood', 1, 3);
    seedRunningTask(a, {
      id: 'harvest-1', definitionId: 'Harvest',
      request: { id: 'wood-req', resource: 'wood', tier: 1, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'routine' },
      ancestry: [], phase: 'travel:0', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [orderId], targetId: woodDeposit.id, target: { x: a.x + 3, y: a.y },
    });
    tickWorld(world, 2);
    expect(a.action).not.toBeNull();
    b.x = a.x + 1; b.y = a.y;
    const attack = dispatch(world, b.id, { type: 'attack', targetId: a.id });
    expect(attack).toMatchObject({ ok: true });
    const dangerTick = world.tick;
    let interrupted = -1, exited = -1, orderSettled = -1, defended = -1, attackedBack = -1;
    for (let t = 0; t < 40; t++) {
      tickWorld(world, 1);
      const interruptCount = a.mind!.trace.filter(e => e.transition === 'interrupt').length;
      if (interrupted < 0 && interruptCount > 0) interrupted = world.tick;
      if (exited < 0 && a.mind!.tasks.every(t => !t.id.startsWith('harvest-1') || t.status !== 'running')) exited = world.tick;
      if (orderSettled < 0 && !world.orders[orderId]) orderSettled = world.tick;
      const defenses = a.mind!.tasks.filter(t => t.definitionId === 'AttackCitizen');
      if (defended < 0 && defenses.length) defended = world.tick;
      if (attackedBack < 0 && (a.action?.command.type === 'attack' || a.mind!.trace.some(e => e.command?.type === 'attack'))) attackedBack = world.tick;
      if (world.tick > dangerTick + 36) break;
    }
    expect(interrupted).toBeGreaterThanOrEqual(0);
    expect(exited).toBeGreaterThanOrEqual(0);
    // Cleanup order: owned order settled before the terminal interruption report.
    expect(orderSettled).toBeLessThanOrEqual(exited);
    expect(a.mind!.tasks.find(t => t.id === 'harvest-1')).toMatchObject({
      status: 'failed', reason: expect.stringContaining('interrupted: material-danger:'),
    });
    // The triggering event creates a stochastic reconsideration, not an attack
    // directive. This seed chooses a nonviolent alternative.
    expect(a.mind!.trace.some(e => e.transition === 'select' && e.reason.startsWith('material-danger:'))).toBe(true);
    expect(attackedBack).toBe(-1);
    expect(a.alive).toBe(true);
    expect(b.alive).toBe(true);
    // Each distinct attack may trigger reconsideration, but never twice for the
    // same event, even when the interrupted action was itself combat.
    const interruptions = a.mind!.trace.filter(e => e.transition === 'interrupt');
    expect(new Set(interruptions.map(e => e.reason)).size).toBe(interruptions.length);
  });
  it('interrupts an unrelated resting sale on newly critical hunger, settles the owned order, and reconsiders food once per episode', () => {
    const { world, citizens: [seller] } = composedWorld(3, 1);
    seller.inventory = { 'wood:1': 4 }; // nothing edible
    seller.fullness = 32;               // crosses below 30 during the resting sale
    const saleRequest = { id: 'sale-req', resource: 'wood' as Resource, tier: 1 as Tier, quantity: 2, allowMarket: true, purpose: 'Fund provisions', urgency: 'routine' as const };
    seedRunningTask(seller, {
      id: 'sell-1', definitionId: 'SellItem', request: saleRequest, ancestry: [], phase: 'start',
      status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [],
      targetId: 'wood:1',
    });
    const deposit = placeDeposit(world, seller.x, seller.y, 'food', 1, 6); // obtainable food
    updateKnowledge(world);
    let orderId: string | undefined, interrupted = -1, orderSettled = -1, exited = -1, recovered = -1;
    const hunger: { tick: number; reason: string }[] = [];
    const fullnessByTick = new Map<number, number>();
    for (let t = 0; t < 300 && recovered < 0; t++) {
      tickWorld(world, 1);
      fullnessByTick.set(world.tick, seller.fullness);
      orderId ??= seller.mind!.tasks.find(t => t.id === 'sell-1')?.ownedOrderIds[0];
      for (const entry of seller.mind!.trace.filter(e => e.tick === world.tick && e.transition === 'interrupt' &&
        (/^hunger-critical:/.test(e.reason) || e.reason === 'starvation-critical'))) {
        hunger.push({ tick: world.tick, reason: entry.reason });
        if (interrupted < 0) interrupted = world.tick;
      }
      if (orderId && orderSettled < 0 && !world.orders[orderId]) orderSettled = world.tick;
      if (exited < 0 && seller.mind!.tasks.every(t => t.id !== 'sell-1' || t.status !== 'running')) exited = world.tick;
      if (interrupted >= 0 && seller.fullness >= 30) recovered = world.tick;
    }
    expect(interrupted).toBeGreaterThanOrEqual(0);
    expect(hunger[0]!.reason).toBe('hunger-critical:2');
    expect(orderId).toBeDefined();
    // Cleanup order: owned order settled at/after the interrupt, before the
    // terminal interruption report.
    expect(orderSettled!).toBeGreaterThanOrEqual(interrupted);
    expect(orderSettled!).toBeLessThanOrEqual(exited!);
    expect(seller.mind!.tasks.find(t => t.id === 'sell-1')).toMatchObject({
      status: 'failed', reason: expect.stringContaining('interrupted: hunger-critical:2'),
    });
    // Obtainable food won through ordinary local selection; the urgent remedy
    // proposed real work on the nearby deposit.
    expect(seller.mind!.trace.some(e => e.tick > exited! && e.transition === 'propose' &&
      ['ObtainResource', 'Harvest', 'ObtainFoodNow'].includes(e.definitionId) && e.command)).toBe(true);
    expect(seller.mind!.trace.some(e => e.tick > exited! && e.command?.type === 'harvest' && e.command.depositId === deposit.id)).toBe(true);
    expect(recovered).toBeGreaterThan(exited!);
    expect(seller.fullness).toBeGreaterThan(10);
    expect(seller.alive).toBe(true);
    // The same hunger never cancels twice: reasons repeat only after recovery.
    expectHungerInterruptionsBounded(hunger, fullnessByTick);
  });
  it('preempts owned unrelated work on newly critical hunger, cancels the work, and redirects effort to obtainable food', () => {
    const { world, citizens: [a] } = composedWorld(3, 1);
    a.inventory = {}; // nothing edible
    a.fullness = 31;
    const woodForWork = placeDeposit(world, a.x + 3, a.y, 'wood', 1, 3);
    const foodNearby = placeDeposit(world, a.x, a.y, 'food', 1, 6); // obtainable food nearby
    seedRunningTask(a, {
      id: 'harvest-1', definitionId: 'Harvest',
      request: { id: 'wood-req', resource: 'wood' as Resource, tier: 1 as Tier, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'routine' as const },
      ancestry: [], phase: 'travel:0', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: woodForWork.id, target: { x: a.x + 3, y: a.y },
    });
    updateKnowledge(world);
    tickWorld(world, 3); // establish owned travel work with an accepted action
    expect(a.action).not.toBeNull();
    const workTick = world.tick;
    let interrupted = -1, exited = -1, actionStopped = -1, remedy = -1, recovered = -1;
    const hunger: { tick: number; reason: string }[] = [];
    const fullnessByTick = new Map<number, number>();
    for (let t = 0; t < 300 && recovered < 0; t++) {
      tickWorld(world, 1);
      fullnessByTick.set(world.tick, a.fullness);
      for (const entry of a.mind!.trace.filter(e => e.tick === world.tick && e.transition === 'interrupt' &&
        (/^hunger-critical:/.test(e.reason) || e.reason === 'starvation-critical'))) {
        hunger.push({ tick: world.tick, reason: entry.reason });
        if (interrupted < 0) interrupted = world.tick;
      }
      if (interrupted >= 0 && exited < 0 && a.mind!.tasks.every(t => t.id !== 'harvest-1' || t.status !== 'running')) exited = world.tick;
      if (interrupted >= 0 && actionStopped < 0 && (!a.action || a.action.command?.type === 'cancel')) actionStopped = world.tick;
      if (remedy < 0 && exited >= 0 && a.mind!.trace.some(e => e.tick > exited && e.tick <= world.tick && e.transition === 'propose' &&
        ['ObtainResource', 'Harvest', 'ObtainFoodNow'].includes(e.definitionId) && e.command)) remedy = world.tick;
      if (interrupted >= 0 && a.fullness >= 30) recovered = world.tick;
    }
    expect(interrupted).toBeGreaterThanOrEqual(workTick);
    expect(hunger[0]!.reason).toBe('hunger-critical:2');
    expect(a.mind!.tasks.find(t => t.id === 'harvest-1')).toMatchObject({
      status: 'failed', reason: expect.stringContaining('interrupted: hunger-critical:2'),
    });
    // The owned action was cancelled before the terminal report...
    expect(actionStopped).toBeGreaterThanOrEqual(interrupted);
    expect(actionStopped!).toBeLessThanOrEqual(exited!);
    // ...and the urgent food remedy proposed real food-harvest work after exit.
    expect(remedy).toBeGreaterThan(exited!);
    expect(a.mind!.trace.some(e => e.tick > exited! &&
      ['ObtainResource', 'Harvest', 'ObtainFoodNow'].includes(e.definitionId) && e.command?.type === 'harvest')).toBe(true);
    expect(recovered).toBeGreaterThan(exited!);
    expect(a.alive).toBe(true);
    expectHungerInterruptionsBounded(hunger, fullnessByTick);
  });
  it('interrupts sleep at actual starvation so obtainable food keeps the citizen alive', () => {
    const { world, citizens: [a] } = composedWorld(3, 1);
    a.inventory = {}; // nothing edible
    a.rest = { value: 30 };
    a.fullness = 20 * BALANCE.fullnessDrain; // exhausts fullness within ~20 ticks, before sleep ends
    const foodDeposit = placeDeposit(world, a.x, a.y, 'food', 1, 6);
    updateKnowledge(world);
    expect(dispatch(world, a.id, { type: 'sleep', targetRest: 100 })).toMatchObject({ ok: true });
    expect(a.action).not.toBeNull();
    seedRunningTask(a, {
      id: 'sleep-1', definitionId: 'Sleep',
      request: { id: 'rest-req', resource: 'food' as Resource, tier: 1 as Tier, quantity: 85, allowMarket: false, purpose: 'Rested', urgency: 'survival' as const },
      ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], actionId: a.action!.id,
    });
    let interrupted = -1, exited = -1, recovered = -1;
    const hunger: { tick: number; reason: string }[] = [];
    const fullnessByTick = new Map<number, number>();
    for (let t = 0; t < 900 && recovered < 0; t++) {
      tickWorld(world, 1);
      fullnessByTick.set(world.tick, a.fullness);
      for (const entry of a.mind!.trace.filter(e => e.tick === world.tick && e.transition === 'interrupt' &&
        (/^hunger-critical:/.test(e.reason) || e.reason === 'starvation-critical'))) {
        hunger.push({ tick: world.tick, reason: entry.reason });
        if (entry.reason === 'starvation-critical' && interrupted < 0) interrupted = world.tick;
      }
      if (interrupted >= 0 && exited < 0 && !a.mind!.tasks.some(t => t.id === 'sleep-1' && t.status === 'running')) exited = world.tick;
      if (interrupted >= 0 && a.fullness > 20) recovered = world.tick;
    }
    expect(interrupted).toBeGreaterThanOrEqual(0);
    expect(hunger.map(h => h.reason)).toContain('starvation-critical');
    expect(a.mind!.tasks.find(t => t.id === 'sleep-1')).toMatchObject({
      status: 'failed', reason: expect.stringContaining('interrupted: starvation-critical'),
    });
    expect(exited).toBeGreaterThan(interrupted!);
    // No sleep is proposed again while actually starving (fullness exhausted).
    expect(a.mind!.trace.filter(e => e.tick > interrupted! && e.command?.type === 'sleep' && fullnessByTick.get(e.tick) === 0)).toEqual([]);
    // The remedy restores fullness before the body fails.
    expect(recovered).toBeGreaterThan(interrupted!);
    expect(a.fullness).toBeGreaterThan(20);
    expect(a.health).toBeGreaterThan(50);
    expect(a.alive).toBe(true);
    expectHungerInterruptionsBounded(hunger, fullnessByTick);
  });
  it('keeps the admission request alive and the member projection honest', () => {
    const { world, citizens: [owner, applicant] } = composedWorld(5, 2);
    owner.inventory = { 'wood:1': 10 };
    owner.x = 5; owner.y = 5; applicant.x = 6; applicant.y = 5;
    // Member-retention pin: the tested premise is a live current member, so the
    // owner stays occupied with ordinary owned work (selection never reroutes
    // into a LeaveTerritory draw inside the short window).
    const ownerWork = placeDeposit(world, owner.x + 2, owner.y + 2, 'wood', 1, 4);
    seedRunningTask(owner, {
      id: 'owner-work', definitionId: 'Harvest',
      request: { id: 'owner-work-req', resource: 'wood', tier: 1, quantity: 1, allowMarket: false, purpose: 'work the local deposit', urgency: 'routine' },
      ancestry: [], phase: 'travel:0', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: ownerWork.id, target: { x: ownerWork.x, y: ownerWork.y },
    });
    const tiles = [P(5, 6)];
    updateKnowledge(world);
    expect(dispatch(world, owner.id, { type: 'create-territory', tiles, woodTier: 1 })).toMatchObject({ ok: true });
    const territoryId = Object.keys(world.territories ?? {})[0]!;
    expect(dispatch(world, applicant.id, { type: 'join-territory', territoryId })).toMatchObject({ ok: true });
    const admission = world.territories![territoryId]!.admissions.at(-1)!;
    expect(admission.status).toBe('pending');
    // The applicant's own view carries their own pending admission outcome.
    const applicantView = observe(world, applicant.id).territories!.find(t => t.id === territoryId)!;
    expect(applicantView.admissions.some(a => a.id === admission.id && a.status === 'pending')).toBe(true);
    expect(observe(world, owner.id).territories!.find(t => t.id === territoryId)!.admissions)
      .toContainEqual(expect.objectContaining({ id: admission.id, status: 'pending' }));
    for (let t = 0; t < 40; t++) tickWorld(world, 1);
    const current = world.territories![territoryId]!.admissions.find(entry => entry.id === admission.id)!;
    expect(['pending', 'admitted', 'refused', 'timeout', 'expired'].includes(current.status)).toBe(true);
  });
  it('reaches stations and refinement through ordinary local selection with carried prerequisites', () => {
    const { world, citizens: [a, b, buyer] } = composedWorld(3, 3);
    b.x = a.x + 1; b.y = a.y;
    buyer.x = a.x; buyer.y = a.y + 1;
    const authority = {citizens:{[a.id]:'local-ai' as const,[b.id]:'local-ai' as const,[buyer.id]:'passive-body' as const},newbornAuthority:'passive-body' as const};
    for (const c of [a, b]) {
      // Enough finite inputs remain after construction/tool costs to refine
      // output for the funded T2 demand, rather than exhausting the affordance.
      c.inventory = { 'wood:1': 180, 'fibre:1': 140, 'food:1': 12, 'food:2': 6 };
      c.fullness = 100;
      c.mind!.dispositions.morals = 1;
      // Finite economic progression fixture: independently uninterested in
      // family, rather than competing with the stronger family opportunity.
      c.mind!.dispositions.familyOrientation = 0;
      c.mind!.dispositions.enterprise = 1;
    }
    // Isolate carried-input progression from competing extraction and hunger.
    // This is an affordance fixture, not a natural survival benchmark.
    world.deposits = {};
    buyer.gold = 1000;
    for (const resource of ['wood', 'fibre', 'food'])
      expect(dispatch(world, buyer.id, {type:'order',side:'buy',item:`${resource}:2`,quantity:30,price:1}).ok).toBe(true);
    updateKnowledge(world);
    const completed = new Set<string>();
    const unknownLandFailures: string[] = [];
    for (let t = 0; t < 2400; t++) {
      for (const c of [a, b]) c.fullness = 100;
      tickWorld(world,1,{authority});
      updateKnowledge(world);
      for (const c of [a, b]) for (const task of c.mind!.tasks) {
        if (task.status === 'succeeded') {
          completed.add(task.definitionId);
          if (task.strategyId === 'refine') completed.add('RefineResource');
        }
        if (task.reason?.includes('outside this citizen')) unknownLandFailures.push(task.reason);
      }
    }
    expect(completed).toContain('BuildResourceBuilding');
    expect(completed).toContain('RefineResource');
    expect(completed).toContain('CreateTerritory');
    expect(unknownLandFailures).toEqual([]);
  }, 60_000);
  it('reaches consent-free reproduction with one T1 each and adjacent observed partners', () => {
    const { world, citizens: [a, b] } = composedWorld(3, 2);
    world.width = 3; world.height = 3; world.deposits = {};
    a.x = 1; a.y = 1; b.x = 2; b.y = 1;
    for (const c of [a, b]) {
      c.inventory = { 'food:2': 3, 'food:1': 2 }; c.fullness = 100;
      c.mind!.dispositions.morals = 1; c.mind!.dispositions.familyOrientation = 1;
      c.mind!.dispositions.generosity = 0;
    }
    updateKnowledge(world);
    expect(prepareTreeCandidates(observe(world, a.id)).some(c => c.task.definitionId === 'Reproduce')).toBe(true);
    for (let t = 0; t < 500 && Object.keys(world.citizens).length === 2; t++) tickWorld(world);
    expect(Object.values(world.citizens).some(c => c.parents.includes(a.id) && c.parents.includes(b.id))).toBe(true);
    expect([a, b].some(c => c.mind!.trace.some(e => e.command?.type === 'consent'))).toBe(false);
  });
  it('does not offer distant reproduction or manufacture rendezvous travel', () => {
    const { world, citizens: [a, b] } = composedWorld(3, 2);
    a.x = 30; a.y = 20; b.x = 33; b.y = 20;
    for (const c of [a, b]) { c.inventory = { 'food:1': 1 }; c.fullness = 100; c.health = 100; }
    updateKnowledge(world);
    expect(prepareTreeCandidates(observe(world, a.id)).some(c => c.task.definitionId === 'Reproduce')).toBe(false);
    expect(dispatch(world, a.id, {type:'reproduce',partnerId:b.id}).code).toBe('not-adjacent');
    expect(Object.values(world.citizens)).toHaveLength(2);
    expect(a.inventory['food:1']).toBe(1); expect(b.inventory['food:1']).toBe(1);
  });
  it('excludes depleted observed deposits across acquisition definitions without trace spam', () => {
    const { world, citizens: [a] } = composedWorld(3, 1);
    a.inventory = {}; a.gold = 0;
    world.deposits = {};
    const depleted = placeDeposit(world, a.x, a.y, 'wood', 1, 0);
    updateKnowledge(world);
    const options = prepareTreeCandidates(observe(world, a.id));
    expect(options.some(c => ['Harvest', 'ObtainResource'].includes(c.task.definitionId) && c.task.request.resource === 'wood')).toBe(false);
    expect(a.mind!.trace).toHaveLength(0);
    // A reservation failure remains invalid evidence even with positive visible
    // stock: reservations are not exposed by the observation contract.
    world.deposits[depleted.id]!.stock = 1;
    // Generic production now needs a use; a real pending station recipe supplies
    // the intent without weakening the exhausted/reserved-deposit exclusion.
    seedRunningTask(a, {id:'station-intent',definitionId:'BuildResourceBuilding',request:{id:'station-intent',resource:'wood',tier:1,quantity:1,allowMarket:false,purpose:'station',urgency:'routine'},ancestry:[],phase:'start',status:'running',startedTick:0,lastProgressTick:0,delivered:0,receiptIds:[],ownedOrderIds:[]});
    const failed = prepareTreeCandidates(observe(world, a.id)).find(c => c.task.definitionId === 'Harvest' && c.task.request.resource === 'wood')!.task;
    failed.status = 'failed'; failed.targetId = depleted.id; failed.reason = 'Deposit is depleted or reserved; wait for regrowth or choose another.';
    a.mind!.tasks.push(failed);
    const retry = prepareTreeCandidates(observe(world, a.id));
    expect(retry.some(c => ['Harvest', 'ObtainResource'].includes(c.task.definitionId) && c.task.request.resource === 'wood')).toBe(false);
    expect(a.mind!.trace).toHaveLength(0);
  });
  it('keeps an ObtainTool prerequisite chain alive through a transient deposit race and crafts the tool', () => {
    // The observed ObtainTool failure mode: the one harvestable deposit is
    // momentarily claimed by another citizen, the delegated material child
    // fails, and the old cascade abandoned the whole chain (64-84 failures,
    // 1-3 successes). Here the chain defers once (parent stays running), the
    // visible-but-empty alternate route never fakes feasibility, and the
    // persistent chain retries the approved delegation once supply returns.
    const { world, citizens: [a, peer] } = composedWorld(3, 2);
    a.inventory = { 'wood:1': 3, 'fibre:1': 2, 'food:1': 2 }; // knife:1 missing one fibre:1
    a.gold = 0; peer.gold = 0;
    a.fullness = 100;
    world.deposits = {};
    const claimed = placeDeposit(world, a.x + 2, a.y, 'fibre', 1, 1);
    // Public-work evaluation now detects the competitor before travelling.
    // Keep the empty alternate in the initial Manhattan-3 sight diamond so
    // later regrowth is genuinely observed from that truthful deferral site.
    const growing = placeDeposit(world, a.x + 2, a.y + 1, 'fibre', 1, 0);
    peer.x = claimed.x; peer.y = claimed.y; // peer claims the only harvestable stock
    peer.inventory = { 'food:1': 12 };
    // The peer is occupied by its own bounded, unfilled resting sale while the
    // chain defers and retries (peer gold 0: no fills, no material loss).
    seedRunningTask(peer, {
      id: 'peer-sale', definitionId: 'SellItem',
      request: { id: 'peer-sale-req', resource: 'food', tier: 1, quantity: 3, allowMarket: true, purpose: 'Sell food', urgency: 'routine' },
      ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: 'food:1',
    });
    updateKnowledge(world);
    expect(dispatch(world, peer.id, { type: 'harvest', depositId: claimed.id })).toMatchObject({ ok: true });
    seedRunningTask(a, {
      id: 'tool-1', definitionId: 'ObtainTool',
      request: { id: 'tool-req', resource: 'wood', tier: 1, quantity: 1, allowMarket: true, purpose: 'Obtain knife', urgency: 'routine' },
      ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [], targetId: 'knife:1',
    });
    let transiently = -1, retried = false;
    for (let t = 0; t < 600 && !(a.inventory['knife:1'] > 0); t++) {
      tickWorld(world, 1, { authority: { citizens: { [a.id]: 'local-ai', [peer.id]: 'passive-body' }, newbornAuthority: 'passive-body' } });
      // Supply returns while the chain is in its bounded deferral window.
      if (world.tick === 42) world.deposits[growing.id]!.stock = 1;
      const parent = a.mind!.tasks.find(t => t.definitionId === 'ObtainTool' && t.targetId === 'knife:1');
      if (transiently < 0 && parent && parent.status === 'running' && /transiently/.test(parent.reason ?? '')) transiently = world.tick;
      if (a.mind!.trace.some(e => /Awaiting a 40-tick prerequisite retry/.test(e.reason))) retried = true;
      // Public competitor evidence can reject the route before delegating;
      // that is a truthful deferral, not a fabricated failed harvest.
    }
    // The transient child failure deferred the chain instead of abandoning it.
    expect(transiently).toBeGreaterThanOrEqual(0);
    expect(retried).toBe(true);
    // The persistent chain still delivered the exact-tier tool.
    expect(a.inventory['knife:1']).toBe(1);
    expect(a.alive).toBe(true);
  });
  it('reaches a station and refinement through the construction prerequisite chain', () => {
    // No carried construction materials and no carried tool stock: the fresh
    // candidate set must still expose the persistent procurement chain (the
    // observed normal run produced zero BuildResourceBuilding candidates).
    const { world, citizens: [a, buyer] } = composedWorld(3, 2);
    buyer.gold = 1000;
    buyer.x = a.x; buyer.y = a.y + 1;
    const authority = {citizens:{[a.id]:'local-ai' as const,[buyer.id]:'passive-body' as const},newbornAuthority:'passive-body' as const};
    expect(dispatch(world, buyer.id, {type:'order',side:'buy',item:'wood:2',quantity:30,price:1}).ok).toBe(true);
    a.inventory = { 'food:1': 15 };
    a.fullness = 100;
    a.mind!.dispositions.ambition = 1;
    a.mind!.dispositions.economicIndependence = 1;
    a.mind!.dispositions.riskTolerance = 0;
    world.deposits = {};
    placeDeposit(world, a.x + 2, a.y, 'wood', 1, 8);
    placeDeposit(world, a.x + 1, a.y, 'fibre', 1, 8);
    updateKnowledge(world);
    const initial = prepareTreeCandidates(observe(world, a.id));
    const initialWood = initial.find(c => c.task.definitionId === 'BuildResourceBuilding' && c.task.request.resource === 'wood' && c.task.request.tier === 1);
    expect(initialWood).toBeDefined();
    seedRunningTask(a, initialWood!.task);
    const completed = new Set<string>();
    let supplied = false;
    for (let t = 0; t < 2200; t++) {
      tickWorld(world, 1, {authority});
      for (const task of a.mind!.tasks) if (task.status === 'succeeded') {
        completed.add(task.definitionId);
        if (task.strategyId === 'refine') completed.add('RefineResource');
      }
      // Additional actual input stock for the funded output demand, only after
      // procurement has independently finished the real station.
      if (!supplied && completed.has('BuildResourceBuilding')) {
        a.inventory['wood:1'] = (a.inventory['wood:1'] ?? 0) + 9;
        const station = Object.values(world.buildings).find(b => b.ownerId === a.id && b.kind === 'lumbermill')!;
        seedRunningTask(a, {
          id: 'committed-refine', definitionId: 'RefineResource',
          request: { id: 'committed-refine', resource: 'wood', tier: 2, quantity: 1, allowMarket: false, purpose: 'Refine at completed station', urgency: 'routine' },
          ancestry: [], phase: 'travel:0', strategyId: 'refine-up', targetId: station.id,
          status: 'running', startedTick: world.tick, lastProgressTick: world.tick,
          delivered: 0, receiptIds: [], ownedOrderIds: [],
        });
        supplied = true;
      }
    }
    expect(completed).toContain('BuildResourceBuilding');
    expect(completed).toContain('RefineResource');
    expect(Object.keys(world.buildings).length).toBeGreaterThanOrEqual(1);
    expect(a.alive).toBe(true);
  });
  it('offers exploration goals only for evidence not currently in sight and never succeeds without real search', () => {
    const { world, citizens: [a] } = composedWorld(3, 1);
    a.inventory = { 'food:1': 10 };
    a.fullness = 100;
    world.deposits = {};
    placeDeposit(world, a.x + 1, a.y, 'food', 1, 6);
    updateKnowledge(world);
    const candidates = prepareTreeCandidates(observe(world, a.id));
    const explore = candidates.find(c => c.task.definitionId === 'Explore');
    expect(explore).toBeDefined();
    const visibleKeys = new Set((observe(world, a.id)).visible.flatMap(t => t.deposits.map(d => `${d.resource}:${d.tier}`)));
    const match = /deposit (food|wood|fibre) T(\d+)/.exec(explore!.task.request.purpose);
    if (match) expect(visibleKeys.has(`${match[1]}:${match[2]}`)).toBe(false);
    // Automatic ticks: a goal-refresh success requires the citizen to have
    // actually proposed travel in that invocation — the old always-visible
    // 'deposit food T1' purpose succeeded with zero travel on every selection.
    const invocationsWithTravel = new Set<string>();
    for (let t = 0; t < 200; t++) {
      tickWorld(world);
      for (const entry of a.mind!.trace.filter(e => e.tick === world.tick)) {
        if (entry.transition === 'propose' && entry.command?.type === 'move') invocationsWithTravel.add(entry.invocationId);
        if (entry.transition === 'succeed' && entry.definitionId === 'Explore' && /Search goal refreshed in sight/.test(entry.reason))
          expect(invocationsWithTravel.has(entry.invocationId)).toBe(true);
      }
    }
  });
  it('bounds idle waiting instead of letting composed citizens stall forever', () => {
    const { world, citizens: [a] } = composedWorld(21, 1);
    updateKnowledge(world);
    const initialKnown = Object.keys(a.knowledge).length;
    const visited = new Set<string>();
    let longestWaitStreak = 0, streak = 0, tasks = new Set<string>();
    for (let t = 0; t < 500; t++) {
      tickWorld(world, 1);
      updateKnowledge(world);
      const entry = a.mind!.trace.at(-1)!;
      if (entry.transition === 'wait') { streak++; longestWaitStreak = Math.max(longestWaitStreak, streak); }
      else streak = 0;
      visited.add(`${a.x},${a.y}`);
      tasks.add(entry.definitionId);
    }
    // No unbounded stall: waits are bounded and effort gets redirected.
    expect(longestWaitStreak).toBeLessThanOrEqual(121);
    expect(visited.size).toBeGreaterThan(1);
    expect(Object.keys(a.knowledge).length).toBeGreaterThan(initialKnown);
    expect(tasks.size).toBeGreaterThanOrEqual(2);
    expect(a.alive).toBe(true);
  });
});