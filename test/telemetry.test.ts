import { describe, expect, it } from 'vitest';
import { HISTORY_CADENCE, HISTORY_LIMIT } from '../src/shared/telemetry-types.ts';
import { TIERS } from '../src/shared/tiers.ts';
import type { Action, World } from '../src/shared/types.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { marketCommand } from '../src/world/market.ts';
import { citizenHistory, ensureTelemetry, globalHistory, sampleTelemetry } from '../src/world/telemetry.ts';
import { event } from '../src/shared/utils.ts';
import { observe } from '../src/world/observation.ts';

function fixture() {
  const world = createWorld({ population: 3 });
  const [a, b, c] = Object.values(world.citizens);
  a.inventory['wood:1'] = 20;
  return { world, a, b, c };
}
const order = (world: World, id: string, side: 'buy' | 'sell', quantity: number, price: number) =>
  dispatch(world, id, { type: 'order', side, item: 'wood:1', quantity, price });
const latest = (world: World) => world.telemetry!.frames.at(-1)!;

describe('bounded spectator telemetry', () => {
  it('starts with every founder at the actual tick and does not duplicate baseline', () => {
    const { world } = fixture();
    expect(latest(world).population).toBe(3);
    expect(Object.keys(latest(world).citizens)).toHaveLength(3);
    sampleTelemetry(world);
    ensureTelemetry(world);
    tickWorld(world, 0);
    expect(world.telemetry!.frames).toHaveLength(1);
    delete world.telemetry;
    world.tick = 137;
    dispatch(world, 'missing', { type: 'cancel' });
    expect(world.telemetry!.startedTick).toBe(137);
    expect(world.telemetry!.frames.map((f) => f.tick)).toEqual([137]);
    tickWorld(world, 19);
    expect(world.telemetry!.frames).toHaveLength(1);
    tickWorld(world);
    expect(latest(world).tick).toBe(157);
  });

  it('counts exact partial matches, resting prices, same-tick fills and no cancelled volume', () => {
    const { world, a, b, c } = fixture();
    expect(order(world, a.id, 'sell', 3, 4).ok).toBe(true);
    expect(order(world, b.id, 'buy', 2, 6).ok).toBe(true);
    expect(order(world, c.id, 'buy', 2, 5).ok).toBe(true);
    expect(world.telemetry!.pending['wood:1']).toEqual({ units: 3, turnover: 12, fills: 2 });
    const open = Object.values(world.orders)[0];
    expect(dispatch(world, c.id, { type: 'cancel-order', orderId: open.id }).ok).toBe(true);
    expect(order(world, b.id, 'buy', 1, 1000).ok).toBe(false);
    expect(world.telemetry!.pending['wood:1']).toEqual({ units: 3, turnover: 12, fills: 2 });
    tickWorld(world, HISTORY_CADENCE);
    expect(latest(world).markets['wood:1']).toMatchObject({
      units: 3, turnover: 12, fills: 2, lastPrice: 4, lastTick: 0, supply: 0, demand: 0,
      bid: null, ask: null,
    });
    tickWorld(world, HISTORY_CADENCE);
    expect(latest(world).markets['wood:1']).toMatchObject({ units: 0, turnover: 0, fills: 0, lastPrice: 4, lastTick: 0 });
  });

  it('excludes self trades and captures unmatched book quotes, quantities and buy escrow', () => {
    const { world, a, b } = fixture();
    order(world, a.id, 'sell', 5, 4);
    order(world, a.id, 'buy', 3, 5);
    expect(world.telemetry!.pending).toEqual({});
    order(world, b.id, 'buy', 2, 2);
    tickWorld(world, HISTORY_CADENCE);
    expect(latest(world).markets['wood:1']).toMatchObject({ bid: 5, ask: 4, supply: 5, demand: 5, units: 0, held: 5 });
    expect(latest(world).citizens[a.id]).toMatchObject({ cash: 85, escrow: 15 });
    expect(latest(world).citizens[b.id]).toMatchObject({ cash: 96, escrow: 4 });
  });

  it('does not depend on retained event text or eviction', () => {
    const { world, a, b } = fixture();
    order(world, a.id, 'sell', 1, 7);
    order(world, b.id, 'buy', 1, 7);
    for (let i = 0; i < 1100; i++) event(world, 'work', 'noise');
    world.events = [];
    tickWorld(world, HISTORY_CADENCE);
    expect(latest(world).markets['wood:1']).toMatchObject({ units: 1, turnover: 7, fills: 1 });
  });

  it('separates carried, both work holds, sell escrow and unharvested ground counting carried tools once', () => {
    const { world, a } = fixture();
    a.inventory['axe:1'] = 1;
    const heldAction = (quantity: number): Action => ({
      id: `held-${quantity}`, command: { type: 'craft', item: 'axe', tier: 1 },
      phase: 'work', startedTick: 0, elapsed: 0, duration: 8,
      reserved: { 'wood:1': quantity }, path: [], target: { x: a.x, y: a.y },
    });
    a.action = heldAction(2);
    a.emergency = { startedTick: 0, depositId: 'test', outsideAreas: false, stage: 'gather', suspendedAction: heldAction(3) };
    order(world, a.id, 'sell', 4, 8);
    world.tick = HISTORY_CADENCE;
    sampleTelemetry(world);
    expect(latest(world).markets['wood:1']).toMatchObject({ carried: 16, held: 9, supply: 4,
      ground: Object.values(world.deposits).filter((d) => d.resource === 'wood' && d.tier === 1).reduce((n, d) => n + d.stock, 0) });
    expect(latest(world).markets['axe:1'].carried).toBe(1);
    expect(Object.keys(latest(world).markets)).toHaveLength(7 * TIERS.length);
    expect(Object.keys(latest(world).markets).some((key) => key.startsWith('building:'))).toBe(false);
  });

  it('includes only one terminal death point and living-only aggregate means', () => {
    const { world, a, b, c } = fixture();
    a.health = 0;
    tickWorld(world, HISTORY_CADENCE);
    expect(latest(world).citizens[a.id].alive).toBe(false);
    expect(latest(world).population).toBe(2);
    expect(latest(world).meanHealth).toBe((b.health + c.health) / 2);
    tickWorld(world, HISTORY_CADENCE * 2);
    expect(latest(world).citizens[a.id]).toBeUndefined();
    expect(citizenHistory(world, a.id).points.map((p) => p.alive)).toEqual([true, false]);
  });

  it('produces identical frames for batched and individual ticks including local autonomy', () => {
    const batch = createWorld({ population: 3, seed: 19, autonomy: true });
    const steps = structuredClone(batch);
    tickWorld(batch, 80);
    for (let i = 0; i < 80; i++) tickWorld(steps);
    expect(batch.telemetry).toEqual(steps.telemetry);
    expect(batch.telemetry!.frames.map((f) => f.tick)).toEqual([0, 20, 40, 60, 80]);
  });

  it('retains a mid-interval accumulator across serialized restoration', () => {
    const { world, a, b } = fixture();
    tickWorld(world, 7);
    // Also exercise the ordinary direct market API's legacy initialization boundary.
    delete world.telemetry;
    marketCommand(world, a.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 5, price: 3 });
    order(world, b.id, 'buy', 2, 4);
    tickWorld(world, 8);
    const restored = JSON.parse(JSON.stringify(world)) as World;
    tickWorld(world, 12);
    tickWorld(restored, 12);
    expect(restored.telemetry).toEqual(world.telemetry);
    expect(latest(restored).tick).toBe(27);
    expect(latest(restored).markets['wood:1']).toMatchObject({ units: 2, turnover: 6, fills: 1, lastTick: 7 });
  });

  it('bounds frames to 256, preserves start metadata and isolates history projections', () => {
    const { world, a } = fixture();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      world.tick += HISTORY_CADENCE;
      sampleTelemetry(world);
      sampleTelemetry(world);
    }
    expect(world.telemetry!.frames).toHaveLength(HISTORY_LIMIT);
    expect(world.telemetry!.startedTick).toBe(0);
    expect(new Set(world.telemetry!.frames.map((f) => f.tick)).size).toBe(HISTORY_LIMIT);
    const global = globalHistory(world);
    expect(global.frames[0]).not.toHaveProperty('citizens');
    global.frames[0].markets['wood:1'].carried = -99;
    const personal = citizenHistory(world, a.id);
    personal.points[0].cash = -99;
    expect(world.telemetry!.frames[0].markets['wood:1'].carried).not.toBe(-99);
    expect(world.telemetry!.frames[0].citizens[a.id].cash).not.toBe(-99);
    expect(citizenHistory(world, 'unknown').points).toEqual([]);
    expect(observe(world, a.id)).not.toHaveProperty('telemetry');
  });
});
