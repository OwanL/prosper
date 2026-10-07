import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInteraction } from '../lib/interactions.mjs';
import { CRAFT_COSTS } from '../lib/economy.mjs';
import { applyPlan, createWorld, planningContext, tickWorld } from '../lib/world.mjs';

function strategy(tasks, options = {}) {
  return {
    thought: options.thought ?? 'A considered choice.',
    goals: options.goals ?? ['Stay well'],
    memory: options.memory ?? '',
    routine: {
      food: options.routine?.food ?? 4,
      wood: options.routine?.wood ?? 3,
      family: options.routine?.family ?? false,
    },
    reviewAfter: options.reviewAfter ?? 300,
    tasks,
  };
}

function citizen(world, id) {
  return world.citizens.find((entry) => entry.id === id);
}

function node(world, id) {
  return world.nodes.find((entry) => entry.id === id);
}

function apply(world, id, tasks, options) {
  return applyPlan(world, id, strategy(tasks, options));
}

function blocked(world, x, y) {
  return world.blocked.some((tile) => tile.x === x && tile.y === y);
}

test('move orders use deterministic BFS steps through a ridge gap', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  apply(world, mira.id, [{ type: 'move', x: 10, y: 2 }]);

  let previous = { x: mira.x, y: mira.y };
  let crossedRidgeGap = false;
  for (let tick = 0; tick < 40 && (mira.x !== 10 || mira.y !== 2); tick += 1) {
    tickWorld(world);
    const distance = Math.abs(mira.x - previous.x) + Math.abs(mira.y - previous.y);
    assert.ok(distance <= 1, 'an order advances by at most one orthogonal tile per tick');
    assert.equal(blocked(world, mira.x, mira.y), false, 'the route never enters a blocked ridge tile');
    if (mira.x === 8 && mira.y === 4) crossedRidgeGap = true;
    previous = { x: mira.x, y: mira.y };
  }

  assert.deepEqual([mira.x, mira.y], [10, 2]);
  assert.equal(crossedRidgeGap, true, 'the shortest route uses the ridge opening');
  tickWorld(world);
  assert.equal(mira.order, null);
  assert.equal(mira.planCount, 1, 'deterministic travel does not request another strategy');
});

test('gather orders count units across depletion and regrowth without replanning', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const crop = node(world, 'crop-1');
  crop.capacity = 1;
  crop.stock = 1;
  crop.regrowTicks = 2;
  crop.regrowIn = 0;
  world.nodes = [crop];
  mira.knowledge.nodes = {};
  mira.x = crop.x;
  mira.y = crop.y;
  mira.food = 8;
  apply(world, mira.id, [{ type: 'gather', resource: 'food', amount: 2 }], {
    routine: { food: 2, wood: 0 },
  });

  for (let tick = 0; tick < 40 && world.stats.harvestedFood < 2; tick += 1) tickWorld(world);

  assert.equal(world.stats.harvestedFood, 2);
  assert.equal(mira.food, 10);
  assert.equal(mira.planCount, 1);
  assert.equal(mira.order?.progress, 2);
  assert.equal(mira.tasks.length, 0);
  assert.equal(world.events.some((event) => /could not finish/.test(event.text)), false);
  tickWorld(world);
  assert.equal(mira.order, null);
});

test('needs interrupt work safely, then the strategic order resumes', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const tree = node(world, 'tree-1');
  mira.x = tree.x;
  mira.y = tree.y;
  mira.food = 1;
  mira.wood = 0;
  mira.hunger = 25;
  mira.energy = 85;
  apply(world, mira.id, [{ type: 'gather', resource: 'wood', amount: 1 }], {
    routine: { food: 2, wood: 0 },
  });

  tickWorld(world);
  assert.equal(mira.current?.task.type, 'harvest');
  assert.equal(mira.order?.task.type, 'gather');
  mira.hunger = 69.7;
  mira.energy = 20;
  tickWorld(world);
  assert.equal(mira.food, 0, 'the citizen eats when hunger interrupts harvesting');
  assert.equal(mira.order?.progress, 0, 'interrupted work has no premature harvest effect');
  assert.equal(mira.current, null);

  tickWorld(world);
  assert.equal(mira.current?.task.type, 'sleep', 'low energy triggers the routine recovery action');
  for (let tick = 0; tick < 15 && mira.order; tick += 1) tickWorld(world);

  assert.equal(mira.order, null, 'the gather order finishes after needs are met');
  assert.equal(mira.wood, 5);
  assert.equal(mira.planCount, 1);
  assert.ok(mira.energy > 20);
});

test('legacy reserve values do not auto-gather while awaiting the next undertaking', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const crop = node(world, 'crop-1');
  mira.x = crop.x;
  mira.y = crop.y;
  mira.food = 0;
  mira.hunger = 25;
  mira.energy = 100;
  apply(world, mira.id, [{ type: 'wait', ticks: 1 }], {
    routine: { food: 2, wood: 0 },
  });

  for (let tick = 0; tick < 30; tick += 1) {
    tickWorld(world);
    assert.ok(mira.hunger < 60, 'no hunger-driven rescue is needed');
  }

  assert.equal(mira.food, 0, 'legacy reserve targets do not invent gathering work');
  assert.equal(world.stats.harvestedFood, 0);
  assert.equal(mira.work, null);
  assert.notEqual(mira.current?.task.type, 'harvest', 'waiting for a decision does not start a harvest');
  assert.equal(mira.planCount, 1, 'deterministic upkeep does not make another model call');
  assert.equal(mira.order, null);
  assert.equal(mira.tasks.length, 0);
  assert.equal(mira.replanReason, 'strategy complete', 'completion requests the next eligible undertaking');
  assert.equal(mira.activity, 'Choosing next undertaking');
  assert.equal(world.events.some((event) => /ReservesMet|reserves met/i.test(event.text)), false);
});

test('chosen gather work continues beyond a configured legacy food reserve', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const crop = node(world, 'crop-1');
  crop.capacity = 4;
  crop.stock = 4;
  crop.regrowTicks = 99;
  crop.regrowIn = 0;
  world.nodes = [crop];
  mira.x = crop.x;
  mira.y = crop.y;
  mira.food = 0;
  mira.hunger = 25;
  mira.energy = 100;
  mira.knowledge.nodes = { [crop.id]: { ...crop, observedAt: world.tick, source: 'seen' } };
  apply(world, mira.id, [{ type: 'wait', ticks: 1 }], {
    routine: { food: 2, wood: 0 },
  });
  mira.work = { type: 'gather', resource: 'food' };

  for (let tick = 0; tick < 30; tick += 1) tickWorld(world);

  assert.ok(mira.food >= 3, 'chosen work keeps harvesting after passing the legacy reserve of two');
  assert.ok(world.stats.harvestedFood >= 3);
  assert.equal(mira.tasks.length, 0, 'the finite task list is exhausted');
  assert.notEqual(mira.order?.task.type, 'wait', 'the explicit wait finished');
  assert.deepEqual(mira.work, { type: 'gather', resource: 'food' }, 'the chosen policy persists');
  assert.equal(mira.planCount, 1);
});

test('craft weapon orders automatically gather missing wood before crafting', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const tree = node(world, 'tree-1');
  tree.capacity = Math.ceil(CRAFT_COSTS.weapon / tree.yield);
  tree.stock = tree.capacity;
  tree.regrowIn = 0;
  world.nodes = [tree];
  mira.knowledge.nodes = {};
  mira.x = tree.x;
  mira.y = tree.y;
  mira.wood = 0;
  apply(world, mira.id, [{ type: 'craft', item: 'weapon' }], {
    routine: { food: 2, wood: 0 },
  });

  for (let tick = 0; tick < 50 && !mira.weapon; tick += 1) tickWorld(world);

  assert.equal(mira.weapon, true);
  assert.equal(mira.weaponDurability, 12);
  assert.equal(mira.wood, 0);
  assert.equal(world.stats.harvestedWood, tree.capacity * tree.yield);
  assert.equal(world.stats.harvestedWood - mira.wood, CRAFT_COSTS.weapon);
  assert.equal(world.stats.crafted, 1);
  assert.equal(world.stats.weapons, 1);
  assert.equal(mira.planCount, 1);
});

test('trade orders follow a moving maker and exchange escrow atomically at adjacency', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  const oren = citizen(world, 'citizen-2');
  oren.x = 5;
  oren.y = 2;
  oren.wood = 4;
  oren.food = 2;
  mira.food = 2;
  mira.wood = 0;
  apply(world, oren.id, [{
    type: 'offer', give: 'wood', giveAmount: 2, want: 'food', wantAmount: 1,
  }], { routine: { food: 2, wood: 0 } });
  tickWorld(world);
  const offer = world.offers.find((entry) => entry.status === 'open');
  assert.ok(offer);
  assert.equal(oren.wood, 2, 'offer inventory is held in escrow');

  apply(world, oren.id, [{ type: 'wait', ticks: 120 }], { routine: { food: 2, wood: 0 } });
  apply(world, mira.id, [{ type: 'trade', offer: offer.id }], { routine: { food: 2, wood: 0 } });
  for (let tick = 0; tick < 30 && mira.current?.task.type !== 'trade'; tick += 1) tickWorld(world);
  assert.equal(mira.current?.task.type, 'trade', 'the buyer reaches the maker and begins the exchange');
  assert.equal(offer.status, 'open');

  // Let the maker move before the buyer's in-flight exchange completes.
  apply(world, oren.id, [{ type: 'move', x: 6, y: 3 }], { routine: { food: 2, wood: 0 } });
  world.citizens = [oren, mira, ...world.citizens.filter((entry) => entry !== oren && entry !== mira)];
  tickWorld(world);
  assert.deepEqual([oren.x, oren.y], [6, 2]);
  assert.equal(offer.status, 'open', 'the buyer does not exchange from a stale position');
  assert.equal(mira.order?.task.type, 'trade', 'the trade order remains active and re-paths');

  for (let tick = 0; tick < 20 && offer.status === 'open'; tick += 1) tickWorld(world);

  assert.equal(offer.status, 'filled');
  assert.equal(world.stats.trades, 1);
  assert.equal(mira.food, 1);
  assert.equal(mira.wood, 2);
  assert.equal(oren.food, 3);
  assert.equal(oren.wood, 2);
});

test('attack orders stop after three strikes and cannot target children', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  const oren = citizen(world, 'citizen-2');
  mira.x = 2;
  mira.y = 2;
  oren.x = 3;
  oren.y = 2;
  oren.energy = 0; // No retaliation obscures the exact three-strike bound.
  oren.hunger = 60;
  oren.food = 0;
  world.nodes = [];
  // No food and no unexplored frontier: keep the defender in range for this strike-bound test.
  oren.knowledge = { nodes: {}, explored: Array.from({ length: world.width * world.height }, (_, i) => `${i % world.width},${Math.floor(i / world.width)}`) };
  const child = { ...structuredClone(oren), id: 'citizen-child', name: 'Sprig', adult: false, bornAt: 0, parents: [mira.id, oren.id] };
  world.citizens.push(child);

  const before = JSON.stringify(world);
  assert.throws(
    () => apply(world, mira.id, [{ type: 'attack', target: child.id }]),
    /Invalid attack order/,
  );
  assert.equal(JSON.stringify(world), before, 'a prohibited child target leaves the world unchanged');
  world.citizens.pop();
  apply(world, oren.id, [{ type: 'wait', ticks: 120 }]);
  apply(world, mira.id, [{ type: 'attack', target: oren.id }]);

  for (let tick = 0; tick < 25 && (world.stats.attacks < 3 || mira.order || mira.tasks.length); tick += 1) tickWorld(world);

  assert.equal(world.stats.attacks, 3);
  assert.equal(oren.health, 82, 'exactly three unarmed hits land');
  assert.equal(mira.order, null);
  assert.equal(mira.planCount, 1);
});

test('reproduction creates a dependent, parents feed it, and it matures at 300 ticks', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  const oren = citizen(world, 'citizen-2');
  mira.x = 2;
  mira.y = 2;
  oren.x = 3;
  oren.y = 2;
  for (const adult of [mira, oren]) {
    adult.food = 8;
    adult.wood = 0;
    adult.hunger = 20;
    adult.energy = 80;
    adult.health = 100;
    adult.familyReady = true;
  }
  assert.equal(resolveInteraction(world, mira, { type: 'propose_family', target: oren.id }).ok, true);
  assert.equal(resolveInteraction(world, oren, { type: 'accept_family', proposal: world.familyProposals[0].id }).ok, true);
  apply(world, oren.id, [{ type: 'wait', ticks: 120 }], { routine: { family: true } });
  apply(world, mira.id, [{ type: 'reproduce', target: oren.id }], { routine: { family: true } });

  for (let tick = 0; tick < 10 && world.stats.births === 0; tick += 1) tickWorld(world);

  assert.equal(world.stats.births, 1);
  const child = world.citizens.find((entry) => !entry.adult);
  assert.ok(child);
  assert.deepEqual(child.parents, [mira.id, oren.id]);
  assert.equal(child.bornAt, world.tick);
  assert.equal(child.food, 2);
  assert.equal(child.health, 100);
  assert.equal(child.planCount, 0);
  assert.equal(mira.food, 6);
  assert.equal(oren.food, 6);
  assert.equal(mira.wood, 0);
  assert.equal(oren.wood, 0);
  assert.equal(mira.familyReady, false);
  assert.equal(oren.familyReady, false);
  assert.throws(() => apply(world, mira.id, [{ type: 'attack', target: child.id }]), /Invalid attack order/);

  child.food = 0;
  child.hunger = 55;
  const parentFood = mira.food + oren.food;
  tickWorld(world);
  assert.ok(child.food > 0, 'the nearby dependent receives food before needing to forage');
  assert.ok(child.hunger < 60, 'the dependent remains below the foraging threshold');
  assert.equal(mira.food + oren.food + child.food, parentFood, 'parental care conserves food');
  assert.ok(mira.food < 6 || oren.food < 6, 'a parent supplies the dependent');
  assert.ok(world.events.some((event) => /(?:fed|gave \d+ food to) Sprig/.test(event.text)));

  world.tick = child.bornAt + 299;
  tickWorld(world);
  assert.equal(child.adult, true);
  assert.equal(child.reviewAt, world.tick);
  assert.equal(child.replanReason, 'became adult');
  assert.equal(child.planCount, 0, 'maturation does not invent a strategic plan');
});

test('starvation drains health and eventually records a dead citizen', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  mira.food = 0;
  mira.hunger = 100;
  mira.health = 2;

  tickWorld(world);
  assert.equal(mira.health, 1.5);
  assert.equal(world.citizens.includes(mira), true);
  tickWorld(world);
  tickWorld(world);
  assert.equal(mira.health, 0.5);
  tickWorld(world);

  assert.equal(world.citizens.includes(mira), false);
  assert.equal(mira.alive, false);
  assert.equal(mira.health, 0);
  assert.equal(mira.status, 'dead');
  assert.equal(world.dead.at(-1), mira);
  assert.equal(world.stats.deaths, 1);
});

test('a healthy citizen still handles needs while a planner request is in flight', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const tree = node(world, 'tree-1');
  mira.x = tree.x;
  mira.y = tree.y;
  mira.hunger = 25;
  mira.food = 2;
  apply(world, mira.id, [{ type: 'gather', resource: 'wood', amount: 1 }]);
  tickWorld(world);
  mira.hunger = 69.7;
  mira.planning = true;
  mira.status = 'thinking';

  tickWorld(world);

  assert.equal(mira.planning, true, 'the pending request marker does not suspend deterministic upkeep');
  assert.equal(mira.food, 1);
  assert.ok(mira.hunger < 40, 'the citizen ate while the request was pending');
  assert.equal(mira.order?.task.type, 'gather', 'the strategic order remains active through routine needs');
  assert.equal(mira.planCount, 1);
});

test('strategic plans validate strictly and reject atomically', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  apply(world, mira.id, [{ type: 'wait', ticks: 2 }], { memory: 'Keep the shade in mind.' });
  const before = JSON.stringify(world);

  const invalidPlans = [
    strategy([
      { type: 'wait', ticks: 1 },
      { type: 'move', x: 16, y: 0 },
    ]),
    { ...strategy([{ type: 'wait', ticks: 1 }]), extra: true },
    strategy([{ type: 'gather', resource: 'food', amount: -1 }]),
    strategy([{ type: 'move', x: 3, y: 2 }], { routine: { food: -1, wood: 0 } }),
    strategy([{ type: 'wait', ticks: 1 }], { reviewAfter: 179 }),
    strategy([{ type: 'harvest', target: 'crop-1' }]),
  ];
  for (const invalid of invalidPlans) {
    assert.throws(() => applyPlan(world, mira.id, invalid), /Invalid/);
    assert.equal(JSON.stringify(world), before, 'a rejected plan changes no world, citizen, or event state');
  }
});

test('planning context keeps strategic state compact, recent, and detached', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  apply(world, mira.id, [{ type: 'wait', ticks: 2 }], { memory: 'A useful observation.' });
  mira.memories = Array.from({ length: 8 }, (_, index) => `memory ${index}`);
  mira.tasks = [];
  mira.order = { task: { type: 'wait', ticks: 2 }, startedAt: 0, progress: 0 };
  mira.current = { task: { type: 'move', x: 2, y: 3 }, remaining: 1, total: 1, purpose: 'travel' };
  mira.path = [{ x: 3, y: 2 }];
  mira.planning = true;
  mira.activity = 'private execution detail';
  for (let index = 0; index < 6; index += 1) {
    world.board.push({ id: `message-${index}`, tick: index, text: `message ${index}` });
    world.events.push({ id: `event-${index}`, tick: index, citizenId: mira.id, text: `personal event ${index}` });
  }
  world.events.push({ id: 'other-event', tick: 9, citizenId: 'citizen-2', text: 'not mine' });

  const context = planningContext(world, mira.id);

  assert.deepEqual(context.citizen.memories, ['memory 5', 'memory 6', 'memory 7']);
  assert.deepEqual(context.citizen.tasks, []);
  assert.deepEqual(context.citizen.order, { type: 'wait', ticks: 2 });
  assert.equal('current' in context.citizen, false);
  assert.equal('path' in context.citizen, false);
  assert.equal('planning' in context.citizen, false);
  assert.equal('activity' in context.citizen, false);
  assert.deepEqual(context.board.map((entry) => entry.text), ['message 2', 'message 3', 'message 4', 'message 5']);
  assert.deepEqual(context.events.map((entry) => entry.text), ['personal event 2', 'personal event 3', 'personal event 4', 'personal event 5']);
  assert.ok(JSON.stringify(context).length < 12_000);
  assert.ok(context.deposits.length > 0);
  assert.equal('nodes' in context, false);

  const before = JSON.stringify(world);
  context.citizen.goals.push('mutated copy');
  context.deposits[0].stock = -99;
  context.board[0].text = 'mutated copy';
  assert.equal(JSON.stringify(world), before, 'context mutations cannot alter the simulation');
});

test('hunger at 60 with no food interrupts a strategic wait for auto-foraging', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const crop = node(world, 'crop-1');
  mira.x = crop.x;
  mira.y = crop.y;
  mira.food = 0;
  mira.hunger = 20;
  apply(world, mira.id, [{ type: 'wait', ticks: 120 }], {
    routine: { food: 2, wood: 0 },
  });

  tickWorld(world);
  assert.equal(mira.order?.task.type, 'wait');
  assert.equal(mira.order.progress, 1);
  mira.hunger = 59.75;
  tickWorld(world);

  assert.equal(mira.food, 0);
  assert.equal(mira.order?.task.type, 'wait', 'foraging preserves the strategic wait');
  assert.equal(mira.order.progress, 1, 'the interrupted wait makes no progress during foraging');
  assert.equal(mira.current?.task.type, 'harvest');
  assert.equal(mira.current.purpose, 'need');

  for (let tick = 0; tick < 160 && mira.order; tick += 1) tickWorld(world);
  assert.equal(mira.order, null, 'the wait resumes after the citizen forages and eats');
  assert.equal(mira.planCount, 1);
  assert.ok(world.stats.harvestedFood >= 1);
  assert.equal(world.events.some((event) => /could not finish/.test(event.text)), false);
});

test('energy at 20 interrupts work so the citizen can sleep', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const tree = node(world, 'tree-1');
  mira.x = tree.x;
  mira.y = tree.y;
  mira.hunger = 25;
  mira.energy = 20.3;
  apply(world, mira.id, [{ type: 'gather', resource: 'wood', amount: 1 }], {
    routine: { food: 2, wood: 0 },
  });

  tickWorld(world);
  assert.equal(mira.current?.task.type, 'harvest');
  assert.equal(mira.order?.task.type, 'gather');
  mira.energy = 20;
  tickWorld(world);

  assert.equal(mira.current?.task.type, 'sleep');
  assert.equal(mira.current.purpose, 'need');
  assert.equal(mira.order?.task.type, 'gather', 'the strategic work remains queued while energy recovers');
  assert.equal(mira.order.progress, 0);
  assert.equal(world.stats.harvestedWood, 0, 'interrupted work has no premature harvest effect');
});

test('an interrupted strategic wait keeps its progress and finishes without timeout', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  mira.hunger = 25;
  mira.energy = 85;
  apply(world, mira.id, [{ type: 'wait', ticks: 120 }], {
    routine: { food: 2, wood: 0 },
  });

  for (let tick = 0; tick < 60; tick += 1) tickWorld(world);
  assert.equal(mira.order?.progress, 60);
  mira.hunger = 59.8;
  mira.food = 1;
  tickWorld(world);
  const interruptedAt = world.tick;

  assert.equal(mira.food, 0, 'the need interruption is resolved by eating');
  assert.ok(mira.hunger < 30);
  assert.equal(mira.order?.progress, 60, 'the need interruption does not erase elapsed wait progress');

  for (let tick = 0; tick < 70 && mira.order; tick += 1) tickWorld(world);
  assert.equal(mira.order, null);
  assert.equal(world.tick - interruptedAt, 60, 'only the remaining wait ticks are needed after interruption');
  assert.equal(mira.planCount, 1);
  assert.equal(world.events.some((event) => /could not finish|timed out/.test(event.text)), false);
});

test('a wounded citizen without nearby hostiles can complete a multi-tick food harvest', () => {
  const world = createWorld({ expanded: false });
  const mira = citizen(world, 'citizen-1');
  world.citizens = [mira];
  const crop = node(world, 'crop-1');
  crop.stock = 2;
  crop.regrowIn = 0;
  mira.x = crop.x;
  mira.y = crop.y;
  mira.health = 20;
  mira.hunger = 25;
  mira.energy = 85;
  mira.food = 0;
  apply(world, mira.id, [{ type: 'gather', resource: 'food', amount: 2 }], {
    routine: { food: 2, wood: 0 },
  });

  for (let tick = 0; tick < 30 && (mira.order || mira.tasks.length); tick += 1) tickWorld(world);

  assert.equal(world.stats.harvestedFood, 2);
  assert.equal(mira.food, 2);
  assert.equal(mira.order, null, 'low health alone does not reset the harvest order');
  assert.equal(mira.planCount, 1);
  assert.equal(world.events.some((event) => /could not finish/.test(event.text)), false);
});
