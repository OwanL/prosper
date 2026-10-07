import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMotion, createMotionClock } from '../ui/motion.js';
import { recordMotion } from '../lib/motion.mjs';
import { createWorld, applyPlan, planningContext, tickWorld } from '../lib/world.mjs';
import { citizenObservation } from '../lib/citizen-tools.mjs';
import { normalizePlan } from '../lib/plans.mjs';

test('polling unchanged ticks does not rewind the animation clock and no movement is predicted beyond truth', () => {
  for (const speed of [1, 3, 8]) {
    const clock = createMotionClock();
    clock.receive(10, true, speed, 0);
    let previous = clock.sample(0);
    for (let now = 20; now <= 1200; now += 20) {
      if (now % 100 === 0) clock.receive(10 + Math.floor(now * speed / 1000), true, speed, now);
      const position = clock.sample(now);
      assert.ok(position >= previous, `speed ${speed} at ${now}ms must not rewind`);
      assert.ok(position <= 10 + Math.floor(now * speed / 1000));
      assert.ok(position - previous <= speed * .020001, 'a new observation does not teleport the display');
      previous = position;
    }
    assert.ok(clock.sample(100000) >= previous, 'a background-tab resume must not rewind');
    assert.equal(clock.sample(101000), 10 + Math.floor(1200 * speed / 1000));
  }
});

test('animation speed changes preserve position, pause shows truth and a world reset starts a new clock', () => {
  const clock = createMotionClock();
  clock.receive(20, true, 3, 0);
  const before = clock.sample(200);
  clock.receive(20, true, 8, 200);
  assert.equal(clock.sample(200), before);
  clock.receive(21, false, 8, 300);
  assert.equal(clock.sample(500), 21);
  clock.receive(0, true, 1, 600);
  assert.equal(clock.sample(600), 0);
});

test('motion interpolation follows real corners and never draws a diagonal shortcut', () => {
  const points = [{ tick: 10, x: 0, y: 0 }, { tick: 11, x: 1, y: 0 }, { tick: 12, x: 1, y: 1 }];
  assert.deepEqual(sampleMotion(points, 10.5), { x: .5, y: 0 });
  assert.deepEqual(sampleMotion(points, 11.5), { x: 1, y: .5 });
  assert.deepEqual(sampleMotion(points, 100), points.at(-1));
  assert.deepEqual(sampleMotion([{ tick: 0, x: 0, y: 0 }, { tick: 1, x: 4, y: 4 }], .5), { tick: 0, x: 0, y: 0 });
});

test('movement evidence is bounded and pauses anchor the next step instead of smearing motion across work', () => {
  const citizen = { x: 0, y: 0 };
  for (let tick = 1; tick <= 100; tick++) {
    const previous = { x: citizen.x, y: citizen.y }; citizen.x++;
    recordMotion(citizen, previous, tick);
  }
  assert.equal(citizen.motion.length, 32);
  const previous = { x: citizen.x, y: citizen.y }; citizen.y++;
  recordMotion(citizen, previous, 150);
  assert.equal(citizen.motion.at(-2).tick, 149);
  assert.deepEqual(sampleMotion(citizen.motion, 149.5), { x: 100, y: .5 });
});

test('real executor records movement but planning observations never expose the spectator trail', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0];
  applyPlan(world, citizen.id, normalizePlan({ tasks: [{ type: 'move', x: citizen.x + 3, y: citizen.y }], work: null }, planningContext(world, citizen.id)));
  for (let i = 0; i < 5; i++) tickWorld(world);
  assert.ok(citizen.motion.length >= 3);
  assert.ok(citizen.motion.every(p => Number.isFinite(p.tick)));
  assert.equal(JSON.stringify(citizenObservation(world, citizen.id)).includes('"motion"'), false);
  assert.equal(Object.hasOwn(planningContext(world, citizen.id).citizen, 'motion'), false);
});
