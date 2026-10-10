import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CitizenObservation, WorldEvent } from '../src/shared/types.ts';
import type { CommitRecord } from '../src/evaluation/contracts.ts';
import { initializeFixture, totalGold } from '../src/evaluation/fixtures.ts';
import { createNoCommandCandidate } from '../src/evaluation/candidates/no-command.ts';
import { runEpisode, replayEpisode, type EpisodeReport } from '../src/evaluation/runner.ts';
import { productionTradeFixture, productionTradeReference, PRODUCTION_TRADE_SITE } from '../src/evaluation/development/production-trade.ts';

const outputs: string[] = [];
afterEach(() => {
  for (const path of outputs.splice(0)) rmSync(path, { recursive: true, force: true });
});
async function run(...args: Parameters<typeof runEpisode>) {
  const report = await runEpisode(...args);
  outputs.push(report.outputDirectory);
  return report;
}
type TraceRecord = EpisodeReport['outcome'] & {
  kind: string;
  commit?: CommitRecord;
  observation: CitizenObservation;
  immediateObservation?: CitizenObservation;
  events: WorldEvent[];
};
function trace(report: EpisodeReport): TraceRecord[] {
  return readFileSync(join(report.outputDirectory, 'trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
}
function assertAccountingAndReplay(report: EpisodeReport, records: TraceRecord[]) {
  expect(report.status).toBe('complete');
  expect(report.ticks).toBe(320);
  expect(report.decisions).toBe(320);
  expect(report.failures).toBe(0);
  expect(report.usage).toMatchObject({ modelCalls: 0, tokens: 0 });
  expect(report.accountingValid).toBe(true);
  expect(records.every(record => record.totalGold === 16 && record.initialGold === 16)).toBe(true);
  expect(records.filter(record => record.kind === 'tick').map(record => record.tick)).toEqual(Array.from({ length: 320 }, (_, i) => i + 1));
  expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
}

// These assertions certify THIS authored development trajectory, not generic
// intelligence. The manifest/runner objective independently scores vitals only.
describe('authored real-engine production/trade development probe', () => {
  it('initializes only declared endowments and genuine finite resting orders', () => {
    const initial = initializeFixture(productionTradeFixture());
    const ids = Object.keys(initial.world.citizens);
    expect(initial.manifest.split).toBe('development');
    expect(initial.actorId).toBe(ids[0]);
    expect(initial.world.citizens[initial.actorId]).toMatchObject({ x: 27, y: 2, gold: 0, inventory: {}, action: null, queue: [] });
    expect(initial.world.deposits[PRODUCTION_TRADE_SITE.depositId]).toMatchObject({ x: 6, y: 1, resource: 'wood', tier: 1, stock: 1, capacity: 1 });
    expect(totalGold(initial.world)).toBe(16);
    expect(initial.options.authority?.citizens).toEqual({ [ids[0]]: 'direct', [ids[1]]: 'passive-body', [ids[2]]: 'passive-body' });
    expect(initial.options.authority?.newbornAuthority).toBe('passive-body');
    expect(initial.setupLog).toHaveLength(2);
    for (const setup of initial.setupLog) {
      expect(setup.knownResult.ok).toBe(true);
      expect(setup.dispatchResult.ok).toBe(true);
      expect(setup.dispatchResult.order?.filledQuantity).toBe(0);
    }
    expect(Object.values(initial.world.orders)).toEqual([
      expect.objectContaining({ citizenId: ids[1], side: 'sell', item: 'food:1', quantity: 4, escrowItems: { 'food:1': 4 } }),
      expect.objectContaining({ citizenId: ids[2], side: 'buy', item: 'wood:1', quantity: 1, escrowGold: 16 }),
    ]);
    expect(initial.world.citizens[ids[1]].inventory['food:1']).toBe(3);
    expect(initial.world.citizens[ids[2]].gold).toBe(0);
  });

  it('completes 22 travel steps, 40 work ticks, actual sale/purchase and four automatic meals, then exactly replays', async () => {
    const report = await run(productionTradeFixture(), productionTradeReference());
    const records = trace(report);
    assertAccountingAndReplay(report, records);
    expect(report.success).toBe(true);
    const initialization = records.find(record => record.kind === 'initialization')!;
    const actorId = initialization.observation.citizen.id;
    const ids = initialization.holders.map(holder => holder.id);
    expect(initialization.observation.visible.flatMap(tile => tile.deposits.map(deposit => deposit.id))).not.toContain(PRODUCTION_TRADE_SITE.depositId);
    const commands = records.filter(record => record.kind === 'decision' && record.commit?.decision?.kind === 'command');
    expect(commands.map(record => record.commit?.decision)).toEqual([
      expect.objectContaining({ command: { type: 'move', x: 6, y: 1 } }),
      expect.objectContaining({ command: { type: 'harvest', depositId: PRODUCTION_TRADE_SITE.depositId } }),
      expect.objectContaining({ command: { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 16 } }),
      expect.objectContaining({ command: { type: 'order', side: 'buy', item: 'food:1', quantity: 4, price: 4 } }),
    ]);
    expect(commands.map(record => record.tick)).toEqual([0, 44, 84, 85]);
    expect(commands.every(record => record.commit?.knownResult?.ok && record.commit.dispatchResult?.ok)).toBe(true);
    expect(commands[0].actor.action).toMatchObject({ phase: 'travel', path: expect.any(Array) });
    expect(commands[0].actor.action?.path).toHaveLength(22);
    const ticks = records.filter(record => record.kind === 'tick');
    expect(ticks.every(record => record.observation.visible.every(tile => tile.seenTick === record.tick))).toBe(true);
    expect(ticks.find(record => record.tick === 44)?.observation.citizen).toMatchObject({ x: 6, y: 1, action: null });
    expect(commands[1].observation.visible.flatMap(tile => tile.deposits.map(deposit => deposit.id))).toContain(PRODUCTION_TRADE_SITE.depositId);
    expect(commands[1].actor.action).toMatchObject({ phase: 'work', duration: 40, elapsed: 0 });
    expect(ticks.find(record => record.tick === 83)?.actor.inventory['wood:1'] ?? 0).toBe(0);
    expect(ticks.find(record => record.tick === 84)?.actor).toMatchObject({ inventory: { 'wood:1': 1 }, action: null, gold: 0 });
    expect(commands[2].commit?.dispatchResult?.order).toMatchObject({ filledQuantity: 1, remainingQuantity: 0, goldReceived: 16 });
    expect(commands[2].actor.gold).toBe(16);
    expect(commands[2].holders.find(holder => holder.id === ids[2])?.inventory['wood:1']).toBe(1);
    expect(commands[3].commit?.dispatchResult?.order).toMatchObject({ filledQuantity: 4, remainingQuantity: 0, goldPaid: 16 });
    expect(commands[3].actor).toMatchObject({ gold: 0, inventory: { 'food:1': 4 } });
    expect(commands[3].immediateObservation?.citizen.fullness).toBeCloseTo(71.5, 8);
    expect(commands[3].holders.find(holder => holder.id === ids[1])?.gold).toBe(16);
    const actorMeals = records.flatMap(record => record.events.filter(event => event.kind === 'meal' && event.citizenId === actorId));
    expect(actorMeals.map(event => event.tick)).toEqual([86, 87, 134, 245]);
    expect(report.outcome.actor).toMatchObject({ alive: true, health: 100, gold: 0, action: null, queue: [] });
    expect(report.outcome.actor.inventory['wood:1'] ?? 0).toBe(0);
    expect(report.outcome.actor.inventory['food:1'] ?? 0).toBe(0);
    expect(report.outcome.actor.fullness).toBeCloseTo(92.44444444444444, 8);
    expect(Object.values(report.outcome.orders)).toHaveLength(0);
    expect(report.outcome.holders.every(holder => holder.alive && holder.health === 100)).toBe(true);
    const retained = JSON.parse(readFileSync(join(report.outputDirectory, 'initialization.json'), 'utf8'));
    expect(JSON.stringify(retained)).toContain('authored-script-sha256:');
  });

  it('compares no-command with and without authored meal endowments, with no strategic rescue or trades', async () => {
    for (const food of [0, 4] as const) {
      const report = await run(productionTradeFixture(food), createNoCommandCandidate);
      const records = trace(report);
      assertAccountingAndReplay(report, records);
      expect(report.success).toBe(food === 4);
      expect(report.outcome.actor.fullness).toBeCloseTo(food === 4 ? 92.44444444444444 : 48, 8);
      expect(report.outcome.actor).toMatchObject({ alive: true, health: 100, gold: 0, action: null, queue: [] });
      expect(report.outcome.actor.inventory['wood:1'] ?? 0).toBe(0);
      expect(records.filter(record => record.kind === 'decision').every(record => record.commit?.decision?.kind === 'advance' && record.commit.dispatchResult === undefined)).toBe(true);
      expect(records.filter(record => record.kind === 'tick').every(record => record.observation.citizen.x === 27 && record.observation.citizen.y === 2 && record.actor.action === null)).toBe(true);
      const actorId = records[0].observation.citizen.id;
      expect(records.flatMap(record => record.events.filter(event => event.kind === 'meal' && event.citizenId === actorId))).toHaveLength(food);
      expect(Object.values(report.outcome.orders)).toHaveLength(2);
      expect(Object.values(report.outcome.orders).find(order => order.side === 'buy')?.escrowGold).toBe(16);
      expect(Object.values(report.outcome.orders).find(order => order.side === 'sell')?.escrowItems).toEqual({ 'food:1': 4 });
    }
  });
});
