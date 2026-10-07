import test from "node:test";
import assert from "node:assert/strict";
import {
  BAKERY_COST, BAKERY_HEALTH, BAKE_TICKS, BIRTH_FOOD_COST, BIRTH_MIN_HEALTH, BREAD_NUTRITION, BUILD_TICKS, CRAFT_COSTS, REPAIR_TICKS,
} from "../lib/economy.mjs";
import { killCitizen, resolveInteraction, tickInteractions, OFFER_TTL } from "../lib/interactions.mjs";

function adult(id, x = 1, y = 1, overrides = {}) {
  return {
    id, name: id, x, y, food: 10, wood: 10, health: 100, hunger: 20, energy: 100,
    alive: true, adult: true, bornAt: null, tool: false, weapon: false, weaponDurability: 0,
    familyReady: true, reproduceAfter: 0, relationships: {}, parents: [], routine: { food: 4, wood: 3 },
    tasks: [], current: null, order: null, path: [], planning: false, status: "idle",
    ...overrides,
  };
}

function world(...citizens) {
  return {
    tick: 0, width: 8, height: 8, citizens, dead: [], offers: [], nextOfferId: 1, nextCitizenId: citizens.length + 1,
    stats: {
      harvestedFood: 0, harvestedWood: 0, messages: 0, transfers: 0,
      crafted: 0, weapons: 0, trades: 0, births: 0, deaths: 0, attacks: 0,
    },
  };
}

function effects(overrides = {}) {
  return {
    events: [], memories: [],
    event(text, citizenId) { this.events.push({ text, citizenId }); },
    remember(citizen, text) { this.memories.push({ citizenId: citizen.id, text }); },
    ...overrides,
  };
}

function resolve(state, who, task, fx = effects()) {
  return resolveInteraction(state, who, task, fx);
}

function agree(state, maker, recipient) {
  assert.equal(resolve(state, maker, { type: 'propose_family', target: recipient.id }).ok, true);
  const id = state.familyProposals.at(-1).id;
  assert.equal(resolve(state, recipient, { type: 'accept_family', proposal: id }).ok, true);
  return state.familyProposals.at(-1);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createChildEffect(state) {
  return (parent) => {
    const child = adult(`citizen-${state.nextCitizenId++}`, parent.x, parent.y, {
      alive: true, adult: false, bornAt: state.tick, parents: [parent.id], food: 99, color: "rose",
    });
    state.citizens.push(child);
    return child;
  };
}

test("crafting uses configured costs and creates permanent tools or 12-use weapons", () => {
  const mira = adult("mira", 1, 1, { wood: CRAFT_COSTS.tool });
  const oren = adult("oren", 2, 1, { wood: CRAFT_COSTS.weapon + 4 });
  const state = world(mira, oren);

  assert.deepEqual(resolve(state, mira, { type: "craft", item: "tool" }), { ok: true });
  assert.equal(mira.wood, 0);
  assert.equal(mira.tool, true);
  assert.equal(state.stats.crafted, 1);

  assert.deepEqual(resolve(state, oren, { type: "craft", item: "weapon" }), { ok: true });
  assert.equal(oren.wood, 4);
  assert.equal(oren.weapon, true);
  assert.equal(oren.weaponDurability, 12);
  assert.deepEqual([state.stats.crafted, state.stats.weapons], [2, 1]);
  const before = clone(state);
  assert.equal(resolve(state, oren, { type: "craft", item: "weapon" }).ok, false);
  assert.deepEqual(state, before, "a weapon cannot be recrafted before wear-out");

  const noWood = adult("poor", 3, 1, { wood: CRAFT_COSTS.tool - 1 });
  state.citizens.push(noWood);
  const noWoodBefore = clone(state);
  assert.equal(resolve(state, noWood, { type: "craft", item: "weapon" }).ok, false);
  assert.deepEqual(state, noWoodBefore);
  assert.equal(resolve(state, noWood, { type: "craft", item: "sword" }).ok, false);
});

test("an offer escrows atomically, replacement refunds first, and only one maker offer stays open", () => {
  const maker = adult("maker", 1, 1, { food: 6, wood: 1 });
  const state = world(maker);
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "food", giveAmount: 5, want: "wood", wantAmount: 2 }), { ok: true });
  assert.equal(maker.food, 1);
  assert.deepEqual(state.offers[0], {
    id: "offer-1", makerId: "maker", give: "food", giveAmount: 5,
    want: "wood", wantAmount: 2, recipient: null, createdAt: 0, expiresAt: OFFER_TTL, status: "open",
  });

  // The held escrow makes this replacement affordable although the visible balance is only one.
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "food", giveAmount: 6, want: "wood", wantAmount: 1 }), { ok: true });
  assert.equal(maker.food, 0);
  assert.deepEqual(state.offers.map(({ id, status }) => [id, status]), [["offer-1", "cancelled"], ["offer-2", "open"]]);
  assert.equal(state.nextOfferId, 3);

  const before = clone(state);
  assert.equal(resolve(state, maker, { type: "offer", give: "wood", giveAmount: 2, want: "food", wantAmount: 1 }).ok, false);
  assert.deepEqual(state, before, "an unaffordable replacement does not cancel/refund the old offer");
  assert.ok(maker.food >= 0 && maker.wood >= 0);
});

test("offer bounds and bounded history preserve active escrow while pruning closed offers", () => {
  const maker = adult("maker", 1, 1, { food: 10 });
  const existingMaker = adult("existing", 2, 1, { food: 9 });
  const state = world(maker, existingMaker);
  assert.equal(resolve(state, maker, { type: "offer", give: "food", giveAmount: 0, want: "wood", wantAmount: 1 }).ok, false);
  assert.equal(resolve(state, maker, { type: "offer", give: "food", giveAmount: 1, want: "food", wantAmount: 1 }).ok, false);
  state.offers.push({
    id: "offer-1", makerId: existingMaker.id, give: "food", giveAmount: 1,
    want: "wood", wantAmount: 1, recipient: null, createdAt: 0, expiresAt: 240, status: "open",
  });
  for (let index = 2; index <= 32; index += 1) {
    state.offers.push({
      id: `offer-${index}`, makerId: `old-${index}`, give: "food", giveAmount: 1,
      want: "wood", wantAmount: 1, recipient: null, createdAt: 0, expiresAt: 240, status: "filled",
    });
  }
  state.nextOfferId = 33;
  assert.equal(resolve(state, maker, { type: "offer", give: "food", giveAmount: 1, want: "wood", wantAmount: 1 }).ok, true);
  assert.equal(state.offers.length, 32);
  assert.equal(state.offers[0].id, "offer-1");
  assert.equal(state.offers[0].status, "open", "active escrow is never pruned");
  assert.ok(!state.offers.some((offer) => offer.id === "offer-2"));
  assert.equal(state.offers.at(-1).id, "offer-33");
  assert.equal(maker.food, 9);
});

test("replacing an offer at the history cap prunes closed history without dropping escrow", () => {
  const maker = adult("maker", 1, 1, { food: 9 });
  const otherMaker = adult("other", 2, 1, { wood: 9 });
  const state = world(maker, otherMaker);
  state.offers.push(
    { id: "offer-1", makerId: maker.id, give: "food", giveAmount: 1, want: "wood", wantAmount: 1,
      recipient: null, createdAt: 0, expiresAt: 240, status: "open" },
    { id: "offer-2", makerId: otherMaker.id, give: "wood", giveAmount: 1, want: "food", wantAmount: 1,
      recipient: null, createdAt: 0, expiresAt: 240, status: "open" },
  );
  for (let index = 3; index <= 32; index += 1) {
    state.offers.push({
      id: `offer-${index}`, makerId: `old-${index}`, give: "food", giveAmount: 1,
      want: "wood", wantAmount: 1, recipient: null, createdAt: 0, expiresAt: 240, status: "filled",
    });
  }
  state.nextOfferId = 33;

  assert.deepEqual(resolve(state, maker, { type: "offer", give: "food", giveAmount: 1, want: "wood", wantAmount: 1 }), { ok: true });
  assert.equal(state.offers.length, 32);
  assert.equal(state.offers.find((offer) => offer.id === "offer-1").status, "cancelled");
  assert.equal(state.offers.find((offer) => offer.id === "offer-2").status, "open", "other active escrow is never pruned");
  assert.ok(!state.offers.some((offer) => offer.id === "offer-3"), "old closed history is pruned to make room");
  assert.equal(state.offers.at(-1).id, "offer-33");
  assert.deepEqual(tickInteractions(state), { ok: true }, "the capped replacement leaves the world valid");
});

test("trade settles escrow exactly once and updates both relationships and replan reasons", () => {
  const maker = adult("maker", 1, 1, { food: 5, wood: 0 });
  const taker = adult("taker", 2, 1, { food: 0, wood: 3 });
  const state = world(maker, taker);
  assert.equal(resolve(state, maker, { type: "offer", give: "food", giveAmount: 3, want: "wood", wantAmount: 2 }).ok, true);
  const offer = state.offers[0];
  assert.equal(maker.food, 2, "food leaves inventory at offer time");
  assert.equal(resolve(state, taker, { type: "trade", offer: offer.id }).ok, true);
  assert.deepEqual([maker.food, maker.wood, taker.food, taker.wood], [2, 2, 3, 1]);
  assert.equal(offer.status, "filled");
  assert.equal(state.stats.trades, 1);
  assert.deepEqual([maker.relationships.taker, taker.relationships.maker], [10, 10]);
  assert.deepEqual([maker.replanReason, taker.replanReason], ["trade", "trade"]);

  const after = clone(state);
  assert.equal(resolve(state, taker, { type: "trade", offer: offer.id }).ok, false);
  assert.deepEqual(state, after, "a filled offer can never be accepted twice");
});

test("trade rejects moved, non-adult, expired, and underfunded takers atomically", () => {
  const maker = adult("maker", 1, 1, { food: 5 });
  const taker = adult("taker", 2, 1, { wood: 1 });
  const state = world(maker, taker);
  resolve(state, maker, { type: "offer", give: "food", giveAmount: 2, want: "wood", wantAmount: 2 });
  const offer = state.offers[0];
  const before = clone(state);
  assert.equal(resolve(state, taker, { type: "trade", offer: offer.id }).ok, false);
  assert.deepEqual(state, before);
  taker.wood = 2;
  taker.x = 5;
  assert.equal(resolve(state, taker, { type: "trade", offer: offer.id }).ok, false);
  taker.x = 2;
  taker.adult = false;
  taker.bornAt = 0;
  assert.equal(resolve(state, taker, { type: "trade", offer: offer.id }).ok, false);
  taker.adult = true;
  taker.bornAt = null;
  state.tick = offer.expiresAt;
  assert.equal(resolve(state, taker, { type: "trade", offer: offer.id }).ok, false);
  assert.deepEqual([maker.food, taker.wood, offer.status, state.stats.trades], [3, 2, "open", 0]);
});

test("targeted free gifts are reserved for their recipient, including children", () => {
  const maker = adult("maker", 1, 1, { food: 6, wood: 0 });
  const child = adult("child", 2, 1, { adult: false, bornAt: 0, parents: ["maker"], food: 1, wood: 0 });
  const outsider = adult("outsider", 2, 2, { food: 0, wood: 0 });
  const state = world(maker, child, outsider);
  const task = { type: "offer", give: "food", giveAmount: 4, want: "food", wantAmount: 0, recipient: child.id };

  assert.deepEqual(resolve(state, maker, task), { ok: true });
  assert.equal(state.offers[0].recipient, child.id);
  const before = clone(state);
  assert.equal(resolve(state, outsider, { type: "trade", offer: state.offers[0].id }).ok, false,
    "a nearby nonrecipient cannot claim a reserved gift");
  assert.deepEqual(state, before, "rejected third-party claims leave escrow and inventories unchanged");

  assert.deepEqual(resolve(state, child, { type: "trade", offer: state.offers[0].id }), { ok: true });
  assert.deepEqual([maker.food, child.food, state.offers[0].status, state.stats.trades], [2, 5, "filled", 1]);
});

test("recipient death cancels and refunds a targeted gift exactly once", () => {
  const maker = adult("maker", 1, 1, { food: 9, wood: 0 });
  const child = adult("child", 2, 1, { adult: false, bornAt: 0, parents: ["maker"], food: 0, wood: 0 });
  const state = world(maker, child);
  assert.deepEqual(resolve(state, maker, {
    type: "offer", give: "food", giveAmount: 7, want: "food", wantAmount: 0, recipient: child.id,
  }), { ok: true });
  const offer = state.offers[0];
  assert.equal(maker.food, 2);
  assert.deepEqual(killCitizen(state, child), { ok: true });
  assert.deepEqual([offer.status, maker.food], ["cancelled", 9]);
  assert.deepEqual(killCitizen(state, child), { ok: true });
  assert.deepEqual(tickInteractions(state), { ok: true });
  assert.deepEqual([offer.status, maker.food], ["cancelled", 9], "recipient death returns escrow only once");
});

test("offer quantities have no small cap but stay safe and atomic", () => {
  const maker = adult("maker", 1, 1, { food: 100, wood: 0 });
  const taker = adult("taker", 2, 1, { food: 0, wood: 80 });
  const state = world(maker, taker);
  assert.deepEqual(resolve(state, maker, {
    type: "offer", give: "food", giveAmount: 25, want: "wood", wantAmount: 18,
  }), { ok: true });
  assert.deepEqual(resolve(state, taker, { type: "trade", offer: state.offers[0].id }), { ok: true });
  assert.deepEqual([maker.food, maker.wood, taker.food, taker.wood], [75, 18, 25, 62]);

  const fullMaker = adult("full-maker", 1, 1, { food: Number.MAX_SAFE_INTEGER, wood: 0 });
  const fullTaker = adult("full-taker", 2, 1, { food: 1, wood: Number.MAX_SAFE_INTEGER });
  const overflowWorld = world(fullMaker, fullTaker);
  const unsafeMaker = adult("unsafe-maker", 1, 1);
  const unsafeWorld = world(unsafeMaker);
  const unsafeBefore = clone(unsafeWorld);
  assert.equal(resolve(unsafeWorld, unsafeMaker, {
    type: "offer", give: "food", giveAmount: Number.MAX_SAFE_INTEGER + 1, want: "wood", wantAmount: 0,
  }).ok, false, "offer quantities must be safe integers");
  assert.deepEqual(unsafeWorld, unsafeBefore);
  assert.deepEqual(resolve(overflowWorld, fullMaker, {
    type: "offer", give: "food", giveAmount: Number.MAX_SAFE_INTEGER, want: "wood", wantAmount: Number.MAX_SAFE_INTEGER,
  }), { ok: true });
  const before = clone(overflowWorld);
  assert.equal(resolve(overflowWorld, fullTaker, { type: "trade", offer: overflowWorld.offers[0].id }).ok, false,
    "a safe-integer transfer that would overflow the receiver is rejected");
  assert.deepEqual(overflowWorld, before);
});

test("shoes, equipment and simplified birth requirements are configured", () => {
  const citizen = adult("shoemaker", 1, 1, { wood: CRAFT_COSTS.shoes });
  const state = world(citizen);
  assert.deepEqual(resolve(state, citizen, { type: "craft", item: "shoes" }), { ok: true });
  assert.deepEqual([citizen.wood, citizen.shoes, state.stats.crafted], [0, true, 1]);
  assert.equal(resolve(state, citizen, { type: "craft", item: "shoes" }).ok, false);
  assert.equal(CRAFT_COSTS.tool, 15);
  assert.equal(CRAFT_COSTS.weapon, 20);
  assert.equal(BIRTH_FOOD_COST, 2);
  assert.equal(BIRTH_MIN_HEALTH, 50);
  assert.equal(BAKERY_COST, 50);
  assert.equal(BAKERY_HEALTH, 240);
  assert.equal(BUILD_TICKS, 30);
  assert.equal(BAKE_TICKS, 8);
  assert.equal(REPAIR_TICKS, 4);
  assert.equal(BREAD_NUTRITION, 87.5);
});

test("unarmed attack is bounded and retaliation costs energy only when affordable", () => {
  const attacker = adult("attacker", 1, 1, { energy: 8 });
  const defender = adult("defender", 2, 1, { energy: 3 });
  const state = world(attacker, defender);
  assert.deepEqual(resolve(state, attacker, { type: "attack", target: defender.id }), { ok: true });
  assert.deepEqual([attacker.health, defender.health, attacker.energy, defender.energy], [100, 94, 0, 3]);
  assert.deepEqual([attacker.relationships.defender, defender.relationships.attacker], [-30, -30]);
  assert.equal(state.stats.attacks, 1);
  assert.equal(attacker.replanReason, "attack");
});

test("armed hits wear durability and a final weapon strike breaks it", () => {
  const attacker = adult("attacker", 1, 1, { weapon: true, weaponDurability: 1 });
  const defender = adult("defender", 2, 1, { energy: 0 });
  const state = world(attacker, defender);
  assert.equal(resolve(state, attacker, { type: "attack", target: defender.id }).ok, true);
  assert.deepEqual([defender.health, attacker.weapon, attacker.weaponDurability], [82, false, 0]);
  assert.equal(state.stats.attacks, 1);
});

test("a defender's armed retaliation also wears its weapon and can kill the attacker", () => {
  const attacker = adult("attacker", 1, 1, { health: 12 });
  const defender = adult("defender", 2, 1, { weapon: true, weaponDurability: 2, energy: 4 });
  const state = world(attacker, defender);
  const fx = effects();
  assert.deepEqual(resolve(state, attacker, { type: "attack", target: defender.id }, fx), { ok: true });
  assert.equal(defender.health, 94);
  assert.equal(defender.weaponDurability, 1);
  assert.equal(defender.energy, 0);
  assert.equal(attacker.alive, false);
  assert.equal(attacker.health, 0);
  assert.equal(state.stats.deaths, 1);
  assert.equal(state.stats.attacks, 1);
  assert.equal(state.citizens.includes(attacker), false);
  assert.equal(state.dead[0], attacker);
  assert.ok(fx.memories.some((entry) => entry.text.includes("retaliated for 12 damage")));
});

test("a lethal initiating hit skips retaliation and death refunds escrow before loot", () => {
  const attacker = adult("attacker", 1, 1, { weapon: true, weaponDurability: 3, food: 1, wood: 4 });
  const defender = adult("defender", 2, 1, { health: 10, food: 5, wood: 5, energy: 100 });
  const state = world(attacker, defender);
  resolve(state, defender, { type: "offer", give: "food", giveAmount: 3, want: "wood", wantAmount: 1 });
  const escrow = state.offers[0];
  assert.equal(defender.food, 2);
  assert.equal(resolve(state, attacker, { type: "attack", target: defender.id }).ok, true);
  assert.equal(defender.alive, false);
  assert.equal(escrow.status, "cancelled");
  assert.deepEqual([attacker.food, attacker.wood], [6, 9], "attacker receives defender's refunded escrow and remaining inventory");
  assert.equal(defender.food, 0);
  assert.equal(defender.wood, 0);
  assert.equal(attacker.health, 100, "a dead defender cannot counterattack");
  assert.equal(state.stats.deaths, 1);
  assert.equal(state.dead.length, 1);
});

test("maker death refunds escrow before loot exactly once and records family death", () => {
  const parent = adult("parent", 1, 1, { food: 2, wood: 1, tasks: [{ type: "wait" }], current: { task: {} },
    order: { task: {} }, path: [{ x: 1, y: 2 }], planning: true });
  const child = adult("child", 2, 1, { adult: false, bornAt: 0, parents: ["parent"] });
  const killer = adult("killer", 3, 1, { food: 0, wood: 0 });
  const state = world(parent, child, killer);
  resolve(state, parent, { type: "offer", give: "food", giveAmount: 1, want: "wood", wantAmount: 1 });
  const escrow = state.offers[0];
  const fx = effects();
  assert.deepEqual(killCitizen(state, parent, killer, fx), { ok: true });
  assert.deepEqual([killer.food, killer.wood, escrow.status], [2, 1, "cancelled"]);
  assert.deepEqual([parent.food, parent.wood], [0, 0]);
  assert.deepEqual([parent.status, parent.health, parent.tasks.length, parent.current, parent.order, parent.path.length, parent.planning],
    ["dead", 0, 0, null, null, 0, false]);
  assert.equal(child.replanReason, "death");
  assert.ok(fx.memories.some((entry) => entry.citizenId === child.id && entry.text.includes("parent died")));
  const after = clone(state);
  assert.deepEqual(killCitizen(state, parent.id, null, fx), { ok: true });
  assert.deepEqual(state, after, "repeated death reports do not transfer loot or increment stats twice");
  assert.deepEqual([killer.food, killer.wood, escrow.status], [2, 1, "cancelled"]);
  assert.equal(state.stats.deaths, 1);
});

test("reproduction spends food only after consent, health and food checks", () => {
  const parent = adult("parent", 1, 1, { food: 5, wood: 0, energy: 50 });
  const partner = adult("partner", 2, 1, { food: 5, wood: 0, energy: 50 });
  const state = world(parent, partner);
  const before = clone(state);
  let createCalls = 0;
  const fx = effects({ createChild: () => { createCalls += 1; } });

  partner.familyReady = false;
  assert.equal(resolve(state, parent, { type: "reproduce", target: partner.id }, fx).ok, false);
  partner.familyReady = true;
  agree(state, parent, partner);
  parent.health = 49;
  assert.equal(resolve(state, parent, { type: "reproduce", target: partner.id }, fx).ok, false);
  parent.health = 100;
  parent.food = 1;
  assert.equal(resolve(state, parent, { type: "reproduce", target: partner.id }, fx).ok, false);
  assert.equal(createCalls, 0, "failed preconditions do not invoke child creation");
  assert.equal(state.stats.births, 0);
  assert.deepEqual([partner.food, partner.wood, partner.energy], [5, 0, 50]);
  assert.deepEqual([state.citizens.length, state.offers.length], [2, 0]);
  assert.notDeepEqual(state, before, "only deliberately changed test inputs differ from the preflight snapshot");
});

test("each reproductive prerequisite is rechecked for both adults", () => {
  const invalidCases = [
    ['partner health', (parent, partner) => { partner.health = 49; }],
    ['partner food', (parent, partner) => { partner.food = 1; }],
    ['partner adulthood', (parent, partner) => { partner.adult = false; partner.bornAt = 0; }],
    ['parent health', parent => { parent.health = 49; }],
    ['parent food', parent => { parent.food = 1; }],
    ['parent cancellation', (parent, partner, state) => { resolve(state, parent, { type: 'cancel_family', proposal: state.familyProposals[0].id }); }],
    ['non-adjacency', (parent, partner) => { partner.x = parent.x + 2; }],
  ];
  for (const [label, change] of invalidCases) {
    const parent = adult("parent", 1, 1);
    const partner = adult("partner", 2, 1);
    const state = world(parent, partner);
    agree(state, parent, partner);
    change(parent, partner, state);
    const before = clone(state);
    let createCalls = 0;
    const result = resolve(state, parent, { type: "reproduce", target: partner.id }, effects({
      createChild: () => { createCalls += 1; },
    }));
    assert.equal(result.ok, false, `${label} should block reproduction`);
    assert.equal(createCalls, 0, `${label} must be checked before creating a child`);
    assert.deepEqual(state, before, `${label} leaves the world unchanged`);
  }
});

test("successful reproduction consumes two food per parent without wood, energy or cooldown costs", () => {
  const parent = adult("parent", 1, 1, { food: 4, wood: 0, energy: 40 });
  const partner = adult("partner", 2, 1, { food: 6, wood: 0 + 2, energy: 80 });
  const state = world(parent, partner);
  agree(state, parent, partner);
  const fx = effects({ createChild: createChildEffect(state) });
  assert.deepEqual(resolve(state, parent, { type: "reproduce", target: partner.id }, fx), { ok: true });
  const child = state.citizens[2];
  assert.deepEqual([parent.food, parent.wood, parent.bread, parent.energy], [2, 0, 0, 40]);
  assert.deepEqual([partner.food, partner.wood, partner.bread, partner.energy], [4, 2, 0, 80]);
  assert.deepEqual([parent.familyReady, partner.familyReady, parent.reproduceAfter, partner.reproduceAfter], [false, false, 0, 0]);
  assert.deepEqual([child.alive, child.adult, child.bornAt, child.parents, child.food, child.wood, child.bread, child.energy, child.health, child.hunger],
    [true, false, 0, [parent.id, partner.id], 2, 0, 0, 80, 100, 15]);
  assert.deepEqual([child.weapon, child.weaponDurability, child.tool, child.shoes, child.familyReady], [false, 0, false, false, false]);
  assert.deepEqual([state.stats.births, parent.relationships.partner, partner.relationships.parent], [1, 15, 15]);
  // Birth mechanics own the newborn's defaults, but creator-set metadata survives.
  assert.equal(child.name, "citizen-3");
  assert.equal(child.color, "rose");
  assert.deepEqual([child.work, child.routine], [null, { family: false }]);
});

test("exactly 50 health and two food suffice despite hunger, zero wood/energy and a legacy cooldown", () => {
  const parent = adult('parent', 1, 1, { food: 2, health: 50, hunger: 100, wood: 0, energy: 0, reproduceAfter: 9999 });
  const partner = adult('partner', 2, 1, { food: 2, health: 50, hunger: 100, wood: 0, energy: 0, reproduceAfter: 9999 });
  const state = world(parent, partner);
  agree(state, parent, partner);
  assert.equal(resolve(state, parent, { type: 'reproduce', target: partner.id }, effects({ createChild: createChildEffect(state) })).ok, true);
  for (const citizen of [parent, partner]) {
    assert.deepEqual([citizen.food, citizen.health, citizen.wood, citizen.energy, citizen.reproduceAfter], [0, 50, 0, 0, 0]);
  }
  assert.equal(state.stats.births, 1);
  assert.equal(state.familyProposals[0].status, 'fulfilled');
});

test("failed or malformed child creation rolls back insertion and birth costs", () => {
  const parent = adult("parent", 1, 1, { food: 5 });
  const partner = adult("partner", 2, 1, { food: 5 });
  const state = world(parent, partner);
  agree(state, parent, partner);
  const before = clone(state);
  const result = resolve(state, parent, { type: "reproduce", target: partner.id }, effects({
    createChild: () => {
      parent.food -= 1;
      partner.wood -= 1;
      state.stats.births += 1;
      state.citizens.push(adult("stray", 1, 1));
      return adult("not-added", 1, 1);
    },
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(state, before);
});

test("children cannot attack, and reproduction continues beyond twelve living citizens", () => {
  const child = adult("child", 1, 1, { adult: false, bornAt: 0, parents: ["parent"] });
  const adultTarget = adult("adult", 2, 1);
  const state = world(child, adultTarget);
  const before = clone(state);
  assert.equal(resolve(state, child, { type: "attack", target: adultTarget.id }).ok, false);
  assert.deepEqual(state, before);


  const full = world(...Array.from({ length: 12 }, (_, index) => adult('adult-' + index, index % 8, 0)));
  agree(full, full.citizens[0], full.citizens[1]);
  assert.equal(resolve(full, full.citizens[0], { type: 'reproduce', target: full.citizens[1].id }, effects({ createChild: createChildEffect(full) })).ok, true);
  assert.equal(full.citizens.length, 13);
  assert.equal(tickInteractions(full).ok, true);
  agree(full, full.citizens[0], full.citizens[1]);
  assert.equal(resolve(full, full.citizens[0], { type: 'reproduce', target: full.citizens[1].id }, effects({ createChild: createChildEffect(full) })).ok, true);
  assert.equal(full.citizens.length, 14, 'fresh consent permits another birth immediately');

});

test("expiry refunds escrow exactly once and children mature at 300 ticks", () => {
  const maker = adult("maker", 1, 1, { food: 4 });
  const child = adult("child", 2, 1, {
    adult: false, bornAt: 0, parents: ["maker"], familyReady: false, food: 2,
  });
  const state = world(maker, child);
  resolve(state, maker, { type: "offer", give: "food", giveAmount: 3, want: "wood", wantAmount: 1 });
  const offer = state.offers[0];
  state.tick = 239;
  assert.deepEqual(tickInteractions(state), { ok: true });
  assert.deepEqual([offer.status, maker.food, child.adult], ["open", 1, false]);
  state.tick = 300;
  assert.deepEqual(tickInteractions(state), { ok: true });
  assert.deepEqual([offer.status, maker.food, child.adult, child.reviewAt, child.replanReason],
    ["open", 1, true, 300, "became adult"]);
  // Adulthood grants no parent-copied reserve agenda and no automatic plan.
  assert.deepEqual(child.routine, { family: false });
  assert.equal(child.work, null);
  assert.deepEqual(child.aspirations, ["Own an independent future safely", "Discover valued purpose"]);
  const after = clone(state);
  assert.deepEqual(tickInteractions(state), { ok: true });
  assert.deepEqual(state, after, "the adult default is applied only once at maturation");
});

test("malformed negative runtime state is rejected before any interaction mutates it", () => {
  const maker = adult("maker", 1, 1, { food: -1 });
  const state = world(maker);
  const before = clone(state);
  const result = resolve(state, maker, { type: "craft", item: "tool" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid food inventory/);
  assert.deepEqual(state, before);
});

test("bread offers escrow, replace, refund, and stay atomic like other goods", () => {
  const maker = adult("maker", 1, 1, { food: 10, wood: 10, bread: 7 });
  const state = world(maker);
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "bread", giveAmount: 5, want: "wood", wantAmount: 2 }), { ok: true });
  assert.equal(maker.bread, 2);
  assert.deepEqual(state.offers.map(({ id, give, status }) => [id, give, status]),
    [["offer-1", "bread", "open"]], "bread escrows like any other resource");

  // Replacement refunds the old bread escrow before the new escrow is taken.
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "bread", giveAmount: 6, want: "wood", wantAmount: 1 }), { ok: true });
  assert.equal(maker.bread, 1);
  assert.deepEqual(state.offers.map(({ id, status }) => [id, status]), [["offer-1", "cancelled"], ["offer-2", "open"]]);

  // Switching resources refunds the bread escrow too.
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "food", giveAmount: 1, want: "wood", wantAmount: 1 }), { ok: true });
  assert.deepEqual([maker.food, maker.bread], [9, 7]);

  state.tick = OFFER_TTL;
  assert.deepEqual(tickInteractions(state), { ok: true });
  assert.deepEqual([state.offers.at(-1).status, maker.food, maker.bread], ["expired", 10, 7],
    "expired bread/food escrow is refunded exactly once");

  const before = clone(state);
  assert.equal(resolve(state, maker, { type: "offer", give: "bread", giveAmount: 8, want: "wood", wantAmount: 0 }).ok, false);
  assert.deepEqual(state, before, "an unaffordable bread offer mutates nothing");
});

test("bread trades settle safely and overflow is rejected atomically", () => {
  const maker = adult("maker", 1, 1, { bread: 4 });
  const taker = adult("taker", 2, 1, { wood: 2 });
  const state = world(maker, taker);
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "bread", giveAmount: 3, want: "wood", wantAmount: 2 }), { ok: true });
  assert.deepEqual(resolve(state, taker, { type: "trade", offer: state.offers[0].id }), { ok: true });
  assert.deepEqual([maker.bread, maker.wood, taker.bread, taker.wood], [1, 12, 3, 0]);

  const full = adult("full", 2, 1, { bread: Number.MAX_SAFE_INTEGER, wood: 5 });
  state.citizens.push(full);
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "bread", giveAmount: 1, want: "wood", wantAmount: 1 }), { ok: true });
  const before = clone(state);
  assert.equal(resolve(state, full, { type: "trade", offer: state.offers[1].id }).ok, false,
    "receiving bread beyond a safe integer is rejected");
  assert.deepEqual(state, before, "overflowing bread trades leave escrow and inventories unchanged");
});

test("death refunds and loot extend to bread atomically, exactly once, without overflow", () => {
  const maker = adult("maker", 1, 1, { food: 1, wood: 1, bread: 3 });
  const killer = adult("killer", 3, 1);
  const state = world(maker, killer);
  assert.deepEqual(resolve(state, maker, { type: "offer", give: "bread", giveAmount: 2, want: "wood", wantAmount: 0 }), { ok: true });
  assert.equal(maker.bread, 1);
  const fx = effects();
  assert.deepEqual(killCitizen(state, maker, killer, fx), { ok: true });
  assert.deepEqual([killer.food, killer.wood, killer.bread], [11, 11, 3],
    "the killer receives refunded escrow plus remaining inventory, including bread");
  assert.equal(state.offers[0].status, "cancelled");
  assert.deepEqual([maker.food, maker.wood, maker.bread], [0, 0, 0]);
  assert.ok(fx.events.some((event) => event.text.includes(" and bread")));

  const after = clone(state);
  assert.deepEqual(killCitizen(state, maker.id, killer, fx), { ok: true });
  assert.deepEqual(tickInteractions(state), { ok: true });
  assert.deepEqual(state, after, "repeated death reports never loot bread twice");

  const richKiller = adult("rich-killer", 1, 1, { bread: Number.MAX_SAFE_INTEGER, energy: 100 });
  const carrier = adult("carrier", 2, 1, { bread: 1 });
  const overflowState = world(richKiller, carrier);
  const overflowBefore = clone(overflowState);
  assert.equal(killCitizen(overflowState, carrier, richKiller).ok, false,
    "death loot that would overflow bread is rejected before anything moves");
  assert.deepEqual(overflowState, overflowBefore);
});

test("missing bread reads as zero for legacy citizens, unsafe counts are rejected, and gifts normalize", () => {
  const legacy = adult("legacy", 2, 1);
  const giver = adult("giver", 1, 1, { bread: 2 });
  const state = world(giver, legacy);
  const before = clone(state);
  assert.equal(resolve(state, legacy, { type: "offer", give: "bread", giveAmount: 1, want: "wood", wantAmount: 0 }).ok, false);
  assert.deepEqual(state, before, "a legacy citizen without bread cannot offer bread it does not have");

  assert.deepEqual(resolve(state, giver, {
    type: "offer", give: "bread", giveAmount: 2, want: "food", wantAmount: 1, recipient: legacy.id,
  }), { ok: true });
  assert.deepEqual(resolve(state, legacy, { type: "trade", offer: state.offers[0].id }), { ok: true });
  assert.equal(legacy.bread, 2, "the first bread receipt normalizes a missing count from 0");
  assert.equal(giver.bread, 0);

  const corrupt = adult("corrupt", 1, 1, { bread: -1 });
  const corruptWorld = world(corrupt);
  const corruptBefore = clone(corruptWorld);
  const result = resolve(corruptWorld, corrupt, { type: "craft", item: "tool" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid bread inventory/);
  assert.deepEqual(corruptWorld, corruptBefore);

  const fractional = adult("fractional", 1, 1, { bread: 1.5 });
  const fractionalWorld = world(fractional);
  const fractionalBefore = clone(fractionalWorld);
  assert.equal(resolve(fractionalWorld, fractional, { type: "craft", item: "tool" }).ok, false);
  assert.deepEqual(fractionalWorld, fractionalBefore);
});

test("adulthood retains varied aspirations, defaults missing ones, and never copies parent agenda", () => {
  const parent = adult("parent", 1, 1, { aspirations: ["Keep the family fed"] });
  const varied = adult("varied", 2, 1, { adult: false, bornAt: 0, parents: ["parent"], aspirations: ["Map every tree"], familyReady: false });
  const blank = adult("blank", 3, 1, { adult: false, bornAt: 0, parents: ["parent"] });
  const state = world(parent, varied, blank);
  state.tick = 299;
  assert.deepEqual(tickInteractions(state), { ok: true });
  state.tick = 300;
  assert.deepEqual(tickInteractions(state), { ok: true });
  for (const citizen of [varied, blank]) {
    assert.equal(citizen.adult, true);
    assert.equal(citizen.reviewAt, 300);
    assert.equal(citizen.replanReason, "became adult");
    assert.deepEqual(citizen.routine, { family: citizen.familyReady }, "adulthood restores no parent-copied reserve agenda; routine only mirrors consent");
    assert.equal(citizen.work, null);
  }
  assert.deepEqual(varied.aspirations, ["Map every tree"], "varied aspirations are retained, not overwritten");
  assert.deepEqual(blank.aspirations, ["Own an independent future safely", "Discover valued purpose"]);
  const after = clone(state);
  assert.deepEqual(tickInteractions(state), { ok: true });
  assert.deepEqual(state, after, "the adult default is applied only once at maturation");
});

test("birth equivalence mixes food and bread explicitly: food first, then ceil(remaining)/2 bread", () => {
  const parent = adult("parent", 1, 1, { food: 1, bread: 1, wood: 0, energy: 40 });
  const partner = adult("partner", 2, 1, { food: 2, bread: 1, wood: 0, energy: 80 });
  const state = world(parent, partner);
  agree(state, parent, partner);
  assert.deepEqual(resolve(state, parent, { type: "reproduce", target: partner.id }, effects({
    createChild: createChildEffect(state),
  })), { ok: true });
  assert.deepEqual([parent.food, parent.bread, parent.wood, parent.energy], [0, 0, 0, 40],
    "1 food plus a whole bread covers the remaining food equivalent");
  assert.deepEqual([partner.food, partner.bread, partner.wood, partner.energy], [0, 1, 0, 80],
    "2 food pays the share and leaves bread untouched");

  const richParent = adult("rich-parent", 1, 1, { food: 10, bread: 5, wood: 0, energy: 40 });
  const breadParent = adult("bread-parent", 2, 1, { food: 0, bread: 2, wood: 0, energy: 40 });
  const richState = world(richParent, breadParent);
  agree(richState, richParent, breadParent);
  assert.deepEqual(resolve(richState, richParent, { type: "reproduce", target: breadParent.id }, effects({
    createChild: createChildEffect(richState),
  })), { ok: true });
  assert.deepEqual([richParent.food, richParent.bread], [8, 5], "consumption is capped at 2 food and 0 bread");
  assert.deepEqual([breadParent.food, breadParent.bread], [0, 1], "1 bread pays one full share");

  const fullParent = adult("full-parent", 1, 1, {
    food: Number.MAX_SAFE_INTEGER, bread: Number.MAX_SAFE_INTEGER, wood: 0, energy: 40,
  });
  const other = adult("other", 2, 1);
  const fullState = world(fullParent, other);
  agree(fullState, fullParent, other);
  assert.equal(resolve(fullState, fullParent, { type: "reproduce", target: other.id }, effects({
    createChild: () => { throw new Error("equivalence checks must not multiply large counts"); },
  })).ok, false, "large counts pass equivalence without multiplication and reach the (throwing) creator gate");
});

test("short birth inventories and missing consent block birth without spending resources", () => {
  const cases = [
    ["one food without bread", (parent) => { parent.food = 1; }],
    ["no food or bread", (parent) => { parent.food = 0; parent.bread = 0; }],
  ];
  for (const [label, change] of cases) {
    const parent = adult("parent", 1, 1, { energy: 40 });
    const partner = adult("partner", 2, 1, { energy: 40 });
    const state = world(parent, partner);
    agree(state, parent, partner);
    change(parent);
    const before = clone(state);
    assert.equal(resolve(state, parent, { type: "reproduce", target: partner.id }, effects({
      createChild() { throw new Error("short inventories must not create children"); },
    })).ok, false, label);
    assert.deepEqual(state, before, `${label} leaves the world unchanged`);
  }

  const rich = adult("rich", 1, 1, { food: 10, bread: 5, wood: 10, energy: 50 });
  const reserved = adult("reserved", 2, 1, { food: 0, bread: 2, wood: 10, energy: 50, familyReady: false });
  const consentState = world(rich, reserved);
  const consentBefore = clone(consentState);
  assert.equal(resolve(consentState, rich, { type: "reproduce", target: reserved.id }, effects({
    createChild() { throw new Error("bread never substitutes for consent"); },
  })).ok, false, "abundant resources still require actual consent");
  assert.deepEqual(consentState, consentBefore, "consent is checked before any resource is spent");


});

test("children may accept only zero-price bread gifts targeted to them", () => {
  const maker = adult("maker", 1, 1, { bread: 2 });
  const child = adult("child", 2, 1, { adult: false, bornAt: 0, parents: ["maker"] });
  const outsider = adult("outsider", 2, 2);
  const state = world(maker, child, outsider);
  const task = { type: "offer", give: "bread", giveAmount: 2, want: "bread", wantAmount: 0, recipient: child.id };
  assert.deepEqual(resolve(state, maker, task), { ok: true });
  const before = clone(state);
  assert.equal(resolve(state, outsider, { type: "trade", offer: state.offers[0].id }).ok, false,
    "a child's bread gift is reserved for its named recipient");
  assert.deepEqual(state, before);
  assert.deepEqual(resolve(state, child, { type: "trade", offer: state.offers[0].id }), { ok: true });
  assert.equal(child.bread, 2);
  assert.equal(maker.bread, 0);
  assert.equal(maker.familyReady, true, "the zero-target gift rule is otherwise unchanged");
});
