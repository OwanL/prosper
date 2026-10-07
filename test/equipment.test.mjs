import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, planningContext, tickWorld } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { resolveInteraction } from '../lib/interactions.mjs';
import { resolveBuilding } from '../lib/buildings.mjs';
import { EQUIPMENT, equipmentLevel } from '../lib/equipment.mjs';
import { citizenObservation } from '../lib/citizen-tools.mjs';

function alone() {
  const world = createWorld(), citizen = world.citizens[0];
  world.citizens = [citizen];
  Object.assign(citizen, { food: 20, wood: 1000, hunger: 0, energy: 100, asyncReview: true });
  return { world, citizen };
}
function plan(world, citizen, tasks, work = null) {
  applyPlan(world, citizen.id, normalizePlan({ tasks, work }, planningContext(world, citizen.id)));
}

test('all equipment upgrades charge full costs, reject skips and duplicates atomically, and expose levels', () => {
  for (const item of ['tool', 'shoes', 'weapon']) {
    const { world, citizen } = alone();
    const craft = level => resolveInteraction(world, citizen, { type: 'craft', item, level });
    for (const level of [1, 2, 3]) {
      if (level < 3) {
        const before = structuredClone(world);
        assert.equal(craft(level + 1).ok, false);
        assert.deepEqual(world, before);
      }
      const wood = citizen.wood;
      assert.equal(craft(level).ok, true);
      assert.equal(citizen.wood, wood - EQUIPMENT[item][level].cost);
      assert.equal(equipmentLevel(citizen, item), level);
      assert.equal(citizenObservation(world, citizen.id).citizen[`${item}Level`], level);
      if (item === 'weapon') assert.equal(citizen.weaponDurability, EQUIPMENT.weapon[level].durability);
      const before = structuredClone(world);
      assert.equal(craft(level).ok, false);
      assert.deepEqual(world, before);
    }
  }
});

test('legacy equipment is level one; upgrades require actual wood and four ticks', () => {
  const { world, citizen } = alone();
  citizen.tool = true;
  citizen.wood = 59;
  assert.equal(equipmentLevel(citizen, 'tool'), 1);
  const before = structuredClone(world);
  assert.equal(resolveInteraction(world, citizen, { type: 'craft', item: 'tool', level: 2 }).ok, false);
  assert.deepEqual(world, before);
  citizen.wood = 60;
  plan(world, citizen, [{ type: 'craft', item: 'tool', level: 2 }], { type: 'gather', resource: 'wood' });
  for (let i = 0; i < 3; i++) tickWorld(world);
  assert.equal(equipmentLevel(citizen, 'tool'), 1);
  tickWorld(world);
  assert.equal(equipmentLevel(citizen, 'tool'), 2);
  assert.equal(citizen.wood, 0);
  assert.equal(citizen.replanReason, 'planned steps complete');
  tickWorld(world);
  assert.equal(citizen.order.work, true, 'productive work continues while awaiting a review');
});

test('each tool level reduces actual harvest duration and each shoe level speeds a long route', () => {
  const harvestTimes = [], travelTimes = [];
  for (const level of [0, 1, 2, 3]) {
    const { world, citizen } = alone();
    const tree = world.nodes.find(n => n.kind === 'tree');
    Object.assign(citizen, { x: tree.x, y: tree.y, tool: level > 0, toolLevel: level });
    plan(world, citizen, [{ type: 'gather', resource: 'wood', amount: 1 }]);
    while (!world.stats.harvestedWood && world.tick < 30) tickWorld(world);
    assert.ok(world.stats.harvestedWood > 0);
    harvestTimes.push(world.tick);
    const trip = alone();
    trip.world.blocked = [];
    Object.assign(trip.citizen, { x: 0, y: 0, shoes: level > 0, shoesLevel: level });
    plan(trip.world, trip.citizen, [{ type: 'move', x: 19, y: 15 }]);
    while ((trip.citizen.x !== 19 || trip.citizen.y !== 15) && trip.world.tick < 60) tickWorld(trip.world);
    assert.deepEqual([trip.citizen.x, trip.citizen.y], [19, 15]);
    travelTimes.push(trip.world.tick);
  }
  for (let i = 1; i < 4; i++) {
    assert.equal(harvestTimes[i], harvestTimes[i - 1] - 1);
    assert.ok(travelTimes[i] < travelTimes[i - 1], JSON.stringify(travelTimes));
  }
});

test('a concrete milestone prompts review without holding the remaining productive queue', () => {
  const { world, citizen } = alone();
  plan(world, citizen, [{ type: 'craft', item: 'shoes' }, { type: 'gather', resource: 'wood', amount: 5 }]);
  for (let i = 0; i < 4; i++) tickWorld(world);
  assert.equal(citizen.shoes, true);
  assert.equal(citizen.replanReason, 'milestone completed');
  assert.equal(citizen.tasks.length, 1);
  tickWorld(world);
  assert.equal(citizen.order.task.type, 'gather');
  assert.ok(!citizen.planBlocked);
});

test('weapon tiers affect attacks, counters and buildings; breakage clears the tier', () => {
  for (const level of [1, 2, 3]) {
    const world = createWorld(), [actor, target] = world.citizens;
    world.citizens = [actor, target];
    Object.assign(target, { x: actor.x + 1, y: actor.y });
    for (const citizen of [actor, target]) Object.assign(citizen, { energy: 100, weapon: true, weaponLevel: level, weaponDurability: 1 });
    assert.equal(resolveInteraction(world, actor, { type: 'attack', target: target.id }).ok, true);
    assert.equal(target.health, 100 - EQUIPMENT.weapon[level].damage);
    assert.equal(actor.health, 100 - EQUIPMENT.weapon[level].counterDamage);
    for (const citizen of [actor, target]) assert.deepEqual([citizen.weapon, citizen.weaponLevel, citizen.weaponDurability], [false, 0, 0]);
    Object.assign(actor, { weapon: true, weaponLevel: level, weaponDurability: 1, energy: 100 });
    world.buildings = [{ id: 'bakery-1', kind: 'bakery', ownerId: target.id, x: actor.x, y: actor.y, health: 100, maxHealth: 100, destroyed: false }];
    world.nextBuildingId = 2;
    assert.equal(resolveBuilding(world, actor, { type: 'attack', target: 'bakery-1' }).ok, true);
    assert.equal(world.buildings[0].health, 100 - EQUIPMENT.weapon[level].damage);
    assert.deepEqual([actor.weapon, actor.weaponLevel, actor.weaponDurability], [false, 0, 0]);
  }
});
