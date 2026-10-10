import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner } from '../src/citizen/runner.ts';
import type { ProviderResponse, TransportRequest } from '../src/citizen/provider.ts';
import { createWorld, dispatch, tickWorld, cancelAction } from '../src/world/core.ts';
import { commitStrategy } from '../src/world/directives.ts';
import { BALANCE } from '../src/world/config.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';
import type { StrategySpec } from '../src/shared/directive-types.ts';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);
const call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});
const areas: [number, number, number, number][] = [[0, 0, 4, 4]];
const knife: StrategySpec = {
  mode: 'replace',
  directives: [{ type: 'craft', item: 'knife', tier: 1, areas }],
};
function setup(
  answer: (
    request: TransportRequest,
    index: number,
  ) => ProviderResponse | Promise<ProviderResponse>,
  maxRequestsPerTurn = 4,
) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-decision-freshness-'));
  directories.push(directory);
  const world = createWorld({ seed: 42 });
  const [citizen, partner] = Object.values(world.citizens);
  for (const c of Object.values(world.citizens)) c.nextReviewTick = 10000;
  citizen.x = 1;
  citizen.y = 1;
  partner.x = 2;
  partner.y = 1;
  citizen.inventory = { 'food:2': 12, 'wood:1': 6, 'fibre:1': 6 };
  partner.inventory = { 'food:2': 12 };
  citizen.knowledge = {};
  partner.knowledge = {};
  world.deposits = {
    tree: { id: 'tree', resource: 'wood', tier: 1, x: 1, y: 1, stock: 4, capacity: 4, regrowAt: 0 },
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
      mode: 'live',
      contextMode: 'legacy',
      maxRequestsPerTurn,
      transport: async (request) => {
        requests.push(request);
        return answer(request, requests.length);
      },
      ledgerOptions: { directory, maxRequests: 20, maxTokens: 2000000 },
    },
  );
  const choose = (spec: StrategySpec) =>
    commitStrategy(world, citizen.id, spec, {
      command: (command) => dispatch(world, citizen.id, command, 'directive'),
      cancel: () => cancelAction(world, citizen.id),
    });
  return { world, citizen, partner, runner, requests, choose };
}

describe('material work completion during inference', () => {
  it.each(['replace', 'append'] as const)(
    'reconsiders a stale %s repeating a completed craft without committing its metadata',
    async (mode) => {
      const { world, citizen, runner, requests, choose } = setup((request, index) => {
        if (index === 1) {
          tickWorld(world, 12);
          updateKnowledge(world);
          expect(citizen.inventory['knife:1']).toBe(1);
          return {
            toolCalls: [
              call('stale', 'set_strategy', {
                ...knife,
                mode,
                memory: 'A stale claim',
                communications: [{ text: 'I am starting my first knife now.' }],
              }),
            ],
          };
        }
        const receipt = JSON.parse(
          request.payload.messages.filter((m) => m.role === 'tool').at(-1)!.content!,
        );
        expect(receipt).toMatchObject({
          ok: false,
          code: 'work_state_changed',
          observationRefresh: 'next-request',
        });
        expect(receipt).not.toHaveProperty('freshContext');
        const context = JSON.parse(request.payload.messages[1].content!);
        expect(context.ownState.inventory['knife:1']).toBe(1);
        expect(context.execution.strategy.status).toBe('completed');
        return {
          toolCalls: [
            call('fresh', 'set_strategy', { mode: 'keep', memory: 'My knife is complete.' }),
          ],
        };
      });
      expect(choose(knife).ok).toBe(true);
      await runner.startTurn(citizen.id);
      expect(requests).toHaveLength(2);
      expect(citizen.inventory['knife:1']).toBe(1);
      expect(citizen.inventory['wood:1']).toBe(3);
      expect(citizen.action).toBeNull();
      expect(citizen.memories.map((m) => m.text)).not.toContain('A stale claim');
      expect(world.messages).toHaveLength(0);
      expect(runner.records()[0].status).toBe('completed');
    },
  );

  it('allows deliberate additional output after the refreshed context confirms the first craft', async () => {
    const { world, citizen, runner, requests, choose } = setup((_, index) => {
      if (index === 1) {
        tickWorld(world, 12);
        updateKnowledge(world);
      }
      return { toolCalls: [call(`craft-${index}`, 'set_strategy', knife)] };
    });
    choose(knife);
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    tickWorld(world, 12);
    expect(citizen.inventory['knife:1']).toBe(2);
    expect(citizen.strategy?.status).toBe('completed');
  });

  it('reconsiders a repeated building completed during inference', async () => {
    const wall: StrategySpec = {
      mode: 'replace',
      directives: [{ type: 'build', kind: 'wall', tier: 1, x: 3, y: 1, areas }],
    };
    const { world, citizen, runner, requests, choose } = setup((_, index) => {
      if (index === 1) {
        tickWorld(world, 40);
        updateKnowledge(world);
        return { toolCalls: [call('stale-wall', 'set_strategy', wall)] };
      }
      return { toolCalls: [call('keep-wall', 'set_strategy', { mode: 'keep' })] };
    });
    choose(wall);
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    expect(Object.values(world.buildings)).toHaveLength(1);
    expect(citizen.strategy?.status).toBe('completed');
    expect(runner.records()[0].toolEvents[0].result).toMatchObject({ code: 'work_state_changed' });
  });

  it.each([{ quantity: 2 }, { maxTicks: 1 }])(
    'retains partial or stopped craft intent rather than guessing completion: %j',
    async (ending) => {
      const partial: StrategySpec = {
        mode: 'replace',
        directives: [{ type: 'craft', item: 'knife', tier: 1, areas, ...ending }],
      };
      const { world, citizen, runner, requests, choose } = setup(() => {
        tickWorld(world, 9);
        updateKnowledge(world);
        return { toolCalls: [call('still-want-this', 'set_strategy', partial)] };
      });
      choose(partial);
      await runner.startTurn(citizen.id);
      expect(requests).toHaveLength(1);
      expect(runner.records()[0].toolEvents[0].result).toMatchObject({ ok: true });
    },
  );

  it('does not invalidate an unrelated replacement or ordinary gathering progress', async () => {
    const { world, citizen, runner, requests, choose } = setup(() => {
      tickWorld(world, 12);
      updateKnowledge(world);
      return {
        toolCalls: [
          call('different', 'set_strategy', {
            mode: 'replace',
            directives: [{ type: 'craft', item: 'scythe', tier: 1, areas }],
          }),
        ],
      };
    });
    choose(knife);
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.strategy?.directives[0]).toMatchObject({ item: 'scythe' });
  });

  it('keeps new-output gathering semantics when a finite gather finishes during inference', async () => {
    const gather: StrategySpec = {
      mode: 'replace',
      directives: [{ type: 'gather', resource: 'wood', tier: 1, quantity: 1, areas }],
    };
    const { world, citizen, runner, requests, choose } = setup(() => {
      tickWorld(world, 12);
      updateKnowledge(world);
      return { toolCalls: [call('more-wood', 'set_strategy', gather)] };
    });
    choose(gather);
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.strategy?.status).toBe('active');
    expect(citizen.strategy?.progress).toBe(0);
  });

  it('preserves completed work and yields without exceeding a one-request turn limit', async () => {
    const { world, citizen, runner, requests, choose } = setup(() => {
      tickWorld(world, 12);
      updateKnowledge(world);
      return { toolCalls: [call('stale', 'set_strategy', knife)] };
    }, 1);
    choose(knife);
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(runner.records()[0]).toMatchObject({ status: 'yielded', stopReason: 'request_limit' });
    expect(citizen.inventory['knife:1']).toBe(1);
    expect(citizen.strategy?.status).toBe('completed');
  });
});

describe('commands accompanying a strategy', () => {
  it('allows an order after set_strategy in one response without replacing the strategy', async () => {
    const { citizen, runner, requests } = setup(() => ({
      toolCalls: [
        call('keep', 'set_strategy', { mode: 'keep' }),
        call('order', 'command', { type: 'order', side: 'sell', item: 'knife:1', quantity: 1, price: 5 }),
      ],
    }));
    citizen.inventory['knife:1'] = 1;
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.inventory['knife:1'] ?? 0).toBe(0);
    expect(citizen.strategy).toBeDefined();
    expect(runner.records()[0].toolEvents.at(-1)?.result).toMatchObject({ ok: true });
  });

  it('allows a deliberate attack after keep, through ordinary visibility and combat rules', async () => {
    const { world, citizen, partner, runner, requests } = setup(() => ({
      toolCalls: [
        call('keep', 'set_strategy', { mode: 'keep' }),
        call('attack', 'command', { type: 'attack', targetId: partner.id }),
      ],
    }));
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.action?.command.type).toBe('attack');
    tickWorld(world, 8);
    expect(partner.health).toBeLessThan(100);
  });

  it('keeps the legacy draft and approval physical-command protections', async () => {
    const { citizen, partner, runner, requests } = setup((request, index) => {
      if (index === 1)
        return {
          toolCalls: [
            call('draft', 'draft_plan', { mode: 'replace', steps: [{ type: 'wait', ticks: 40 }] }),
            call('blocked-attack', 'command', { type: 'attack', targetId: partner.id }),
          ],
        };
      const draft = JSON.parse(
        request.payload.messages.filter((m) => m.role === 'tool')[0].content!,
      );
      return {
        toolCalls: [
          call('approve', 'approve_plan', { draftId: draft.draftId }),
          call('blocked-craft', 'command', { type: 'craft', item: 'knife', tier: 1 }),
        ],
      };
    });
    citizen.inventory['knife:1'] = 1;
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(2);
    const results = runner.records()[0].toolEvents.map((e) => e.result);
    expect(results[1]).toMatchObject({ ok: false, code: 'invalid_tool' });
    expect(results[2]).toMatchObject({ ok: true });
    expect(results[3]).toMatchObject({ ok: false, code: 'invalid_tool' });
    expect(citizen.inventory['knife:1']).toBe(1);
    expect(citizen.plan).toBeDefined();
    expect(citizen.action).toBeNull();
  });

  it('does not manufacture a partner consent after a strategy', async () => {
    const { world, citizen, partner, runner } = setup(() => ({
      toolCalls: [
        call('keep', 'set_strategy', { mode: 'keep' }),
        call('consent', 'command', { type: 'consent', partnerId: partner.id, accept: true }),
        call('reproduce', 'command', { type: 'reproduce', partnerId: partner.id }),
      ],
    }));
    const initialPopulation = Object.keys(world.citizens).length;
    await runner.startTurn(citizen.id);
    expect(runner.records()[0].toolEvents.at(-1)?.result).toMatchObject({
      ok: false,
      code: 'consent-required',
    });
    expect(citizen.action).toBeNull();
    expect(partner.action).toBeNull();
    expect(citizen.inventory['food:2']).toBe(12);
    expect(Object.keys(world.citizens)).toHaveLength(initialPopulation);
  });

  it('allows chosen reproduction after keep while requiring both parents consent and paying both costs', async () => {
    const { world, citizen, partner, runner, requests } = setup(() => ({
      toolCalls: [
        call('keep', 'set_strategy', { mode: 'keep' }),
        call('consent', 'command', { type: 'consent', partnerId: partner.id, accept: true }),
        call('reproduce', 'command', { type: 'reproduce', partnerId: partner.id }),
      ],
    }));
    dispatch(world, partner.id, { type: 'consent', partnerId: citizen.id, accept: true });
    await runner.startTurn(citizen.id);
    expect(requests).toHaveLength(1);
    expect(citizen.action?.command.type).toBe('reproduce');
    expect(partner.action?.command.type).toBe('reproduce');
    tickWorld(world, BALANCE.reproductionTicks);
    expect(
      Object.values(world.citizens).filter((c) => c.parents.includes(citizen.id)),
    ).toHaveLength(1);
    expect(citizen.inventory['food:2']).toBe(12 - BALANCE.reproductionFood);
    expect(partner.inventory['food:2']).toBe(12 - BALANCE.reproductionFood);
  });
});
