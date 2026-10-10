import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner } from '../src/citizen/runner.ts';
import type { ProviderResponse, TransportRequest } from '../src/citizen/provider.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});
it.each(['invalid', 'query'])(
  'refreshes an existing %s continuation without replaying effects',
  async (reason) => {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-freshness-'));
    directories.push(directory);
    const world = createWorld({ seed: 42 });
    const citizen = Object.values(world.citizens)[0];
    citizen.x = 1;
    citizen.y = 1;
    citizen.inventory = { 'food:1': 20 };
    citizen.knowledge = {};
    world.deposits = {
      tree: {
        id: 'tree',
        resource: 'wood',
        tier: 1,
        x: 1,
        y: 1,
        stock: 1,
        capacity: 1,
        regrowAt: 0,
      },
    };
    updateKnowledge(world);
    expect(dispatch(world, citizen.id, { type: 'harvest', depositId: 'tree' }).ok).toBe(true);
    const requests: TransportRequest[] = [];
    let initialReview: string | undefined;
    const runner = new CitizenRunner(
      {
        world: () => world,
        observe: (id) => observe(world, id),
        command: (id, command) => dispatch(world, id, command),
        diagnostic: () => {},
      },
      {
        contextMode: 'legacy', mode: 'live',
        ledgerOptions: { directory, maxRequests: 2, maxTokens: 1000000 },
        transport: async (request) => {
          requests.push(request);
          request.onTiming?.({ headerWaitMs: 12, bodyReadMs: 3, parseMs: 1 });
          if (requests.length === 1) {
            initialReview = JSON.stringify(citizen.review);
            tickWorld(world, 50);
            updateKnowledge(world);
            return {
              toolCalls: [
                call('note', 'command', { type: 'remember', text: 'One committed note.' }),
                reason === 'invalid'
                  ? call('bad', 'set_strategy', {
                      mode: 'replace',
                      directives: [{ type: 'gather' }],
                    })
                  : call('query', 'query_tile', { x: 1, y: 1 }),
              ],
            };
          }
          return {
            toolCalls: [
              call('note', 'command', { type: 'remember', text: 'One committed note.' }),
              call('keep', 'set_strategy', { mode: 'keep' }),
            ],
          };
        },
      },
    );
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    const first = JSON.parse(requests[0].payload.messages[1].content!);
    const second = JSON.parse(requests[1].payload.messages[1].content!);
    expect(first.currentWorld.tick).toBe(0);
    expect(first.ownState.inventory['wood:1'] ?? 0).toBe(0);
    expect(second.currentWorld.tick).toBe(50);
    expect(second.ownState.inventory['wood:1']).toBeGreaterThan(0);
    expect(second.execution.action).toBeNull();
    expect(
      second.personalityMemoriesGoals.memories.some(
        (n: { text: string }) => n.text === 'One committed note.',
      ),
    ).toBe(true);
    expect(requests[1].payload.messages.slice(2).map((m) => m.role)).toEqual([
      'assistant',
      'tool',
      'tool',
    ]);
    expect(requests[1].payload.messages[3].tool_call_id).toBe('note');
    expect(citizen.memories.filter((n) => n.text === 'One committed note.')).toHaveLength(1);
    expect(
      runner.records()[0].requests.map((r) => (r as { observationTick?: number }).observationTick),
    ).toEqual([0, 50]);
    const originalReview = JSON.parse(initialReview!);
    expect(citizen.review?.eventSequence).toBe(originalReview.eventSequence);
    expect(citizen.review?.foodRisk).toBe(originalReview.foodRisk);
    expect(runner.records()[0].status).toBe('completed');
    expect(runner.budget().requests).toBe(2);
    for (const record of runner.records()[0].requests) {
      expect(record.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(record.transportTiming).toEqual({ headerWaitMs: 12, bodyReadMs: 3, parseMs: 1 });
    }
    for (const request of requests) {
      expect(request.payload.reasoning_effort).toBe('low');
      expect(request.payload.max_tokens).toBe(40000);
      expect(request.payload.model).toBe('deepseek-v4.1-flash:cloud');
    }
  },
);
it('late timing has no mutation authority while late usage still settles', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-late-timing-'));
  directories.push(directory);
  const world = createWorld({ seed: 42 });
  const citizen = Object.values(world.citizens)[0];
  let sent!: TransportRequest;
  let resolve!: (response: ProviderResponse) => void;
  const response = new Promise<ProviderResponse>((done) => {
    resolve = done;
  });
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => observe(world, id),
      command: (id, command) => dispatch(world, id, command),
      diagnostic: () => {},
    },
    {
      contextMode: 'legacy', mode: 'live',
      ledgerOptions: { directory, maxRequests: 2, maxTokens: 1000000 },
      transport: async (request) => {
        sent = request;
        return response;
      },
    },
  );
  const turn = runner.startTurn(citizen.id);
  for (let i = 0; i < 20 && !sent; i++) await Promise.resolve();
  expect(sent).toBeDefined();
  runner.interrupt('test interruption');
  await turn;
  expect(runner.budget().pending).toBe(1);
  sent.onTiming?.({ headerWaitMs: 123 });
  resolve({
    toolCalls: [call('late', 'command', { type: 'remember', text: 'Must not commit.' })],
    usage: { inputTokens: 2, outputTokens: 3 },
  });
  await new Promise<void>((done) => setImmediate(done));
  expect(runner.budget().pending).toBe(0);
  expect(runner.budget().tokens).toBe(5);
  expect(runner.records()[0].requests[0].transportTiming).toBeUndefined();
  expect(runner.records()[0].status).toBe('interrupted');
  expect(citizen.memories.some((note) => note.text === 'Must not commit.')).toBe(false);
});
