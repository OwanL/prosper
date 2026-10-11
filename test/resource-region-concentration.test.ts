import { describe, expect, it } from 'vitest';
import { createWorld, tickWorld } from '../src/world/core.ts';
import { BALANCE, RESOURCES } from '../src/world/config.ts';
import { ringAt } from '../src/shared/utils.ts';
import { RING_COUNT } from '../src/shared/tiers.ts';
import { totalGold } from '../src/evaluation/fixtures.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';

// Frozen outputs of the pre-concentration algorithm (including outskirts and
// founder provisioning), captured before relocation was implemented. Index = tier-1.
const baselineFood = {
  20: { 1: [46,12,9,9,5,3,0], 7: [42,13,10,9,4,4,0], 20: [42,14,10,7,6,3,0] },
  100: { 1: [231,60,48,40,24,11,1], 7: [230,56,52,35,23,16,0], 20: [230,60,45,38,26,12,0] },
};
const sector = (x: number, y: number, size: number) => Math.min(2, Math.floor(
  (Math.atan2(y-(size-1)/2, x-(size-1)/2)+Math.PI)/(2*Math.PI/3)));

describe('new-map regional food concentration', () => {
  for (const population of [20,100] as const) for (const seed of [1,7,20] as const) {
    it(`preserves seeded tier supply and starter wealth: ${population}/${seed}`, () => {
      const world = createWorld({ population, seed });
      const deposits = Object.values(world.deposits);
      const food = deposits.filter(d => d.resource === 'food');
      expect(Array.from({length:7}, (_,i) => food.filter(d => d.tier === i+1).length))
        .toEqual(baselineFood[population][seed]);
      expect(new Set(deposits.map(d => `${d.x},${d.y}`)).size).toBe(deposits.length);
      for (const d of deposits) {
        expect(sector(d.x,d.y,world.width)).toBe(RESOURCES.indexOf(d.resource));
        expect(d.stock).toBe(BALANCE.depositCapacity);
        expect(d.capacity).toBe(BALANCE.depositCapacity);
        expect(d.regrowAt).toBe(0);
        expect([RING_COUNT-ringAt(world,d), RING_COUNT-ringAt(world,d)+1]).toContain(d.tier);
      }
      expect(world.initialGold).toBe(population*BALANCE.startingGold);
      for (const c of Object.values(world.citizens)) {
        expect(c.gold).toBe(BALANCE.startingGold);
        expect(c.inventory).toEqual({'food:1': BALANCE.startingFood});
      }
      expect(createWorld({ population, seed })).toEqual(world);
    });
  }
  it('handles all supported founding populations without overwriting slots', () => {
    for (const population of [1,9,21,250]) {
      const w = createWorld({population,seed:7});
      expect(Object.values(w.deposits).every(d => d.resource !== 'food' || sector(d.x,d.y,w.width) === 1)).toBe(true);
    }
  });
  it('keeps the angular boundary convention (shifted atan2: food 120–240 degrees)', () => {
    expect(sector(0,18,37)).toBe(2); // shifted 360, clamped
    expect(sector(36,18,37)).toBe(1); // shifted 180
    expect(sector(18,0,37)).toBe(0); // shifted 90
    expect(sector(18,36,37)).toBe(2); // shifted 270
    for (const degrees of [0,120,240]) {
      const radians = degrees*Math.PI/180-Math.PI;
      for (const delta of [-1e-9,1e-9]) {
        const a = radians+delta;
        const actual = sector(18+10*Math.cos(a),18+10*Math.sin(a),37);
        const expected = degrees === 0 ? (delta < 0 ? 2 : 0) : degrees/120-(delta < 0 ? 1 : 0);
        expect(actual).toBe(expected);
      }
    }
  });
  it('records a natural composed 20-founder seed-7 continuation without rescue', () => {
    const world = createWorld({population:20,seed:7,controllerMode:'composed'});
    const founderIds = Object.keys(world.citizens);
    const startingGroundFood = Object.values(world.deposits).filter(d => d.resource === 'food').reduce((n,d) => n+d.stock,0);
    const outcomes = new Map<string, typeof world.events[number]>();
    for (let i = 0; i < 500; i++) {
      tickWorld(world);
      for (const e of world.events) if (e.trade || e.kind === 'death') outcomes.set(e.id,e);
    }
    const citizens = Object.values(world.citizens);
    console.info('concentrated-food natural 500 ticks', JSON.stringify({
      alive: citizens.filter(c => c.alive).length,
      dead: citizens.filter(c => !c.alive).length,
      carriedFood: citizens.filter(c => c.alive).reduce((n,c) => n+(c.inventory['food:1']??0),0),
      groundFood: Object.values(world.deposits).filter(d => d.resource==='food').reduce((n,d) => n+d.stock,0),
      trades: [...outcomes.values()].filter(e => e.trade).length,
      foodTraded: [...outcomes.values()].reduce((n,e) => n+(e.trade?.item.startsWith('food:') ? e.trade.quantity : 0),0),
      deaths: [...outcomes.values()].filter(e => e.kind === 'death').map(e => e.text),
    }));
    expect(world.tick).toBe(500);
    // Market policy legitimately changes births, survival and trade counts.
    // This finite regional-food run proves real metabolism and food settlements,
    // not zero starvation or a guaranteed long-term population equilibrium.
    expect(founderIds.some(id => world.citizens[id]!.fullness < BALANCE.maxFullness)).toBe(true);
    expect(Object.values(world.deposits).filter(d => d.resource === 'food').reduce((n,d) => n+d.stock,0)).toBeLessThan(startingGroundFood);
    for (const d of Object.values(world.deposits)) {
      expect(sector(d.x,d.y,world.width)).toBe(RESOURCES.indexOf(d.resource));
      expect(d.stock).toBeGreaterThanOrEqual(0);
      expect(d.stock).toBeLessThanOrEqual(d.capacity);
    }
    const foodTrades = [...outcomes.values()].flatMap(e => e.trade?.item.startsWith('food:') ? [e.trade] : []);
    expect(foodTrades.length).toBeGreaterThan(0);
    for (const trade of foodTrades) {
      expect(trade.quantity).toBeGreaterThan(0);
      expect(trade.price).toBeGreaterThan(0);
    }
    expect(totalGold(world)).toBeCloseTo(world.initialGold);
    const checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
    expect(validateCheckpoint(JSON.parse(JSON.stringify(checkpoint))).world).toEqual(world);
  }, 60_000);
});
