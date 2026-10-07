import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, createWorld, tickWorld } from '../lib/world.mjs';

function inject(world, citizen, tasks) {
  applyPlan(world, citizen.id, {
    thought: 'Offline deterministic scenario plan.',
    goals: ['Maintain a stable settlement'],
    memory: '',
    routine: { food: 4, wood: 2, family: false },
    reviewAfter: 300,
    tasks,
  });
}

function isBlocked(world, point) {
  return world.blocked.some((tile) => tile.x === point.x && tile.y === point.y);
}

test('a 1200-tick injected-plan scenario preserves world invariants without a model', () => {
  const world = createWorld();
  inject(world, world.citizens[0], [{ type: 'move', x: 10, y: 2 }]);
  inject(world, world.citizens[1], [{ type: 'craft', item: 'tool' }]);
  inject(world, world.citizens[2], [{ type: 'gather', resource: 'food', amount: 2 }]);
  inject(world, world.citizens[3], [{ type: 'move', x: 7, y: 9 }]);

  const replansAt = new Set([250, 500, 750, 1000]);
  for (let elapsed = 0; elapsed < 1200; elapsed += 1) {
    if (replansAt.has(world.tick)) {
      for (const citizen of world.citizens) {
        if (citizen.alive && citizen.adult) inject(world, citizen, [{ type: 'wait', ticks: 10 }]);
      }
    }

    const previous = new Map(world.citizens.map((citizen) => [citizen.id, { x: citizen.x, y: citizen.y }]));
    tickWorld(world);

    assert.equal(new Set(world.citizens.map(c => c.id)).size, world.citizens.length, 'living identities remain unique');
    assert.ok(world.events.length <= 80, 'event history stays bounded');
    for (const citizen of world.citizens) {
      assert.ok(Number.isFinite(citizen.food) && citizen.food >= 0);
      assert.ok(Number.isFinite(citizen.wood) && citizen.wood >= 0);
      assert.ok(Number.isFinite(citizen.health) && citizen.health >= 0 && citizen.health <= 100);
      assert.ok(Number.isFinite(citizen.hunger) && citizen.hunger >= 0 && citizen.hunger <= 100);
      assert.ok(Number.isFinite(citizen.energy) && citizen.energy >= 0 && citizen.energy <= 100);
      assert.equal(isBlocked(world, citizen), false, `${citizen.id} never occupies a ridge tile`);

      const from = previous.get(citizen.id);
      if (from) {
        const distance = Math.abs(citizen.x - from.x) + Math.abs(citizen.y - from.y);
        assert.ok(distance <= 1, `${citizen.id} never teleports or crosses a blocked tile`);
      }
      for (const step of citizen.path) {
        assert.equal(isBlocked(world, step), false, `${citizen.id}'s planned route avoids the ridge`);
      }
    }
  }

  assert.equal(world.tick, 1200);
  assert.ok(world.citizens.length > 0, 'the seeded population continues executing routine upkeep');
});
