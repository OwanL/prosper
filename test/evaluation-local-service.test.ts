import { describe, expect, it } from 'vitest';
import { LOCAL_RUN_ENVELOPE as E, GRANITE_RUN_ENVELOPE as G, QWEN4B_RUN_ENVELOPE as Q, requireLocalResources } from '../src/evaluation/local-service.ts';

describe('local development preflight', () => {
  const safe = { ramFreeBytes: E.minRamFreeBytes, gpuFreeBytes: E.minGpuFreeBytes, gpuTotalBytes: 8 * 1024 ** 3 };
  it('admits only the declared planning headroom', () => {
    expect(() => requireLocalResources(safe)).not.toThrow();
    expect(() => requireLocalResources({ ...safe, ramFreeBytes: safe.ramFreeBytes - 1 })).toThrow('preflight blocked');
    expect(() => requireLocalResources({ ...safe, gpuFreeBytes: safe.gpuFreeBytes - 1 })).toThrow('preflight blocked');
  });
  it('admits the explicit Granite envelope without weakening the installed Qwen default', () => {
    const granite = { ...safe, gpuFreeBytes: G.minGpuFreeBytes };
    expect(() => requireLocalResources(granite, G)).not.toThrow();
    expect(() => requireLocalResources(granite)).toThrow('7 GiB');
    expect(() => requireLocalResources({ ...granite, gpuFreeBytes: G.minGpuFreeBytes - 1 }, G)).toThrow('5 GiB');
    expect(() => requireLocalResources({ ...granite, ramFreeBytes: G.minRamFreeBytes - 1 }, G)).toThrow('6 GiB');
    expect(G.contextTokens).toBe(131072);
    expect(G.maxInputTokens).toBe(120000);
    expect(G.maxOutputTokens).toBe(256);
    expect(G.stopRamFreeBytes).toBe(E.stopRamFreeBytes);
    expect(G.stopGpuFreeBytes).toBe(E.stopGpuFreeBytes);
    expect(Object.isFrozen(G)).toBe(true);
    expect(Object.isFrozen(E)).toBe(true);
  });
  it('admits the empirical 4B 96K trial at exactly 2 GiB RAM without weakening the 9B gate', () => {
    expect(Q.minRamFreeBytes).toBe(2 * 1024 ** 3);
    expect(E.minRamFreeBytes).toBe(6 * 1024 ** 3);
    const qwen = { ...safe, ramFreeBytes: Q.minRamFreeBytes, gpuFreeBytes: Q.minGpuFreeBytes };
    expect(() => requireLocalResources(qwen, Q)).not.toThrow();
    expect(() => requireLocalResources(qwen)).toThrow('6 GiB');
    expect(() => requireLocalResources({ ...qwen, ramFreeBytes: Q.minRamFreeBytes - 1 }, Q)).toThrow('2 GiB');
    expect(() => requireLocalResources({ ...qwen, gpuFreeBytes: Q.minGpuFreeBytes - 1 }, Q)).toThrow('7.25 GiB');
    expect(Q.contextTokens).toBe(98304); expect(Q.maxInputTokens).toBe(90000);
    expect(Q.maxCalls).toBe(3); expect(Q.runWallMs).toBe(300000);
    expect(() => requireLocalResources(qwen, { ...Q })).toThrow('fixed');
  });
  it('rejects custom envelopes, including copies of the fixed constants', () => {
    expect(() => requireLocalResources(safe, { ...E })).toThrow('fixed');
    expect(() => requireLocalResources(safe, { ...G, minRamFreeBytes: 1 })).toThrow('fixed');
  });
  it('fails closed on absent, nonfinite or incoherent measurements', () => {
    for (const invalid of [NaN, Infinity, -1, 0, 0.5]) expect(() => requireLocalResources({ ...safe, ramFreeBytes: invalid })).toThrow();
    expect(() => requireLocalResources({ ...safe, gpuFreeBytes: safe.gpuTotalBytes + 1 })).toThrow();
  });
  it('pins a three-send, bounded-context/wall envelope without hard allocation claims', () => {
    expect(E.maxCalls).toBe(3);
    expect(E.maxInputTokens + E.maxOutputTokens).toBeLessThan(E.contextTokens);
    expect(E.runWallMs).toBe(300000);
    expect(E.teardownMs).toBe(10000);
    expect(E.minRamFreeBytes).toBeGreaterThan(E.stopRamFreeBytes);
    expect(E.minGpuFreeBytes).toBeGreaterThan(E.stopGpuFreeBytes);
  });
});
