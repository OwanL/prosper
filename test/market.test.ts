import { describe, expect, it } from 'vitest';
import { MAX_TIER, TIERS } from '../src/shared/tiers.ts';
import type { Action, Citizen, Command, World } from '../src/shared/types.ts';
import {
  cancelBuildingOrders,
  cancelCitizenOrders,
  isBuildingListed,
  marketCommand,
} from '../src/world/market.ts';

function citizen(id: string): Citizen {
  return {
    id,
    name: id,
    color: 'blue',
    personality: '',
    x: 0,
    y: 0,
    alive: true,
    health: 100,
    fullness: 100,
    gold: 100,
    inventory: {},
    action: null,
    queue: [],
    goals: [],
    memories: [],
    knowledge: {},
    lastResult: '',
    nextReviewTick: 0,
    consent: {},
    reproductionCooldown: 0,
    parents: [],
  };
}
function fixture(): World {
  return {
    schemaVersion: 1,
    runId: 'test',
    seed: 1,
    rngState: 1,
    nextId: 1,
    tick: 0,
    width: 10,
    height: 10,
    initialGold: 300,
    citizens: { a: citizen('a'), b: citizen('b'), c: citizen('c') },
    deposits: {},
    buildings: {},
    orders: {},
    loot: {},
    messages: [],
    events: [],
  };
}
const place = (
  w: World,
  who: string,
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
  item = 'wood:1',
) => marketCommand(w, who, { type: 'order', side, quantity, price, item });
const gold = (w: World) =>
  Object.values(w.citizens).reduce((n, c) => n + c.gold, 0) +
  Object.values(w.orders).reduce((n, o) => n + o.escrowGold, 0);
function building(w: World) {
  w.buildings.mill = {
    id: 'mill',
    kind: 'lumbermill',
    tier: 1,
    ownerId: 'a',
    x: 5,
    y: 5,
    health: 100,
    maxHealth: 100,
    materials: { 'wood:1': 10 },
  };
}
function refine(w: World) {
  w.citizens.a.action = {
    id: 'work',
    command: { type: 'refine', buildingId: 'mill', fromTier: 1 },
    phase: 'work',
    startedTick: 0,
    elapsed: 0,
    duration: 10,
    reserved: { 'wood:1': 3 },
    path: [],
    target: { x: 5, y: 5 },
  } satisfies Action;
}

describe('market escrow and settlement', () => {
  it('settles remotely outside sight with no meetup, travel or world ticks', () => {
    const w = fixture();
    w.citizens.b.x = 9;
    w.citizens.b.y = 9;
    w.citizens.a.inventory['wood:1'] = 3;
    expect(place(w, 'a', 'sell', 3, 2).ok).toBe(true);
    expect(place(w, 'b', 'buy', 3, 2).ok).toBe(true);
    expect(w.citizens.b.inventory['wood:1']).toBe(3);
    expect(w.citizens.a.gold).toBe(106);
    expect(w.citizens.b.gold).toBe(94);
    expect(w.citizens.a).toMatchObject({ x: 0, y: 0, action: null });
    expect(w.citizens.b).toMatchObject({ x: 9, y: 9, action: null });
    expect(w.tick).toBe(0);
    expect(w.orders).toEqual({});
    expect(gold(w)).toBe(w.initialGold);
  });

  it('partially fills at resting sell price and immediately refunds excess buy gold', () => {
    const w = fixture();
    w.citizens.a.inventory['wood:1'] = 5;
    expect(place(w, 'a', 'sell', 5, 3).ok).toBe(true);
    expect(w.citizens.a.inventory['wood:1']).toBeUndefined();
    expect(place(w, 'b', 'buy', 8, 5).ok).toBe(true);
    expect(w.citizens.b.gold).toBe(70); // 15 paid, 15 still reserved
    expect(w.citizens.a.gold).toBe(115);
    expect(w.citizens.b.inventory['wood:1']).toBe(5);
    expect(Object.values(w.orders)[0]).toMatchObject({ quantity: 3, escrowGold: 15 });
    expect(gold(w)).toBe(300);
    cancelCitizenOrders(w, 'b');
    expect(w.citizens.b.gold).toBe(85);
    expect(gold(w)).toBe(300);
  });
  it('serves best prices then time, and pays a resting buy price', () => {
    const w = fixture();
    w.citizens.a.inventory['wood:1'] = 6;
    place(w, 'b', 'buy', 2, 7);
    place(w, 'c', 'buy', 2, 9);
    place(w, 'b', 'buy', 2, 9);
    place(w, 'a', 'sell', 3, 5);
    expect(w.citizens.c.inventory['wood:1']).toBe(2);
    expect(w.citizens.b.inventory['wood:1']).toBe(1);
    expect(w.citizens.a.gold).toBe(127);
    expect(gold(w)).toBe(300);
    // Remaining sell can cross the older, lower buy at that buy's price.
    place(w, 'a', 'sell', 3, 5);
    expect(w.citizens.a.gold).toBe(150);
    expect(gold(w)).toBe(300);
  });
  it('skips self-crossing orders without blocking another citizen', () => {
    const w = fixture();
    w.citizens.a.inventory['wood:1'] = 4;
    place(w, 'a', 'sell', 4, 2);
    place(w, 'a', 'buy', 2, 5);
    expect(Object.keys(w.orders)).toHaveLength(2);
    expect(w.citizens.a.inventory['wood:1']).toBeUndefined();
    place(w, 'b', 'buy', 1, 3);
    expect(w.citizens.b.inventory['wood:1']).toBe(1);
    expect(gold(w)).toBe(300);
  });
  it('refunds all remaining escrow even after death, once', () => {
    const w = fixture();
    w.citizens.a.inventory['food:2'] = 4;
    place(w, 'a', 'sell', 4, 8, 'food:2');
    place(w, 'a', 'buy', 3, 7);
    w.citizens.a.alive = false;
    cancelCitizenOrders(w, 'a');
    cancelCitizenOrders(w, 'a');
    expect(w.citizens.a.gold).toBe(100);
    expect(w.citizens.a.inventory['food:2']).toBe(4);
    expect(w.orders).toEqual({});
    expect(gold(w)).toBe(300);
  });
  it('cancels explicitly before replacement and forbids cancelling another owner', () => {
    const w = fixture();
    w.citizens.a.inventory['wood:1'] = 3;
    place(w, 'a', 'sell', 3, 9);
    const orderId = Object.keys(w.orders)[0];
    expect(marketCommand(w, 'b', { type: 'cancel-order', orderId }).ok).toBe(false);
    expect(marketCommand(w, 'a', { type: 'cancel-order', orderId }).ok).toBe(true);
    expect(place(w, 'a', 'sell', 3, 7).ok).toBe(true);
    expect(Object.values(w.orders)[0].escrowItems).toEqual({ 'wood:1': 3 });
  });
});

describe('unique building assets', () => {
  it('reserves ownership without removing the map building and sells remotely once', () => {
    const w = fixture();
    building(w);
    expect(place(w, 'a', 'sell', 1, 40, 'building:mill').ok).toBe(true);
    expect(isBuildingListed(w, 'mill')).toBe(true);
    expect(w.buildings.mill.ownerId).toBe('a');
    expect(place(w, 'a', 'sell', 1, 30, 'building:mill').ok).toBe(false);
    expect(place(w, 'b', 'buy', 1, 50, 'building:mill').ok).toBe(true);
    expect(w.buildings.mill).toMatchObject({ ownerId: 'b', x: 5, y: 5 });
    expect(w.citizens.b.gold).toBe(60);
    expect(w.citizens.a.gold).toBe(140);
    expect(isBuildingListed(w, 'mill')).toBe(false);
    expect(gold(w)).toBe(300);
    expect(place(w, 'a', 'sell', 1, 30, 'building:mill').ok).toBe(false);
  });
  it('rejects active processing and nonunique quantities', () => {
    const w = fixture();
    building(w);
    refine(w);
    expect(place(w, 'a', 'sell', 1, 40, 'building:mill').ok).toBe(false);
    w.citizens.a.action = null;
    expect(place(w, 'a', 'sell', 2, 40, 'building:mill').ok).toBe(false);
  });
  it('cancels sell and buy listings on destruction without creating a carried building', () => {
    const w = fixture();
    building(w);
    place(w, 'a', 'sell', 1, 80, 'building:mill');
    place(w, 'b', 'buy', 1, 40, 'building:mill');
    delete w.buildings.mill;
    cancelBuildingOrders(w, 'mill');
    cancelBuildingOrders(w, 'mill');
    expect(w.orders).toEqual({});
    expect(w.citizens.b.gold).toBe(100);
    expect(w.citizens.a.inventory).toEqual({});
    expect(gold(w)).toBe(300);
  });
  it.each(['owner', 'health', 'existence'] as const)(
    'rechecks %s before settlement',
    (condition) => {
      const w = fixture();
      building(w);
      place(w, 'a', 'sell', 1, 30, 'building:mill');
      if (condition === 'owner') w.buildings.mill.ownerId = 'c';
      else if (condition === 'health') w.buildings.mill.health = 0;
      else delete w.buildings.mill;
      const result = place(w, 'b', 'buy', 1, 40, 'building:mill');
      if (condition === 'owner') {
        expect(result.ok).toBe(true);
        expect(w.buildings.mill.ownerId).toBe('c');
        expect(Object.values(w.orders).every((o) => o.side === 'buy')).toBe(true);
      } else expect(result.ok).toBe(false);
      expect(w.citizens.a.gold).toBe(100);
      expect(gold(w)).toBe(300);
    },
  );
});

describe('validation and available holdings', () => {
  it('sells every carried tool copy but not escrowed units', () => {
    const w = fixture();
    w.citizens.a.inventory['axe:1'] = 2;
    expect(place(w, 'a', 'sell', 1, 10, 'axe:1').ok).toBe(true);
    expect(place(w, 'a', 'sell', 1, 11, 'axe:1').ok).toBe(true);
    expect(place(w, 'a', 'sell', 1, 12, 'axe:1').ok).toBe(false);
    expect(w.citizens.a.inventory['axe:1']).toBeUndefined();
    cancelCitizenOrders(w, 'a');
    expect(w.citizens.a.inventory['axe:1']).toBe(2);
  });
  it('cannot sell work inputs removed into action reservations', () => {
    const w = fixture();
    refine(w);
    w.citizens.a.inventory['wood:1'] = 1;
    expect(place(w, 'a', 'sell', 2, 1).ok).toBe(false);
    expect(place(w, 'a', 'sell', 1, 1).ok).toBe(true);
    expect(w.citizens.a.action?.reserved).toEqual({ 'wood:1': 3 });
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid price and quantity %s without mutation',
    (n) => {
      const w = fixture();
      const before = JSON.stringify(w);
      expect(place(w, 'a', 'buy', n, 1).ok).toBe(false);
      expect(place(w, 'a', 'buy', 1, n).ok).toBe(false);
      expect(JSON.stringify(w)).toBe(before);
    },
  );
  it.each(TIERS)('trades and refunds carried items at tier %i', (tier) => {
    const w = fixture();
    for (const kind of ['wood', 'food', 'fibre', 'axe', 'scythe', 'knife', 'sword']) {
      const item = `${kind}:${tier}`;
      w.citizens.a.inventory[item] = 2;
      expect(place(w, 'a', 'sell', 2, 3, item).ok).toBe(true);
      expect(place(w, 'b', 'buy', 1, 3, item).ok).toBe(true);
      expect(w.citizens.b.inventory[item]).toBe(1);
      cancelCitizenOrders(w, 'a');
      expect(w.citizens.a.inventory[item]).toBe(1);
      expect(gold(w)).toBe(300);
    }
    expect(w.orders).toEqual({});
  });
  it('rejects unknown items, unsafe totals and unfunded orders', () => {
    const w = fixture();
    for (const item of [`food:${MAX_TIER + 1}`, 'gold:1', 'citizen:a', 'wood', 'building:missing']) {
      expect(place(w, 'a', 'buy', 1, 1, item).ok).toBe(false);
    }
    expect(place(w, 'a', 'buy', 2, Number.MAX_SAFE_INTEGER).ok).toBe(false);
    expect(place(w, 'a', 'buy', 101, 1).ok).toBe(false);
    expect(place(w, 'a', 'sell', 1, 1).ok).toBe(false);
    expect(gold(w)).toBe(300);
    expect(w.orders).toEqual({});
  });
  it('transfers gold remotely, but not escrow, invalid amounts or to the dead', () => {
    const w = fixture();
    w.citizens.b.x = 9;
    place(w, 'a', 'buy', 9, 10);
    expect(marketCommand(w, 'a', { type: 'transfer', citizenId: 'b', gold: 11 }).ok).toBe(false);
    expect(marketCommand(w, 'a', { type: 'transfer', citizenId: 'b', gold: 10 }).ok).toBe(true);
    expect(w.citizens.a.gold).toBe(0);
    expect(w.citizens.b.gold).toBe(110);
    w.citizens.c.alive = false;
    const commands: Command[] = [
      { type: 'transfer', citizenId: 'c', gold: 1 },
      { type: 'transfer', citizenId: 'missing', gold: 1 },
      { type: 'transfer', citizenId: 'b', gold: -1 },
    ];
    for (const command of commands) expect(marketCommand(w, 'b', command).ok).toBe(false);
    expect(gold(w)).toBe(300);
  });
});
