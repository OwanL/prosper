import { describe, expect, it } from 'vitest';
import type { Citizen, Command, World } from '../src/shared/types.ts';
import { queryTile } from '../src/citizen/tools.ts';
import { dispatch, tickWorld } from '../src/world/core.ts';
import { BALANCE } from '../src/world/config.ts';
import { settleDeath } from '../src/world/life.ts';
import {
  observe,
  SIGHT_RADIUS,
  updateKnowledge,
  validateKnownCommand,
} from '../src/world/observation.ts';

function citizen(id: string, x: number, y: number): Citizen {
  return {
    id,
    name: id,
    color: 'red',
    x,
    y,
    alive: true,
    health: 100,
    fullness: 100,
    gold: 100,
    personality: 'private personality',
    inventory: { 'food:1': 3, 'axe:1': 1 },
    equipment: { axe: 'axe:1' },
    action: null,
    queue: [],
    goals: ['private goal'],
    memories: [],
    knowledge: {},
    lastResult: 'Ready',
    nextReviewTick: 0,
    consent: {},
    reproductionCooldown: 0,
    parents: [],
  };
}
function fixture() {
  const self = citizen('self', 1, 1),
    other = citizen('other', 2, 1),
    remote = citizen('remote', 8, 8);
  const world: World = {
    schemaVersion: 1,
    runId: 'test',
    seed: 1,
    rngState: 1,
    nextId: 1,
    tick: 4,
    width: 10,
    height: 10,
    initialGold: 300,
    citizens: { self, other, remote },
    deposits: {
      tree: {
        id: 'tree',
        x: 2,
        y: 1,
        resource: 'wood',
        tier: 1,
        stock: 5,
        capacity: 10,
        regrowAt: 20,
      },
    },
    buildings: {
      wall: {
        id: 'wall',
        x: 1,
        y: 2,
        kind: 'wall',
        tier: 1,
        ownerId: 'other',
        health: 80,
        maxHealth: 100,
        materials: { 'wood:1': 3 },
      },
    },
    loot: {
      body: { id: 'body', x: 2, y: 1, citizenName: 'Gone', gold: 999, inventory: { 'sword:3': 9 } },
    },
    orders: {},
    messages: [],
    events: [],
  };
  return { world, self, other, remote };
}

describe('citizen knowledge projection', () => {
  it('uses a small Manhattan radius and sees through walls without exposing remote truth', () => {
    const { world, self } = fixture();
    const observation = observe(world, self.id);
    expect(observation.visible.some((tile) => tile.x === 1 && tile.y === 4)).toBe(true);
    expect(observation.visible.some((tile) => tile.x === 1 && tile.y === 5)).toBe(false);
    expect(
      observation.visible.every(
        (tile) => Math.abs(tile.x - self.x) + Math.abs(tile.y - self.y) <= SIGHT_RADIUS,
      ),
    ).toBe(true);
    expect(observation.visible.flatMap((tile) => tile.citizens).map((c) => c.id)).not.toContain(
      'remote',
    );
    expect(queryTile({ x: 8, y: 8 }, observation)).toMatchObject({ source: 'unknown' });
    expect(self.knowledge).toEqual({}); // observe is pure
    expect(() => observe(world, 'absent')).toThrow('Unknown citizen');
  });

  it('remembers dated snapshots, never unseen stock, movement or death; revisiting clears stale entities', () => {
    const { world, self, other } = fixture();
    updateKnowledge(world);
    self.x = 8;
    self.y = 8;
    world.tick = 12;
    other.x = 5;
    other.y = 5;
    other.alive = false;
    other.health = 0;
    world.deposits.tree.stock = 0;
    delete world.loot.body;
    updateKnowledge(world);
    const observation = observe(world, 'self');
    const old = observation.remembered.find((tile) => tile.x === 2 && tile.y === 1)!;
    expect(old).toMatchObject({
      seenTick: 4,
      deposits: [{ stock: 5 }],
      citizens: [{ id: 'other', alive: true, health: 100 }],
      loot: [{ id: 'body' }],
    });
    expect(queryTile({ x: 2, y: 1 }, observation)).toMatchObject({
      source: 'dated-memory',
      tile: { seenTick: 4 },
    });
    expect(observation.ascii.split('\n')[8][2]).toBe('x');
    expect(observation.entityIndex.join('\n')).not.toContain('other');
    expect(validateKnownCommand(world, 'self', { type: 'harvest', depositId: 'tree' }).code).toBe(
      'outside-sight',
    );
    expect(validateKnownCommand(world, 'self', { type: 'attack', targetId: 'other' }).code).toBe(
      'outside-sight',
    );
    self.x = 1;
    self.y = 1;
    world.tick = 13;
    updateKnowledge(world);
    const fresh = observe(world, 'self');
    expect(fresh.remembered.some((tile) => tile.x === 2 && tile.y === 1)).toBe(false);
    expect(queryTile({ x: 2, y: 1 }, fresh)).toMatchObject({
      source: 'current',
      tile: { seenTick: 13, citizens: [], loot: [], deposits: [{ stock: 0 }] },
    });
  });

  it('prints north first, marks unseen cells x, and indexes every same-tile entity', () => {
    const { world, self, other } = fixture();
    self.x = 2;
    other.x = 2;
    const observation = observe(world, 'self');
    const rows = observation.ascii.split('\n');
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.length === 10)).toBe(true);
    expect(rows[0]).toBe('xxxxxxxxxx');
    expect(rows[8][2]).toBe('@');
    const line = observation.entityIndex.find((entry) => entry.startsWith('(2,1)'))!;
    for (const entity of ['self', 'other', 'tree', 'body']) expect(line).toContain(entity);
    expect(observation.entityIndex.join('\n')).toContain('wall');
    expect(observation.visible.flatMap((t) => t.loot)[0]).not.toHaveProperty('inventory');
    expect(observation.visible.flatMap((t) => t.loot)[0]).not.toHaveProperty('gold');
  });

  it('keeps own holdings/execution but hides other plans and unseen pathfinder output', () => {
    const { world, self, other } = fixture();
    self.action = {
      id: 'a',
      command: { type: 'move', x: 8, y: 1 },
      phase: 'travel',
      startedTick: 4,
      elapsed: 1,
      duration: 2,
      reserved: { 'wood:1': 3 },
      path: [
        { x: 2, y: 1 },
        { x: 5, y: 1 },
        { x: 3, y: 1 },
      ],
      target: { x: 8, y: 1 },
    };
    other.action = {
      ...structuredClone(self.action),
      command: { type: 'harvest', depositId: 'secret-deposit' },
    };
    const observation = observe(world, 'self');
    expect(observation.citizen.inventory).toEqual(self.inventory);
    expect(observation.citizen.equipment).toEqual(self.equipment);
    expect(observation.citizen.action).toMatchObject({
      target: { x: 8, y: 1 },
      path: [{ x: 2, y: 1 }],
    });
    const sighting = observation.visible.flatMap((t) => t.citizens).find((c) => c.id === 'other')!;
    expect(Object.keys(sighting).sort()).toEqual([
      'activity',
      'alive',
      'color',
      'health',
      'id',
      'name',
      'x',
      'y',
    ]);
    expect(sighting.activity).toBe('present');
    expect(JSON.stringify(observation)).not.toContain('secret-deposit');
    self.action.command = { type: 'attack', targetId: 'remote' };
    self.action.target = { x: 8, y: 8 };
    expect(observe(world, 'self').citizen.action?.target).toEqual({ x: self.x, y: self.y });
  });

  it('projects only public/involved communications and explicitly addressed alerts', () => {
    const { world } = fixture();
    world.messages = [
      { id: 'public', tick: 4, from: 'remote', text: 'Hello' },
      { id: 'incoming', tick: 4, from: 'remote', to: 'self', text: 'For you' },
      { id: 'outgoing', tick: 4, from: 'self', to: 'remote', text: 'From me' },
      { id: 'secret', tick: 4, from: 'other', to: 'remote', text: 'Hidden' },
    ];
    world.events = [
      { id: 'spectator', tick: 4, kind: 'death', text: 'Remote death' },
      {
        id: 'owner',
        tick: 4,
        kind: 'attack',
        text: 'Your wall damaged by remote',
        audience: ['self'],
        targetId: 'far-wall',
        x: 8,
        y: 7,
      },
      { id: 'other-owner', tick: 4, kind: 'attack', text: 'Private attack', audience: ['other'] },
    ];
    world.orders.sale = {
      id: 'sale',
      citizenId: 'remote',
      side: 'sell',
      item: 'food:1',
      quantity: 2,
      price: 7,
      createdTick: 4,
      sequence: 1,
      escrowGold: 0,
      escrowItems: { 'food:1': 2 },
    };
    world.buildings.listed = {
      ...world.buildings.wall,
      id: 'listed',
      x: 8,
      y: 7,
      ownerId: 'remote',
      health: 42,
    };
    world.orders.property = {
      ...world.orders.sale,
      id: 'property',
      item: 'building:listed',
      quantity: 1,
      escrowItems: {},
    };
    const observation = observe(world, 'self');
    expect(observation.markets[1]).toMatchObject({
      building: { id: 'listed', x: 8, y: 7, health: 42 },
    });
    expect(observation.visible.flatMap((t) => t.buildings).map((b) => b.id)).not.toContain(
      'listed',
    );
    expect(observation.messages.map((m) => m.id)).toEqual(['public', 'incoming', 'outgoing']);
    expect(observation.alerts.map((e) => e.id)).toEqual(['owner']);
    expect(observation.markets[0]).toMatchObject({
      citizenId: 'remote',
      quantity: 2,
      price: 7,
      escrowItems: {},
    });
    expect(observation.visible.flatMap((t) => t.citizens).map((c) => c.id)).not.toContain('remote');
    expect(validateKnownCommand(world, 'self', { type: 'attack', targetId: 'far-wall' }).code).toBe(
      'outside-sight',
    );
  });

  it('has no mutable references into truth, knowledge, or other citizens', () => {
    const { world, self } = fixture();
    updateKnowledge(world);
    world.messages.push({ id: 'post', tick: 4, from: 'self', text: 'Original' });
    const before = structuredClone(world);
    const observation = observe(world, 'self');
    observation.citizen.inventory['food:1'] = 999;
    observation.visible.find((t) => t.deposits.length)!.deposits[0].stock = 999;
    observation.visible.find((t) => t.buildings.length)!.buildings[0].materials['wood:1'] = 999;
    observation.citizen.knowledge['2,1'].deposits[0].stock = 777;
    observation.messages[0].text = 'Changed';
    expect(world).toEqual(before);
    expect(observation.visible.find((t) => t.x === 2 && t.y === 1)!.deposits[0].stock).toBe(999);
    self.x = 8;
    self.y = 8;
    const stale = observe(world, 'self');
    stale.remembered.find((t) => t.x === 2 && t.y === 1)!.deposits[0].stock = 1000;
    expect(self.knowledge['2,1'].deposits[0].stock).toBe(5);
  });

  it('rejects unseen build probes identically for empty, occupied and reserved sites', () => {
    const { world, self, remote } = fixture();
    self.inventory = { 'wood:1': 100, 'fibre:1': 100 };
    const command: Command = { type: 'build', kind: 'wall', tier: 1, x: 8, y: 8 };
    const submit = () => {
      const gate = validateKnownCommand(world, self.id, command);
      return gate.ok ? dispatch(structuredClone(world), self.id, command) : gate;
    };
    const occupied = submit();
    remote.x = 7;
    const empty = submit();
    expect(dispatch(world, remote.id, { ...command, kind: 'lumbermill' }).code).toBe(
      'insufficient-materials',
    );
    remote.inventory = { 'wood:1': 6, 'fibre:1': 4 };
    expect(dispatch(world, remote.id, { ...command, kind: 'lumbermill' }).ok).toBe(true);
    const reserved = submit();
    expect(occupied).toEqual(empty);
    expect(reserved).toEqual(empty);
    expect(empty.code).toBe('outside-sight');
    expect(self.action).toBeNull();
    expect(validateKnownCommand(world, self.id, { type: 'move', x: 8, y: 8 }).ok).toBe(true);
  });

  it('requires current build-site sight at the Manhattan boundary, not dated memory', () => {
    const { world, self } = fixture();
    expect(SIGHT_RADIUS).toBe(BALANCE.sightRadius);
    const command: Command = {
      type: 'build',
      kind: 'lumbermill',
      tier: 1,
      x: self.x + SIGHT_RADIUS,
      y: self.y,
    };
    expect(validateKnownCommand(world, self.id, command).ok).toBe(true);
    expect(validateKnownCommand(world, self.id, { ...command, y: self.y + 1 }).code).toBe(
      'outside-sight',
    );
    updateKnowledge(world);
    self.x = 8;
    self.y = 8;
    expect(
      observe(world, self.id).remembered.some((t) => t.x === command.x && t.y === command.y),
    ).toBe(true);
    expect(validateKnownCommand(world, self.id, command).code).toBe('outside-sight');
  });

  it('projects death only as loot and removes the body after timed collection', () => {
    const { world, self, other } = fixture();
    world.deposits = {};
    world.loot = {};
    settleDeath(world, other.id);
    updateKnowledge(world);
    const body = Object.values(world.loot)[0];
    const before = observe(world, self.id);
    expect(before.visible.flatMap((t) => t.citizens).map((c) => c.id)).not.toContain(other.id);
    expect(before.ascii.split('\n')[world.height - 1 - other.y][other.x]).toBe('L');
    expect(before.entityIndex.join('\n')).toContain(`loot ${body.id}`);
    expect(dispatch(world, self.id, { type: 'loot', lootId: body.id }).ok).toBe(true);
    tickWorld(world, BALANCE.moveTicks + BALANCE.lootTicks);
    updateKnowledge(world);
    expect(world.loot[body.id]).toBeUndefined();
    expect(world.citizens[other.id].alive).toBe(false); // identity record is retained
    const after = observe(world, self.id);
    expect(after.visible.flatMap((t) => t.citizens).map((c) => c.id)).not.toContain(other.id);
    expect(after.visible.flatMap((t) => t.loot)).toEqual([]);
    expect(after.entityIndex.join('\n')).not.toContain(other.id);
    expect(after.citizen.knowledge[`${other.x},${other.y}`]).toMatchObject({
      citizens: [{ id: self.id }],
      loot: [],
    });
  });

  it('rejects guessed existing and missing IDs identically before core inspection', () => {
    const { world } = fixture();
    expect(validateKnownCommand(world, 'self', { type: 'harvest', depositId: 'tree' }).ok).toBe(
      true,
    );
    const hidden = validateKnownCommand(world, 'self', { type: 'attack', targetId: 'remote' });
    expect(hidden).toEqual(
      validateKnownCommand(world, 'self', { type: 'attack', targetId: 'nonexistent' }),
    );
    expect(hidden.code).toBe('unknown-entity');
    expect(validateKnownCommand(world, 'self', { type: 'loot', lootId: 'body' }).ok).toBe(true);
    expect(validateKnownCommand(world, 'self', { type: 'move', x: 8, y: 8 }).ok).toBe(true);
  });
});
