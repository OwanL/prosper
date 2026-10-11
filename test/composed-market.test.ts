import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { cancelBuildingOrders, cancelCitizenOrders, cancelLegacyBuildingOrders, marketCommand } from '../src/world/market.ts';
import type { World } from '../src/shared/types.ts';

function fixture() {
  const world = createWorld({ population: 2, autonomy: false });
  const [seller, buyer] = Object.values(world.citizens);
  seller.inventory = { 'wood:1': 2.75, 'axe:1': 1 };
  seller.gold = 100;
  buyer.gold = 100;
  buyer.inventory = {};
  return { world, seller, buyer };
}
function place(world: World, who: string, side: 'buy' | 'sell', item: string, quantity: number, price: number) {
  return marketCommand(world, who, { type: 'order', side, item, quantity, price });
}
const gold = (w: World) => Object.values(w.citizens).reduce((sum, c) => sum + c.gold, 0) + Object.values(w.orders).reduce((sum, o) => sum + o.escrowGold, 0);

describe('commodity-only composed market', () => {
  it('settles fractional commodities at resting prices and refunds remaining escrow', () => {
    const { world, seller, buyer } = fixture();
    expect(place(world, seller.id, 'sell', 'wood:1', 2.75, 3).ok).toBe(true);
    expect(place(world, buyer.id, 'buy', 'wood:1', 1.25, 4).order?.filledQuantity).toBe(1.25);
    expect(buyer.inventory['wood:1']).toBe(1.25);
    expect(buyer.gold).toBe(96.25);
    cancelCitizenOrders(world, seller.id);
    expect(seller.inventory['wood:1']).toBe(1.5);
    expect(gold(world)).toBe(200);
    expect(place(world, buyer.id, 'buy', 'food:1', 0.25, 3).ok).toBe(true);
    const order = Object.values(world.orders)[0];
    expect(marketCommand(world, buyer.id, { type: 'cancel-order', orderId: order.id }).ok).toBe(true);
    expect(buyer.gold).toBe(96.25);
    expect(gold(world)).toBe(200);
  });

  it('sells carried tools intact but rejects fractional tools', () => {
    const { world, seller, buyer } = fixture();
    expect(place(world, seller.id, 'sell', 'axe:1', 0.5, 2).ok).toBe(false);
    expect(place(world, seller.id, 'sell', 'axe:1', 1, 2).ok).toBe(true);
    expect(place(world, buyer.id, 'buy', 'axe:1', 1, 2).ok).toBe(true);
    expect(buyer.inventory['axe:1']).toBe(1);
    expect(seller.inventory['axe:1']).toBeUndefined();
    expect(gold(world)).toBe(200);
  });

  it('rejects both building sides and refunds legacy orders without transfer', () => {
    const { world, seller, buyer } = fixture();
    for (const side of ['buy', 'sell'] as const)
      expect(place(world, buyer.id, side, 'building:mill', 1, 10)).toMatchObject({ ok: false, code: 'building-trading-disabled' });
    world.orders.legacy = { id: 'legacy', citizenId: buyer.id, side: 'buy', item: 'building:mill', quantity: 1, price: 10, createdTick: 0, sequence: 0, escrowGold: 10, escrowItems: {} };
    buyer.gold -= 10;
    cancelBuildingOrders(world, 'mill');
    expect(buyer.gold).toBe(100);
    world.orders.legacy = { id: 'legacy', citizenId: seller.id, side: 'sell', item: 'building:mill', quantity: 1, price: 10, createdTick: 0, sequence: 0, escrowGold: 0, escrowItems: {} };
    cancelLegacyBuildingOrders(world);
    expect(world.orders).toEqual({});
    expect(gold(world)).toBe(200);
  });
});
