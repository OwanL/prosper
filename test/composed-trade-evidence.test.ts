import { describe, expect, it } from 'vitest';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import type { World } from '../src/shared/types.ts';

const gold = (world: World) => Object.values(world.citizens).reduce((sum, c) => sum + c.gold, 0)
  + Object.values(world.orders).reduce((sum, order) => sum + order.escrowGold, 0);
function fixture() {
  const world = createWorld({ population: 3 });
  const [seller, buyer, peer] = Object.values(world.citizens);
  seller.inventory['wood:1'] = 10;
  buyer.gold = 100;
  const place = (who: string, side: 'buy' | 'sell', quantity: number, price: number) => {
    const result = dispatch(world, who, { type: 'order', side, item: 'wood:1', quantity, price });
    expect(result.ok).toBe(true);
    expect(result.order).toBeDefined();
    return result.order!;
  };
  return { world, seller, buyer, peer, place };
}
const checkpoint = (world: World): Checkpoint => ({ version: 1, savedAt: new Date().toISOString(), world,
  runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } });

describe('structured market settlement evidence', () => {
  it('attributes distinct same-item listings, partial fills and cancel/reprice without changing custody', () => {
    const { world, seller, buyer, peer, place } = fixture();
    const initialGold = gold(world);
    const first = place(seller.id, 'sell', 0.5, 2);
    const second = place(seller.id, 'sell', 1.5, 3);
    const buy = place(buyer.id, 'buy', 1, 4);
    expect(world.events.filter(e => e.trade).map(e => e.trade)).toEqual([
      { buyOrderId: buy.id, sellOrderId: first.id, item: 'wood:1', quantity: 0.5, price: 2, buyerId: buyer.id, sellerId: seller.id },
      { buyOrderId: buy.id, sellOrderId: second.id, item: 'wood:1', quantity: 0.5, price: 3, buyerId: buyer.id, sellerId: seller.id },
    ]);
    expect(world.orders[buy.id]).toBeUndefined();
    expect(world.orders[second.id].quantity).toBe(1);
    expect(dispatch(world, seller.id, { type: 'cancel-order', orderId: second.id }).ok).toBe(true);
    const repriced = place(seller.id, 'sell', 1, 2);
    const finalBuy = place(buyer.id, 'buy', 1, 2);
    expect(world.events.filter(e => e.trade).at(-1)?.trade?.sellOrderId).toBe(repriced.id);
    expect(world.events.filter(e => e.trade).at(-1)?.trade?.buyOrderId).toBe(finalBuy.id);
    expect(gold(world)).toBe(initialGold);
    expect(seller.inventory['wood:1']).toBe(8);
    expect(buyer.inventory['wood:1']).toBe(2);
    updateKnowledge(world);
    for (const who of [seller, buyer]) expect(observe(world, who.id).alerts.filter(e => e.trade)).toHaveLength(3);
    expect(observe(world, peer.id).alerts.filter(e => e.trade)).toHaveLength(0);
  });

  it('returns the incoming sell ID even when it settles completely, and roundtrips optional evidence', () => {
    const { world, seller, buyer, place } = fixture();
    const initialGold = gold(world);
    const buy = place(buyer.id, 'buy', 0.75, 4);
    const sell = place(seller.id, 'sell', 0.75, 2);
    expect(sell.remainingQuantity).toBe(0);
    expect(sell.goldReceived).toBe(3);
    expect(world.orders[sell.id]).toBeUndefined();
    const trade = world.events.filter(e => e.trade).at(-1)!.trade!;
    expect(trade).toEqual({ buyOrderId: buy.id, sellOrderId: sell.id, item: 'wood:1', quantity: 0.75,
      price: 4, buyerId: buyer.id, sellerId: seller.id });
    expect(gold(world)).toBe(initialGold);
    const cp = checkpoint(world);
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp))).world.events.filter(e => e.trade).at(-1)?.trade).toEqual(trade);
    for (const field of ['quantity', 'price'] as const) {
      for (const invalid of [0, -1, Infinity, NaN]) {
        const malformed = structuredClone(cp);
        malformed.world.events.filter(e => e.trade).at(-1)!.trade![field] = invalid;
        expect(() => validateCheckpoint(malformed)).toThrow();
      }
    }
    const legacy = structuredClone(cp);
    for (const event of [...legacy.world.events, ...(legacy.world.significantEvents ?? [])]) delete event.trade;
    expect(() => validateCheckpoint(legacy)).not.toThrow();
  });
});
