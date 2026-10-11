import { describe, expect, it } from 'vitest';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe, observeDecision, updateKnowledge } from '../src/world/observation.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';

function fixture() {
  const world = createWorld({ seed: 7, scenario: 'progression', population: 3 });
  const [self, peer, remote] = Object.values(world.citizens);
  Object.assign(self, { x: 1, y: 1 });
  Object.assign(peer, { x: 2, y: 1, gold: 20, inventory: { 'food:1': 3, 'axe:1': 1 } });
  Object.assign(remote, { x: world.width - 1, y: world.height - 1, gold: 99 });
  for (const citizen of Object.values(world.citizens)) citizen.knowledge = {};
  world.initialGold = Object.values(world.citizens).reduce((sum, citizen) => sum + citizen.gold, 0);
  return { world, self, peer, remote };
}

describe('dated public carried holdings', () => {
  it('shows living visible holdings, not remote holdings or escrow/private fields', () => {
    const { world, self, peer, remote } = fixture();
    expect(dispatch(world, peer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 2, price: 3 }).ok).toBe(true);
    expect(dispatch(world, peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 5 }).ok).toBe(true);
    const peers = observe(world, self.id).visible.flatMap(tile => tile.citizens);
    const sighting = peers.find(c => c.id === peer.id)!;
    expect(sighting.inventory).toEqual(peer.inventory);
    expect(sighting.inventory).toEqual({ 'food:1': 2, 'axe:1': 1 });
    expect(sighting.gold).toBe(14);
    expect(peers.some(c => c.id === remote.id)).toBe(false);
    for (const field of ['mind', 'goals', 'personality', 'queue', 'action', 'knowledge'])
      expect(sighting).not.toHaveProperty(field);
  });

  it('keeps unseen memories dated and detached, and seals lean borrowed holdings', () => {
    const { world, self, peer } = fixture();
    updateKnowledge(world);
    const seenTick = world.tick;
    Object.assign(peer, { x: world.width - 1, y: world.height - 1 });
    Object.assign(self, { x: world.width - 1, y: 0 });
    peer.inventory['food:1'] = 10;
    peer.gold = 2;
    world.tick++;
    updateKnowledge(world);
    const observation = observe(world, self.id);
    const tile = observation.remembered.find(t => t.citizens.some(c => c.id === peer.id))!;
    const remembered = tile.citizens.find(c => c.id === peer.id)!;
    expect(tile.seenTick).toBe(seenTick);
    expect(remembered.inventory).toEqual({ 'food:1': 3, 'axe:1': 1 });
    expect(remembered.gold).toBe(20);
    remembered.inventory!['food:1'] = 500;
    remembered.gold = 500;
    expect(self.knowledge[`${tile.x},${tile.y}`].citizens.find(c => c.id === peer.id)!.gold).toBe(20);
    const lean = observeDecision(world, self.id).remembered.find(t => t.x === tile.x && t.y === tile.y)!;
    expect(Object.isFrozen(lean.citizens.find(c => c.id === peer.id)!.inventory)).toBe(true);
    expect(peer.inventory['food:1']).toBe(10);
  });

  it('detaches visible public and projected notebook inventories from world truth', () => {
    const { world, self, peer } = fixture();
    updateKnowledge(world);
    const observation = observe(world, self.id);
    observation.visible.flatMap(t => t.citizens).find(c => c.id === peer.id)!.inventory!['food:1'] = 700;
    observation.citizen.knowledge['2,1'].citizens.find(c => c.id === peer.id)!.inventory!['food:1'] = 800;
    expect(peer.inventory['food:1']).toBe(3);
    expect(self.knowledge['2,1'].citizens.find(c => c.id === peer.id)!.inventory!['food:1']).toBe(3);
  });

  it('restores new holdings and preserves legacy absence as unknown', () => {
    const { world } = fixture();
    updateKnowledge(world);
    const checkpoint = { version: 1, savedAt: new Date(0).toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
    expect(validateCheckpoint(checkpoint).world).toEqual(world);
    const legacy = structuredClone(checkpoint);
    for (const citizen of Object.values(legacy.world.citizens))
      for (const tile of Object.values(citizen.knowledge))
        for (const sighting of tile.citizens) {
          delete sighting.inventory;
          delete sighting.gold;
        }
    const restored = validateCheckpoint(legacy);
    for (const citizen of Object.values(restored.world.citizens))
      for (const tile of Object.values(citizen.knowledge))
        for (const sighting of tile.citizens) {
          expect(sighting).not.toHaveProperty('inventory');
          expect(sighting).not.toHaveProperty('gold');
        }
  });
});
