import { createHash } from 'node:crypto';
import { areaOf, inArea, wallPlacement } from './places.mjs';
import { STRUCTURES } from './structures.mjs';
import { findPath, isWalkable } from './pathfinding.mjs';

const directions = ['north', 'east', 'south', 'west'];
export function planConstruction(world, citizen, args) {
  const reference = citizen.knowledge.nodes[args.target] ?? citizen.knowledge.buildings?.[args.target];
  if (!reference) throw new Error('Construction target must be a personally known resource or building ID.');
  const area = args.area ?? areaOf(world, reference);
  let tiles, openings = [];
  if (args.layout === 'line') {
    if (args.size !== undefined || args.openings !== undefined) throw new Error('A line accepts length/side, not size/openings.');
    const line = wallPlacement(world, citizen, { reference, area, side: args.side, length: args.length ?? 3, restrictArea: Boolean(args.area) });
    tiles = Array.from({ length: line.length }, (_, i) => ({ x: line.x + (line.axis === 'horizontal' ? i : 0),
      y: line.y + (line.axis === 'vertical' ? i : 0) }));
  } else {
    if (args.length !== undefined || args.side !== undefined) throw new Error('An enclosure accepts size/openings, not length/side.');
    const size = { small: 3, medium: 5, large: 7 }[args.size ?? 'small'];
    const radius = (size - 1) / 2;
    const gaps = Object.fromEntries(directions.map((side, i) => [side, { x: reference.x + [0, radius, 0, -radius][i],
      y: reference.y + [-radius, 0, radius, 0][i] }]));
    // A default entrance faces the builder. An opening is empty terrain, not
    // a magic owner-only gate; anyone can use it.
    const nearest = directions.toSorted((a, b) => Math.abs(gaps[a].x - citizen.x) + Math.abs(gaps[a].y - citizen.y)
      - Math.abs(gaps[b].x - citizen.x) - Math.abs(gaps[b].y - citizen.y))[0];
    openings = args.openings ?? [nearest];
    const omitted = openings.map(side => gaps[side]);
    if (omitted.some(p => !isWalkable(world, p.x, p.y, citizen) || !citizen.knowledge.explored.includes(`${p.x},${p.y}`))) {
      throw new Error('An entrance must be explored and passable. Choose another opening or clear its obstruction first.');
    }
    tiles = [];
    for (let y = reference.y - radius; y <= reference.y + radius; y++) {
      for (let x = reference.x - radius; x <= reference.x + radius; x++) {
        if (Math.abs(x - reference.x) !== radius && Math.abs(y - reference.y) !== radius) continue;
        if (!omitted.some(p => p.x === x && p.y === y)) tiles.push({ x, y });
      }
    }
  }
  const explored = new Set(citizen.knowledge.explored);
  const occupied = [...Object.values(citizen.knowledge.nodes), ...Object.values(citizen.knowledge.buildings ?? {}).filter(b => b.health > 0)];
  if (tiles.some(p => (args.area && !inArea(world, p, area)) || !explored.has(`${p.x},${p.y}`) || !isWalkable(world, p.x, p.y)
      || occupied.some(o => o.x === p.x && o.y === p.y))) {
    throw new Error('The footprint crosses unexplored, occupied, blocked or out-of-area tiles. Explore, choose a smaller layout, or change its openings/side.');
  }
  const preview = { ...world, buildings: [...(world.buildings ?? []), ...tiles.map((p, i) => ({ ...p, id: `preview-${i}`, kind: 'wall', health: 120 }))] };
  if (tiles.some(p => !findPath(preview, citizen, p, { range: 1 }))) {
    throw new Error('The completed layout leaves wall segments inaccessible to the builder. Add openings or choose another layout.');
  }
  const lostAccess = Object.values(citizen.knowledge.nodes).filter(n => findPath(world, citizen, n)
    && !findPath(preview, citizen, n)).map(n => n.id);
  if (tiles.some(p => p.x === citizen.x && p.y === citizen.y)) throw new Error('The footprint covers your current tile. Move outside it before planning.');
  const planId = `construction-${createHash('sha256').update(JSON.stringify([citizen.id, args.layout, args.target, tiles])).digest('hex').slice(0, 16)}`;
  const plan = { id: planId, layout: args.layout, target: args.target, area, openings, tiles, createdAt: world.tick };
  const retained = Object.values(citizen.constructionPlans ?? {}).filter(p => p.id !== planId);
  const active = new Set([citizen.order?.task, ...(citizen.tasks ?? [])].filter(t => t?.type === 'construct').map(t => t.plan));
  while (retained.length >= 4) {
    const index = retained.findIndex(p => !active.has(p.id));
    if (index < 0) throw new Error('Finish an existing construction plan before preparing another.');
    retained.splice(index, 1);
  }
  citizen.constructionPlans = Object.fromEntries([...retained, plan].map(p => [p.id, p]));
  return { planId, directive: { type: 'construct', plan: planId }, layout: args.layout, target: args.target, area,
    openings, segments: tiles.length, wood: tiles.length * STRUCTURES.wall.wood, workTicks: tiles.length * STRUCTURES.wall.ticks,
    warnings: lostAccess.length ? [`This layout blocks your routes to: ${lostAccess.join(', ')}. Consider openings or a different side.`] : [],
    note: 'Preview only; nothing is built or reserved. Walls block everyone, including you, and hide what is beyond. Openings stay passable to everyone. Routes and occupancy may change. Construction gathers inputs, builds adjacent segments, retains progress through needs/reviews, and stops for review on failure. Do not trap yourself or others unintentionally. You may attack your own buildings to demolish them.' };
}

export function activeConstruction(citizen) {
  const order = citizen.order;
  if (order?.task.type !== 'construct') return null;
  const plan = citizen.constructionPlans?.[order.task.plan];
  if (!plan) return null;
  const remaining = Math.max(0, plan.tiles.length - order.progress);
  return { planId: plan.id, layout: plan.layout, target: plan.target, area: plan.area, openings: plan.openings,
    completedSegments: order.progress, totalSegments: plan.tiles.length, remainingWood: remaining * STRUCTURES.wall.wood,
    note: 'Remaining construction materials, not an inventory target. Missing wood is gathered; continue_strategy retains progress. Travel, gathering and needs add time.' };
}
