import { describe, expect, it } from 'vitest';
import { evaluate } from '../scripts/evaluate-composed.ts';

describe('normal seeded composed behavior (no mocked actors/provider)', () => {
  it('advances actual citizen decisions deterministically with conserved gold', () => {
    const a = evaluate(7, 20, 80), b = evaluate(7, 20, 80);
    expect(a.ticks).toBe(80);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.maxGoldError).toBeLessThan(1e-8);
    expect(a.invalidCustodyTicks).toBe(0);
    // every-100-tick checkpoint validation (plus tick-0 and final) must hold
    expect(a.checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(a.checkpointFailures).toBe(0);
    expect(a.checkpoints.every(c => c.ok)).toBe(true);
    expect(a.finalActors.some(c => (c.trace?.length ?? 0) > 0)).toBe(true);
    expect(Object.values(a.events).reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
  });
});