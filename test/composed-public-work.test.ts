import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { BALANCE, harvestDuration } from '../src/world/config.ts';

function fixture() {
  const world = createWorld({ seed: 7, population: 3 });
  const [self, peer, hidden] = Object.values(world.citizens);
  world.buildings = {};
  world.deposits = { tree: { id: 'tree', x: 3, y: 1, resource: 'wood', tier: 1, stock: 1, capacity: 1, regrowAt: 999 } };
  Object.assign(self, { x: 1, y: 1 });
  Object.assign(peer, { x: 2, y: 1, inventory: { 'axe:3': 1, 'knife:5': 1 } });
  Object.assign(hidden, { x: 20, y: 20 });
  updateKnowledge(world);
  expect(dispatch(world, peer.id, { type: 'harvest', depositId: 'tree' }).ok).toBe(true);
  return { world, self, peer, hidden };
}

describe('dated public harvesting work', () => {
  it('projects real travel and work timing with only the involved tool', () => {
    const { world, self, peer, hidden } = fixture();
    const peers = () => observe(world, self.id).visible.flatMap(tile => tile.citizens);
    expect(peers().find(c => c.id === hidden.id)).toBeUndefined();
    expect(peers().find(c => c.id === peer.id)).toMatchObject({ busy: true, publicWork: {
      kind: 'harvest', depositId: 'tree', phase: 'travel', remainingTicks: BALANCE.moveTicks,
      harvestTicks: harvestDuration(1, 3), toolTier: 3,
    } });
    expect(peers().find(c => c.id === peer.id)?.inventory).toEqual(peer.inventory);
    expect(peers().find(c => c.id === peer.id)).not.toHaveProperty('plan');
    expect(peers().find(c => c.id === peer.id)).not.toHaveProperty('mind');
    tickWorld(world);
    expect(peers().find(c => c.id === peer.id)?.publicWork?.remainingTicks).toBe(1);
    tickWorld(world);
    expect(peer.action?.phase).toBe('work');
    expect(peers().find(c => c.id === peer.id)?.publicWork).toMatchObject({ phase: 'harvest', remainingTicks: peer.action!.duration });
    expect(peer.action!.duration).toBe(harvestDuration(1, 3));
    tickWorld(world);
    expect(peers().find(c => c.id === peer.id)?.publicWork?.remainingTicks).toBe(peer.action!.duration - 1);
  });

  it('retains dated evidence without updating hidden facts or projecting unseen targets', () => {
    const { world, self, peer } = fixture();
    updateKnowledge(world);
    const dated = structuredClone(self.knowledge['2,1']);
    Object.assign(self, { x: 15, y: 15 });
    dispatch(world, peer.id, { type: 'cancel' });
    tickWorld(world);
    updateKnowledge(world);
    expect(observe(world, self.id).remembered.find(tile => tile.x === 2 && tile.y === 1)).toEqual(dated);
    expect(dated.citizens.find(c => c.id === peer.id)?.publicWork?.phase).toBe('travel');
    Object.assign(self, { x: 0, y: 1 });
    expect(dispatch(world, peer.id, { type: 'harvest', depositId: 'tree' }).ok).toBe(true);
    world.deposits.tree.x = 4;
    const projected = observe(world, self.id).visible.flatMap(tile => tile.citizens).find(c => c.id === peer.id);
    expect(projected?.busy).toBe(true);
    expect(projected?.publicWork).toBeUndefined();
  });
});
