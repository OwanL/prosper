import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { runTrial, parseTrialArgs } from '../scripts/trial.ts';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, mkdtempSync: vi.fn(fs.mkdtempSync), rmSync: vi.fn(fs.rmSync) };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('bounded SCRIPTED headless trial', () => {
  it('repeats a seeded progression fixture exactly and completes useful work between ticks', async () => {
    const network = vi.fn(() => {
      throw new Error('Network forbidden');
    });
    vi.stubGlobal('fetch', network);
    const options = { scenario: 'progression', seed: 1, ticks: 360 };
    const first = await runTrial(options);
    expect(await runTrial(options)).toEqual(first);
    expect(first).toMatchObject({
      mode: 'SCRIPTED',
      simulatedTicks: 360,
      alive: 3,
      dead: 0,
      completedActions: { craft: 2, harvest: 20, move: 58 },
      tools: { 'knife:1': 2 },
      gold: { initial: 300, total: 300, delta: 0 },
      providerRequests: 0,
      plannerErrors: 0,
    });
    expect(first.evidence).toContain('not emergence');
    expect(network).not.toHaveBeenCalled();
    for (const result of vi.mocked(mkdtempSync).mock.results) {
      expect(result.type).toBe('return');
      expect(existsSync(result.value)).toBe(false);
      expect(rmSync).toHaveBeenCalledWith(result.value, { recursive: true, force: true });
    }
  });

  it.each(['village', 'competition', 'progression'])(
    'conserves gold across %s reviews, including batches larger than concurrency',
    async (scenario) => {
      const outcome = await runTrial({ scenario, seed: 7, ticks: 120 });
      expect(outcome.gold.total).toBe(outcome.gold.initial);
      expect(outcome.gold.delta).toBe(0);
      expect(outcome.simulatedTicks).toBe(120);
      expect(outcome.completedActions.harvest).toBeGreaterThan(0);
      expect(outcome.providerRequests).toBe(0);
      expect(outcome.plannerErrors).toBe(0);
    },
  );

  it('supports zero simulated ticks without inventing completions', async () => {
    const result = await runTrial({ scenario: 'progression', ticks: 0 });
    expect(result.simulatedTicks).toBe(0);
    expect(result.completedActions).toEqual({});
    expect(result.gold).toEqual({ initial: 300, total: 300, delta: 0 });
  });

  it('parses native output paths and rejects unsupported/live or malformed flags', () => {
    expect(
      parseTrialArgs([
        '--scenario',
        'competition',
        '--seed',
        '17',
        '--ticks',
        '60',
        '--output',
        'C:\\Temp\\trial.json',
      ]),
    ).toEqual({ scenario: 'competition', seed: 17, ticks: 60, output: 'C:\\Temp\\trial.json' });
    for (const args of [
      ['--mode', 'live'],
      ['--ticks'],
      ['--seed', '-1'],
      ['--ticks', '2.5'],
      ['--ticks', '1', '--ticks', '2'],
    ]) {
      expect(() => parseTrialArgs(args)).toThrow();
    }
  });

  it('rejects invalid scenarios and bounded numeric inputs before creating runtime artifacts', async () => {
    for (const options of [
      { scenario: 'unknown' },
      { ticks: -1 },
      { ticks: 10001 },
      { seed: 0x100000000 },
      { seed: NaN },
    ]) {
      await expect(runTrial(options)).rejects.toThrow();
    }
    expect(mkdtempSync).not.toHaveBeenCalled();
  });
});
