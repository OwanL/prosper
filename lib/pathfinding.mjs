function isIntegerInBounds(value, limit) {
  return Number.isInteger(value) && value >= 0 && value < limit;
}

function prepareWorld(world, actor) {
  if (!world || typeof world !== "object" ||
      !Number.isInteger(world.width) || world.width < 1 ||
      !Number.isInteger(world.height) || world.height < 1 ||
      !Array.isArray(world.blocked)) {
    return null;
  }

  const blocked = new Set();
  for (const tile of world.blocked) {
    if (!tile || typeof tile !== "object" || Array.isArray(tile) ||
        !isIntegerInBounds(tile.x, world.width) || !isIntegerInBounds(tile.y, world.height)) {
      return null;
    }
    blocked.add(tile.y * world.width + tile.x);
  }
  const terrainBlocked = new Set(blocked);
  for (const b of Array.isArray(world.buildings) ? world.buildings : []) {
    if ((b?.kind === 'wall' || (b?.kind === 'house' && b.ownerId !== actor?.id)) && b.health > 0 && b.destroyed !== true
        && isIntegerInBounds(b.x, world.width) && isIntegerInBounds(b.y, world.height)) {
      blocked.add(b.y * world.width + b.x);
    }
  }
  return { width: world.width, height: world.height, blocked, terrainBlocked };
}

function isValidPoint(point, world) {
  return point !== null && typeof point === "object" && !Array.isArray(point) &&
    isIntegerInBounds(point.x, world.width) && isIntegerInBounds(point.y, world.height);
}

export function isWalkable(world, x, y, actor) {
  const board = prepareWorld(world, actor);
  if (!board || !isIntegerInBounds(x, board.width) || !isIntegerInBounds(y, board.height)) return false;
  return !board.blocked.has(y * board.width + x);
}

export function findPath(world, start, goal, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const range = options.range === undefined ? 0 : options.range;
  const board = prepareWorld(world, start);
  if (!board || !isValidPoint(start, board) || !isValidPoint(goal, board) ||
      !Number.isInteger(range) || range < 0) {
    return null;
  }

  const startIndex = start.y * board.width + start.x;
  const goalIndex = goal.y * board.width + goal.x;
  // A new wall must not trap someone already standing on its tile. Terrain
  // remains invalid; a displaced visitor may leave but cannot re-enter.
  if (board.terrainBlocked.has(startIndex) || (range === 0 && board.blocked.has(goalIndex))) return null;

  const withinRange = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y) <= range;
  if (withinRange(start.x, start.y)) return [];

  // North, east, south, west gives deterministic tie-breaking among shortest paths.
  const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const queue = [startIndex];
  const parents = new Map([[startIndex, -1]]);
  let destination = -1;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const x = current % board.width;
    const y = Math.floor(current / board.width);

    if (withinRange(x, y)) {
      destination = current;
      break;
    }

    for (const [dx, dy] of neighbors) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (!isIntegerInBounds(nextX, board.width) || !isIntegerInBounds(nextY, board.height)) continue;
      const next = nextY * board.width + nextX;
      if (board.blocked.has(next) || parents.has(next)) continue;
      parents.set(next, current);
      queue.push(next);
    }
  }

  if (destination === -1) return null;
  const path = [];
  for (let current = destination; current !== startIndex; current = parents.get(current)) {
    path.push({ x: current % board.width, y: Math.floor(current / board.width) });
  }
  path.reverse();
  return path;
}
