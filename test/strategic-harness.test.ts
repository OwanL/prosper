import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner, type CitizenRunnerOptions } from '../src/citizen/runner.ts';
import type { ProviderResponse, TransportRequest } from '../src/citizen/provider.ts';
import {
  strategicContext,
  strategicProjection,
  STRATEGIC_CONTEXT_BYTE_LIMIT,
} from '../src/citizen/strategic-context.ts';
import { strategicTools } from '../src/citizen/strategic-tools.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';
import { setAutonomyPolicy } from '../src/world/autonomy.ts';
import { strategicReviewReason } from '../src/citizen/strategic-review.ts';

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const policyCall = (args: unknown): ProviderResponse => ({
  toolCalls: [{ id: 'policy', name: 'set_policy', arguments: JSON.stringify(args) }],
  usage: { inputTokens: 800, outputTokens: 120 },
});
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function setup(
  answer: (
    request: TransportRequest,
    index: number,
  ) => ProviderResponse | Promise<ProviderResponse>,
  options: CitizenRunnerOptions = {},
  population = 6,
) {
  const world = createWorld({ seed: 42, autonomy: true, population });
  const citizen = Object.values(world.citizens)[0];
  updateKnowledge(world);
  const directory = mkdtempSync(join(tmpdir(), 'prosper-policy-test-'));
  directories.push(directory);
  const requests: TransportRequest[] = [];
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => observe(world, id),
      command: (id, command) => {
        const gate = validateKnownCommand(world, id, command);
        return gate.ok ? dispatch(world, id, command) : gate;
      },
      diagnostic: () => {},
    },
    {
      mode: 'live',
      minRequestIntervalMs: 0,
      minRequestIntervalTicks: 0,
      ledgerOptions: { directory, maxRequests: 20, maxTokens: 1000000 },
      transport: async (request) => {
        requests.push(request);
        return answer(request, requests.length);
      },
      ...options,
    },
  );
  return { world, citizen, requests, runner };
}

describe('sparse strategic function over a continuous local mind', () => {
  it('preserves a newer explicit policy but accepts ordinary autonomous changes during inference', async () => {
    for (const explicit of [false, true]) {
      let resolve!: (response: ProviderResponse) => void;
      const { world, citizen, runner } = setup(
        () =>
          new Promise((yes) => {
            resolve = yes;
          }),
      );
      const turn = runner.startTurn(citizen.id);
      await flush();
      if (explicit) setAutonomyPolicy(world, citizen, { accessPrice: 7 });
      else citizen.autonomy!.policy.accessPrice = 7;
      resolve(policyCall({ policy: { accessPrice: 2 } }));
      await turn;
      expect(citizen.autonomy!.policy.accessPrice).toBe(explicit ? 7 : 2);
      expect(runner.records()[0].requests).toHaveLength(1);
      if (explicit)
        expect(runner.records()[0].toolEvents[0].result).toMatchObject({
          ok: false,
          code: 'policy_superseded',
        });
    }
  });
  it('accepts a single JSON policy after physical time advances, without an acknowledgement request', async () => {
    let resolve!: (response: ProviderResponse) => void;
    const pending = new Promise<ProviderResponse>((yes) => {
      resolve = yes;
    });
    const { world, citizen, runner, requests } = setup(() => pending);
    const turn = runner.startTurn(citizen.id);
    await flush();
    tickWorld(world, 60);
    updateKnowledge(world);
    expect(world.tick).toBe(60);
    expect(citizen.action || Object.keys(citizen.inventory).length).toBeTruthy();
    resolve({
      content: JSON.stringify({
        policy: { stance: 'assertive', accessPrice: 7 },
        reviewAfter: 4800,
        memory: 'Protect the grove and negotiate access.',
      }),
      usage: { inputTokens: 900, outputTokens: 90 },
    });
    await turn;
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.reasoning_effort).toBe('none');
    expect(requests[0].payload.max_tokens).toBe(1200);
    expect(requests[0].payload.tools).toHaveLength(1);
    expect(citizen.autonomy?.policy).toMatchObject({ stance: 'assertive', accessPrice: 7 });
    expect(citizen.autonomy).toMatchObject({ source: 'live', reviewedTick: 60 });
    expect(citizen.nextReviewTick).toBeGreaterThanOrEqual(4860);
    expect(runner.records()[0].status).toBe('completed');
    expect(runner.budget()).toMatchObject({ requests: 1, pending: 0, tokens: 990 });
  });

  it('keeps local behavior and receipts when a model emits invalid text; no correction or immediate retry', async () => {
    const { world, citizen, runner, requests } = setup(() => ({
      content: 'Let us all be friends.',
      usage: { inputTokens: 400, outputTokens: 50 },
    }));
    await runner.startTurn(citizen.id);
    expect(runner.records()[0]).toMatchObject({
      status: 'yielded',
      stopReason: 'invalid_decision',
      inputTokens: 400,
      outputTokens: 50,
    });
    expect(citizen.nextReviewTick).toBeGreaterThanOrEqual(4800);
    for (const other of Object.values(world.citizens)) other.nextReviewTick = 10000;
    tickWorld(world, 120);
    runner.tick();
    await flush();
    expect(requests).toHaveLength(1);
    expect(citizen.alive).toBe(true);
    expect(runner.metrics()).toMatchObject({ totalInputTokens: 400, totalOutputTokens: 50 });
  });

  it('rejects malformed policies atomically without cancelling the citizen body', async () => {
    const { world, citizen, runner } = setup(() => policyCall({ policy: { aggression: 7 } }));
    dispatch(world, citizen.id, { type: 'move', x: citizen.x + 1, y: citizen.y });
    const before = structuredClone(citizen.action);
    const policy = structuredClone(citizen.autonomy?.policy);
    await runner.startTurn(citizen.id);
    expect(citizen.action).toEqual(before);
    expect(citizen.autonomy?.policy).toEqual(policy);
    expect(runner.records()[0].toolEvents[0].result).toMatchObject({
      ok: false,
      code: 'invalid_tool',
    });
    expect(runner.records()[0].requests).toHaveLength(1);
  });

  it('requires known people and map-bounded policy areas before any work cancellation', async () => {
    const { world, citizen, runner } = setup(() =>
      policyCall({ policy: { rivals: ['imaginary-person'] } }),
    );
    dispatch(world, citizen.id, { type: 'move', x: citizen.x + 1, y: citizen.y });
    const before = structuredClone(citizen.action);
    await runner.startTurn(citizen.id);
    expect(citizen.action).toEqual(before);
    expect(citizen.autonomy?.policy.rivals).not.toContain('imaginary-person');
    expect(runner.records()[0].toolEvents[0].result).toMatchObject({ ok: false });
  });

  it('rejects physical directives and unaffordable policy prices at the model boundary', async () => {
    for (const decision of [
      { policy: {}, mode: 'keep', directives: [{ item: 'axe', quantity: 1, tier: 1 }] },
      { policy: { accessPrice: 10000 } },
    ]) {
      const { citizen, runner } = setup(() => policyCall(decision));
      const before = structuredClone(citizen.autonomy?.policy);
      await runner.startTurn(citizen.id);
      expect(citizen.autonomy?.policy).toEqual(before);
      expect(runner.records()[0].toolEvents[0].result).toMatchObject({
        ok: false,
        code: 'invalid_tool',
      });
    }
  });

  it('cannot bypass the policy function using unadvertised primitive tools', async () => {
    const { citizen, runner } = setup(() => ({
      toolCalls: [
        {
          id: 'bypass',
          name: 'command',
          arguments: JSON.stringify({ type: 'remember', text: 'Injected physical tool' }),
        },
      ],
    }));
    await runner.startTurn(citizen.id);
    expect(citizen.memories.some((memory) => memory.text === 'Injected physical tool')).toBe(false);
    expect(runner.records()[0].toolEvents[0].result).toMatchObject({
      ok: false,
      code: 'invalid_tool',
    });
  });

  it('closes inference without stopping physical time when durable accounting is damaged', () => {
    const { world, runner, requests } = setup(() => policyCall({ policy: {} }));
    runner.budget();
    writeFileSync(join(directories.at(-1)!, 'request-ledger.jsonl'), 'damaged');
    expect(() => runner.tick()).not.toThrow();
    tickWorld(world, 20);
    expect(world.tick).toBe(20);
    expect(requests).toHaveLength(0);
    expect(runner.status().error).toBeTruthy();
  });

  it('spreads a 100-citizen backlog across wall time and simulation time, including explicit starts', async () => {
    vi.useFakeTimers();
    const { world, runner, requests } = setup(
      () => policyCall({ policy: {}, reviewAfter: 4800 }),
      { minRequestIntervalMs: 30000, minRequestIntervalTicks: 120 },
      100,
    );
    for (const c of Object.values(world.citizens)) c.nextReviewTick = 0;
    world.tick = 10000;
    runner.tick();
    await flush();
    expect(requests).toHaveLength(1);
    world.tick = 100000;
    for (let i = 0; i < 10; i++) runner.tick();
    await runner.startTurn(Object.values(world.citizens)[1].id);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30001);
    runner.tick();
    await flush();
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30001);
    runner.tick();
    await flush();
    expect(requests).toHaveLength(2); // Wall time alone cannot advance simulation spacing.
    expect(runner.status().thinking).toHaveLength(0);
  });

  it('enforces a rolling hourly send ceiling independently of token capacity', async () => {
    vi.useFakeTimers();
    const { world, runner, requests } = setup(() => policyCall({ policy: {} }), {
      maxRequestsPerHour: 2,
    });
    const [a, b, c] = Object.keys(world.citizens);
    await runner.startTurn(a);
    await runner.startTurn(b);
    await runner.startTurn(c);
    expect(requests).toHaveLength(2);
    expect(runner.budget().pending).toBe(0);
    await vi.advanceTimersByTimeAsync(3600001);
    await runner.startTurn(c);
    expect(requests).toHaveLength(3);
  });

  it('never opens a model turn for autonomous scripted citizens', async () => {
    const { world, runner, requests } = setup(
      () => {
        throw new Error('Network forbidden');
      },
      { mode: 'scripted' },
    );
    for (let i = 0; i < 100; i++) {
      tickWorld(world);
      runner.tick();
    }
    await flush();
    expect(requests).toHaveLength(0);
    expect(runner.records()).toHaveLength(0);
    expect(Object.values(world.citizens).every((c) => c.alive)).toBe(true);
  });

  it('does not spend on a thriving 100-citizen due backlog or routine messages and trades', async () => {
    const { world, runner, requests } = setup(() => policyCall({ policy: {} }), {}, 100);
    world.tick = 600;
    for (const citizen of Object.values(world.citizens)) {
      citizen.nextReviewTick = 0;
      citizen.autonomy!.lastProgressTick = 600;
      citizen.autonomy!.evidence = [
        { tick: 590, kind: 'trade', text: 'Profitable exchange completed' },
      ];
    }
    runner.tick();
    await flush();
    expect(requests).toHaveLength(0);
    expect(runner.records()).toHaveLength(0);
    const citizen = Object.values(world.citizens)[0];
    citizen.autonomy!.evidence = [
      { tick: 601, kind: 'attack', text: 'Witnessed strike' },
      { tick: 602, kind: 'attack', text: 'Witnessed another strike' },
    ];
    world.tick = 1200;
    runner.tick();
    await flush();
    expect(requests).toHaveLength(1);
    expect(runner.records()[0].reason).toContain('harm');
    expect(strategicReviewReason(citizen, 1201)).toBeUndefined();
  });

  it('restores serializable policies, claims, social evidence and inheritance state', () => {
    const { world } = setup(() => policyCall({ mode: 'keep' }));
    tickWorld(world, 180);
    Object.values(world.citizens)[0].autonomy!.idleReason = 'surplus';
    const checkpoint = {
      version: 1,
      savedAt: new Date().toISOString(),
      world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
    };
    const restored = validateCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
    expect(restored.world).toEqual(world);
  });
});

describe('compact private strategic evidence', () => {
  it('distinguishes a deliberate surplus pause from stalled local work', () => {
    const { citizen } = setup(() => policyCall({ mode: 'keep' }));
    citizen.action = null;
    citizen.autonomy!.lastProgressTick = 0;
    citizen.autonomy!.evidence = [];
    citizen.autonomy!.intent = 'Unsold fibre surplus; watch productive ground';
    citizen.autonomy!.idleReason = 'surplus';
    expect(strategicReviewReason(citizen, 600)).toBeUndefined();
    expect(strategicReviewReason(citizen, 4800)).toBeUndefined();
    expect(strategicReviewReason(citizen, 10000)).toContain('age');
    citizen.autonomy!.intent = 'Find fibre';
    delete citizen.autonomy!.idleReason;
    expect(strategicReviewReason(citizen, 600)).toContain('stalled');
  });
  it('admits a failed critical food search once, even during an existing local action', () => {
    const { citizen } = setup(() => policyCall({ mode: 'keep' }));
    citizen.autonomy!.evidence = [
      {
        tick: 10,
        kind: 'survival',
        text: 'No usable known food or affordable sale; publicly begged for food.',
      },
    ];
    expect(strategicReviewReason(citizen, 11)).toContain('critical food');
    citizen.review = { ...citizen.review, foodRisk: 2, eventSequence: 0, strategicTick: 11 };
    expect(strategicReviewReason(citizen, 12)).toBeUndefined();
  });
  it('budgets the system and schema together while retaining witnessed harm ahead of trade spam', () => {
    const { world, citizen } = setup(() => policyCall({ mode: 'keep' }));
    const observation = observe(world, citizen.id);
    observation.alerts = [
      {
        id: 'event-1',
        tick: 1,
        kind: 'attack',
        text: 'Actual witnessed harm',
        audience: [citizen.id],
      },
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `event-${i + 2}`,
        tick: i + 2,
        kind: 'trade' as const,
        text: 'Routine trade '.repeat(30),
        audience: [citizen.id],
      })),
    ];
    observation.messages = Array.from({ length: 30 }, (_, i) => ({
      id: `message-${i}`,
      tick: i,
      from: 'known',
      text: 'Market chatter '.repeat(30),
    }));
    const messages = strategicContext(observation);
    expect(
      Buffer.byteLength(JSON.stringify({ messages, tools: strategicTools })),
    ).toBeLessThanOrEqual(STRATEGIC_CONTEXT_BYTE_LIMIT);
    const context = JSON.parse(messages[1].content!);
    expect(
      context.period.alerts.some((e: { text: string }) => e.text === 'Actual witnessed harm'),
    ).toBe(true);
    expect(messages[0].content).toContain('noGo rectangles are hard travel/work exclusions');
    expect(Object.values(context.contextBudgetOmissions).some((n) => Number(n) > 0)).toBe(true);
  });
  it('sends only known sightings, keeps latest contact locations and avoids peer private state', () => {
    const { world, citizen } = setup(() => policyCall({ mode: 'keep' }));
    const observation = observe(world, citizen.id);
    const contact = {
      id: 'dated-peer',
      name: 'Peer',
      color: 'red',
      x: citizen.x,
      y: citizen.y,
      alive: true,
      health: 80,
      activity: 'present',
    };
    observation.visible[0].citizens.push(contact);
    observation.remembered.push({
      x: world.width - 1,
      y: world.height - 1,
      seenTick: 0,
      citizens: [{ ...contact, x: world.width - 1, y: world.height - 1 }],
      buildings: [],
      deposits: [],
      loot: [],
    });
    const hidden = Object.values(world.citizens).at(-1)!;
    hidden.inventory['wood:3'] = 99999;
    hidden.memories.push({ tick: 0, text: 'SECRET PRIVATE THOUGHT' });
    const projected = strategicProjection(observation);
    expect(projected.currentWorld.contacts.find((c) => c.id === 'dated-peer')).toMatchObject({
      x: citizen.x,
      y: citizen.y,
      current: true,
    });
    expect(JSON.stringify(projected)).not.toContain('SECRET PRIVATE THOUGHT');
    expect(JSON.stringify(projected)).not.toContain('99999');
  });

  it('bounds period transcripts and separates cumulative relationship evidence from recent delivery', () => {
    const { world, citizen } = setup(() => policyCall({ mode: 'keep' }));
    const observation = observe(world, citizen.id);
    observation.messages = Array.from({ length: 100 }, (_, i) => ({
      id: `message-${i}`,
      tick: i,
      from: 'known',
      text: `message ${i}`,
    }));
    observation.alerts = Array.from({ length: 100 }, (_, i) => ({
      id: `event-${i}`,
      tick: i,
      kind: 'attack',
      text: 'Witnessed attack',
      audience: [citizen.id],
    }));
    const projected = strategicProjection(observation, 50);
    expect(projected.period.messages).toHaveLength(12);
    expect(projected.period.alerts).toHaveLength(12);
    expect(projected.period.omitted).toMatchObject({ messages: 37, alerts: 37 });
    expect(projected.period.alertCounts.attack).toBe(49);
    expect(projected.period.messages.every((m) => m.tick > 50)).toBe(true);
    expect(projected.period.relationshipCountsAre).toContain('cumulative');
  });

  it('substantially reduces the initial strategic request without an unlabelled map or duplicated manual', () => {
    const { world, citizen } = setup(() => policyCall({ mode: 'keep' }));
    const observation = observe(world, citizen.id);
    const compact = JSON.stringify(strategicContext(observation));
    const legacy = JSON.stringify(freshContext(observation));
    expect(compact.length).toBeLessThan(legacy.length * 0.6);
    expect(JSON.parse(strategicContext(observation)[1].content!).currentWorld.mapSize).toMatchObject({
      width: world.width,
      height: world.height,
    });
    expect(compact).not.toContain('entityIndex');
  });
});
