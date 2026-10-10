import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner } from '../src/citizen/runner.ts';
import type { ProviderResponse, TransportRequest } from '../src/citizen/provider.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';
import { reviewReason, reviewState } from '../src/citizen/planning.ts';
import { freshContext } from '../src/citizen/prompt.ts';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const strategy = {
  mode: 'replace',
  directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[0, 0, 4, 4]] }],
  reviewAfter: 900,
};
const call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});
function setup(
  answer: (
    request: TransportRequest,
    index: number,
  ) => ProviderResponse | Promise<ProviderResponse>,
) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-directive-runner-'));
  directories.push(directory);
  const world = createWorld({ seed: 42 });
  const citizen = Object.values(world.citizens)[0];
  for (const other of Object.values(world.citizens)) other.nextReviewTick = 10000;
  citizen.x = 1;
  citizen.y = 1;
  citizen.inventory = { 'food:1': 20, 'wood:1': 3, 'fibre:1': 3 };
  citizen.knowledge = {};
  world.deposits = {
    tree: { id: 'tree', resource: 'wood', tier: 1, x: 1, y: 1, stock: 1, capacity: 1, regrowAt: 0 },
  };
  updateKnowledge(world);
  const requests: TransportRequest[] = [];
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => observe(world, id),
      command: (id, command) => {
        const gate = validateKnownCommand(world, id, command);
        const result = gate.ok ? dispatch(world, id, command) : gate;
        updateKnowledge(world);
        return result;
      },
      diagnostic: () => {},
    },
    {
      contextMode: 'legacy', mode: 'live',
      transport: async (request) => {
        requests.push(request);
        return answer(request, requests.length);
      },
      ledgerOptions: { directory, maxRequests: 20, maxTokens: 1000000 },
    },
  );
  return { world, citizen, runner, requests };
}

describe('single-response citizen strategies', () => {
  it('commits work, notes and communications in one low-effort response', async () => {
    const { citizen, runner, requests, world } = setup(() => ({
      toolCalls: [
        call('decision', 'set_strategy', {
          ...strategy,
          memory: 'Control this grove.',
          communications: [{ text: 'I can sell wood.' }],
        }),
        call('note', 'command', { type: 'remember', text: 'Seek an ally later.' }),
      ],
    }));
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.reasoning_effort).toBe('low');
    expect(JSON.parse(requests[0].payload.messages[1].content!).currentWorld.mapSize).toMatchObject({
      width: world.width,
      height: world.height,
    });
    expect(requests[0].payload.max_tokens).toBe(40000);
    expect(
      requests[0].payload.tools.map(
        (tool) => (tool as { function: { name: string } }).function.name,
      ),
    ).toEqual(['set_strategy', 'command', 'query_tile']);
    expect(citizen.strategy?.directives).toMatchObject(strategy.directives);
    expect(citizen.memories.map((note) => note.text)).toContain('Control this grove.');
    expect(citizen.memories.at(-1)?.text).toBe('Seek an ally later.');
    expect(world.messages.at(-1)?.text).toBe('I can sell wood.');
    const identities = runner.records()[0].commandIdentities.map((identity) => identity.commandId);
    expect(new Set(identities).size).toBe(identities.length);
    expect(identities.filter((identity) => identity.includes(':decision:metadata:'))).toHaveLength(
      2,
    );
    expect(runner.records()[0].status).toBe('completed');
  });

  it('keep retains active physical work and its reserved inputs', async () => {
    const { citizen, runner, world, requests } = setup(() => ({
      toolCalls: [
        call('keep', 'set_strategy', {
          mode: 'keep',
          reviewAfter: 800,
          memory: 'Continue the knife.',
        }),
      ],
    }));
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    const before = structuredClone(citizen.action);
    await runner.startTurn(citizen.id);
    expect(citizen.action).toEqual(before);
    expect(requests).toHaveLength(1);
  });

  it('does not force a strategy or another request after ordinary social calls', async () => {
    const { citizen, runner, requests } = setup(() => ({
      toolCalls: [call('message', 'command', { type: 'message', text: 'Who wants to trade?' })],
    }));
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.strategy).toBeUndefined();
    expect(runner.records()[0].status).toBe('completed');
  });

  it.each([
    { mode: 'keep', reviewAfter: 600 },
    { mode: 'replace', directives: [], reviewAfter: 600 },
  ])('respects an intentionally empty decision until its chosen review: %j', async (decision) => {
    const { citizen, runner, requests, world } = setup(() => ({
      toolCalls: [call('idle', 'set_strategy', decision)],
    }));
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    const reviewTick = citizen.strategy!.reviewTick;
    tickWorld(world, 12);
    runner.tick();
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    expect(reviewReason(world, citizen)).toBeUndefined();
    tickWorld(world, reviewTick - world.tick - 1);
    runner.tick();
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    tickWorld(world);
    runner.tick();
    await runner.startTurn(citizen.id); // Join the scheduled review rather than creating another.
    expect(requests).toHaveLength(2);
  });

  it('ordinary notes mentioning emergency do not invalidate a decision in the same response', async () => {
    const { citizen, runner, requests } = setup(() => ({
      toolCalls: [
        call('note', 'command', {
          type: 'remember',
          text: 'Avoid emergency mistakes and protect my grove.',
        }),
        call('decision', 'set_strategy', strategy),
      ],
    }));
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.strategy?.directives).toMatchObject(strategy.directives);
    expect(runner.records()[0].toolEvents.at(-1)?.result).toMatchObject({ ok: true });
  });

  it('ongoing routines and keep-idle do not trigger empty-queue reviews', async () => {
    const { citizen, runner, world } = setup(() => ({
      toolCalls: [call('decision', 'set_strategy', strategy)],
    }));
    await runner.startTurn(citizen.id);
    citizen.action = null;
    citizen.queue = [];
    citizen.review = reviewState(world, citizen);
    expect(reviewReason(world, citizen)).toBeUndefined();
    world.tick = 120;
    expect(reviewReason(world, citizen)).toBeUndefined();
    if (citizen.strategy) {
      citizen.strategy.status = 'completed';
      expect(reviewReason(world, citizen)).toContain('completed');
      citizen.review = reviewState(world, citizen);
      world.tick = citizen.strategy.reviewTick - 1;
      expect(reviewReason(world, citizen)).toBeUndefined();
      world.tick++;
      expect(reviewReason(world, citizen)).toContain('citizen-selected');
    }
  });

  it('successful emergency receipts alone do not wake ongoing work after food risk is acknowledged', async () => {
    const { citizen, runner, world } = setup(() => ({
      toolCalls: [call('decision', 'set_strategy', strategy)],
    }));
    await runner.startTurn(citizen.id);
    citizen.fullness = 0;
    citizen.inventory = {};
    citizen.review = reviewState(world, citizen); // Current danger already received a review.
    for (const text of [
      'Emergency feeding started.',
      'Emergency feeding completed.',
      'Emergency feeding resumed the interrupted directive.',
    ]) {
      world.events.push({
        id: `event-${world.nextId++}`,
        tick: world.tick,
        kind: 'emergency',
        citizenId: citizen.id,
        audience: [citizen.id],
        text,
      });
    }
    expect(reviewReason(world, citizen)).toBeUndefined();
    world.events.push({
      id: `event-${world.nextId++}`,
      tick: world.tick,
      kind: 'error',
      citizenId: citizen.id,
      audience: [citizen.id],
      text: 'Emergency feeding could not resume interrupted work.',
    });
    expect(reviewReason(world, citizen)).toBe('personal error alert');
  });

  it('rejects in-flight consequential decisions with fresh emergency evidence, preserving notes', async () => {
    const { citizen, runner, world, requests } = setup((request, index) => {
      if (index === 1) {
        tickWorld(world, 1);
        const id = `event-${world.nextId++}`;
        world.events.push({
          id,
          tick: world.tick,
          kind: 'emergency',
          citizenId: citizen.id,
          audience: [citizen.id],
          text: 'Emergency feeding resumed the interrupted knife.',
        });
        citizen.memories.push({
          tick: world.tick,
          text: `Emergency feeding at tick ${world.tick}: completed; resumed the interrupted knife.`,
        });
        return {
          toolCalls: [
            call('replace', 'set_strategy', strategy),
            call('note', 'command', { type: 'remember', text: 'I heard the warning.' }),
          ],
        };
      }
      const feedback = request.payload.messages
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.parse(message.content!));
      expect(feedback[0]).toMatchObject({
        ok: false,
        code: 'emergency_state_changed',
        observationRefresh: 'next-request',
      });
      expect(citizen.strategy).toBeUndefined();
      return {
        toolCalls: [call('reconsider', 'set_strategy', { mode: 'keep', reviewAfter: 800 })],
      };
    });
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    const id = citizen.action!.id;
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    expect(citizen.action?.id).toBe(id);
    expect(citizen.memories.map((note) => note.text)).toContain('I heard the warning.');
  });

  it('blocks physical and market changes until one fresh response, while allowing an acknowledgement', async () => {
    const { citizen, runner, world, requests } = setup((request, index) => {
      if (index === 1) {
        world.events.push({
          id: `event-${world.nextId++}`,
          tick: world.tick,
          kind: 'emergency',
          citizenId: citizen.id,
          audience: [citizen.id],
          text: 'Emergency feeding completed during reasoning.',
        });
        return {
          toolCalls: [
            call('stale-move', 'command', { type: 'move', x: 2, y: 1 }),
            call('stale-sale', 'command', {
              type: 'order',
              side: 'sell',
              item: 'food:1',
              quantity: 1,
              price: 3,
            }),
            call('ack', 'command', { type: 'remember', text: 'Reconsider after feeding.' }),
          ],
        };
      }
      expect(citizen.action).toBeNull();
      expect(Object.keys(world.orders)).toHaveLength(0);
      const feedback = request.payload.messages
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.parse(message.content!));
      expect(feedback.slice(0, 2)).toEqual([
        expect.objectContaining({
          code: 'emergency_state_changed',
          observationRefresh: 'next-request',
        }),
        expect.objectContaining({
          code: 'emergency_state_changed',
          observationRefresh: 'next-request',
        }),
      ]);
      return {
        toolCalls: [
          call('fresh-move', 'command', { type: 'move', x: 2, y: 1 }),
          call('fresh-sale', 'command', {
            type: 'order',
            side: 'sell',
            item: 'food:1',
            quantity: 1,
            price: 3,
          }),
        ],
      };
    });
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    expect(citizen.action?.command.type).toBe('move');
    expect(Object.keys(world.orders)).toHaveLength(1);
    expect(citizen.memories.at(-1)?.text).toBe('Reconsider after feeding.');
    expect(runner.records()[0].status).toBe('completed');
  });

  it("ignores another citizen's emergency when committing unaffected work", async () => {
    const { citizen, runner, world, requests } = setup(() => {
      const other = Object.values(world.citizens).find((other) => other.id !== citizen.id)!;
      world.events.push({
        id: `event-${world.nextId++}`,
        tick: world.tick,
        kind: 'emergency',
        citizenId: other.id,
        audience: [other.id],
        text: 'Another citizen ate.',
      });
      return { toolCalls: [call('decision', 'set_strategy', strategy)] };
    });
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.strategy?.directives).toMatchObject(strategy.directives);
  });

  it('accepts legacy draft/approval calls without advertising that pipeline', async () => {
    const { citizen, runner, requests } = setup((request, index) => {
      if (index === 1)
        return {
          toolCalls: [
            call('draft', 'draft_plan', { mode: 'append', steps: [{ type: 'wait', ticks: 4 }] }),
          ],
        };
      const draft = JSON.parse(
        request.payload.messages.filter((message) => message.role === 'tool').at(-1)!.content!,
      );
      return { toolCalls: [call('approve', 'approve_plan', { draftId: draft.draftId })] };
    });
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    expect(runner.records()[0].status).toBe('completed');
    expect(runner.records()[0].toolEvents.at(-1)?.result).toMatchObject({ ok: true });
    expect(requests[0].payload.tools).not.toContainEqual(
      expect.objectContaining({ function: expect.objectContaining({ name: 'draft_plan' }) }),
    );
  });

  it('durable emergency notes survive aged events and context omits executor attempted arrays', async () => {
    const { citizen, runner, world, requests } = setup((_, index) => {
      if (index === 1) {
        world.events = [];
        citizen.memories.push({
          tick: world.tick,
          text: `Emergency feeding at tick ${world.tick}: began and completed while you reasoned.`,
        });
        return { toolCalls: [call('replace', 'set_strategy', strategy)] };
      }
      return { content: 'I will keep the current work.' };
    });
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    expect(runner.records()[0].toolEvents[0].result).toMatchObject({
      code: 'emergency_state_changed',
    });
    const context = JSON.parse(freshContext(observe(world, citizen.id))[1].content!);
    expect(context.execution.emergencyEvidence.notes[0].text).toContain('Emergency feeding');
    expect(JSON.stringify(context.execution)).not.toContain('attempted');
  });
});
