import { describe, expect, it } from 'vitest';
import type { Building, Citizen, Command, World } from '../src/shared/types.ts';
import { BALANCE } from '../src/world/config.ts';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { settleDeath } from '../src/world/life.ts';

function fixture() {
  const world = createWorld({ seed: 42, scenario: 'progression' });
  const [a, b, c] = Object.values(world.citizens);
  world.deposits = {};
  for (const citizen of [a, b, c]) {
    citizen.x = 1;
    citizen.y = 1;
    citizen.inventory = {};
    citizen.fullness = 100;
  }
  b.x = 2;
  return { world, a, b, c };
}
function send(world: World, citizen: Citizen, command: Command) {
  const result = dispatch(world, citizen.id, command);
  expect(result, result.message).toMatchObject({ ok: true });
  return result;
}
function building(world: World, owner: Citizen, overrides: Partial<Building> = {}) {
  const result: Building = {
    id: 'property',
    x: 2,
    y: 1,
    ownerId: owner.id,
    kind: 'lumbermill',
    tier: 1,
    health: 100,
    maxHealth: 100,
    materials: { 'wood:1': 6, 'fibre:1': 4 },
    ...overrides,
  };
  world.buildings[result.id] = result;
  return result;
}
function consenting(world: World, a: Citizen, b: Citizen) {
  a.inventory['food:2'] = BALANCE.reproductionFood;
  b.inventory['food:2'] = BALANCE.reproductionFood;
  send(world, a, { type: 'consent', partnerId: b.id, accept: true });
  send(world, b, { type: 'consent', partnerId: a.id, accept: true });
}
function totalGold(world: World) {
  return (
    Object.values(world.citizens).reduce((sum, c) => sum + c.gold, 0) +
    Object.values(world.orders).reduce((sum, order) => sum + order.escrowGold, 0) +
    Object.values(world.loot).reduce((sum, loot) => sum + loot.gold, 0)
  );
}

describe('combat and property', () => {
  it('selects the best available sword on each strike, with escrowed swords excluded', () => {
    const { world, a, b } = fixture();
    a.inventory = { 'sword:1': 1, 'sword:3': 1, 'axe:7': 1 };
    send(world, a, { type: 'attack', targetId: b.id });
    tickWorld(world, BALANCE.attackTicks);
    const firstDamage = 100 - b.health + BALANCE.healing;
    expect(firstDamage).toBeGreaterThanOrEqual(BALANCE.attackDamage[3] * .5);
    send(world, a, { type: 'order', side: 'sell', item: 'sword:3', quantity: 1, price: 5 });
    b.health = 100;
    tickWorld(world, BALANCE.attackTicks);
    const secondDamage = 100 - b.health + BALANCE.healing;
    expect(secondDamage).toBeGreaterThanOrEqual(BALANCE.attackDamage[1] * .5);
    expect(secondDamage).toBeLessThanOrEqual(BALANCE.attackDamage[1] * 1.5);
    expect(a.action?.command.type).toBe('attack');
  });
  it('delays strikes for reaction and samples seeded uniform carried-tool tier damage', () => {
    for (const tier of [0, 1, 2, 3] as const) {
      const { world, a, b } = fixture();
      if (tier) {
        a.inventory[`sword:${tier}`] = 1;
      }
      send(world, a, { type: 'attack', targetId: b.id });
      tickWorld(world, BALANCE.attackTicks - 1);
      expect(b.health).toBe(100);
      tickWorld(world);
      const damage = 100 - b.health + BALANCE.healing;
      expect(damage).toBeGreaterThanOrEqual(BALANCE.attackDamage[tier] * 0.5);
      expect(damage).toBeLessThanOrEqual(BALANCE.attackDamage[tier] * 1.5);
      expect(b.alive).toBe(true);
      expect(a.action?.command.type).toBe('attack');
      const restored: World = JSON.parse(JSON.stringify(world));
      tickWorld(world, 16);
      tickWorld(restored, 16);
      expect(restored).toEqual(world);
    }
    const unarmed = fixture(),
      armed = fixture();
    armed.a.inventory['sword:3'] = 1;
    send(unarmed.world, unarmed.a, { type: 'attack', targetId: unarmed.b.id });
    send(armed.world, armed.a, { type: 'attack', targetId: armed.b.id });
    tickWorld(unarmed.world, 8);
    tickWorld(armed.world, 8);
    expect(armed.b.health).toBeLessThan(unarmed.b.health);
  });

  it('allows fleeing before impact, pursues with ordinary movement and resets interrupted strikes', () => {
    const { world, a, b } = fixture();
    send(world, a, { type: 'attack', targetId: b.id });
    tickWorld(world, 4);
    send(world, b, { type: 'move', x: 5, y: 1 });
    tickWorld(world, 6);
    expect(a.x).toBeGreaterThan(1);
    expect(b.x).toBeGreaterThan(2);
    expect(b.health).toBe(100); // Leaving range discarded the unfinished strike.
    send(world, a, { type: 'cancel' });
    tickWorld(world, 8);
    expect(b.health).toBe(100);
  });

  it('never remotely hits an unseen target and searches only its last-seen position', () => {
    const { world, a, b } = fixture();
    b.x = a.x + BALANCE.sightRadius;
    send(world, a, { type: 'attack', targetId: b.id });
    const seen = { ...a.action!.target };
    b.x = 18;
    b.y = 18;
    tickWorld(world, 20);
    expect(b.health).toBe(100);
    expect(a.action).toBeNull();
    expect(a.lastResult).toContain('last-seen');
    expect({ x: a.x, y: a.y }).toEqual(seen);
    expect(dispatch(world, a.id, { type: 'attack', targetId: b.id }).code).toBe('unknown-target');
  });

  it('can search dated sightings without updating them from remote truth', () => {
    const { world, a, b } = fixture();
    b.x = 18;
    b.y = 18;
    a.knowledge['4,1'] = {
      x: 4,
      y: 1,
      seenTick: 0,
      buildings: [],
      deposits: [],
      loot: [],
      citizens: [
        {
          id: b.id,
          name: b.name,
          color: b.color,
          alive: true,
          health: 100,
          activity: 'idle',
          x: 4,
          y: 1,
        },
      ],
    };
    send(world, a, { type: 'attack', targetId: b.id });
    tickWorld(world, 20);
    expect({ x: a.x, y: a.y }).toEqual({ x: 4, y: 1 });
    expect(a.lastResult).toContain('last-seen');
    expect(b.health).toBe(100);
  });

  it('routes around walls, cannot hit diagonally or across blocked routes, but can demolish a wall', () => {
    const { world, a, b, c } = fixture();
    b.x = 3;
    const wall = building(world, c, { kind: 'wall' });
    send(world, a, { type: 'attack', targetId: b.id });
    tickWorld(world, 2);
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
    expect(b.health).toBe(100);
    cancelAction(world, a.id);
    a.x = 1;
    a.y = 1;
    for (const [x, y] of [
      [3, 0],
      [3, 2],
      [4, 1],
    ])
      building(world, c, { id: `wall-${x}-${y}`, kind: 'wall', x, y });
    expect(dispatch(world, a.id, { type: 'attack', targetId: b.id }).code).toBe('unreachable');
    send(world, a, { type: 'attack', targetId: wall.id });
    tickWorld(world, 8);
    expect(wall.health).toBeLessThan(100);
    expect(b.health).toBe(100);
  });

  it('alerts remote owners with property coordinates/damage and awards rounded salvage only on destruction', () => {
    const { world, a, b, c } = fixture();
    c.x = 20;
    c.y = 20;
    const station = building(world, c, { health: 10 });
    send(world, c, {
      type: 'order',
      side: 'sell',
      item: `building:${station.id}`,
      quantity: 1,
      price: 20,
    });
    send(world, b, {
      type: 'order',
      side: 'buy',
      item: `building:${station.id}`,
      quantity: 1,
      price: 10,
    });
    a.inventory['sword:3'] = 1;
    send(world, a, { type: 'attack', targetId: station.id });
    expect(a.inventory['wood:1']).toBeUndefined();
    tickWorld(world, 8);
    expect(world.buildings[station.id]).toBeUndefined();
    expect(world.orders).toEqual({});
    expect(b.gold).toBe(100);
    expect(a.inventory).toMatchObject({ 'wood:1': 4, 'fibre:1': 3 });
    const alert = world.events.find((e) => e.kind === 'attack')!;
    expect(alert).toMatchObject({ citizenId: a.id, targetId: station.id, x: 2, y: 1 });
    expect(alert.audience).toContain(c.id);
    expect(alert.text).toContain('damage');
    expect(alert.text).toContain(a.id);
    tickWorld(world, 20);
    expect(a.inventory['wood:1']).toBe(4);
    expect(a.inventory['fibre:1']).toBe(3);
    expect(totalGold(world)).toBe(world.initialGold);
  });

  it('immediately releases destroyed-station work inputs separately from construction salvage', () => {
    const { world, a, b } = fixture();
    const station = building(world, b, { health: 1, tier: 2 });
    b.inventory['wood:2'] = 3;
    send(world, b, { type: 'refine', buildingId: station.id, fromTier: 2 });
    // Attacker finishes before this worker's tick; give it a due strike.
    send(world, a, { type: 'attack', targetId: station.id });
    a.action!.elapsed = 7;
    tickWorld(world);
    expect(b.action).toBeNull();
    expect(b.inventory['wood:2']).toBe(3);
    expect(b.inventory['wood:3']).toBeUndefined();
    expect(a.inventory['wood:1']).toBe(4);
    expect(a.inventory['wood:2']).toBeUndefined();
  });
});

describe('death and bodies', () => {
  it('settles attack death after refunding all work and escrow, with carried tools counted once', () => {
    const { world, a, b } = fixture();
    b.inventory = { 'wood:1': 4, 'fibre:1': 4, 'axe:1': 1, 'food:2': 2 };
    send(world, b, { type: 'craft', item: 'sword', tier: 1 });
    send(world, b, { type: 'order', side: 'sell', item: 'food:2', quantity: 2, price: 9 });
    send(world, b, { type: 'order', side: 'buy', item: 'wood:3', quantity: 2, price: 10 });
    const property = building(world, b);
    b.health = 1;
    send(world, a, { type: 'attack', targetId: b.id });
    a.action!.elapsed = 7;
    tickWorld(world);
    expect(b).toMatchObject({
      alive: false,
      gold: 0,
      inventory: {},
      action: null,
      queue: [],
    });
    expect(a.gold).toBe(200);
    expect(a.inventory).toEqual({ 'wood:1': 4, 'fibre:1': 4, 'axe:1': 1, 'food:2': 2 });
    expect(world.orders).toEqual({});
    expect(world.loot).toEqual({});
    expect(property.ownerId).toBeNull();
    settleDeath(world, b.id, a.id);
    tickWorld(world, 8);
    expect(a.gold).toBe(200);
    expect(a.inventory['axe:1']).toBe(1);
    expect(totalGold(world)).toBe(world.initialGold);
  });

  it('starvation releases food reservations/escrow into a persistent body and unowns buildings', () => {
    const { world, a, b } = fixture();
    a.inventory = { 'food:1': 3, 'fibre:1': 3, 'wood:3': 2 };
    send(world, a, { type: 'craft', item: 'axe', tier: 1 });
    send(world, a, { type: 'order', side: 'sell', item: 'wood:3', quantity: 2, price: 10 });
    send(world, a, { type: 'order', side: 'buy', item: 'food:3', quantity: 1, price: 50 });
    const property = building(world, a);
    a.fullness = 0;
    a.health = BALANCE.starvationDamage;
    tickWorld(world);
    expect(a.alive).toBe(false);
    expect(a.action).toBeNull();
    expect(world.orders).toEqual({});
    expect(property.ownerId).toBeNull();
    const body = Object.values(world.loot)[0];
    expect(body).toMatchObject({
      x: 1,
      y: 1,
      gold: 100,
      inventory: { 'food:1': 3, 'fibre:1': 3, 'wood:3': 2 },
    });
    tickWorld(world, 40);
    expect(world.loot[body.id]).toEqual(body);
    expect(totalGold(world)).toBe(world.initialGold);
    expect(
      dispatch(world, b.id, { type: 'refine', buildingId: property.id, fromTier: 1 }).code,
    ).toBe('not-owner');
  });

  it('times body travel/pickup and serializes concurrent collectors without duplication', () => {
    const { world, a, b, c } = fixture();
    a.inventory['axe:2'] = 1;
    settleDeath(world, a.id);
    const body = Object.values(world.loot)[0];
    send(world, b, { type: 'loot', lootId: body.id });
    send(world, c, { type: 'loot', lootId: body.id });
    tickWorld(world, BALANCE.lootTicks - 1);
    expect(world.loot[body.id]).toBeDefined();
    expect(c.gold).toBe(100);
    tickWorld(world);
    expect(c.gold).toBe(200);
    expect(c.inventory['axe:2']).toBe(1);
    expect(world.loot).toEqual({});
    expect(b.action).not.toBeNull();
    tickWorld(world);
    expect(b.action).toBeNull();
    expect(b.lastResult).toContain('already collected');
    expect(b.gold).toBe(100);
    expect(totalGold(world)).toBe(world.initialGold);
    expect(dispatch(world, b.id, { type: 'loot', lootId: body.id }).code).toBe('missing-loot');
  });
});

describe('joint reproduction and command interaction', () => {
  it('requires authoritative mutual consent, adjacency, per-parent food, health and cooldown', () => {
    const { world, a, b } = fixture();
    send(world, a, { type: 'message', text: 'I consent', to: b.id });
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).code).toBe(
      'consent-required',
    );
    send(world, a, { type: 'consent', partnerId: b.id, accept: true });
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).code).toBe(
      'consent-required',
    );
    consenting(world, a, b);
    b.x = 3;
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).code).toBe('not-adjacent');
    b.x = 2;
    b.health = 74;
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).code).toBe(
      'parent-health',
    );
    b.health = 100;
    b.reproductionCooldown = 10;
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).code).toBe(
      'parent-cooldown',
    );
    b.reproductionCooldown = 0;
    b.inventory = { 'food:1': 100 };
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).code).toBe('parent-food');
    expect(a.action).toBeNull();
    expect(a.inventory['food:2']).toBe(3);
  });

  it('occupies both parents, consumes once and creates an individual adult without minting holdings', () => {
    const { world, a, b } = fixture();
    consenting(world, a, b);
    send(world, a, { type: 'reproduce', partnerId: b.id });
    expect(a.action?.id).toBe(b.action?.id);
    expect(a.inventory).toEqual({});
    expect(b.inventory).toEqual({});
    expect(a.action?.reserved).toEqual({ 'food:2': 3 });
    expect(b.action?.reserved).toEqual({ 'food:2': 3 });
    const restored: World = JSON.parse(JSON.stringify(world));
    tickWorld(world, BALANCE.reproductionTicks - 1);
    tickWorld(restored, BALANCE.reproductionTicks - 1);
    expect(Object.values(world.citizens)).toHaveLength(3);
    expect(restored).toEqual(world);
    tickWorld(world);
    tickWorld(restored);
    expect(restored).toEqual(world);
    const child = Object.values(world.citizens).find((c) => c.parents.length)!;
    expect(child).toMatchObject({
      parents: [a.id, b.id],
      gold: 0,
      inventory: {},
      knowledge: {},
      health: 100,
      fullness: 60,
      x: 1,
      y: 1,
    });
    expect(child.id).not.toBe(a.id);
    expect(child.name).not.toBe(a.name);
    expect(child.personality).not.toBe(a.personality);
    expect(child.goals).not.toBe(a.goals);
    expect(a.action).toBeNull();
    expect(b.action).toBeNull();
    expect(a.reproductionCooldown).toBe(world.tick + BALANCE.reproductionCooldown);
    expect(b.reproductionCooldown).toBe(a.reproductionCooldown);
    expect(totalGold(world)).toBe(world.initialGold);
    expect(a.inventory['food:2']).toBeUndefined();
    send(world, child, { type: 'move', x: 1, y: 2 });
    tickWorld(world, 2);
    expect(child.y).toBe(2);
    tickWorld(world, 10);
    expect(Object.values(world.citizens)).toHaveLength(4);
  });

  it('rejects busy partners without cancelling either existing physical action', () => {
    const { world, a, b } = fixture();
    consenting(world, a, b);
    send(world, b, { type: 'move', x: 5, y: 1 });
    send(world, a, { type: 'move', x: 4, y: 1 });
    const actionId = a.action!.id;
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).code).toBe('partner-busy');
    expect(a.action?.id).toBe(actionId);
    expect(b.action?.command.type).toBe('move');
  });

  it('returns both reservations on cancel/replace/revoke, while append waits without breaking joint work', () => {
    for (const mode of ['cancel', 'replace', 'revoke'] as const) {
      const { world, a, b } = fixture();
      consenting(world, a, b);
      send(world, a, { type: 'reproduce', partnerId: b.id });
      tickWorld(world, 3);
      send(world, b, { type: 'move', x: 3, y: 1, queue: 'append' });
      expect(b.action?.command.type).toBe('reproduce');
      expect(b.queue).toHaveLength(1);
      if (mode === 'cancel') send(world, a, { type: 'cancel' });
      if (mode === 'replace') send(world, a, { type: 'move', x: 1, y: 2 });
      if (mode === 'revoke') send(world, a, { type: 'consent', partnerId: b.id, accept: false });
      expect(b.action).toBeNull();
      expect(a.inventory['food:2']).toBe(3);
      expect(b.inventory['food:2']).toBe(3);
      cancelAction(world, a.id);
      expect(a.inventory['food:2']).toBe(3);
      expect(b.inventory['food:2']).toBe(3);
      expect(a.reproductionCooldown).toBe(0);
      tickWorld(world, 4);
      expect(b.x).toBe(3);
      expect(Object.values(world.citizens)).toHaveLength(3);
    }
  });

  it('refunds joint work before a parents death holdings settle; partner food is not stolen', () => {
    const { world, a, b, c } = fixture();
    consenting(world, a, b);
    send(world, a, { type: 'reproduce', partnerId: b.id });
    a.health = 1;
    send(world, c, { type: 'attack', targetId: a.id });
    c.action!.elapsed = 7;
    tickWorld(world);
    expect(a.alive).toBe(false);
    expect(b.action).toBeNull();
    expect(b.inventory['food:2']).toBe(3);
    expect(c.inventory['food:2']).toBe(3);
    expect(c.gold).toBe(200);
    expect(Object.values(world.citizens)).toHaveLength(3);
    expect(totalGold(world)).toBe(world.initialGold);
  });

  it('cancels if joint prerequisites disappear or consent expires', () => {
    for (const cause of ['health', 'adjacency', 'expiry'] as const) {
      const { world, a, b } = fixture();
      consenting(world, a, b);
      if (cause === 'expiry') {
        a.consent[b.id] = 2;
        b.consent[a.id] = 2;
      }
      send(world, a, { type: 'reproduce', partnerId: b.id });
      if (cause === 'health') b.health = 70;
      if (cause === 'adjacency') b.x = 5;
      tickWorld(world, 2);
      expect(a.action).toBeNull();
      expect(b.action).toBeNull();
      expect(a.inventory['food:2']).toBe(3);
      expect(b.inventory['food:2']).toBe(3);
    }
  });

  it('activates queued life actions serially and validates malformed commands even when queued', () => {
    const { world, a, b } = fixture();
    send(world, a, { type: 'move', x: 1, y: 2 });
    send(world, a, { type: 'attack', targetId: b.id, queue: 'append' });
    expect(dispatch(world, a.id, { type: 'attack', targetId: '', queue: 'append' }).code).toBe(
      'invalid-target',
    );
    expect(
      dispatch(world, a.id, {
        type: 'consent',
        partnerId: b.id,
        accept: 'yes',
      } as unknown as Command).code,
    ).toBe('invalid-consent');
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: a.id }).code).toBe(
      'invalid-partner',
    );
    expect(dispatch(world, a.id, { type: 'loot', lootId: 12 } as unknown as Command).code).toBe(
      'invalid-loot',
    );
    tickWorld(world, 2);
    expect(a.action?.command.type).toBe('attack');
    expect(a.queue).toEqual([]);
    const actionId = a.action!.id;
    expect(dispatch(world, a.id, { type: 'loot', lootId: 'missing' }).code).toBe('missing-loot');
    expect(a.action?.id).toBe(actionId);
    send(world, a, { type: 'message', text: 'help' });
    send(world, a, { type: 'transfer', citizenId: b.id, gold: 10 });
    expect(a.action?.id).toBe(actionId);
  });
});
