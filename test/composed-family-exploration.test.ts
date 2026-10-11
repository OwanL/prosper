import { describe, expect, it } from 'vitest';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { prepareTreeCandidates } from '../src/world/tree-controller.ts';

function familyWorld(seed = 3) {
  const world = createWorld({ seed, population: 2, controllerMode: 'composed', autonomy: false });
  world.width = 40; world.height = 40; world.deposits = {};
  const [a, b] = Object.values(world.citizens);
  a.x = 30; a.y = 20; b.x = 33; b.y = 20;
  for (const c of [a, b]) {
    c.inventory = { 'food:2': 3, 'food:1': 3 }; c.health = c.fullness = 100;
    c.mind!.dispositions.morals = c.mind!.dispositions.familyOrientation = 1;
    c.mind!.dispositions.generosity = 0;
  }
  updateKnowledge(world);
  return { world, a, b };
}

describe('nearby composed family and meaningful exploration', () => {
  it('offers only currently observed nearby healthy idle partners, without invitations', () => {
    const {world,a,b}=familyWorld();
    expect(prepareTreeCandidates(observe(world,a.id)).some(c=>c.task.definitionId==='Reproduce')).toBe(false);
    b.x=a.x+1;updateKnowledge(world);
    expect(prepareTreeCandidates(observe(world,a.id)).some(c=>c.task.definitionId==='Reproduce'&&c.task.targetId===b.id)).toBe(true);
    b.health=74;updateKnowledge(world);
    expect(prepareTreeCandidates(observe(world,a.id)).some(c=>c.task.definitionId==='Reproduce')).toBe(false);
  });
  it('does not offer dead or busy partners or travel toward remote partners',()=>{
    const {world,a,b}=familyWorld();b.x=a.x+1;updateKnowledge(world);
    dispatch(world,b.id,{type:'move',x:b.x+1,y:b.y});updateKnowledge(world);
    expect(prepareTreeCandidates(observe(world,a.id)).some(c=>c.task.definitionId==='Reproduce')).toBe(false);
    b.action=null;b.alive=false;updateKnowledge(world);
    expect(prepareTreeCandidates(observe(world,a.id)).some(c=>c.task.definitionId==='Reproduce')).toBe(false);
  });
  it('prepares T1 food without a family tool prerequisite',()=>{
    const {world,a,b}=familyWorld();b.x=a.x+1;a.inventory={};
    world.deposits.food={id:'food',x:a.x,y:a.y,resource:'food',tier:1,stock:5,capacity:5,regrowAt:0};updateKnowledge(world);
    const options=prepareTreeCandidates(observe(world,a.id));
    expect(options.some(c=>c.task.request.purpose==='Prepare own family provisions; family intention toward '+b.id&&c.task.request.tier===1)).toBe(true);
    expect(options.some(c=>/family.*tool|tool.*family/.test(c.task.request.purpose))).toBe(false);
  });
  it('does not inspect partner supplies, consent or private motives', () => {
    const { world, a, b } = familyWorld();
    const before = prepareTreeCandidates(observe(world, a.id));
    b.inventory = {}; b.consent = {}; b.mind!.dispositions.familyOrientation = 0;
    expect(prepareTreeCandidates(observe(world, a.id))).toEqual(before);
    // This comparison is about candidate privacy at this observation, not
    // global infertility over later movement, gifts and consent-free births.
    expect(before.some(c => c.task.definitionId === 'Reproduce')).toBe(false);
  });

  it('does not turn dated out-of-sight deposits into automatic repeat exploration goals', () => {
    const { world, a } = familyWorld();
    world.deposits['remote'] = { id: 'remote', x: 25, y: 20, resource: 'food', tier: 2, stock: 5, capacity: 5, regrowAt: 0 };
    a.x = 25; updateKnowledge(world); a.x = 30; updateKnowledge(world);
    const explore = prepareTreeCandidates(observe(world, a.id)).find(c => c.task.definitionId === 'Explore');
    expect(explore?.task.request.purpose).toBe('Survey the frontier for unknown land');
  });
});
