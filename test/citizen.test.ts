import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Citizen, CitizenObservation, Command, World } from '../src/shared/types.ts';
import {
  CitizenRunner,
  RequestLedger,
  type CitizenRunnerOptions,
  type ProviderResponse,
  type TransportRequest,
} from '../src/citizen/index.ts';
import { ollamaTransport } from '../src/citizen/provider.ts';
import { dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';
import { freshContext } from '../src/citizen/prompt.ts';
const temporary: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'prosper-citizen-'));
  temporary.push(path);
  return path;
}
function setup(options: CitizenRunnerOptions = {}) {
  const citizen: Citizen = {
    id: 'a',
    name: 'Ada',
    color: 'red',
    personality: 'careful',
    x: 1,
    y: 1,
    alive: true,
    health: 100,
    fullness: 100,
    gold: 100,
    inventory: {},
    action: null,
    queue: [],
    goals: ['unfinished project'],
    memories: [],
    knowledge: {},
    lastResult: '',
    nextReviewTick: 0,
    consent: {},
    reproductionCooldown: 0,
    parents: [],
  };
  const world: World = {
    schemaVersion: 1,
    runId: 'run-a',
    seed: 1,
    rngState: 1,
    nextId: 1,
    tick: 0,
    width: 8,
    height: 8,
    initialGold: 100,
    citizens: { a: citizen },
    deposits: {},
    buildings: {},
    orders: {},
    loot: {},
    messages: [],
    events: [],
  };
  const observation: CitizenObservation = {
    tick: 0,
    citizen,
    ascii: 'x..\n.A.',
    entityIndex: ['a Ada (1,1)'],
    visible: [
      {
        x: 2,
        y: 1,
        seenTick: 0,
        citizens: [],
        buildings: [],
        loot: [],
        deposits: [
          { id: 'wood', x: 2, y: 1, resource: 'wood', tier: 1, stock: 5, capacity: 5, regrowAt: 0 },
        ],
      },
    ],
    remembered: [],
    markets: [],
    messages: [],
    alerts: [],
  };
  const commands: Command[] = [];
  const diagnostic = vi.fn();
  const command = vi.fn((_id: string, cmd: Command) => {
    commands.push(structuredClone(cmd));
    if (cmd.type === 'goals') citizen.goals = cmd.goals;
    if (cmd.type === 'remember') citizen.memories.push({ tick: world.tick, text: cmd.text });
    return { ok: true, code: 'ok', message: 'committed' };
  });
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => ({ ...observation, citizen: world.citizens[id], tick: world.tick }),
      command,
      diagnostic,
    },
    { contextMode: 'legacy', ...options },
  );
  return { citizen, world, observation, commands, diagnostic, command, runner };
}
function call(id: string, command: unknown): ProviderResponse {
  return { toolCalls: [{ id, name: 'command', arguments: JSON.stringify(command) }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function live(transport: CitizenRunnerOptions['transport']) {
  return {
    mode: 'live' as const,
    transport,
    ledger: new RequestLedger({ directory: directory(), maxTokens: 1_000_000 }),
  };
}

describe('fresh citizen runner', () => {
  it('reports truncated and empty results instead of claiming completed reasoning', async () => {
    const { runner } = setup({
      contextMode: 'legacy', mode: 'recorded',
      recorded: [
        {
          citizenId: 'a',
          responses: [{ finishReason: 'length', usage: { inputTokens: 10, outputTokens: 1024 } }],
        },
        { citizenId: 'a', responses: [{ finishReason: 'stop', content: '   ' }] },
      ],
    });
    await runner.startTurn('a');
    expect(runner.records()[0]).toMatchObject({ status: 'yielded', stopReason: 'output_limit' });
    expect(runner.records()[0].requests[0].finishReason).toBe('length');
    expect(runner.records()[0].requests).toHaveLength(1);
    await runner.startTurn('a');
    expect(runner.records()[1]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('no visible response or tool calls'),
    });
  });
  it('retains valid effects but marks a truncated tool response as yielded', async () => {
    const { runner, commands } = setup({
      contextMode: 'legacy', mode: 'recorded',
      recorded: [
        {
          citizenId: 'a',
          responses: [
            { ...call('one', { type: 'remember', text: 'retained' }), finishReason: 'length' },
          ],
        },
      ],
    });
    await runner.startTurn('a');
    expect(commands).toHaveLength(1);
    expect(runner.records()[0]).toMatchObject({ status: 'yielded', stopReason: 'output_limit' });
  });
  it('allows 40k output and waits a review interval after a slow live turn finishes', async () => {
    const pending = deferred<ProviderResponse>();
    const transport = vi.fn(() => pending.promise);
    const { runner, world, citizen } = setup(live(transport));
    const done = runner.startTurn('a');
    await flush();
    expect(runner.records()[0].requests[0].payload.max_tokens).toBe(40000);
    world.tick = 100;
    pending.resolve({ content: 'done', usage: { inputTokens: 10, outputTokens: 2000 } });
    await done;
    expect(citizen.nextReviewTick).toBe(112);
    runner.tick();
    await flush();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('surfaces a restored token stop below the request cap, skips futile reviews, and resumes after cap increase', async () => {
    const root = directory();
    const oldLedger = new RequestLedger({ directory: root, maxRequests: 100, maxTokens: 100_000 });
    const request = oldLedger.reserve({
      runId: 'old',
      turnId: 'old',
      citizenId: 'a',
      inputTokens: 99_000,
      maxOutputTokens: 0,
    });
    oldLedger.settle(request.requestId);
    const ledger = new RequestLedger({ directory: root });
    const transport = vi.fn(async () => ({
      content: 'fresh',
      usage: { inputTokens: 5, outputTokens: 2 },
    }));
    const { runner, world, citizen } = setup({ contextMode: 'legacy', mode: 'live', ledger, transport });
    expect(runner.budget()).toMatchObject({
      requests: 1,
      tokens: 99_000,
      blocked: { reason: 'tokens', remainingTokens: 1000 },
    });
    const text = readFileSync(join(root, 'request-ledger.jsonl'), 'utf8');
    for (let i = 0; i < 100; i++) {
      tickWorld(world);
      runner.tick();
      await runner.startTurn('a');
    }
    expect(world.tick).toBe(100);
    expect(citizen.fullness).toBeLessThan(100);
    expect(transport).not.toHaveBeenCalled();
    expect(runner.records()).toEqual([]);
    expect(readFileSync(join(root, 'request-ledger.jsonl'), 'utf8')).toBe(text);
    ledger.setLimits({ maxRequests: 100, maxTokens: 200_000 });
    await runner.startTurn('a');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(runner.records()[0].status).toBe('completed');
    expect(runner.budget()).toMatchObject({ requests: 2, tokens: 99_007, maxTokens: 200_000 });
  });
  it('yields mid-turn on total token budget, preserves committed work, and never retries blocked turns', async () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root, maxTokens: 1_000_000 });
    const transport = vi.fn(async () => ({
      toolCalls: [
        ...call('goal', { type: 'goals', goals: ['continue project'] }).toolCalls!,
        { id: 'detail', name: 'query_tile', arguments: '{"x":1,"y":1}' },
      ],
      usage: { inputTokens: 999_999, outputTokens: 0 },
    }));
    const { runner, citizen, world, commands } = setup({ contextMode: 'legacy', mode: 'live', ledger, transport });
    citizen.queue.push({ type: 'move', x: 2, y: 2 });
    await runner.startTurn('a');
    expect(runner.records()[0]).toMatchObject({ status: 'yielded', stopReason: 'budget_tokens' });
    expect(runner.records()[0].error).toBeUndefined();
    expect(citizen.goals).toEqual(['continue project']);
    expect(citizen.queue).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(runner.budget()).toMatchObject({
      requests: 1,
      pending: 0,
      tokens: 999_999,
      blocked: { reason: 'tokens', remainingTokens: 1 },
    });
    const ledgerText = readFileSync(join(root, 'request-ledger.jsonl'), 'utf8');
    const settingsText = readFileSync(join(root, 'budget-settings.jsonl'), 'utf8');
    for (let i = 0; i < 100; i++) {
      world.tick++;
      runner.tick();
      await runner.startTurn('a');
    }
    expect(transport).toHaveBeenCalledTimes(1);
    expect(runner.records()).toHaveLength(1);
    expect(readFileSync(join(root, 'request-ledger.jsonl'), 'utf8')).toBe(ledgerText);
    expect(readFileSync(join(root, 'budget-settings.jsonl'), 'utf8')).toBe(settingsText);
  });
  it('resumes after an interrupted request receipt creates capacity without authorizing late tools', async () => {
    const pending = deferred<ProviderResponse>();
    const ledger = new RequestLedger({ directory: directory(), maxTokens: 200_000 });
    const { requestId } = ledger.reserve({
      runId: 'old',
      turnId: 'old',
      citizenId: 'old',
      inputTokens: 80_000,
      maxOutputTokens: 0,
    });
    ledger.settle(requestId);
    let sends = 0;
    const transport = vi.fn(() =>
      ++sends === 1
        ? pending.promise
        : Promise.resolve({ content: 'fresh', usage: { inputTokens: 1, outputTokens: 1 } }),
    );
    const { runner, commands } = setup({ contextMode: 'legacy', mode: 'live', ledger, transport });
    const done = runner.startTurn('a');
    await flush();
    // Derive capacity from the actual advertised schema instead of its previous byte size.
    const reserved = ledger.status().tokens - 80_000;
    expect(reserved).toBeGreaterThan(4);
    ledger.setLimits({ maxRequests: 100, maxTokens: 80_000 + reserved + Math.floor(reserved / 2) });
    runner.interrupt();
    await done;
    expect(runner.budget().blocked?.reason).toBe('tokens');
    await runner.startTurn('a');
    expect(transport).toHaveBeenCalledTimes(1);
    pending.resolve({
      ...call('late', { type: 'cancel' }),
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await flush();
    expect(commands).toEqual([]);
    expect(runner.budget().blocked).toBeUndefined();
    await runner.startTurn('a');
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not churn global blockage metadata for an unaffordable citizen while another fresh context fits', async () => {
    const root = directory();
    // Fits the ordinary context plus 40k output, but not the oversized citizen below.
    const ledger = new RequestLedger({ directory: root, maxTokens: 75_000 });
    const transport = vi.fn(async () => ({
      content: 'done',
      usage: { inputTokens: 5, outputTokens: 2 },
    }));
    const { runner, world, citizen } = setup({ contextMode: 'legacy', mode: 'live', ledger, transport });
    world.citizens.b = { ...structuredClone(citizen), id: 'b', nextReviewTick: 1000 };
    citizen.personality = 'long personality '.repeat(2000);
    expect(runner.budget().blocked).toBeUndefined();
    const settingsText = readFileSync(join(root, 'budget-settings.jsonl'), 'utf8');
    for (let i = 0; i < 100; i++) {
      world.tick++;
      runner.tick();
      await flush();
    }
    expect(transport).not.toHaveBeenCalled();
    expect(runner.records()).toEqual([]);
    expect(readFileSync(join(root, 'budget-settings.jsonl'), 'utf8')).toBe(settingsText);
    expect(readFileSync(join(root, 'request-ledger.jsonl'), 'utf8')).toBe('');
    world.tick = 1000;
    runner.tick();
    await flush();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(runner.records()[0].citizenId).toBe('b');
  });
  it('does not mistake a too-large continuation for an unaffordable fresh review', async () => {
    const cap = 100_000;
    const ledger = new RequestLedger({ directory: directory(), maxTokens: cap });
    let sends = 0;
    const transport = vi.fn(async (request: TransportRequest): Promise<ProviderResponse> => {
      sends++;
      if (sends === 1) {
        const initialSize =
          Buffer.byteLength(JSON.stringify(request.payload)) + request.payload.max_tokens;
        return {
          content: 'continuation detail '.repeat(200),
          toolCalls: [{ id: 'query', name: 'query_tile', arguments: '{"x":2,"y":1}' }],
          usage: { inputTokens: cap - initialSize - 100, outputTokens: 0 },
        };
      }
      return { content: 'fresh completion', usage: { inputTokens: 10, outputTokens: 2 } };
    });
    const { runner } = setup({ contextMode: 'legacy', mode: 'live', ledger, transport });
    await runner.startTurn('a');
    expect(runner.records()[0]).toMatchObject({ status: 'yielded', stopReason: 'budget_tokens' });
    expect(ledger.status().blocked?.reason).toBe('tokens');
    expect(runner.budget().blocked).toBeUndefined();
    await runner.startTurn('a');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(runner.records()[1].status).toBe('completed');
  });
  it('yields at the tool boundary instead of claiming all returned calls completed', async () => {
    const { runner, commands } = setup({
      contextMode: 'legacy', mode: 'recorded',
      maxToolsPerTurn: 1,
      recorded: [
        {
          citizenId: 'a',
          responses: [
            {
              toolCalls: [
                {
                  id: 'first',
                  name: 'command',
                  arguments: JSON.stringify({ type: 'goals', goals: ['continue'] }),
                },
                { id: 'second', name: 'command', arguments: JSON.stringify({ type: 'cancel' }) },
              ],
            },
          ],
        },
      ],
    });
    await runner.startTurn('a');
    expect(commands).toEqual([{ type: 'goals', goals: ['continue'] }]);
    expect(runner.records()[0]).toMatchObject({ status: 'yielded', stopReason: 'tool_limit' });
    expect(runner.records()[0].error).toBeUndefined();
    expect(runner.records()[0].toolEvents).toHaveLength(1);
  });
  it('completes at the exact tool cap without spending on an unnecessary acknowledgement', async () => {
    const transport = vi.fn(async () => call('goal', { type: 'goals', goals: ['continue'] }));
    const { runner, commands } = setup({ ...live(transport), maxToolsPerTurn: 1 });
    await runner.startTurn('a');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(commands).toHaveLength(1);
    expect(runner.records()[0]).toMatchObject({ status: 'completed' });
  });
  it('defaults to explicitly non-evaluative scripted travel/harvest', async () => {
    const { runner, commands } = setup();
    await runner.startTurn('a');
    expect(commands).toEqual([{ type: 'harvest', depositId: 'wood' }]);
    expect(runner.records()[0].notes.join(' ')).toContain('not an evaluation');
    expect(runner.budget().requests).toBe(0);
  });
  it('fresh contexts retain family and authoritative reproduction state', () => {
    const { observation, citizen } = setup();
    citizen.parents = ['parent-a', 'parent-b'];
    citizen.consent = { ally: 40 };
    citizen.reproductionCooldown = 80;
    const context = freshContext(observation);
    expect(JSON.parse(context[1].content!).ownState).toMatchObject({
      parents: citizen.parents,
      reproductionCooldown: 80,
    });
    expect(context[0].content).toContain('information is dated, not remote truth');
  });
  it('headless scripted turns travel to remembered deposits and then make physical progress through the knowledge gate', async () => {
    const { world, citizen } = setup();
    world.width = 12;
    world.deposits.remote = {
      id: 'remote',
      x: 9,
      y: 1,
      resource: 'wood',
      tier: 1,
      stock: 5,
      capacity: 5,
      regrowAt: 0,
    };
    citizen.x = 9;
    updateKnowledge(world);
    citizen.x = 1;
    updateKnowledge(world);
    const calls: { command: Command; ok: boolean }[] = [];
    const runner = new CitizenRunner({
      world: () => world,
      observe: (id) => observe(world, id),
      diagnostic: () => {},
      command: (id, command) => {
        const gate = validateKnownCommand(world, id, command);
        const result = gate.ok ? dispatch(world, id, command) : gate;
        calls.push({ command, ok: result.ok });
        return result;
      },
    });
    await runner.startTurn('a');
    expect(calls[0]).toEqual({ command: { type: 'move', x: 9, y: 1 }, ok: true });
    for (let tick = 0; tick < 60 && !(citizen.inventory['wood:1'] > 0); tick++) {
      tickWorld(world);
      updateKnowledge(world);
      await runner.startTurn('a');
    }
    expect(citizen.inventory['wood:1']).toBeGreaterThan(0);
    expect(calls.some((call) => call.command.type === 'harvest')).toBe(true);
    expect(calls.every((call) => call.ok)).toBe(true);
    expect(runner.records()[0].notes.join(' ')).toContain('not an evaluation');
  });
  it('scripted exploration expands persisted knowledge rather than bouncing explored corners', async () => {
    const { world, citizen } = setup();
    world.width = 14;
    world.height = 14;
    updateKnowledge(world);
    const initial = Object.keys(citizen.knowledge).length;
    const runner = new CitizenRunner({
      world: () => world,
      observe: (id) => observe(world, id),
      diagnostic: () => {},
      command: (id, command) => dispatch(world, id, command),
    });
    for (let tick = 0; tick < 80; tick++) {
      await runner.startTurn('a');
      tickWorld(world);
      updateKnowledge(world);
    }
    expect(Object.keys(citizen.knowledge).length).toBeGreaterThan(initial + 60);
    expect(citizen.alive).toBe(true);
  });
  it('scripted crafting with automatic tool use progresses without restarting existing work', async () => {
    const { runner, citizen, commands } = setup();
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    await runner.startTurn('a');
    expect(commands[0]).toEqual({ type: 'craft', item: 'knife', tier: 1 });
    citizen.inventory = { 'knife:1': 1, 'food:1': 3, 'fibre:1': 3 };
    await runner.startTurn('a');
    expect(commands[1]).toEqual({ type: 'craft', item: 'axe', tier: 1 });
    citizen.queue.push({ type: 'harvest', depositId: 'wood' });
    await runner.startTurn('a');
    expect(commands).toHaveLength(2);
  });
  it('allows one turn per citizen, host work continues, abort is fast and ignores late commands', async () => {
    const pending = deferred<ProviderResponse>();
    let request!: TransportRequest;
    const { runner, world, citizen, commands } = setup(
      live(async (value) => {
        request = value;
        return pending.promise;
      }),
    );
    const done = runner.startTurn('a');
    expect(runner.startTurn('a')).toBe(done);
    await flush();
    expect(request.signal.aborted).toBe(false);
    world.tick += 5; // host advances work while inference is unresolved
    citizen.lastResult = 'harvest completed by host';
    runner.interrupt('checkpoint');
    expect(runner.status().thinking).toEqual([]);
    expect(request.signal.aborted).toBe(true);
    await done; // resolves even though provider remains unresolved
    expect(world.tick).toBe(5);
    expect(citizen.lastResult).toContain('completed');
    expect(runner.budget().pending).toBe(1);
    pending.resolve({
      ...call('late', { type: 'message', text: 'too late' }),
      usage: { inputTokens: 20, outputTokens: 3 },
    });
    await flush();
    expect(commands).toEqual([]);
    expect(runner.budget().pending).toBe(0);
    expect(runner.budget().tokens).toBe(23);
    expect(runner.records()[0].status).toBe('interrupted');
  });
  it('deadlines free thinking slots even for noncooperative transport, retain charges and forbid late effects', async () => {
    vi.useFakeTimers();
    const pending = deferred<ProviderResponse>();
    const requests: TransportRequest[] = [];
    const { runner, citizen, world, commands } = setup({
      ...live((request) => {
        requests.push(request);
        return requests.length === 1
          ? pending.promise
          : Promise.resolve({ content: 'next review' });
      }),
      requestTimeoutMs: 25,
      maxConcurrent: 1,
    });
    citizen.queue.push({ type: 'move', x: 2, y: 2 });
    const done = runner.startTurn('a');
    await flush();
    world.tick += 3;
    const reserved = runner.budget().tokens;
    await vi.advanceTimersByTimeAsync(25);
    await done;
    expect(requests[0].signal.aborted).toBe(true);
    expect(runner.status().thinking).toEqual([]);
    expect(runner.records()[0]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('deadline exceeded'),
    });
    expect(runner.budget()).toMatchObject({ pending: 1, tokens: reserved });
    expect(citizen.queue).toHaveLength(1);
    expect(world.tick).toBe(3);
    world.tick = citizen.nextReviewTick;
    runner.tick();
    await flush();
    expect(requests).toHaveLength(2);
    pending.resolve({
      ...call('late', { type: 'cancel' }),
      usage: { inputTokens: 4, outputTokens: 2 },
    });
    await flush();
    expect(commands).toEqual([]);
    expect(runner.budget().pending).toBe(0);
    expect(runner.records()[0].status).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves committed effects and durable goals, with fresh contexts after interruption', async () => {
    const pending = deferred<ProviderResponse>();
    const requests: TransportRequest[] = [];
    const { runner, commands } = setup(
      live(async (request) => {
        requests.push(request);
        if (requests.length === 1)
          return {
            toolCalls: [
              ...call('goal', { type: 'goals', goals: ['travel to ally'] }).toolCalls!,
              { id: 'detail', name: 'query_tile', arguments: '{"x":1,"y":1}' },
            ],
          };
        if (requests.length === 2) return pending.promise;
        return { content: 'fresh turn' };
      }),
    );
    const first = runner.startTurn('a');
    await flush();
    expect(commands).toHaveLength(1);
    runner.interrupt();
    await first;
    await runner.startTurn('a');
    const fresh = requests[2].payload.messages;
    expect(fresh.map((message) => message.role)).toEqual(['system', 'user']);
    expect(fresh[1].content).toContain('travel to ally');
    expect(commands).toHaveLength(1);
    pending.resolve(call('late', { type: 'goals', goals: ['wrong'] }));
    await flush();
    expect(commands).toHaveLength(1);
  });
  it('rechecks run and death before applying a response even without explicit abort', async () => {
    const pending = deferred<ProviderResponse>();
    const { runner, world, commands } = setup(live(() => pending.promise));
    const done = runner.startTurn('a');
    await flush();
    world.runId = 'restored';
    pending.resolve(call('stale', { type: 'cancel' }));
    await done;
    expect(commands).toHaveLength(0);
    expect(runner.records()[0].status).toBe('interrupted');
  });
  it('validates malformed tools, reports actionable errors, and rejects duplicate committed IDs', async () => {
    const requests: TransportRequest[] = [];
    const responses: ProviderResponse[] = [
      {
        toolCalls: [
          { id: 'bad', name: 'command', arguments: '{nope' },
          { id: 'coord', name: 'command', arguments: '{"type":"move","x":-1,"y":0}' },
        ],
      },
      {
        toolCalls: [
          ...call('once', { type: 'remember', text: 'friend' }).toolCalls!,
          { id: 'detail', name: 'query_tile', arguments: '{"x":1,"y":1}' },
        ],
      },
      call('once', { type: 'remember', text: 'friend' }),
      { content: 'done' },
    ];
    const { runner, commands } = setup(
      live(async (request) => {
        requests.push(request);
        return responses.shift()!;
      }),
    );
    await runner.startTurn('a');
    expect(commands).toHaveLength(1);
    expect(
      requests[1].payload.messages
        .filter((message) => message.role === 'tool')
        .map((message) => message.content)
        .join(' '),
    ).toContain('schema');
    expect(runner.records()[0].toolEvents.at(-1)?.result).toMatchObject({ code: 'duplicate_call' });
    expect(runner.records()[0].status).toBe('completed');
  });
  it('query_tile never supplies omniscient hidden state', async () => {
    const { runner, world } = setup({
      contextMode: 'legacy', mode: 'recorded',
      recorded: [
        {
          citizenId: 'a',
          responses: [
            { toolCalls: [{ id: 'q', name: 'query_tile', arguments: '{"x":7,"y":7}' }] },
            {},
          ],
        },
      ],
    });
    world.deposits.secret = {
      id: 'secret',
      x: 7,
      y: 7,
      resource: 'food',
      tier: 3,
      stock: 999,
      capacity: 999,
      regrowAt: 0,
    };
    await runner.startTurn('a');
    expect(runner.records()[0].toolEvents[0].result).toMatchObject({ source: 'unknown' });
    expect(runner.records()[0].observation).not.toContain('secret');
  });
  it('recorded mode requires imported fixtures and never falls back', async () => {
    expect(() => setup({ mode: 'recorded' })).toThrow('explicitly imported');
    const transport = vi.fn();
    const { runner } = setup({ contextMode: 'legacy', mode: 'recorded', recorded: [], transport });
    await runner.startTurn('a');
    expect(runner.records()[0].error).toContain('no live fallback');
    expect(transport).not.toHaveBeenCalled();
  });
  it('provider failure preserves physical work and charges conservative reservation', async () => {
    const { runner, citizen } = setup(
      live(async () => {
        throw new Error('secret provider credential must not log');
      }),
    );
    citizen.queue.push({ type: 'move', x: 2, y: 2 });
    await runner.startTurn('a');
    expect(citizen.queue).toHaveLength(1);
    expect(runner.records()[0].status).toBe('error');
    expect(runner.records()[0].error).not.toContain('secret');
    expect(runner.budget().tokens).toBeGreaterThan(0);
    expect(runner.budget().pending).toBe(0);
  });
  it('reserves before send and corrupt accounting stops spending', async () => {
    const path = directory();
    const ledger = new RequestLedger({ directory: path, maxTokens: 1_000_000 });
    const transport = vi.fn(async () => {
      expect(ledger.status().pending).toBe(1);
      return {};
    });
    const { runner } = setup({ contextMode: 'legacy', mode: 'live', ledger, transport });
    await runner.startTurn('a');
    expect(transport).toHaveBeenCalledTimes(1);
    writeFileSync(join(path, 'request-ledger.jsonl'), 'corrupt\n');
    await runner.startTurn('a');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(runner.status().error).toBeTruthy();
  });
  it('bounds requests/tools/records and returns immutable inspector snapshots', async () => {
    const recorded = Array.from({ length: 5 }, () => ({
      citizenId: 'a',
      responses: [
        {
          toolCalls: [
            ...call('one', { type: 'message', text: 'hello' }).toolCalls!,
            { id: 'detail', name: 'query_tile', arguments: '{"x":1,"y":1}' },
          ],
        },
      ],
    }));
    const { runner } = setup({ contextMode: 'legacy', mode: 'recorded', recorded, maxRequestsPerTurn: 1, maxRecords: 2 });
    for (let i = 0; i < 5; i++) await runner.startTurn('a');
    expect(runner.records().length).toBe(2);
    expect(runner.records().at(-1)).toMatchObject({
      status: 'yielded',
      stopReason: 'request_limit',
    });
    expect(runner.records().at(-1)?.error).toBeUndefined();
    const copy = runner.records();
    copy[0].calls.length = 0;
    expect(runner.records()[0].calls).toHaveLength(1);
  });
  it('tick uses persisted scheduling, setMode invalidates but keeps physical queue', async () => {
    const pending = deferred<ProviderResponse>();
    const { runner, citizen, world } = setup(live(() => pending.promise));
    runner.tick();
    await flush();
    expect(citizen.nextReviewTick).toBe(12);
    citizen.queue.push({ type: 'move', x: 2, y: 2 });
    runner.setMode('scripted');
    expect(runner.status().generation).toBe(1);
    expect(citizen.nextReviewTick).toBe(world.tick);
    runner.tick();
    await flush();
    expect(citizen.queue).toHaveLength(1);
    expect(runner.records().at(-1)?.mode).toBe('scripted');
  });
  it('uses requested local Ollama model/low reasoning, excludes hidden reasoning', async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'visible', reasoning_content: 'hidden secret', tool_calls: [] },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 3 },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const { runner } = setup(live(ollamaTransport));
    await runner.startTurn('a');
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const payload = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(payload).toMatchObject({
      model: 'deepseek-v4.1-flash:cloud',
      reasoning_effort: 'low',
      stream: false,
    });
    expect(JSON.stringify(runner.records())).not.toContain('hidden secret');
    expect(runner.budget().tokens).toBe(11);
  });
});
