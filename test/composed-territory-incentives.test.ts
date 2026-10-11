import { expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { observe, observeDecision, updateKnowledge } from '../src/world/observation.ts';
import { territoryLandPressure } from '../src/citizen/tree-spatial.ts';
import { membershipPower, knownMemberCount, territoryJoinValue } from '../src/citizen/tree-community.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';
import { territorySchema } from '../src/server/autonomy-checkpoint.ts';
import { prepareTreeCandidates } from '../src/world/tree-controller.ts';

function fixture() {
  const world = createWorld({ population: 4 });
  world.controllerMode = 'composed';
  const [a,b,c,d] = Object.values(world.citizens);
  a.inventory['wood:1'] = 20;
  world.territories = { t: { id: 't', ownerId: a.id, createdTick: 0, admissions: [], members: { [a.id]: { citizenId: a.id, joinedTick: 0, sequence: 0 } } } };
  world.signs = { s: { id: 's', territoryId: 't', x: a.x, y: a.y, woodTier: 1, health: 10, maxHealth: 10 } };
  return { world,a,b,c,d };
}
it('uses diminishing bounded power and unknown legacy counts, with compatible schema', () => {
  expect(membershipPower(4) - membershipPower(3)).toBeGreaterThan(membershipPower(40) - membershipPower(39));
  expect(membershipPower(Number.MAX_SAFE_INTEGER)).toBe(.35);
  const {world,b} = fixture();
  const t = world.territories!.t;
  expect(knownMemberCount({ citizen: { id: b.id } },t)).toBeUndefined();
  expect(territorySchema.safeParse(t).success).toBe(true);
  for (const memberCount of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER + 1]) expect(territorySchema.safeParse({...t,memberCount}).success).toBe(false);
  expect(territorySchema.safeParse({...t,memberCount: 3}).success).toBe(true);
});
it('larger usable known area reduces demand to its unchanged baseline', () => {
  const {world,a} = fixture();
  const o = observe(world,a.id);
  const tiles = o.visible.filter(t => Math.abs(t.x - a.x) + Math.abs(t.y - a.y) <= 1);
  for (const tile of tiles) { tile.deposits = []; tile.buildings = []; }
  o.houses = [];
  const pressure = territoryLandPressure(o,'t');
  o.signs = tiles.map((tile,i) => ({...world.signs!.s,id:`s${i}`,x:tile.x,y:tile.y}));
  expect(territoryLandPressure(o,'t')).toBeLessThan(pressure);
  expect(territoryLandPressure(o,'t')).toBe(0);
  for (const tile of tiles) tile.deposits = [{id:'resource'}] as typeof tile.deposits;
  expect(territoryLandPressure(o,'t')).toBe(1);
});
it('nearby friendly small territory beats distant hostile enormous territory', () => {
  const {world,a,b} = fixture();
  b.x = a.x; b.y = a.y;
  const o = observe(world,b.id);
  const small = o.territories![0];
  const large = {...small,id:'large',ownerId:'hostile',memberCount:10000};
  o.reputations = {[a.id]:'admired',hostile:'hostile'};
  o.signs!.push({...o.signs![0],id:'far',territoryId:'large',x:a.x+100});
  expect(territoryJoinValue(o,small)).toBeGreaterThan(territoryJoinValue(o,large));
  o.territories!.push(large);
  expect(prepareTreeCandidates(o).find(c => c.task.definitionId === 'JoinTerritory')?.task.targetId).toBe('t');
  world.signs!.s.x = b.x + 100; world.signs!.s.y = b.y;
  expect(observe(world,b.id).territories).toEqual([]);
});
it('retains dated usable marked land remotely until current sight clears it', () => {
  const {world,a} = fixture();
  world.deposits = {}; world.buildings = {}; world.houses = {};
  const origin = {x:a.x,y:a.y};
  world.signs!.second = {...world.signs!.s,id:'second',x:a.x+1};
  updateKnowledge(world);
  expect(territoryLandPressure(observe(world,a.id),'t')).toBe(0);
  const moveAway = () => { a.x = origin.x < world.width / 2 ? world.width-1 : 0; a.y = origin.y < world.height / 2 ? world.height-1 : 0; };
  moveAway();
  world.tick++;
  updateKnowledge(world);
  const remote = observe(world,a.id);
  expect(territoryLandPressure(remote,'t')).toBe(0);
  const checkpoint = { version: 1, savedAt: new Date().toISOString(), world, runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
  const restored = validateCheckpoint(JSON.parse(JSON.stringify(checkpoint))).world;
  expect(territoryLandPressure(observeDecision(restored,a.id),'t')).toBe(0);
  const legacy = JSON.parse(JSON.stringify(checkpoint));
  for (const citizen of Object.values(legacy.world.citizens) as typeof a[]) for (const tile of Object.values(citizen.knowledge)) delete tile.observedTerritoryId;
  expect(territoryLandPressure(observeDecision(validateCheckpoint(legacy).world,a.id),'t')).toBe(1);
  expect(remote.remembered.find(t => t.x===origin.x && t.y===origin.y)).toMatchObject({seenTick:0,observedTerritoryId:'t'});
  world.signs = {};
  expect(territoryLandPressure(observe(world,a.id),'t')).toBe(0);
  expect(territoryLandPressure(observeDecision(world,a.id),'t')).toBe(0);
  expect(prepareTreeCandidates(observeDecision(world,a.id))).toEqual(prepareTreeCandidates(observe(world,a.id)));
  Object.assign(a,origin);
  expect(territoryLandPressure(observe(world,a.id),'t')).toBe(1);
  updateKnowledge(world);
  expect(a.knowledge[`${origin.x},${origin.y}`].observedTerritoryId).toBeNull();
  moveAway();
  expect(territoryLandPressure(observeDecision(world,a.id),'t')).toBe(1);
});
const benefit = (o: ReturnType<typeof observe>, def: string) => prepareTreeCandidates(o).find(c => c.task.definitionId === def)?.forecast.benefit ?? 0;

it('increases expansion demand with membership at the same known area', () => {
  const {world,a,b,c} = fixture();
  const o = observe(world,a.id);
  o.visible.find(t => t.x === a.x && t.y === a.y)!.deposits = [];
  const small = benefit(o, 'ExpandTerritory');
  for (const peer of [b,c]) o.territories![0].members[peer.id] = { citizenId: peer.id, joinedTick: 0, sequence: 1 };
  expect(benefit(o, 'ExpandTerritory')).toBeGreaterThan(small);
});
it('projects scoped public counts without foreign identities and matches lean preparation', () => {
  const {world,a,b} = fixture();
  b.x = a.x; b.y = a.y;
  const full = observe(world,b.id);
  expect(full.territories?.[0].members).toEqual({});
  expect(full.territories?.[0]).toHaveProperty('memberCount', 1);
  expect(prepareTreeCandidates(observeDecision(world,b.id))).toEqual(prepareTreeCandidates(full));
  expect(world.territories!.t).not.toHaveProperty('memberCount');
});
it('ranks all known join alternatives by power rather than first territory', () => {
  const {world,a,b,c,d} = fixture();
  b.x = a.x; b.y = a.y;
  world.territories!.large = { id: 'large', ownerId: c.id, createdTick: 0, admissions: [], members: Object.fromEntries([c,d].map((p,sequence) => [p.id,{citizenId:p.id,joinedTick:0,sequence}])) };
  world.signs!.s2 = { ...world.signs!.s, id: 's2', territoryId: 'large' };
  const joins = prepareTreeCandidates(observe(world,b.id)).filter(c => c.task.definitionId === 'JoinTerritory');
  expect(joins).toHaveLength(1);
  expect(joins[0].task.targetId).toBe('large');
});
