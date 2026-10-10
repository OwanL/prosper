import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { marketCommand } from '../src/world/market.ts';

function setup() {
  const world = createWorld({ seed: 1 });
  const [buyer, seller, other] = Object.values(world.citizens);
  return { world, buyer, seller, other };
}

describe('receipt-grounded market settlement', () => {
  it('distinguishes an open order from delivery without inventing income', () => {
    const { world, buyer, seller } = setup();
    seller.inventory['wood:1'] = 3;
    const before = structuredClone(buyer);
    const result = marketCommand(world, seller.id, {
      type: 'order',
      side: 'sell',
      item: 'wood:1',
      quantity: 3,
      price: 12,
    });
    expect(result.order).toMatchObject({
      side: 'sell',
      requestedQuantity: 3,
      filledQuantity: 0,
      remainingQuantity: 3,
      goldPaid: 0,
      goldReceived: 0,
    });
    expect(result.message).toContain('Filled 0/3');
    expect(result.message).toContain('reserved, not delivered');
    expect(seller.gold).toBe(100);
    expect(buyer).toEqual(before);
    expect(world.orders[result.order!.id].escrowItems).toEqual({ 'wood:1': 3 });
  });

  it('reports a partial sale and actual resting bid price, not the ask', () => {
    const { world, buyer, seller } = setup();
    seller.inventory['food:2'] = 3;
    marketCommand(world, buyer.id, {
      type: 'order',
      side: 'buy',
      item: 'food:2',
      quantity: 1,
      price: 20,
    });
    const result = marketCommand(world, seller.id, {
      type: 'order',
      side: 'sell',
      item: 'food:2',
      quantity: 3,
      price: 10,
    });
    expect(result.order).toMatchObject({
      requestedQuantity: 3,
      filledQuantity: 1,
      remainingQuantity: 2,
      goldPaid: 0,
      goldReceived: 20,
    });
    expect(buyer.inventory['food:2']).toBe(1);
    expect(seller.gold).toBe(120);
    expect(world.orders[result.order!.id].escrowItems).toEqual({ 'food:2': 2 });
  });

  it('aggregates actual prices across fills and excludes refunded price improvement', () => {
    const { world, buyer, seller, other } = setup();
    seller.inventory['fibre:3'] = 1;
    other.inventory['fibre:3'] = 2;
    marketCommand(world, seller.id, {
      type: 'order',
      side: 'sell',
      item: 'fibre:3',
      quantity: 1,
      price: 15,
    });
    marketCommand(world, other.id, {
      type: 'order',
      side: 'sell',
      item: 'fibre:3',
      quantity: 2,
      price: 20,
    });
    const result = marketCommand(world, buyer.id, {
      type: 'order',
      side: 'buy',
      item: 'fibre:3',
      quantity: 3,
      price: 25,
    });
    expect(result.order).toMatchObject({
      requestedQuantity: 3,
      filledQuantity: 3,
      remainingQuantity: 0,
      goldPaid: 55,
      goldReceived: 0,
    });
    expect(buyer.gold).toBe(45);
    expect(buyer.inventory['fibre:3']).toBe(3);
    expect(world.orders[result.order!.id]).toBeUndefined();
    expect(Object.values(world.citizens).reduce((n, c) => n + c.gold, 0)).toBe(world.initialGold);
  });

  it('does not attach a success receipt or change balances on a failed delivery', () => {
    const { world, buyer, seller } = setup();
    marketCommand(world, buyer.id, {
      type: 'order',
      side: 'buy',
      item: 'food:2',
      quantity: 2,
      price: 20,
    });
    const before = structuredClone(world);
    const result = marketCommand(world, seller.id, {
      type: 'order',
      side: 'sell',
      item: 'food:2',
      quantity: 2,
      price: 20,
    });
    expect(result).toMatchObject({ ok: false, code: 'insufficient-items' });
    expect(result.order).toBeUndefined();
    expect(world).toEqual(before);
  });

  it('never treats the actor own opposite listing as a fill', () => {
    const { world, seller } = setup();
    seller.inventory['wood:1'] = 1;
    marketCommand(world, seller.id, {
      type: 'order',
      side: 'sell',
      item: 'wood:1',
      quantity: 1,
      price: 10,
    });
    const result = marketCommand(world, seller.id, {
      type: 'order',
      side: 'buy',
      item: 'wood:1',
      quantity: 1,
      price: 10,
    });
    expect(result.order).toMatchObject({
      filledQuantity: 0,
      remainingQuantity: 1,
      goldPaid: 0,
      goldReceived: 0,
    });
    expect(world.events.filter((e) => e.kind === 'trade')).toHaveLength(0);
  });
});
