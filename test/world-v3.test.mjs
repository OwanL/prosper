import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, createWorld, planningContext, tickWorld } from '../lib/world.mjs';

function citizen(world, id = 'citizen-1') {
  return world.citizens.find((entry) => entry.id === id);
}

function strategy(tasks, { food = 0, wood = 0, family = false } = {}) {
  return {
    thought: 'A considered choice.',
    goals: ['Stay well'],
    memory: '',
    routine: { food, wood, family },
    reviewAfter: 300,
    tasks,
  };
}

function apply(world, id, tasks, reserves) {
  return applyPlan(world, id, strategy(tasks, reserves));
}

function prepare(c, { x = c.x, y = c.y, food = 20, wood = 20, hunger = 0 } = {}) {
  Object.assign(c, {
    x, y, food, wood, hunger, energy: 100, health: 100,
    routine: { food: 0, wood: 0 }, current: null, order: null, tasks: [],
    path: [], planning: false,
  });
}

function observation(node, { stock = node.stock, observedAt = 0, source = 'seen' } = {}) {
  return {
    id: node.id,
    kind: node.kind,
    x: node.x,
    y: node.y,
    stock,
    capacity: node.capacity ?? 1,
    yield: node.yield ?? (node.kind === 'tree' ? 5 : 1),
    regrowTicks: node.regrowTicks ?? (node.kind === 'tree' ? 120 : 99),
    observedAt,
    source,
  };
}

function remember(c, ...nodes) {
  c.knowledge = {
    nodes: Object.fromEntries(nodes.map((entry) => [entry.id, entry])),
    explored: [],
  };
}

function childOf(parents, { x, y, food = 0, hunger = 55 } = {}) {
  return {
    ...structuredClone(parents[0]),
    id: 'test-child',
    name: 'Sprig',
    x,
    y,
    food,
    wood: 0,
    hunger,
    energy: 90,
    health: 100,
    adult: false,
    bornAt: 0,
    parents: parents.map((parent) => parent.id),
    tasks: [],
    current: null,
    order: null,
    path: [],
    planCount: 0,
    planning: false,
    status: 'idle',
    routine: { food: 0, wood: 0 },
    knowledge: { nodes: {}, explored: [] },
  };
}

function memoryMap(context) {
  const result = new Map();
  const add = (entries) => {
    if (Array.isArray(entries)) {
      for (const entry of entries) if (entry?.id) result.set(entry.id, entry);
    } else if (entries && typeof entries === 'object') {
      for (const [id, entry] of Object.entries(entries)) {
        if (entry && typeof entry === 'object') result.set(id, entry);
      }
    }
  };
  add(context.nodes);
  add(context.deposits);
  add(context.citizen?.knowledge?.nodes);
  add(context.knowledge?.nodes);
  return result;
}

test('v3 crops have capacity one and the documented ideal food flow supports sixteen adults', () => {
  const world = createWorld({ expanded: false });
  const crops = world.nodes.filter((node) => node.kind === 'crop');
  assert.equal(crops.length, 12);
  assert.ok(crops.every((node) => node.capacity === 1));
  assert.ok(crops.every((node) => node.stock === 0 || node.stock === 1));

  const summary = world.economy ?? planningContext(world, 'citizen-1').economy;
  assert.ok(summary, 'the world summary exposes its food sustainability calculation');
  assert.ok(Math.abs(summary.foodPerMinute - (12 * 60 / (99 + 6))) < 1e-12);
  assert.ok(Math.abs(summary.adultFoodPerMinute - (0.25 * 60 / 35)) < 1e-12);
  assert.equal(summary.idealAdults, 16);
});

test('legacy reserve fields are discarded and direct gifts have no small quantity cap', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world);
  const oren = citizen(world, 'citizen-2');
  world.citizens = [mira, oren];
  world.nodes = [];
  prepare(mira, { x: 3, y: 3, food: 80, wood: 80 });
  prepare(oren, { x: 4, y: 3, food: 0, wood: 0 });

  apply(world, mira.id, [{ type: 'give', target: oren.id, resource: 'food', amount: 25 }], {
    food: 50,
    wood: 60,
  });
  assert.deepEqual(mira.routine, { family: false });
  for (let tick = 0; tick < 5 && (mira.tasks.length > 0 || mira.order); tick += 1) tickWorld(world);

  assert.equal(mira.food, 55);
  assert.equal(oren.food, 25);
});

test('planning context and automatic target selection do not expose hidden live deposits', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world);
  world.citizens = [mira];
  prepare(mira, { x: 2, y: 2, food: 0, wood: 20, hunger: 60 });
  const known = {
    id: 'known-crop', kind: 'crop', x: 2, y: 2, capacity: 1, yield: 1,
    regrowTicks: 99, stock: 0, regrowIn: 77,
  };
  const hidden = {
    id: 'unseen-crop', kind: 'crop', x: 14, y: 9, capacity: 1, yield: 1,
    regrowTicks: 99, stock: 1, regrowIn: 0,
  };
  world.nodes = [known, hidden];
  remember(mira, observation(known, { stock: 0, observedAt: 4 }));

  const context = planningContext(world, mira.id);
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes(hidden.id), false, 'unknown deposit identities stay private');
  assert.equal(serialized.includes('regrowIn'), false, 'exact live readiness is never sent to a planner');
  const knownMemory = memoryMap(context).get(known.id);
  assert.ok(knownMemory, 'the last observed deposit remains available');
  assert.equal(knownMemory.stock, 0, 'the context carries the stale observation, not live stock');

  tickWorld(world);
  assert.notEqual(mira.gatherTarget?.nodeId, hidden.id, 'automatic gathering cannot select an unobserved live node');
});

test('an explicit gather target remains selected while an unseen remote node regrows', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world);
  world.citizens = [mira];
  prepare(mira, { x: 2, y: 2 });
  const target = {
    id: 'target-crop', kind: 'crop', x: 2, y: 2, capacity: 1, yield: 1,
    regrowTicks: 99, stock: 0, regrowIn: 40,
  };
  const remote = {
    id: 'remote-crop', kind: 'crop', x: 14, y: 9, capacity: 1, yield: 1,
    regrowTicks: 99, stock: 0, regrowIn: 1,
  };
  world.nodes = [target, remote];
  remember(mira, observation(target, { stock: 0, observedAt: 0 }));
  apply(world, mira.id, [{ type: 'gather', resource: 'food', amount: 1, target: target.id, camp: true }]);

  for (let tick = 0; tick < 8; tick += 1) tickWorld(world);

  assert.equal(remote.stock, 1, 'the remote live node did regrow during the visit');
  assert.equal(mira.gatherTarget?.resource, 'food');
  assert.equal(mira.gatherTarget?.nodeId, target.id);
  assert.equal(world.stats.harvestedFood, 0, 'remote regrowth did not redirect the gather order');
});

test('exploration discovers deposits from movement rather than an omniscient map', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world);
  world.citizens = [mira];
  prepare(mira, { x: 3, y: 3 });
  const initialExplored = [];
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if ((x - mira.x) ** 2 + (y - mira.y) ** 2 <= 9) initialExplored.push(`${x},${y}`);
    }
  }
  mira.knowledge = { nodes: {}, explored: initialExplored };
  world.nodes = [];
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const distanceSquared = (x - mira.x) ** 2 + (y - mira.y) ** 2;
      if (distanceSquared <= 9 || distanceSquared > 25) continue;
      world.nodes.push({
        id: `frontier-crop-${x}-${y}`, kind: 'crop', x, y, capacity: 1,
        yield: 1, regrowTicks: 99, stock: 1, regrowIn: 0,
      });
    }
  }
  assert.equal(memoryMap(planningContext(world, mira.id)).size, 0, 'unknown resources are absent before exploration');
  apply(world, mira.id, [{ type: 'explore', ticks: 60 }]);

  for (let tick = 0; tick < 6 && memoryMap(planningContext(world, mira.id)).size === 0; tick += 1) tickWorld(world);

  assert.ok(memoryMap(planningContext(world, mira.id)).size > 0, 'moving into the frontier records a local observation');
});

test('broadcast shares a stale snapshot and costs one wood', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world);
  const oren = citizen(world, 'citizen-2');
  world.citizens = [mira, oren];
  prepare(mira, { x: 1, y: 1, food: 20, wood: 2 });
  prepare(oren, { x: 2, y: 1, food: 20, wood: 0 });
  world.tick = 20;
  const crop = {
    id: 'stale-crop', kind: 'crop', x: 13, y: 8, capacity: 1,
    yield: 1, regrowTicks: 99, stock: 1, regrowIn: 0,
  };
  world.nodes = [crop];
  remember(mira, observation(crop, { stock: 0, observedAt: 4 }));
  remember(oren);
  apply(world, mira.id, [{ type: 'post', text: 'A crop was empty when last seen.', share: [crop.id] }]);

  for (let tick = 0; tick < 6 && world.stats.messages === 0; tick += 1) tickWorld(world);

  assert.equal(world.stats.messages, 1);
  assert.equal(mira.wood, 1);
  const report = memoryMap(planningContext(world, oren.id)).get(crop.id);
  assert.ok(report, 'the recipient receives a copy of the sender observation');
  assert.equal(report.stock, 0, 'broadcast does not query live stock');
  assert.equal(report.observedAt, 4, 'the original observation time is retained');
  assert.equal(report.source, 'report');
  assert.equal(report.reportedBy, mira.id);
});

test('repeated empty visits and harvest races leave bounded evidence', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world);
  world.citizens = [mira];
  prepare(mira, { x: 3, y: 3 });
  const crop = {
    id: 'missed-crop', kind: 'crop', x: 3, y: 3, capacity: 1,
    yield: 1, regrowTicks: 99, stock: 0, regrowIn: 99,
  };
  world.nodes = [crop];
  remember(mira, observation(crop, { stock: 0 }));
  apply(world, mira.id, [{ type: 'gather', resource: 'food', amount: 2, target: crop.id, camp: true }]);

  for (let tick = 0; tick < 3; tick += 1) tickWorld(world);
  const firstHistory = mira.resourceHistory?.[crop.id];
  assert.ok(firstHistory, 'an empty visit is recorded');
  assert.equal(firstHistory.emptyVisits, 1, 'wait polling is not counted as another empty visit');
  for (let tick = 0; tick < 35; tick += 1) tickWorld(world);
  assert.equal(mira.resourceHistory[crop.id].emptyVisits, 1, 'wait polling at the same node is still the same visit');

  apply(world, mira.id, [{ type: 'gather', resource: 'food', amount: 2, target: crop.id, camp: true }]);
  tickWorld(world);
  assert.equal(mira.resourceHistory[crop.id].emptyVisits, 2, 'a new gather order makes a distinct empty arrival');

  const raceWorld = createWorld({ expanded: false });
  const winner = citizen(raceWorld);
  const loser = citizen(raceWorld, 'citizen-2');
  raceWorld.citizens = [winner, loser];
  prepare(winner, { x: 3, y: 3 });
  prepare(loser, { x: 3, y: 3 });
  const contested = {
    id: 'contested-crop', kind: 'crop', x: 3, y: 3, capacity: 1,
    yield: 1, regrowTicks: 99, stock: 1, regrowIn: 0,
  };
  raceWorld.nodes = [contested];
  remember(winner, observation(contested));
  remember(loser, observation(contested));
  apply(raceWorld, winner.id, [{ type: 'gather', resource: 'food', amount: 2, target: contested.id, camp: true }]);
  apply(raceWorld, loser.id, [{ type: 'gather', resource: 'food', amount: 2, target: contested.id, camp: true }]);

  for (let tick = 0; tick < 20 && !loser.resourceHistory?.[contested.id]?.lostRaces; tick += 1) tickWorld(raceWorld);

  assert.equal(raceWorld.stats.harvestedFood, 1);
  assert.equal(loser.resourceHistory?.[contested.id]?.lostRaces, 1, 'a depleted-at-completion race is recorded once');
});

test('shoes improve long-route travel without accumulating idle speed credit', () => {
  function travelTicks(shoes) {
    const world = createWorld({ expanded: false });
    const walker = citizen(world);
    world.citizens = [walker];
    world.nodes = [];
    prepare(walker, { x: 0, y: 0 });
    walker.shoes = shoes;
    apply(world, walker.id, [{ type: 'move', x: 15, y: 9 }]);
    let elapsed = 0;
    while ((walker.x !== 15 || walker.y !== 9) && elapsed < 60) {
      tickWorld(world);
      elapsed += 1;
    }
    assert.deepEqual([walker.x, walker.y], [15, 9]);
    return elapsed;
  }

  const barefootTicks = travelTicks(false);
  const shodTicks = travelTicks(true);
  assert.ok(shodTicks < barefootTicks, `shoes should shorten the same long route (${shodTicks} vs ${barefootTicks})`);
  assert.ok(shodTicks <= Math.ceil(barefootTicks / 1.1) + 1, 'the long route reflects approximately 10% faster movement');

  const world = createWorld({ expanded: false });
  const walker = citizen(world);
  world.citizens = [walker];
  world.nodes = [];
  prepare(walker, { x: 2, y: 2 });
  walker.shoes = true;
  apply(world, walker.id, [
    { type: 'wait', ticks: 20 },
    { type: 'move', x: 7, y: 2 },
  ]);
  for (let tick = 0; tick < 30 && (walker.tasks[0]?.type === 'wait' || walker.order?.task.type === 'wait'); tick += 1) tickWorld(world);
  assert.equal(walker.order, null, 'the idle interval finished before travel began');
  tickWorld(world);
  assert.equal(Math.abs(walker.x - 2) + Math.abs(walker.y - 2), 1, 'idle time grants no extra first travel step');
});

test('a hungry child can receive food from the second adjacent parent', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world);
  const oren = citizen(world, 'citizen-2');
  prepare(mira, { x: 4, y: 3, food: 0 });
  prepare(oren, { x: 5, y: 4, food: 5 });
  const child = childOf([mira, oren], { x: 4, y: 4, food: 0, hunger: 55 });
  world.citizens = [mira, oren, child];
  world.nodes = [];
  apply(world, mira.id, [{ type: 'wait', ticks: 120 }]);
  apply(world, oren.id, [{ type: 'wait', ticks: 120 }]);
  const sharedFood = oren.food + child.food;

  tickWorld(world);

  assert.ok(child.food > 0, 'the second adjacent parent feeds the child');
  assert.equal(mira.food, 0, 'the nearest empty parent is not treated as the only caregiver');
  assert.equal(oren.food, sharedFood - child.food, 'the caregiver debit matches the dependent credit');
  assert.equal(oren.food + child.food, sharedFood, 'feeding conserves the family food total');
});

test('a hungry child follows a food-carrying parent instead of foraging locally', () => {
  const world = createWorld({ expanded: false });
  const nearestEmpty = citizen(world);
  const foodParent = citizen(world, 'citizen-2');
  prepare(nearestEmpty, { x: 2, y: 3, food: 0 });
  prepare(foodParent, { x: 5, y: 2, food: 5 });
  const child = childOf([nearestEmpty, foodParent], { x: 2, y: 2, food: 0, hunger: 70 });
  world.citizens = [child, nearestEmpty, foodParent];
  world.nodes = [{
    id: 'local-food', kind: 'crop', x: 2, y: 2, capacity: 1,
    yield: 1, regrowTicks: 99, stock: 1, regrowIn: 0,
  }];
  remember(child, observation(world.nodes[0]));

  tickWorld(world);

  assert.ok(child.x > 2 || child.y !== 2, 'the child begins moving toward the food-carrying parent');
  assert.notEqual(child.current?.task.type, 'harvest', 'local foraging does not override available family food');
});

test('children claim zero-price gifts reserved for them without a planning call', () => {
  const world = createWorld({ expanded: false });
  const donor = citizen(world);
  const otherParent = citizen(world, 'citizen-2');
  prepare(donor, { x: 4, y: 4, food: 10, wood: 0 });
  prepare(otherParent, { x: 12, y: 8, food: 10, wood: 0 });
  const child = childOf([donor, otherParent], { x: 5, y: 4, food: 2, hunger: 20 });
  world.citizens = [donor, otherParent, child];
  world.nodes = [];
  apply(world, donor.id, [{
    type: 'offer', give: 'food', giveAmount: 3, want: 'wood', wantAmount: 0, recipient: child.id,
  }]);

  for (let tick = 0; tick < 12 && world.offers.every((offer) => offer.status === 'open'); tick += 1) tickWorld(world);

  assert.equal(world.offers[0]?.status, 'filled');
  assert.equal(child.food, 5);
  assert.equal(donor.food, 7);
  assert.equal(world.stats.trades, 1);
  assert.equal(child.planCount, 0, 'gift claiming is deterministic and does not ask the child to plan');
});

test('a parent proactively approaches a hungry dependent while retaining its order', () => {
  const world = createWorld({ expanded: false });
  const parent = citizen(world);
  const partner = citizen(world, 'citizen-2');
  prepare(parent, { x: 5, y: 2, food: 5 });
  prepare(partner, { x: 14, y: 8, food: 0 });
  const child = childOf([parent, partner], { x: 2, y: 2, food: 0, hunger: 55 });
  world.citizens = [parent, partner, child];
  world.nodes = [];
  apply(world, parent.id, [{ type: 'wait', ticks: 120 }]);
  apply(world, partner.id, [{ type: 'wait', ticks: 120 }]);
  const sharedFood = parent.food + child.food;

  for (let tick = 0; tick < 12 && child.food === 0; tick += 1) tickWorld(world);

  assert.ok(parent.x < 5 || parent.y !== 2, 'the food-carrying parent moves toward the dependent');
  assert.ok(parent.order?.task.type === 'wait' || parent.tasks.some((task) => task.type === 'wait'), 'care preserves the interrupted strategic order');
  assert.ok(child.food > 0, 'the parent delivers food to the dependent');
  assert.equal(parent.food + child.food, sharedFood, 'the caregiver debit matches the dependent credit');
});

test('a dependent survives through adulthood when its parents have sufficient food', () => {
  const world = createWorld({ expanded: false });
  const [parent, partner] = world.citizens;
  prepare(parent, { x: 2, y: 2, food: 25 });
  prepare(partner, { x: 4, y: 2, food: 25 });
  const child = childOf([parent, partner], { x: 3, y: 2, food: 0, hunger: 55 });
  world.citizens = [parent, partner, child];
  world.nodes = [];
  for (let i = 0; i < 300; i++) tickWorld(world);
  assert.equal(child.alive, true);
  assert.equal(child.adult, true);
  assert.equal(world.stats.deaths, 0);
  assert.ok(world.stats.transfers > 0);
  assert.ok(child.hunger < 100);
  assert.ok(parent.food + partner.food + child.food < 50, 'care and consumption conserve, rather than invent, food');
});

test('clock overflow is rejected before mutating the world', () => {
  const world = createWorld({ expanded: false });
  world.tick = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(world);
  assert.throws(() => tickWorld(world), /safe numeric range/);
  assert.deepEqual(world, before);
});
