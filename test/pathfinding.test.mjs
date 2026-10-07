import test from "node:test";
import assert from "node:assert/strict";
import { findPath, isWalkable } from "../lib/pathfinding.mjs";

function world(width, height, blocked = [], extra = {}) {
  return { width, height, blocked, ...extra };
}

test("findPath routes around obstacles with a shortest deterministic detour", () => {
  const map = world(5, 3, [{ x: 2, y: 1 }]);
  const path = findPath(map, { x: 1, y: 1 }, { x: 3, y: 1 });

  assert.deepEqual(path, [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 1 },
  ]);
  assert.equal(path.length, 4);
});

test("findPath returns null for blocked goals, blocked starts, and unreachable destinations", () => {
  assert.equal(findPath(world(3, 1, [{ x: 2, y: 0 }]), { x: 0, y: 0 }, { x: 2, y: 0 }), null);
  assert.equal(findPath(world(3, 1, [{ x: 0, y: 0 }]), { x: 0, y: 0 }, { x: 2, y: 0 }), null);

  const separated = world(3, 3, [
    { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 },
  ]);
  assert.equal(findPath(separated, { x: 0, y: 1 }, { x: 2, y: 1 }), null);
});

test("isWalkable and findPath validate edge coordinates and integer bounds", () => {
  const map = world(3, 2, [{ x: 2, y: 1 }]);
  assert.equal(isWalkable(map, 0, 0), true);
  assert.equal(isWalkable(map, 2, 1), false);
  assert.equal(isWalkable(map, 3, 1), false);
  assert.equal(isWalkable(map, -1, 0), false);
  assert.equal(isWalkable(map, 1.5, 0), false);
  assert.equal(isWalkable({ width: 3, height: 2 }, 0, 0), false);

  assert.deepEqual(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }), [
    { x: 1, y: 0 }, { x: 2, y: 0 },
  ]);
  assert.equal(findPath(map, { x: 0.5, y: 0 }, { x: 2, y: 0 }), null);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 3, y: 0 }), null);
  assert.equal(findPath(world(2, 2, [{ x: 2, y: 0 }]), { x: 0, y: 0 }, { x: 1, y: 1 }), null);
});

test("range one allows reaching an adjacent social target without blocking citizen tiles", () => {
  const map = world(3, 1, [{ x: 2, y: 0 }], { citizens: [{ id: "neighbor", x: 1, y: 0 }] });
  const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, { range: 1 });

  assert.deepEqual(path, [{ x: 1, y: 0 }]);
  assert.equal(Math.abs(path.at(-1).x - 2) + Math.abs(path.at(-1).y), 1);
});

test("findPath returns an empty path when already in range and the same route on repeat", () => {
  const map = world(3, 3);
  assert.deepEqual(findPath(map, { x: 1, y: 1 }, { x: 1, y: 1 }), []);
  assert.deepEqual(findPath(map, { x: 1, y: 1 }, { x: 2, y: 1 }, { range: 1 }), []);

  const first = findPath(map, { x: 0, y: 0 }, { x: 2, y: 2 });
  const second = findPath(map, { x: 0, y: 0 }, { x: 2, y: 2 });
  assert.deepEqual(first, [
    { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 },
  ]);
  assert.deepEqual(second, first);
});

test("pathfinding does not mutate the world or inputs", () => {
  const map = world(3, 2, [{ x: 1, y: 0 }], { citizens: [{ x: 1, y: 1 }] });
  const start = { x: 0, y: 0 };
  const goal = { x: 2, y: 0 };
  const before = structuredClone({ map, start, goal });

  findPath(map, start, goal);
  isWalkable(map, 0, 0);
  assert.deepEqual({ map, start, goal }, before);
});
