import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { equipmentRecipe } from '../src/world/config.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { MAX_TIER, RING_COUNT, tierConfiguration } from '../src/shared/tiers.ts';

function fixture(): Checkpoint {
  const world = createWorld({ seed: 7, autonomy: true });
  world.ringCount = RING_COUNT;
  world.deposits = {};
  world.buildings = {};
  const citizen = Object.values(world.citizens)[0]!;
  citizen.knowledge = {};
  citizen.inventory = { [`axe:${MAX_TIER}`]: 1, [`food:${MAX_TIER}`]: 2 };
  citizen.autonomy!.policy.targetTier = MAX_TIER;
  citizen.autonomy!.productionGoal = { item: 'axe', tier: MAX_TIER };
  citizen.autonomy!.project = { kind: 'lumbermill', tier: MAX_TIER, x: citizen.x, y: citizen.y };
  const buildingId = `building-${world.nextId++}`;
  world.buildings[buildingId] = {
    id: buildingId, kind: 'lumbermill', tier: MAX_TIER, ownerId: citizen.id,
    x: citizen.x, y: citizen.y, health: 100, maxHealth: 100,
    materials: { [`wood:${MAX_TIER}`]: 384 },
  };
  citizen.action = {
    id: `action-${world.nextId++}`, command: { type: 'craft', item: 'knife', tier: MAX_TIER },
    phase: 'work', startedTick: world.tick, elapsed: 1, duration: 100,
    reserved: equipmentRecipe('knife', MAX_TIER), path: [], target: { x: citizen.x, y: citizen.y },
  };
  const orderId = `order-${world.nextId++}`;
  world.orders[orderId] = {
    id: orderId, citizenId: citizen.id, side: 'sell', item: `wood:${MAX_TIER}`,
    quantity: 2, price: 3, createdTick: world.tick, sequence: 1,
    escrowGold: 0, escrowItems: { [`wood:${MAX_TIER}`]: 2 },
  };
  return { version: 1, savedAt: new Date().toISOString(), world, runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
}

const roundtrip = (cp: Checkpoint) => validateCheckpoint(JSON.parse(JSON.stringify(cp)));

describe('procedural checkpoint tiers', () => {
  it('roundtrips ring metadata and highest-tier holdings, buildings, work and escrow unchanged', () => {
    expect(MAX_TIER).toBe(RING_COUNT + 1);
    const cp = fixture();
    expect(roundtrip(cp)).toEqual(cp);
    const citizen = Object.values(cp.world.citizens)[0]!;
    const reserved = structuredClone(citizen.action!.reserved);
    expect(Object.values(roundtrip(cp).world.citizens)[0]!.action!.reserved).toEqual(reserved);
    citizen.action!.reserved[`food:${MAX_TIER}`] = 1;
    expect(() => roundtrip(cp)).toThrow('action reserved recipe');
  });

  it('discards valid legacy references without duplicating inventory or changing reservations and funded escrow', () => {
    const cp = fixture();
    const citizen = Object.values(cp.world.citizens)[0]!;
    Object.assign(citizen, { equipment: { axe: `axe:${MAX_TIER}` } });
    const orderId = `order-${cp.world.nextId++}`;
    citizen.gold -= 6;
    cp.world.orders[orderId] = { id: orderId, citizenId: citizen.id, side: 'buy', item: 'food:1', quantity: 2, price: 3, createdTick: 0, sequence: 2, escrowGold: 6, escrowItems: {} };
    const original = structuredClone(cp);
    const restored = roundtrip(cp);
    expect(restored.world.citizens[citizen.id]).not.toHaveProperty('equipment');
    expect(restored.world.citizens[citizen.id].inventory).toEqual(citizen.inventory);
    expect(restored.world.citizens[citizen.id].action).toEqual(citizen.action);
    expect(restored.world.citizens[citizen.id].gold).toBe(citizen.gold);
    expect(restored.world.orders).toEqual(cp.world.orders);
    expect(cp).toEqual(original);
    expect(roundtrip(restored)).toEqual(restored);
  });

  it('keeps legacy missing metadata and historical unscaled reservations without defaults', () => {
    const cp = fixture();
    delete cp.world.ringCount;
    const citizen = Object.values(cp.world.citizens)[0]!;
    citizen.action!.command = { type: 'craft', item: 'knife', tier: 2 };
    citizen.action!.reserved = { 'wood:2': 3, 'fibre:2': 3 };
    const restored = roundtrip(cp);
    expect(restored.world).not.toHaveProperty('ringCount');
    expect(restored).toEqual(cp);
    citizen.action!.reserved['wood:2'] = 2;
    expect(() => roundtrip(cp)).toThrow('action reserved recipe');
  });

  it.each([0, -1, 1.5])('rejects invalid ring metadata %s', (ringCount) => {
    const cp = fixture();
    cp.world.ringCount = ringCount;
    expect(() => roundtrip(cp)).toThrow('ringCount');
  });

  it('accepts terminal downconversion and rejects terminal upconversion, including suspended work', () => {
    const cp = fixture();
    const citizen = Object.values(cp.world.citizens)[0]!;
    const buildingId = Object.keys(cp.world.buildings)[0]!;
    const action = citizen.action!;
    const command = { type: 'refine' as const, buildingId, fromTier: MAX_TIER, direction: 'down' as 'up' | 'down' };
    action.command = command;
    action.reserved = { [`wood:${MAX_TIER}`]: 1 };
    expect(roundtrip(cp)).toEqual(cp);
    command.direction = 'up';
    action.reserved = { [`wood:${MAX_TIER}`]: 3 };
    expect(() => roundtrip(cp)).toThrow('refine tier boundary');
    command.direction = 'down';
    action.reserved = { [`wood:${MAX_TIER}`]: 1 };
    citizen.emergency = { startedTick: cp.world.tick, depositId: 'gone', outsideAreas: true, stage: 'gather', suspendedAction: action, suspendedPosition: { x: citizen.x, y: citizen.y } };
    citizen.action = null;
    delete cp.world.buildings[buildingId];
    expect(roundtrip(cp)).toEqual(cp);
  });

  it('rejects out-of-range inventory, equipment and escrow keys', () => {
    for (const location of ['inventory', 'equipment', 'order'] as const) {
      const cp = fixture();
      const citizen = Object.values(cp.world.citizens)[0]!;
      const item = `axe:${MAX_TIER + 1}`;
      if (location === 'inventory') citizen.inventory[item] = 1;
      else if (location === 'equipment') Object.assign(citizen, { equipment: { axe: item } });
      else Object.values(cp.world.orders)[0]!.item = item;
      expect(() => roundtrip(cp)).toThrow();
    }
  });

  it('derives patterns that recognize whole multi-digit tiers, not individual digits', () => {
    const configuration = tierConfiguration(12);
    expect(configuration.maxTier).toBe(13);
    for (const pattern of [configuration.carriedItemPattern, configuration.equipmentItemPattern, configuration.tradableItemPattern]) {
      const regex = new RegExp(pattern);
      expect(regex.test('axe:10')).toBe(true);
      expect(regex.test('axe:13')).toBe(true);
      expect(regex.test('axe:14')).toBe(false);
      expect(regex.test('axe:01')).toBe(false);
    }
    const resource = new RegExp(configuration.resourceItemPattern);
    expect(resource.test('wood:12')).toBe(true);
    expect(resource.test('wood:14')).toBe(false);
  });
});
