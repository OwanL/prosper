import { expect, it } from 'vitest';
import { evaluateMarketFamily } from '../scripts/evaluate-market-family.ts';

it('checks custody and serializable checkpoints in unmodified automatic composed worlds', () => {
  for (const seed of [1, 7, 42]) {
    const result = evaluateMarketFamily(seed, 20);
    expect(result.ticks).toBe(20);
    // Same canonical accounting tolerance as evaluate-composed's checkpoint audit.
    expect(result.maxGoldError).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(result.custody.gold - 2000)).toBeLessThanOrEqual(1e-9);
    expect(result.checkpoints.every(c => c.ok)).toBe(true);
    expect(result.counts['command:harvest']).toBeGreaterThan(0);
  }
});
