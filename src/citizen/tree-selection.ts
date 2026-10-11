import type { Dispositions } from '../shared/tree-types.ts';

export const DISPOSITION_KEYS = ['ambition', 'morals', 'generosity', 'riskTolerance', 'patience', 'sociability', 'vengefulness', 'familyOrientation', 'enterprise', 'economicIndependence'] as const;
export function unit(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
/** Explicit state in/out; never depends on world RNG or process-global randomness. */
export function seededDraw(seed: number): { value: number; seed: number } {
  const next = ((Number.isFinite(seed) ? seed : 0) >>> 0) + 0x6d2b79f5 >>> 0;
  let t = Math.imul(next ^ next >>> 15, next | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return { seed: next, value: ((t ^ t >>> 14) >>> 0) / 4294967296 };
}
export function initializeDispositions(seed: number): Dispositions {
  const result = {} as Dispositions;
  for (const key of DISPOSITION_KEYS) { const draw = seededDraw(seed); seed = draw.seed; result[key] = draw.value; }
  return result;
}
/** Normalized comparable estimates, supplied by the task, not inferred outcomes.
 * Affinities are signed -1..1: e.g. harm has negative morals affinity;
 * own production has positive economicIndependence affinity. */
export interface PreparedOption {
  id: string; feasible: boolean;
  benefit: number; cost: number; risk: number; delay: number; uncertainty: number;
  affinities?: Partial<Record<keyof Dispositions, number>>;
  /** Explicit additive bias in score units, supplied by the caller. Continuous
   * weighting in one disposition (e.g. a conscience penalty on attack options
   * that grows with morals) stays with the caller; selection just adds it. */
  bias?: number;
}
export function optionScore(option: PreparedOption, personality: Dispositions): number {
  let score = 3 * (unit(option.benefit) - unit(option.cost))
    - 2 * unit(option.risk) * (1 - unit(personality.riskTolerance))
    - 2 * unit(option.delay) * (1 - unit(personality.patience)) - unit(option.uncertainty);
  for (const key of DISPOSITION_KEYS) {
    const affinity = option.affinities?.[key] ?? 0;
    score += 2 * (2 * unit(personality[key]) - 1) * (Number.isFinite(affinity) ? Math.max(-1, Math.min(1, affinity)) : 0);
  }
  const bias = option.bias;
  return score + (bias !== undefined && Number.isFinite(bias) ? bias : 0);
}
/** Pure softmax: probabilities are continuous in every score, with no uniform
 * exploration floor (a floor made lifetime predation nearly certain) and no
 * personality cutoffs — a dominated feasible action keeps small nonzero mass,
 * and hard exclusions remain exclusively the caller's feasibility checks. */
export function optionProbabilities(options: readonly PreparedOption[], personality: Dispositions): { id: string; probability: number; score: number }[] {
  const eligible = options.filter(option => option.feasible);
  if (!eligible.length) return [];
  const scores = eligible.map(option => optionScore(option, personality));
  const max = Math.max(...scores);
  const weights = scores.map(score => Math.exp(score - max));
  const sum = weights.reduce((a, b) => a + b, 0);
  return eligible.map((option, i) => ({ id: option.id, score: scores[i]!, probability: weights[i]! / sum }));
}
export function chooseOption(options: readonly PreparedOption[], personality: Dispositions, seed: number): { id?: string; seed: number } {
  const probabilities = optionProbabilities(options, personality);
  if (!probabilities.length) return { seed };
  const draw = seededDraw(seed);
  let remainder = draw.value;
  for (const option of probabilities) { remainder -= option.probability; if (remainder < 0) return { id: option.id, seed: draw.seed }; }
  return { id: probabilities.at(-1)!.id, seed: draw.seed };
}
