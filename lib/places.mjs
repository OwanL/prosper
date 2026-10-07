import { findPath, isWalkable } from './pathfinding.mjs';

export const QUADRANTS = ['north-west', 'north-east', 'south-west', 'south-east'];
export const CENTER = { x: 6, y: 5, width: 8, height: 6 };
export const RESOURCE_RINGS = [
  { ring: 1, x: 3, y: 3, width: 14, height: 10 },
  { ring: 2, x: 0, y: 0, width: 20, height: 16 },
];
export const AREAS = ['center', ...QUADRANTS.flatMap(quadrant => [1, 2].map(ring => `${quadrant}-ring-${ring}`))];
export const AREA_CHOICES = [...AREAS, ...QUADRANTS];
export const AREA_GUIDANCE = 'Three resource tiers: separate center (level3, best), ring1 (level2), ring2 (level1, outermost). Ring numbers increase outward. Quality changes yield only: levels1/2/3 give1/2/3food or5/10/15wood per harvest; same effort/regrowth at every level. Outside center, IDs combine compass quadrant and ring, e.g. north-west-ring-1; all four quadrants have rings1/2. Bare quadrants exclude center. move(area:center) enters it. Geography reveals no sites, stock or access: discover through sight or dated reports; entering an area does not reveal it all. get_places lists actual areas; older worlds retain original geography.';
export const validArea = value => AREA_CHOICES.includes(value);
export const worldAreas = world => world.rings?.length
  ? [...(world.center ? ['center'] : []), ...QUADRANTS.flatMap(quadrant => world.rings.map(({ ring }) => `${quadrant}-ring-${ring}`))]
  : QUADRANTS;
const within = (point, rect) => point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
export const areaResourceLevel = (world, area) => !world.center ? undefined : area === 'center' ? 3
  : /^.+-ring-[1-2]$/.test(area) ? 3 - Number(area.at(-1)) : undefined;
export function areaOf(world, point) {
  const quadrant = `${point.y < Math.ceil(world.height / 2) ? 'north' : 'south'}-${point.x < Math.ceil(world.width / 2) ? 'west' : 'east'}`;
  if (!world.rings) return quadrant; // Existing checkpoints retain their geography.
  if (world.center && within(point, world.center)) return 'center';
  const ring = world.rings.find(rect => within(point, rect))?.ring ?? world.rings.at(-1).ring;
  return `${quadrant}-ring-${ring}`;
}
export const inArea = (world, point, area) => {
  const actual = areaOf(world, point);
  return actual === area || (QUADRANTS.includes(area) && actual.startsWith(`${area}-ring-`));
};
export function areaDestination(world, citizen, area, { exploredOnly = false, buildable = false } = {}) {
  if (!validArea(area)) return null;
  const explored = new Set(citizen.knowledge.explored);
  const occupied = buildable ? [...Object.values(citizen.knowledge.nodes), ...Object.values(citizen.knowledge.buildings ?? {}).filter(b => b.health > 0)] : [];
  const candidates = [];
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const point = { x, y };
    if (!inArea(world, point, area) || !isWalkable(world, x, y, citizen)
      || (exploredOnly && !explored.has(`${x},${y}`)) || occupied.some(p => p.x === x && p.y === y)) continue;
    const path = findPath(world, citizen, point);
    if (path) candidates.push({ point, distance: path.length });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.point.y - b.point.y || a.point.x - b.point.x);
  return candidates[0]?.point ?? null;
}

// Build a short side of a remembered site, without asking the model to place
// coordinates. Every tile must be personally explored and apparently free.
export function wallPlacement(world, citizen, { reference, area, side, length = 1, restrictArea = true }) {
  if (side && !reference) throw new Error('A wall side requires a known resource or building target.');
  const sides = reference ? (side ? [side] : ['north', 'east', 'south', 'west']) : [null];
  const explored = new Set(citizen.knowledge.explored);
  const occupied = [...Object.values(citizen.knowledge.nodes), ...Object.values(citizen.knowledge.buildings ?? {}).filter(b => b.health > 0)];
  const options = [];
  for (const candidateSide of sides) {
    const horizontal = !candidateSide || ['north', 'south'].includes(candidateSide);
    const center = Math.floor((length - 1) / 2);
    const point = reference ? { x: reference.x + (candidateSide === 'east' ? 1 : candidateSide === 'west' ? -1 : -center),
      y: reference.y + (candidateSide === 'south' ? 1 : candidateSide === 'north' ? -1 : -center) }
      : areaDestination(world, citizen, area, { exploredOnly: true, buildable: true });
    if (!point) continue;
    const tiles = Array.from({ length }, (_, i) => ({ x: point.x + (horizontal ? i : 0), y: point.y + (horizontal ? 0 : i) }));
    if (tiles.some(p => (restrictArea && !inArea(world, p, area)) || !explored.has(`${p.x},${p.y}`) || !isWalkable(world, p.x, p.y, citizen)
      || occupied.some(o => o.x === p.x && o.y === p.y))) continue;
    const path = findPath(world, citizen, point);
    if (path) options.push({ ...point, axis: horizontal ? 'horizontal' : 'vertical', length, distance: path.length });
  }
  options.sort((a, b) => a.distance - b.distance);
  if (!options.length) throw new Error('No free, explored wall line in that area/side. Explore, choose another side, or shorten the wall.');
  const { distance, ...placement } = options[0];
  return placement;
}
