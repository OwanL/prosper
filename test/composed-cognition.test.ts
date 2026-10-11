import { describe, expect, it } from 'vitest';
import { chooseOption, initializeDispositions, optionProbabilities, type PreparedOption } from '../src/citizen/tree-selection.ts';
import { relationshipContext, updateMemories } from '../src/citizen/tree-memory.ts';
import { scoreSpatialSite, spatialComponents, type SpatialSite } from '../src/citizen/tree-spatial.ts';
import type { CitizenObservation } from '../src/shared/types.ts';
// Component-level observation projection, not engine integration evidence.
const observationFixture = () => ({ tick: 70, citizen: { x: 0, y: 0 }, visible: [{ x: 1, y: 0, seenTick: 70, citizens: [] }], remembered: [] }) as unknown as CitizenObservation;

describe('pure composed cognition', () => {
  const base = initializeDispositions(42);
  const choices: PreparedOption[] = [
    { id: 'harm', feasible: true, benefit: 0.8, cost: 0, risk: 0, delay: 0, uncertainty: 0, affinities: { morals: -1 } },
    { id: 'work', feasible: true, benefit: 0.6, cost: 0, risk: 0, delay: 0, uncertainty: 0 },
  ];
  it('initializes all ten tendencies reproducibly with seeded variation', () => {
    expect(initializeDispositions(42)).toEqual(base);
    expect(Object.keys(base)).toHaveLength(10);
    expect(Object.values(base).every(v => v >= 0 && v <= 1)).toBe(true);
    expect(initializeDispositions(43)).not.toEqual(base);
  });
  it('contrasts moral preference continuously without prohibiting or flooring feasible options', () => {
    const moral = optionProbabilities(choices, { ...base, morals: 1 });
    const immoral = optionProbabilities(choices, { ...base, morals: 0 });
    expect(moral[0]!.probability).toBeLessThan(immoral[0]!.probability);
    expect(moral[0]!.probability).toBeGreaterThan(0);
    const improvedWork = choices.map(c => c.id === 'work' ? { ...c, benefit: 1 } : c);
    expect(optionProbabilities(improvedWork, base)[1]!.probability).toBeGreaterThan(optionProbabilities(choices, base)[1]!.probability);
    // No uniform exploration floor: a dominated feasible option keeps small
    // nonzero mass instead of an artificial 1% share, and probabilities stay
    // continuous in every score.
    const dominated = choices.map(c => c.id === 'harm' ? { ...c, benefit: 0, bias: -4 } : c);
    const probabilities = optionProbabilities(dominated, base);
    expect(probabilities[0]!.probability).toBeLessThan(0.01);
    expect(probabilities[0]!.probability).toBeGreaterThan(0);
    expect(probabilities.reduce((a, b) => a + b.probability, 0)).toBeCloseTo(1);
  });
  it('applies explicit caller bias continuously in score units with stable sanitization', () => {
    const biased = optionProbabilities(choices.map(c => c.id === 'harm' ? { ...c, bias: -6 } : c), base);
    const plain = optionProbabilities(choices, base);
    expect(biased[0]!.score).toBeCloseTo(plain[0]!.score - 6);
    expect(biased[0]!.probability).toBeLessThan(plain[0]!.probability);
    expect(chooseOption(choices.map(c => c.id === 'harm' ? { ...c, bias: -24 } : c), base, 7).id).toBe('work');
    // Non-finite caller bias is sanitized to zero, like every other field.
    const weird = optionProbabilities([{ ...choices[0]!, benefit: Infinity, bias: Infinity }, choices[1]!], base);
    expect(weird.every(p => Number.isFinite(p.score))).toBe(true);
    expect(weird.reduce((a, b) => a + b.probability, 0)).toBeCloseTo(1);
  });
  it('samples reproducibly, respects feasibility and has stable malformed-input numerics', () => {
    const sample = () => { let seed = 7; return Array.from({ length: 1000 }, () => { const chosen = chooseOption(choices, base, seed); seed = chosen.seed; return chosen.id; }); };
    expect(sample()).toEqual(sample());
    expect(new Set(sample()).size).toBe(2);
    expect(chooseOption(choices.map(c => ({ ...c, feasible: false })), base, 7)).toEqual({ seed: 7 });
    const probabilities = optionProbabilities([{ ...choices[0]!, benefit: Infinity, risk: NaN }, choices[1]!], base);
    expect(probabilities.reduce((a, b) => a + b.probability, 0)).toBeCloseTo(1);
    expect(probabilities.every(p => Number.isFinite(p.score))).toBe(true);
  });
  it('retains bounded dated personal evidence, dedupes without refreshing and knows no hidden relationships', () => {
    const observation = observationFixture();
    const entries = Array.from({ length: 70 }, (_, i) => ({ id: `e${i}`, tick: i, kind: 'help' as const, otherId: 'known', text: 'helped' }));
    const retained = updateMemories([], entries, 70);
    expect(retained.memories).toHaveLength(64);
    expect(retained.memoriesOmitted).toBe(6);
    expect(updateMemories(retained.memories, [{ ...entries[69]!, tick: 70 }], 70).memories.at(-1)!.tick).toBe(69);
    expect(updateMemories([], [{ ...entries[0]!, tick: 100 }], 70).memories).toEqual([]);
    expect(relationshipContext({ ...observation, tick: 70 }, retained.memories, 'hidden')).toBeUndefined();
    expect(relationshipContext({ ...observation, tick: 70 }, retained.memories, 'known')?.help).toBe(64);
  });
  it('scores only dated known eligible sites and changes preference with task purpose', () => {
    const observation = observationFixture();
    const tile = observation.visible[0]!;
    const site: SpatialSite = { id: 'now', x: tile.x, y: tile.y, eligible: true, evidenceTick: tile.seenTick, immediate: 1, future: 0, strategic: 0, risk: 0 };
    const values = spatialComponents(observation, [site, { ...site, id: 'later', immediate: 0, future: 1 }, { ...site, id: 'forbidden', eligible: false }, { ...site, id: 'unknown', x: -100 }, { ...site, id: 'futureEvidence', evidenceTick: observation.tick + 1 }]);
    expect(values.map(v => v.id)).toEqual(['now', 'later']);
    const immediate = { immediate: 1, future: 0, strategic: 0, travel: 0, risk: 0 };
    expect(scoreSpatialSite(values[0]!, immediate)).toBeGreaterThan(scoreSpatialSite(values[1]!, immediate));
    expect(scoreSpatialSite(values[0]!, { ...immediate, immediate: 0, future: 1 })).toBeLessThan(scoreSpatialSite(values[1]!, { ...immediate, immediate: 0, future: 1 }));
  });
});
