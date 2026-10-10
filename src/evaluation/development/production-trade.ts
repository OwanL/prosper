import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Command } from '../../shared/types.ts';
import type { CandidateFactory } from '../contracts.ts';
import { fixtureSchema, type FixtureManifest } from '../fixtures.ts';

/**
 * DEVELOPMENT ONLY. Geography selected at authoring time from seed 7, not a
 * general planner or a sealed case. Do not import this reference into candidate
 * adapters, model prompts, retrieval or training.
 */
export const PRODUCTION_TRADE_SITE = Object.freeze({ depositId: 'deposit-4', x: 6, y: 1 });

/** The four-food variant is an explicitly authored automatic-meal control. */
export function productionTradeFixture(actorFoodEndowment: 0 | 4 = 0): FixtureManifest {
  return fixtureSchema.parse({
    version: 1,
    id: actorFoodEndowment === 0 ? 'development-production-trade' : 'development-production-trade-food-endowment-control',
    split: 'development',
    provenance: [
      'Authored development fixture, not a natural-history continuation or held-out selection.',
      'Seed 7 progression, three founders: actor creation index 0 originally at (27,2);',
      'generated deposit-4 is an unmodified T1 wood site at (6,1), stock/capacity 1.',
      'Actor position is explicitly pinned to its generated start; peer positions and all policies retain creation defaults.',
      `All three bodies receive declared health/fullness/gold/inventory overrides. Actor food:1 endowment ${actorFoodEndowment}; no earned wood, gold, tools or fabricated history.`,
      'Food seller receives seven T1 food, escrows four at 4 gold each and retains three for its body.',
      'Wood buyer receives 16 gold and three T1 food, escrows all 16 for one T1 wood.',
      'No deposit/building/reservation overrides, liquidity replenishment or background commands.',
    ].join(' '),
    creation: { seed: 7, scenario: 'progression', population: 3, autonomy: true },
    actorIndex: 0,
    horizon: 320,
    cadence: 1,
    authorities: ['direct', 'passive-body', 'passive-body'],
    newbornAuthority: 'passive-body',
    objective: {
      description: 'Survive 320 ticks with health at least 100 and fullness at least 85. This manifest scores vitals only; separate development conformance assertions check reference travel, completed harvesting, sale, purchase and automatic meals.',
      minHealth: 100,
      minFullness: 85,
    },
    overrides: [
      { citizenIndex: 0, position: { x: 27, y: 2 }, health: 100, fullness: 80, gold: 0, inventory: actorFoodEndowment === 0 ? {} : { 'food:1': 4 } },
      { citizenIndex: 1, health: 100, fullness: 100, gold: 0, inventory: { 'food:1': 7 } },
      { citizenIndex: 2, health: 100, fullness: 100, gold: 16, inventory: { 'food:1': 3 } },
    ],
    setup: [
      { citizenIndex: 1, command: { type: 'order', side: 'sell', item: 'food:1', quantity: 4, price: 4 } },
      { citizenIndex: 2, command: { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 16 } },
    ],
  });
}

/**
 * Privileged fixture-specific scripted reference. Waits for accepted physical
 * work to finish, then issues the next authored primitive, with no retry/repair.
 * This file's hash is retained in candidate provenance because the harness's
 * fixed source list does not include new development subdirectory modules.
 */
export function productionTradeReference(): CandidateFactory {
  const sourceHash = createHash('sha256').update(readFileSync(new URL('./production-trade.ts', import.meta.url))).digest('hex');
  const commands: Command[] = [
    { type: 'move', x: PRODUCTION_TRADE_SITE.x, y: PRODUCTION_TRADE_SITE.y },
    { type: 'harvest', depositId: PRODUCTION_TRADE_SITE.depositId },
    { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 16 },
    { type: 'order', side: 'buy', item: 'food:1', quantity: 4, price: 4 },
  ];
  return () => {
    let index = 0;
    return {
      metadata: {
        id: 'privileged-development-production-trade-reference', version: '1',
        artifact: `authored-script-sha256:${sourceHash}`,
        provenance: 'Privileged seed-7 development actions selected at authoring time; no training, inference, generic planning or optimality claim.',
        execution: 'cooperative-in-process', inference: 'none',
      },
      reset() { index = 0; },
      decide(input) {
        if (input.observation.citizen.action || index >= commands.length)
          return { requestId: input.requestId, kind: 'advance' };
        return { requestId: input.requestId, kind: 'command', command: commands[index++] };
      },
      feedback() {},
      close() {},
      getUsage() { return { modelCalls: 0, tokens: 0 }; },
    };
  };
}
