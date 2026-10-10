import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner } from '../src/citizen/runner.ts';
import type { ProviderResponse, TransportRequest } from '../src/citizen/provider.ts';
import { createWorld, dispatch, tickWorld, cancelAction } from '../src/world/core.ts';
import { approvePlan } from '../src/world/plans.ts';
import { reviewState } from '../src/citizen/planning.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';
import { BALANCE } from '../src/world/config.ts';

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const call = (id: string, name: string, args: unknown): ProviderResponse => ({
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 10, outputTokens: 10 },
});
const spec = {
  mode: 'append',
  steps: [{ type: 'gather', resource: 'wood', tier: 1, targetQuantity: 3, maxTicks: 400 }],
};
function draftId(request: TransportRequest): string {
  const result = JSON.parse(
    request.payload.messages.filter((m) => m.role === 'tool').at(-1)!.content!,
  );
  return result.draftId;
}
function setup(
  transport: (
    request: TransportRequest,
    index: number,
  ) => Promise<ProviderResponse> | ProviderResponse,
  maxRequestsPerTurn = 4,
) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-plan-runner-'));
  directories.push(directory);
  const world = createWorld({ seed: 42 });
  const citizen = Object.values(world.citizens)[0];
  for (const c of Object.values(world.citizens)) c.nextReviewTick = 10000;
  citizen.nextReviewTick = 0;
  citizen.x = 1;
  citizen.y = 1;
  citizen.inventory = { 'food:1': 8, 'fibre:1': 3 };
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
      maxRequestsPerTurn,
      transport: async (request) => {
        requests.push(request);
        return transport(request, requests.length);
      },
      ledgerOptions: { directory, maxRequests: 100, maxTokens: 1000000 },
    },
  );
  return { world, citizen, runner, requests };
}

describe('fresh-turn draft/revise/approve lifecycle', () => {
  it('drafts an entire batch without changing existing work, resources or durable plans', async () => {
    const { world, citizen, runner, requests } = setup((_, index) =>
      index === 1
        ? call('draft', 'draft_plan', { ...spec, mode: 'replace' })
        : { content: 'I have not approved it.' },
    );
    citizen.inventory['wood:1'] = 3;
    dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 });
    const before = structuredClone(citizen);
    await runner.startTurn(citizen.id);
    expect(citizen.action).toEqual(before.action);
    expect(citizen.inventory).toEqual(before.inventory);
    expect(citizen.plan).toBeUndefined();
    const feedback = JSON.parse(requests[1].payload.messages.at(-1)!.content!);
    expect(feedback).toMatchObject({
      ok: true,
      draftId: expect.any(String),
      forecast: {
        steps: [
          expect.objectContaining({ state: expect.any(Object), duration: expect.any(Object) }),
        ],
      },
    });
  });

  it('approves in two calls, updates notes in the same response and ends without a third acknowledgement', async () => {
    const { world, citizen, runner, requests } = setup((request, index) => {
      if (index === 1) return call('draft', 'draft_plan', spec);
      if (index === 2)
        return {
          toolCalls: [
            {
              id: 'approve',
              name: 'approve_plan',
              arguments: JSON.stringify({ draftId: draftId(request) }),
            },
            {
              id: 'note',
              name: 'command',
              arguments: JSON.stringify({ type: 'remember', text: 'Gather wood, then reassess.' }),
            },
          ],
        };
      throw new Error('Approval should have ended the turn.');
    });
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    expect(runner.records()[0].status).toBe('completed');
    expect(citizen.plan?.steps).toHaveLength(1);
    expect(citizen.memories.at(-1)?.text).toBe('Gather wood, then reassess.');
    for (let i = 0; i < 500 && citizen.plan; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }
    expect(citizen.inventory['wood:1']).toBe(3);
    expect(requests).toHaveLength(2);
    // Fresh turn gets durable receipts, not the old conversation or draft IDs.
    const fresh = new CitizenRunner(
      {
        world: () => world,
        observe: (id) => observe(world, id),
        command: (id, cmd) => dispatch(world, id, cmd),
        diagnostic: () => {},
      },
      {
        contextMode: 'legacy', mode: 'recorded',
        recorded: [{ citizenId: citizen.id, responses: [{ content: 'New review.' }] }],
      },
    );
    await fresh.startTurn(citizen.id);
    const messages = fresh.records()[0].requests[0].payload.messages;
    expect(messages).toHaveLength(2);
    const context = JSON.parse(messages[1].content!);
    expect(context.execution.planReceipts[0].outcome).toBe('completed');
    expect(JSON.stringify(messages)).not.toContain(
      JSON.parse(requests[1].payload.messages.at(-1)!.content!).draftId,
    );
  });

  it('whole-list revision invalidates old draft IDs and commits only the latest steps', async () => {
    let firstId = '';
    const { citizen, runner } = setup((request, index) => {
      if (index === 1) return call('draft1', 'draft_plan', spec);
      if (index === 2) {
        firstId = draftId(request);
        return call('draft2', 'draft_plan', {
          mode: 'append',
          steps: [{ type: 'wait', ticks: 4 }],
        });
      }
      if (index === 3)
        return {
          toolCalls: [
            { id: 'old', name: 'approve_plan', arguments: JSON.stringify({ draftId: firstId }) },
            {
              id: 'new',
              name: 'approve_plan',
              arguments: JSON.stringify({ draftId: draftId(request) }),
            },
          ],
        };
      throw new Error('No fourth request.');
    });
    await runner.startTurn(citizen.id);
    expect(citizen.plan?.steps).toEqual([{ type: 'wait', ticks: 4, onFailure: 'review' }]);
    expect(runner.records()[0].toolEvents.find((e) => e.id === 'old')?.result).toMatchObject({
      ok: false,
      code: 'invalid_tool',
    });
  });

  it('revalidates knowledge at approval without cancelling work on rejected approval', async () => {
    const { world, citizen, runner } = setup((request, index) => {
      if (index === 1)
        return call('draft', 'draft_plan', {
          mode: 'replace',
          steps: [{ type: 'command', command: { type: 'harvest', depositId: 'tree' } }],
        });
      if (index === 2) {
        world.deposits = {};
        citizen.knowledge = {};
        return call('approve', 'approve_plan', { draftId: draftId(request) });
      }
      return { content: 'Need another decision.' };
    });
    dispatch(world, citizen.id, { type: 'move', x: 2, y: 1 });
    const action = structuredClone(citizen.action);
    await runner.startTurn(citizen.id);
    expect(citizen.plan).toBeUndefined();
    expect(citizen.action).toEqual(action);
    expect(runner.records()[0].toolEvents.at(-1)?.result).toMatchObject({
      ok: false,
      code: 'unknown-plan-target',
    });
  });

  it('bounded unapproved turns discard drafts and forbid immediate physical work during drafting', async () => {
    const { citizen, runner } = setup(
      () => ({
        toolCalls: [
          { id: 'draft', name: 'draft_plan', arguments: JSON.stringify(spec) },
          {
            id: 'bypass',
            name: 'command',
            arguments: JSON.stringify({ type: 'harvest', depositId: 'tree' }),
          },
        ],
      }),
      1,
    );
    await runner.startTurn(citizen.id);
    expect(citizen.plan).toBeUndefined();
    expect(citizen.action).toBeNull();
    expect(runner.records()[0]).toMatchObject({ status: 'yielded', stopReason: 'request_limit' });
    expect(runner.records()[0].toolEvents.at(-1)?.result).toMatchObject({
      ok: false,
      code: 'invalid_tool',
    });
  });

  it('starts a successor review before work ends, while bounded gathering continues during inference', async () => {
    let resolve!: (response: ProviderResponse) => void;
    const pending = new Promise<ProviderResponse>((r) => {
      resolve = r;
    });
    const { world, citizen, runner, requests } = setup(() => pending);
    world.deposits.tree.stock = 2;
    world.deposits.tree.capacity = 2;
    citizen.review = reviewState(world, citizen);
    approvePlan(
      world,
      citizen.id,
      { mode: 'append', steps: [{ type: 'gather', resource: 'wood', tier: 1, maxTicks: 500 }] },
      { cancel: () => cancelAction(world, citizen.id) },
    );
    const planId = citizen.plan!.id;
    for (let i = 0; i < 381; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }
    const before = citizen.inventory['wood:1'] ?? 0;
    runner.tick();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(requests).toHaveLength(1);
    expect(runner.records()[0].reason).toContain('plan ahead');
    expect(citizen.plan?.id).toBe(planId);
    for (let i = 0; i < BALANCE.harvestTicks; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }
    expect(citizen.inventory['wood:1']).toBeGreaterThan(before);
    expect(runner.status().thinking).toContain(citizen.id);
    resolve({ content: 'Keep doing this work.' });
    await runner.startTurn(citizen.id);
    runner.tick();
    expect(requests).toHaveLength(1); // Same plan does not repeatedly trigger the early warning.
    expect(citizen.plan?.id).toBe(planId);
  });

  it('reserves the final response for approval rather than spending every request on revisions', async () => {
    const { citizen, runner, requests } = setup((request, index) => {
      if (index <= 3)
        return call(`draft${index}`, 'draft_plan', {
          mode: 'append',
          steps: [{ type: 'wait', ticks: index }],
        });
      expect(request.payload.tools.some((tool: any) => tool.function.name === 'draft_plan')).toBe(
        false,
      );
      expect(request.payload.messages.at(-1)?.content).toContain('final request');
      return call('approve', 'approve_plan', {
        draftId: JSON.parse(
          request.payload.messages.filter((m) => m.role === 'tool').at(-1)!.content!,
        ).draftId,
      });
    });
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(4);
    expect(citizen.plan?.steps[0]).toMatchObject({ type: 'wait', ticks: 3 });
    expect(runner.records()[0].status).toBe('completed');
  });

  it('interruption rejects a late approval and does not retain the draft in world state', async () => {
    let resolve!: (response: ProviderResponse) => void;
    let lateId = '';
    const pending = new Promise<ProviderResponse>((r) => {
      resolve = r;
    });
    const { citizen, runner } = setup((request, index) => {
      if (index === 1) return call('draft', 'draft_plan', spec);
      lateId = draftId(request);
      return pending;
    });
    const done = runner.startTurn(citizen.id);
    for (let i = 0; i < 30 && !lateId; i++) await Promise.resolve();
    expect(lateId).not.toBe('');
    runner.interrupt('test reload');
    await done;
    resolve(call('late', 'approve_plan', { draftId: lateId }));
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(citizen.plan).toBeUndefined();
    expect(runner.records()[0].status).toBe('interrupted');
  });
});
