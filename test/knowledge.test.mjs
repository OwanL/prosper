import test from "node:test";
import assert from "node:assert/strict";
import {
  canSee,
  explorationTarget,
  knownDeposits,
  knownPeople,
  observeWorld,
  reportLocation,
  shareKnowledge,
  shareKnowledgeWith,
} from "../lib/knowledge.mjs";

function world(extra = {}) {
  return {
    width: 10,
    height: 6,
    tick: 10,
    blocked: [],
    nodes: [],
    citizens: [],
    ...extra,
  };
}

function citizen(id, x, y, extra = {}) {
  return { id, x, y, alive: true, ...extra };
}

test('observed work stays local and dated without revealing plans, destinations or private goods', () => {
  const observer = citizen('observer', 1, 1);
  const peer = citizen('peer', 2, 1, { food: 999, goals: ['secret'], activity: 'secret text',
    order: { task: { type: 'attack', target: 'hidden' } }, tasks: [{ type: 'reproduce', target: 'hidden' }],
    current: { task: { type: 'harvest', target: 'crop' }, remaining: 4 } });
  const map = world({ citizens: [observer, peer], nodes: [{ id: 'crop', kind: 'crop', x: 2, y: 1, stock: 1 }] });
  observeWorld(map, observer);
  assert.deepEqual(knownPeople(observer)[0].observedActivity, { type: 'harvesting', resource: 'food', target: 'crop' });
  assert.ok(!JSON.stringify(knownPeople(observer)).includes('secret'));
  assert.ok(!JSON.stringify(knownPeople(observer)).includes('999'));
  const detached = knownPeople(observer);
  detached[0].observedActivity.target = 'changed';
  peer.x = 8;
  peer.current = { task: { type: 'bake', target: 'hidden' } };
  map.tick = 20;
  observeWorld(map, observer);
  assert.equal(knownPeople(observer)[0].observedActivity.target, 'crop');
  assert.equal(knownPeople(observer)[0].observedAt, 10);
  peer.x = 2;
  peer.current = { task: { type: 'move', x: 9, y: 5 } };
  observeWorld(map, observer);
  assert.deepEqual(knownPeople(observer)[0].observedActivity, { type: 'moving' });
  peer.current = { task: { type: 'attack', target: 'hidden' } };
  map.citizens.push(citizen('hidden', 8, 5));
  observeWorld(map, observer);
  assert.deepEqual(knownPeople(observer)[0].observedActivity, { type: 'attacking' });
  peer.current = null;
  observeWorld(map, observer);
  assert.equal(knownPeople(observer)[0].observedActivity, undefined);
  peer.observedActivity = { type: 'crafting', item: 'weapon', private: 'secret' };
  const report = reportLocation(map, peer, observer);
  assert.equal(report.ok, true);
  assert.equal(report.location.observedActivity, undefined);
});

test('equipped items are dated visible evidence, without durability, inventory or remote upgrades', () => {
  const observer = citizen('observer', 1, 1), peer = citizen('peer', 2, 1, {
    tool: true, toolLevel: 2, shoes: true, shoesLevel: 1, weapon: true, weaponLevel: 3,
    weaponDurability: 37, wood: 999, health: 84, energy: 65 });
  const map = world({ citizens: [observer, peer] });
  observeWorld(map, observer);
  assert.deepEqual(knownPeople(observer)[0].observedEquipment, { toolLevel: 2, shoesLevel: 1, weaponLevel: 3 });
  assert.ok(!JSON.stringify(knownPeople(observer)).includes('Durability'));
  assert.ok(!JSON.stringify(knownPeople(observer)).includes('999'));
  const detached = knownPeople(observer); detached[0].observedEquipment.weaponLevel = 0;
  peer.x = 8; peer.weapon = false; peer.toolLevel = 3; map.tick = 20;
  observeWorld(map, observer);
  assert.deepEqual(knownPeople(observer)[0].observedEquipment, { toolLevel: 2, shoesLevel: 1, weaponLevel: 3 });
  assert.equal(knownPeople(observer)[0].observedAt, 10);
  peer.x = 2;
  observeWorld(map, observer);
  assert.deepEqual(knownPeople(observer)[0].observedEquipment, { toolLevel: 3, shoesLevel: 1, weaponLevel: 0 });
  const report = reportLocation(map, peer, observer);
  assert.equal(report.ok, true);
  assert.equal(report.location.observedEquipment, undefined, 'location reporting is not an equipment feed');
});

test("observation discovers only locally visible deposits and leaves hidden snapshots stale", () => {
  const resident = citizen("scout", 1, 1, {
    knowledge: {
      nodes: {
        distant: {
          id: "distant", kind: "crop", x: 8, y: 1, stock: 0, capacity: 1,
          yield: 1, regrowTicks: 99, observedAt: 2, source: "seen",
        },
      },
      explored: [],
    },
  });
  const hiddenBefore = structuredClone(resident.knowledge.nodes.distant);
  const map = world({ nodes: [
    { id: "nearby", kind: "crop", x: 3, y: 1, stock: 1, capacity: 2, yield: 1, regrowTicks: 7, regrowIn: 1 },
    { id: "distant", kind: "crop", x: 8, y: 1, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
  ] });

  assert.deepEqual(observeWorld(map, resident), ["nearby"]);
  assert.equal(resident.knowledge.nodes.nearby.stock, 1);
  assert.equal(resident.knowledge.nodes.nearby.capacity, 2);
  assert.equal(resident.knowledge.nodes.nearby.observedAt, map.tick);
  assert.equal("regrowIn" in resident.knowledge.nodes.nearby, false);
  assert.deepEqual(resident.knowledge.nodes.distant, hiddenBefore);
  assert.ok(resident.knowledge.explored.includes("3,1"));
  assert.ok(!resident.knowledge.explored.includes("5,1"));
});

test("sight is local and an intervening ridge can occlude it", () => {
  const map = world({ width: 8, height: 3, blocked: [{ x: 2, y: 1 }] });
  const observer = citizen("observer", 1, 1);

  assert.equal(canSee(map, observer, { x: 4, y: 1 }), false);
  assert.equal(canSee(map, observer, { x: 2, y: 1 }), true);
  assert.equal(canSee(map, observer, { x: 2, y: 0 }), true);
  assert.equal(canSee(map, observer, { x: 5, y: 1 }), false);
});

test("reports preserve stale sender snapshots and never replace a newer local sighting", () => {
  const sender = citizen("sender", 0, 0, { knowledge: { nodes: {
    food: {
      id: "food", kind: "crop", x: 2, y: 0, stock: 0, capacity: 1,
      yield: 1, regrowTicks: 99, observedAt: 3, source: "seen",
    },
  }, explored: [] } });
  const uninformed = citizen("uninformed", 1, 0, { knowledge: { nodes: {}, explored: [] } });
  const newer = citizen("newer", 2, 0, { knowledge: { nodes: {
    food: {
      id: "food", kind: "crop", x: 2, y: 0, stock: 1, capacity: 1,
      yield: 1, regrowTicks: 99, observedAt: 7, source: "seen",
    },
  }, explored: [] } });
  const map = world({ tick: 10, citizens: [sender, uninformed, newer], nodes: [
    { id: "food", kind: "crop", x: 2, y: 0, stock: 1, regrowIn: 0 },
  ] });

  assert.deepEqual(shareKnowledge(map, sender, ["food"]), { ok: true });
  assert.deepEqual(uninformed.knowledge.nodes.food, {
    id: "food", kind: "crop", x: 2, y: 0, stock: 0, capacity: 1,
    yield: 1, regrowTicks: 99, observedAt: 3, source: "report",
    reportedBy: "sender", receivedAt: 10,
  });
  assert.equal(newer.knowledge.nodes.food.stock, 1);
  assert.equal(newer.knowledge.nodes.food.source, "seen");

  map.nodes[0].stock = 0;
  map.tick = 12;
  assert.deepEqual(shareKnowledge(map, sender, ["food"]), { ok: true });
  assert.equal(uninformed.knowledge.nodes.food.observedAt, 3);
  assert.equal(uninformed.knowledge.nodes.food.receivedAt, 12);
  assert.equal(sender.knowledge.nodes.food.source, "seen");
});

test("invalid shared ID lists fail atomically", () => {
  const sender = citizen("sender", 0, 0, { knowledge: { nodes: {
    known: { id: "known", kind: "tree", x: 0, y: 0, stock: 1, observedAt: 1, source: "seen" },
  }, explored: [] } });
  const recipient = citizen("recipient", 1, 0, { knowledge: { nodes: {}, explored: [] } });
  const map = world({ citizens: [sender, recipient] });
  const beforeSender = structuredClone(sender);
  const beforeRecipient = structuredClone(recipient);

  assert.equal(shareKnowledge(map, sender, ["known", "missing"]).ok, false);
  assert.equal(shareKnowledge(map, sender, ["known", "known"]).ok, false);
  assert.deepEqual(sender, beforeSender);
  assert.deepEqual(recipient, beforeRecipient);
});

test("known deposits are detached snapshots without live regrowth fields", () => {
  const resident = citizen("resident", 0, 0, { knowledge: { nodes: {
    tree: { id: "tree", kind: "tree", x: 0, y: 0, stock: 2, capacity: 4,
      yield: 5, regrowTicks: 120, observedAt: 4, source: "report", reportedBy: "other", receivedAt: 8,
      regrowIn: 1 },
  }, explored: [] } });

  const snapshot = knownDeposits(resident);
  snapshot[0].stock = 99;
  assert.equal(resident.knowledge.nodes.tree.stock, 2);
  assert.equal("regrowIn" in snapshot[0], false);
  assert.equal(snapshot[0].source, "report");
});

test("people observation is local, occluded, living-only and contains no private fields", () => {
  const observer = citizen("observer", 1, 1);
  const visible = citizen("a", 1, 3, {
    name: "Ada", adult: true, health: 40, inventory: { food: 3 }, consent: true,
    tasks: [{ type: "rest" }], parents: ["parent"], reportedBy: "stranger",
  });
  const second = citizen("b", 1, 0, { name: "Bob", adult: false });
  const hidden = citizen("hidden", 4, 1);
  const remote = citizen("remote", 8, 1);
  const dead = citizen("dead", 1, 2, { alive: false });
  const map = world({ blocked: [{ x: 2, y: 1 }], citizens: [observer, second, visible, hidden, remote, dead] });

  assert.deepEqual(observeWorld(map, observer), []);
  assert.deepEqual(knownPeople(observer), [
    { id: "a", name: "Ada", adult: true, x: 1, y: 3, observedAt: 10, source: "seen", observedEquipment: { toolLevel: 0, shoesLevel: 0, weaponLevel: 0 } },
    { id: "b", name: "Bob", adult: false, x: 1, y: 0, observedAt: 10, source: "seen", observedEquipment: { toolLevel: 0, shoesLevel: 0, weaponLevel: 0 } },
  ]);
  const detached = knownPeople(observer);
  detached[0].x = 99;
  detached.reverse();
  assert.equal(knownPeople(observer)[0].x, 1);
  visible.x = 8;
  visible.name = "Changed";
  map.tick = 11;
  observeWorld(map, observer);
  assert.equal(knownPeople(observer)[0].x, 1);
  assert.equal(knownPeople(observer)[0].name, "Ada");
  assert.equal(knownPeople(observer)[0].observedAt, 10);
  observer.x = 7;
  observer.y = 3;
  map.tick = 12;
  observeWorld(map, observer);
  assert.equal(knownPeople(observer)[0].x, 8);
  assert.equal(knownPeople(observer)[0].observedAt, 12);
});

test("people observation works without a node array and keeps discovery return node-only", () => {
  const observer = citizen("observer", 1, 1);
  const peer = citizen("peer", 2, 1, { name: "Peer", adult: true });
  const map = world({ nodes: undefined, citizens: [observer, peer] });
  assert.deepEqual(observeWorld(map, observer), []);
  assert.equal(knownPeople(observer).length, 1);
  map.nodes = [{ id: "tree", kind: "tree", x: 1, y: 1, stock: 1 }];
  assert.deepEqual(observeWorld(map, observer), ["tree"]);
  assert.deepEqual(observeWorld(map, observer), []);
  assert.deepEqual(knownPeople(citizen("new", 0, 0)), []);
});

test("private resource sharing copies only sender snapshots to the chosen recipient", () => {
  const sender = citizen("sender", 0, 0, { knowledge: { nodes: {
    food: { id: "food", kind: "crop", x: 2, y: 0, stock: 0, observedAt: 3, source: "seen" },
  }, explored: [] } });
  const recipient = citizen("recipient", 8, 0);
  const thirdParty = citizen("third", 1, 0);
  const map = world({ citizens: [sender, recipient, thirdParty], nodes: [
    { id: "food", kind: "crop", x: 2, y: 0, stock: 1 },
  ] });
  const beforeSender = structuredClone(sender);
  const beforeThird = structuredClone(thirdParty);
  assert.deepEqual(shareKnowledgeWith(map, sender, recipient, ["food"]), { ok: true });
  assert.equal(recipient.knowledge.nodes.food.stock, 0);
  assert.equal(recipient.knowledge.nodes.food.observedAt, 3);
  assert.equal(recipient.knowledge.nodes.food.receivedAt, 10);
  assert.equal(recipient.knowledge.nodes.food.reportedBy, "sender");
  recipient.knowledge.nodes.food.stock = 9;
  assert.deepEqual(sender, beforeSender);
  assert.deepEqual(thirdParty, beforeThird);

  recipient.knowledge.nodes.food = { ...sender.knowledge.nodes.food, observedAt: 8, stock: 1 };
  const newer = structuredClone(recipient.knowledge.nodes.food);
  shareKnowledgeWith(map, sender, recipient, ["food"]);
  assert.deepEqual(recipient.knowledge.nodes.food, newer);
  recipient.knowledge.nodes.food.observedAt = 3;
  shareKnowledgeWith(map, sender, recipient, ["food"]);
  assert.equal(recipient.knowledge.nodes.food.source, "seen");
  assert.equal(recipient.knowledge.nodes.food.stock, 1);
});

test("private resource sharing validates atomically and rejects unavailable recipients", () => {
  const sender = citizen("sender", 0, 0, { knowledge: { nodes: {
    known: { id: "known", kind: "tree", x: 0, y: 0, stock: 1, observedAt: 1, source: "seen" },
  }, explored: [] } });
  const recipient = citizen("recipient", 1, 0);
  const dead = citizen("dead", 1, 0, { alive: false });
  const map = world({ citizens: [sender, recipient, dead] });
  const before = structuredClone(map.citizens);
  for (const ids of [[], ["known", "known"], ["known", "missing"], [1], ["a", "b", "c", "d", "e"]]) {
    assert.equal(shareKnowledgeWith(map, sender, recipient, ids).ok, false);
  }
  for (const target of [sender, dead, null, citizen("outsider", 1, 0)]) {
    assert.equal(shareKnowledgeWith(map, sender, target, ["known"]).ok, false);
  }
  assert.deepEqual(map.citizens, before);
});

test("voluntary location reports copy only the sender's own current position without tracking", () => {
  const sender = citizen("sender", 1, 1, { name: "Sender", adult: true, health: 10, consent: true,
    inventory: { food: 4 }, knowledge: { people: { third: { id: "third", x: 3, y: 3 } } } });
  const recipient = citizen("recipient", 8, 1);
  const thirdParty = citizen("third", 3, 3);
  const map = world({ citizens: [sender, recipient, thirdParty] });
  const beforeSender = structuredClone(sender);
  const beforeThird = structuredClone(thirdParty);
  const result = reportLocation(map, sender, recipient);
  assert.deepEqual(result, { ok: true, location: {
    id: "sender", name: "Sender", adult: true, x: 1, y: 1,
    observedAt: 10, source: "report", reportedBy: "sender",
  } });
  assert.deepEqual(knownPeople(recipient), [result.location]);
  result.location.x = 99;
  assert.equal(knownPeople(recipient)[0].x, 1);
  assert.deepEqual(sender, beforeSender);
  assert.deepEqual(thirdParty, beforeThird);
  sender.x = 2;
  map.tick = 11;
  observeWorld(map, recipient);
  assert.equal(knownPeople(recipient).find((p) => p.id === "sender").x, 1);
  recipient.x = 4;
  observeWorld(map, recipient);
  const seen = knownPeople(recipient).find((p) => p.id === "sender");
  assert.equal(seen.x, 2);
  assert.equal(seen.source, "seen");
  assert.equal("reportedBy" in seen, false);
  reportLocation(map, sender, recipient);
  assert.deepEqual(knownPeople(recipient).find((p) => p.id === "sender"), seen);
  map.tick = 5;
  sender.x = 3;
  reportLocation(map, sender, recipient);
  assert.deepEqual(knownPeople(recipient).find((p) => p.id === "sender"), seen);
});

test("location reporting rejects invalid participants and coordinates without changing knowledge", () => {
  const sender = citizen("sender", 0, 0);
  const recipient = citizen("recipient", 8, 1);
  const dead = citizen("dead", 1, 1, { alive: false });
  const map = world({ citizens: [sender, recipient, dead] });
  for (const target of [null, sender, dead, citizen("outsider", 1, 1)]) {
    assert.equal(reportLocation(map, sender, target).ok, false);
  }
  assert.equal(reportLocation(map, dead, recipient).ok, false);
  sender.x = -1;
  assert.deepEqual(reportLocation(map, sender, recipient), { ok: false, reason: "invalid-location" });
  assert.equal(recipient.knowledge, undefined);
});

test("exploration uses reachable map tiles only, with deterministic citizen-specific ties", () => {
  const map = new Proxy(world({ width: 3, height: 3 }), {
    get(target, property, receiver) {
      if (property === "nodes") throw new Error("exploration must not inspect resources");
      return Reflect.get(target, property, receiver);
    },
  });
  const explored = ["1,1"];
  const first = citizen("citizen-a", 1, 1, { knowledge: { nodes: {}, explored } });
  const second = citizen("citizen-b", 1, 1, { knowledge: { nodes: {}, explored } });

  const target = explorationTarget(map, first);
  assert.deepEqual(target, explorationTarget(map, first));
  assert.notDeepEqual(target, explorationTarget(map, second));
  assert.equal(Math.abs(target.x - first.x) + Math.abs(target.y - first.y), 1);

  const separated = world({ width: 3, height: 1, blocked: [{ x: 1, y: 0 }] });
  const trapped = citizen("trapped", 0, 0, { knowledge: { nodes: {}, explored: ["0,0"] } });
  assert.equal(explorationTarget(separated, trapped), null);
});
