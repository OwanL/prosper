import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner } from '../src/citizen/runner.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { BALANCE } from '../src/world/config.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import type { TransportRequest } from '../src/citizen/provider.ts';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-emergency-recovery-'));
  dirs.push(directory);
  const world = createWorld({ seed: 42 });
  const citizen = Object.values(world.citizens)[0];
  citizen.inventory = { 'food:1': 20 };
  updateKnowledge(world);
  return { directory, world, citizen };
}

it('keeps a multi-call emergency correction below 128KB with one fresh primary observation', async () => {
  const { directory, world, citizen } = fixture();
  world.messages = Array.from({ length: 90 }, (_, i) => ({
    id: `message-test-${i}`,
    tick: 0,
    from: citizen.id,
    text: 'Public context. '.repeat(30),
  }));
  const requests: TransportRequest[] = [];
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
        if (requests.length === 1) {
          world.tick = 1;
          citizen.fullness = 88;
          world.events.push({
            id: `event-${world.nextId++}`,
            tick: 1,
            kind: 'emergency',
            citizenId: citizen.id,
            audience: [citizen.id],
            text: 'Emergency feeding completed.',
          });
          return {
            toolCalls: [
              call('stale-move', 'command', { type: 'move', x: 1, y: 1 }),
              call('stale-order', 'command', {
                type: 'order',
                side: 'buy',
                item: 'food:1',
                quantity: 1,
                price: 1,
              }),
              call('stale-work', 'set_strategy', {
                mode: 'replace',
                directives: [{ type: 'gather', resource: 'food', tier: 1, areas: [[0, 0, 3, 3]] }],
              }),
            ],
          };
        }
        const context = JSON.parse(request.payload.messages[1].content!);
        expect(context.currentWorld.tick).toBe(1);
        expect(context.ownState.fullness).toBe(88);
        for (const message of request.payload.messages.filter((m) => m.role === 'tool')) {
          const feedback = JSON.parse(message.content!);
          expect(feedback).toMatchObject({
            code: 'emergency_state_changed',
            observationRefresh: 'next-request',
          });
          expect(feedback).not.toHaveProperty('freshContext');
        }
        expect(Object.keys(world.orders)).toHaveLength(0);
        return { toolCalls: [call('fresh', 'set_strategy', { mode: 'keep' })] };
      },
    },
  );
  await runner.startTurn(citizen.id);
  expect(requests).toHaveLength(2);
  expect(Buffer.byteLength(JSON.stringify(requests[0].payload))).toBeGreaterThan(50000);
  expect(Buffer.byteLength(JSON.stringify(requests[1].payload))).toBeLessThan(128000);
  expect(runner.records()[0].status).toBe('completed');
  expect(runner.budget().requests).toBe(2);
});

it('commits food-first work with an oversized optional note in one request', async () => {
  const { directory, world, citizen } = fixture();
  citizen.fullness = 0;
  citizen.health = 72;
  citizen.inventory = {};
  world.deposits = {
    meal: {
      id: 'meal',
      resource: 'food',
      tier: 1,
      x: citizen.x,
      y: citizen.y,
      stock: 4,
      capacity: 4,
      regrowAt: 0,
    },
  };
  updateKnowledge(world);
  const memory = 'Food is my immediate priority. '.repeat(40);
  const directives = [
    {
      type: 'gather',
      resource: 'food',
      tier: 1,
      quantity: 4,
      areas: [[citizen.x, citizen.y, citizen.x, citizen.y]],
    },
  ];
  const requests: TransportRequest[] = [];
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
        return {
          toolCalls: [call('feed', 'set_strategy', { mode: 'replace', directives, memory })],
        };
      },
    },
  );
  await runner.startTurn(citizen.id);
  expect(requests).toHaveLength(1);
  expect(runner.records()[0].status).toBe('completed');
  expect(JSON.parse(runner.records()[0].toolEvents[0].arguments).memory).toBe(memory);
  expect(citizen.memories.at(-1)?.text).toHaveLength(600);
  expect(citizen.memories.at(-1)?.text.endsWith('[trimmed]')).toBe(true);
  expect(citizen.strategy?.directives).toEqual(directives);
  tickWorld(world, BALANCE.harvestTicks + 1);
  expect(citizen.fullness).toBeGreaterThan(0);
  expect(citizen.alive).toBe(true);
});

it('admits the most endangered hungry citizen ahead of a less endangered idle citizen', async () => {
  const { directory, world, citizen } = fixture();
  const other = Object.values(world.citizens).find((c) => c.id !== citizen.id)!;
  for (const c of Object.values(world.citizens)) c.nextReviewTick = 10000;
  citizen.nextReviewTick = other.nextReviewTick = 0;
  citizen.fullness = other.fullness = 0;
  citizen.inventory = other.inventory = {};
  citizen.health = 10;
  other.health = 80;
  citizen.strategy = {
    id: 'ongoing',
    approvedTick: 0,
    directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[0, 0, 3, 3]] }],
    index: 0,
    status: 'active',
    reviewTick: 600,
    progress: 0,
    lastProgressTick: 0,
    attempted: [],
  };
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => observe(world, id),
      command: (id, command) => dispatch(world, id, command),
      diagnostic: () => {},
    },
    {
      contextMode: 'legacy', mode: 'live',
      maxConcurrent: 1,
      ledgerOptions: { directory, maxRequests: 2, maxTokens: 1000000 },
      transport: () => new Promise(() => {}),
    },
  );
  runner.tick();
  expect(runner.status().thinking).toEqual([citizen.id]);
  runner.interrupt('test cleanup');
  await Promise.resolve();
});
