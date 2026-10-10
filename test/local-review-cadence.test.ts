import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner, type CitizenRunnerOptions } from '../src/citizen/runner.ts';
import type { ProviderResponse, TransportRequest } from '../src/citizen/provider.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
async function flush() {
  for (let index = 0; index < 15; index++) await Promise.resolve();
}
const response: ProviderResponse = {
  content: JSON.stringify({ policy: { stance: 'assertive' }, reviewAfter: 4800 }),
  usage: { inputTokens: 500, outputTokens: 50 },
};
function setup(options: CitizenRunnerOptions = {}, answer = async () => response) {
  const world = createWorld({ seed: 21, population: 6, autonomy: true });
  updateKnowledge(world);
  const requests: TransportRequest[] = [];
  const directory = mkdtempSync(join(tmpdir(), 'prosper-local-cadence-'));
  directories.push(directory);
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => observe(world, id),
      command: (id, command) => dispatch(world, id, command),
      diagnostic: () => {},
    },
    {
      mode: 'live',
      model: 'qwen3.5:9b',
      verifiedLocalModel: 'qwen3.5:9b',
      ledgerOptions: { directory, maxRequests: 100, maxTokens: 1_000_000 },
      transport: async (request) => {
        requests.push(request);
        return answer();
      },
      ...options,
    },
  );
  return { world, requests, runner };
}

describe('verified local policy cadence', () => {
  it('uses local throughput only with exact verification and native transport selection', () => {
    expect(setup().runner.metrics()).toMatchObject({
      inferenceProfile: 'verified-local',
      minRequestIntervalMs: 1000,
      minRequestIntervalTicks: 0,
      maxRequestsPerHour: 600,
      maxConcurrent: 1,
    });
    for (const options of [
      { verifiedLocalModel: undefined },
      { verifiedLocalModel: 'different:9b' },
      { model: 'qwen:cloud', verifiedLocalModel: 'qwen:cloud' },
      { provider: 'openai' as const },
    ]) {
      expect(setup(options).runner.metrics()).toMatchObject({
        inferenceProfile: 'metered',
        minRequestIntervalMs: 30000,
        minRequestIntervalTicks: 120,
        maxRequestsPerHour: 30,
      });
    }
  });

  it('reviews thriving initial citizens and refreshes policies after 600 ticks despite a long model delay', async () => {
    vi.useFakeTimers();
    const { world, requests, runner } = setup();
    const citizens = Object.values(world.citizens);
    for (const citizen of citizens) citizen.nextReviewTick = 10000;
    runner.tick(); // Bring a restored sparse-review backlog into a staggered queue.
    world.tick = 120;
    runner.tick();
    await flush();
    expect(requests).toHaveLength(1);
    expect(runner.records()[0].reason).toContain('initial local');
    const reviewed = world.citizens[requests[0].citizenId];
    expect(reviewed.nextReviewTick).toBe(720);
    expect(requests[0].payload.messages[0].content).toContain('verified local inference');
    for (const citizen of citizens) if (citizen !== reviewed) citizen.alive = false;
    await vi.advanceTimersByTimeAsync(1001);
    world.tick = 719;
    runner.tick();
    await flush();
    expect(requests).toHaveLength(1);
    world.tick = 720;
    runner.tick();
    await flush();
    expect(requests).toHaveLength(2);
    expect(runner.records()[1].reason).toContain('periodic local');
    expect(runner.budget()).toMatchObject({ requests: 2, tokens: 1100, pending: 0 });
  });

  it('gives every overdue citizen a review before returning to a recently reviewed desperate citizen', async () => {
    vi.useFakeTimers();
    const { world, requests, runner } = setup();
    runner.tick();
    world.tick = 120;
    for (let count = 0; count < 6; count++) {
      runner.tick();
      await flush();
      expect(requests).toHaveLength(count + 1);
      const reviewed = world.citizens[requests[0].citizenId];
      reviewed.nextReviewTick = world.tick;
      reviewed.fullness = 0;
      reviewed.autonomy!.evidence.push(
        { tick: world.tick + 1, kind: 'attack', text: 'New harm' },
        { tick: world.tick + 2, kind: 'attack', text: 'More harm' },
      );
      world.tick += 3;
      await vi.advanceTimersByTimeAsync(1001);
    }
    expect(new Set(requests.map((request) => request.citizenId)).size).toBe(6);
  });

  it('keeps physical work running during one pending inference and backs failures off', async () => {
    let reject!: (error: Error) => void;
    const { world, runner, requests } = setup(
      {},
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    const citizen = Object.values(world.citizens)[0];
    const turn = runner.startTurn(citizen.id);
    await flush();
    tickWorld(world, 60);
    runner.tick();
    await flush();
    expect(requests).toHaveLength(1);
    expect(world.tick).toBe(60);
    expect(runner.status().thinking).toEqual([citizen.id]);
    reject(new Error('Model unavailable'));
    await turn;
    expect(citizen.nextReviewTick).toBe(660);
    expect(runner.records()[0].status).toBe('error');
    expect(runner.budget()).toMatchObject({ requests: 1, pending: 0 });
  });

  it('still obeys lifetime budgets and leaves local controllers running when exhausted', async () => {
    const { world, runner, requests } = setup({
      minRequestIntervalMs: 0,
      ledgerOptions: {
        directory: (() => {
          const directory = mkdtempSync(join(tmpdir(), 'prosper-local-cap-'));
          directories.push(directory);
          return directory;
        })(),
        maxRequests: 1,
        maxTokens: 1_000_000,
      },
    });
    const [a, b] = Object.values(world.citizens);
    await runner.startTurn(a.id);
    await runner.startTurn(b.id);
    expect(requests).toHaveLength(1);
    tickWorld(world, 10);
    expect(world.tick).toBe(10);
  });
});
