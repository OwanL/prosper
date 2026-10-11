import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { marketCommand } from '../src/world/market.ts';
import { ensureTelemetry, sampleTelemetry } from '../src/world/telemetry.ts';
import { saveCheckpoint, loadCheckpoint, validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';

function setup() {
  const world = createWorld({ population: 2, autonomy: false });
  const [buyer, seller] = Object.values(world.citizens);
  buyer.gold = 0.12;
  seller.gold = 199.88;
  seller.inventory['wood:1'] = 100;
  world.initialGold = buyer.gold + seller.gold;
  const cp: Checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
    runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
  return { world, buyer, seller, cp };
}

it('fully funded fractional fills do not refund negative escrow as a charge', () => {
  const { world, buyer, seller, cp } = setup();
  const buy = marketCommand(world, buyer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 0.04, price: 3 });
  expect(buy.ok).toBe(true);
  expect(buyer.gold).toBe(0);
  expect(marketCommand(world, seller.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 0.03, price: 3 }).ok).toBe(true);
  const remaining = world.orders[buy.order!.id].quantity;
  expect(marketCommand(world, seller.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: remaining, price: 3 }).ok).toBe(true);
  // Before the fix: -6.938893903907228e-18, despite exact initial funding.
  expect(buyer.gold).toBe(0);
  world.tick = 20;
  sampleTelemetry(world);
  expect(world.telemetry!.frames.at(-1)!.citizens[buyer.id].cash).toBe(0);
  expect(() => validateCheckpoint(cp)).not.toThrow();
});

it('repeated fractional partial fills and cancellation conserve gold and save cleanly', () => {
  const { world, buyer, seller, cp } = setup();
  buyer.gold = 100;
  seller.gold = 100;
  world.initialGold = buyer.gold + seller.gold;
  for (let i = 0; i < 500; i++) {
    const buy = marketCommand(world, buyer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 0.04, price: 3 });
    expect(buy.ok).toBe(true);
    expect(marketCommand(world, seller.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 0.03, price: 3 }).ok).toBe(true);
    expect(marketCommand(world, buyer.id, { type: 'cancel-order', orderId: buy.order!.id }).ok).toBe(true);
    expect(buyer.gold).toBeGreaterThanOrEqual(0);
    expect(Math.abs(buyer.gold + seller.gold - world.initialGold)).toBeLessThan(1e-9);
  }
  const directory = mkdtempSync(join(tmpdir(), 'prosper-roundoff-'));
  try {
    const path = join(directory, 'checkpoint.json');
    saveCheckpoint(path, cp);
    expect(loadCheckpoint(path).world.citizens[buyer.id].gold).toBe(buyer.gold);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('samples only epsilon negatives as zero, retaining real overdrafts and existing history', () => {
  const { world, buyer, cp } = setup();
  buyer.gold = -4.440892098500626e-16;
  delete world.telemetry;
  ensureTelemetry(world);
  expect(world.telemetry!.frames[0].citizens[buyer.id].cash).toBe(0);
  expect(buyer.gold).toBe(-4.440892098500626e-16);
  buyer.gold = -2e-9;
  world.tick = 20;
  sampleTelemetry(world);
  expect(world.telemetry!.frames[1].citizens[buyer.id].cash).toBe(-2e-9);
  expect(() => validateCheckpoint(cp)).toThrow();
});

it('does not tolerate underfunding, including an epsilon shortfall', () => {
  const { world, buyer } = setup();
  buyer.gold = 0.12 - 1e-12;
  for (let i = 0; i < 100; i++) {
    expect(marketCommand(world, buyer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 0.04, price: 3 }).ok).toBe(false);
  }
  expect(Object.keys(world.orders)).toHaveLength(0);
  expect(buyer.gold).toBe(0.12 - 1e-12);
});
