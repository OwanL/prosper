import { expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { observe, observeDecision, updateKnowledge } from '../src/world/observation.ts';
import { prepareTreeCandidates } from '../src/world/tree-controller.ts';
import { optionalAttackValue } from '../src/citizen/tree-combat.ts';
import { CONDITIONS } from '../src/citizen/tree-actions.ts';

function fixture() {
  const world = createWorld({ seed: 7, population: 3, autonomy: false });
  const [a, b, c] = Object.values(world.citizens);
  b!.x = a!.x + 1; b!.y = a!.y; c!.x = a!.x; c!.y = a!.y + 1;
  for (const citizen of [a!, b!, c!]) { citizen.health = 100; citizen.gold = 100; citizen.inventory = { 'food:1': 3 }; }
  updateKnowledge(world);
  return { world, a: a!, b: b!, c: c! };
}
const attacks = (o: ReturnType<typeof observe>) => prepareTreeCandidates(o).filter(c => c.task.definitionId === 'AttackCitizen');
it('equal fresh adjacent founders have no profitable attack regardless of personality', () => {
  const { world, a } = fixture();
  expect(attacks(observe(world, a.id))).toEqual([]);
});
it('admits only the best rich target, with saturated value and lean/full equivalence', () => {
  const { world, a, b, c } = fixture(); b.gold = 500; c.gold = 500; b.health = c.health = 30;
  updateKnowledge(world);
  const o = observe(world, a.id), choices = attacks(o);
  expect(choices).toHaveLength(1); expect(choices[0]!.forecast.benefit).toBeGreaterThan(0);
  expect(choices[0]!.forecast.benefit).toBeLessThan(.75);
  expect(prepareTreeCandidates(observeDecision(world, a.id))).toEqual(prepareTreeCandidates(o));
  const frozen = structuredClone(o); b.gold = 0; b.inventory = { 'sword:7': 1 };
  expect(attacks(frozen)).toEqual(choices);
  updateKnowledge(world); expect(attacks(observe(world, a.id))[0]!.task.targetId).toBe(c.id);
});
it('relative swords and distance reduce profit; unknown holdings do not invent loot', () => {
  const { world, a, b } = fixture(); b.gold = 500; updateKnowledge(world);
  const o = observe(world, a.id), peer = o.visible.flatMap(t => t.citizens).find(c => c.id === b.id)!;
  const baseline = optionalAttackValue(o, peer)!;
  peer.inventory = { 'sword:7': 1 }; expect(optionalAttackValue(o, peer)!.gain).toBeLessThan(baseline.gain);
  peer.inventory = {}; const tile = o.visible.find(t => t.citizens.some(c => c.id === b.id))!;
  const adjacent = optionalAttackValue(o, peer)!.gain; tile.x += 3;
  expect(optionalAttackValue(o, peer)!.gain).toBeLessThan(adjacent);
  delete peer.gold; expect(optionalAttackValue(o, peer)).toBeUndefined();
});
it('personal defence needs no loot, unrelated witnessed harm grants no retaliation', () => {
  const { world, a, b, c } = fixture(); const o = observe(world, a.id);
  o.alerts.push({ id: 'event-999', tick: o.tick, kind: 'attack', text: 'Attack', citizenId: b.id, targetId: c.id });
  expect(attacks(o)).toEqual([]);
  o.alerts[0]!.targetId = a.id;
  expect(attacks(o).some(t => t.task.targetId === b.id)).toBe(true);
});
it('rechecks optional intent before execution without changing mechanical guards', () => {
  const { world, a, b } = fixture(); b.gold = 500; updateKnowledge(world);
  const o = observe(world, a.id), t = attacks(o)[0]!.task;
  const peer = o.visible.flatMap(tile => tile.citizens).find(c => c.id === b.id)!; peer.gold = 0;
  expect(CONDITIONS.CanAttackCitizen.evaluate(o, t).ok).toBe(false);
  t.strategyId = undefined; expect(CONDITIONS.CanAttackCitizen.evaluate(o, t).ok).toBe(true);
});
