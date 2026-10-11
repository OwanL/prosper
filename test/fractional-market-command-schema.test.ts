import { describe, expect, it } from 'vitest';
import { commandSchema, legacyTools, parseCommand } from '../src/citizen/tools.ts';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { stepTreeTask } from '../src/citizen/tree-actions.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import type { CitizenMind, TreeTaskState } from '../src/shared/tree-types.ts';

const order = (quantity: number, item = 'wood:1', price = 2, side = 'sell') =>
  ({ type: 'order', side, item, quantity, price });

describe('fractional market command schema', () => {
  it('accepts fractional commodities on both sides and whole equipment', () => {
    for (const side of ['buy', 'sell']) {
      for (const item of ['wood:1', 'food:1', 'fibre:1']) {
        const command = order(0.125, item, 2, side);
        expect(parseCommand(command)).toEqual(command);
        expect(commandSchema.safeParse(command).success).toBe(true);
      }
      for (const item of ['axe:1', 'scythe:1', 'knife:1', 'sword:1']) {
        expect(parseCommand(order(2, item, 2, side))).toEqual(order(2, item, 2, side));
        expect(() => parseCommand(order(0.5, item, 2, side))).toThrow(/quantity:.*whole/i);
      }
    }
  });

  it('keeps finite positive safe quantities, integer prices and building exclusion', () => {
    for (const quantity of [0, -0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(commandSchema.safeParse(order(quantity)).success).toBe(false);
      expect(() => parseCommand(order(quantity))).toThrow(/quantity/);
    }
    for (const price of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseCommand(order(0.5, 'wood:1', price))).toThrow(/price/);
    }
    expect(() => parseCommand(order(Number.MAX_SAFE_INTEGER, 'wood:1', 2))).toThrow(/safe total/i);
    expect(parseCommand(order(Number.MAX_SAFE_INTEGER, 'wood:1', 1))).toMatchObject({ quantity: Number.MAX_SAFE_INTEGER });
    expect(() => parseCommand(order(1, 'building:house'))).toThrow(/item/);
    expect(() => parseCommand({ type: 'give', citizenId: 'peer', item: 'wood:1', quantity: 0.5 })).toThrow();
    expect(() => parseCommand({ type: 'transfer', citizenId: 'peer', gold: 0.5 })).toThrow();
  });

  it('advertises a flat numeric quantity compatible with the root discriminator', () => {
    const parameters = legacyTools[0].function.parameters;
    expect(parameters).toMatchObject({ type: 'object', required: ['type'], additionalProperties: false,
      properties: { quantity: { type: 'number', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        price: { type: 'integer', minimum: 1 } } });
    expect(commandSchema.options.map((schema) => schema.shape.type.value)).toContain('order');
  });

  it('validates a composed fractional sale proposal retained in mind.trace', () => {
    const world = createWorld({ population: 2, autonomy: false });
    world.controllerMode = 'composed';
    const seller = Object.values(world.citizens)[0];
    seller.inventory = { 'wood:1': 0.85 };
    const task: TreeTaskState = { id: 'sale', definitionId: 'SellItem', targetId: 'wood:1', ancestry: [],
      phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0,
      receiptIds: [], ownedOrderIds: [], request: { id: 'sale', resource: 'wood', tier: 1,
        quantity: 0.85, allowMarket: true, purpose: 'sale', urgency: 'routine' } };
    seller.mind = { version: 1, dispositions: { ambition: 0.5, morals: 0.5, generosity: 0.5,
      riskTolerance: 0.5, patience: 0.5, sociability: 0.5, vengefulness: 0.5, familyOrientation: 0.5,
      enterprise: 0.5, economicIndependence: 0.5 }, memories: [], memoriesOmitted: 0,
      tasks: [task], activeTaskId: task.id, receipts: [], trace: [], traceOmitted: 0,
      nextDirectorTick: 2400 } satisfies CitizenMind;
    const proposal = stepTreeTask(observe(world, seller.id), task);
    expect(proposal.command).toMatchObject({ type: 'order', side: 'sell', quantity: 0.85 });
    const result = dispatch(world, seller.id, proposal.command!);
    expect(result.ok).toBe(true);
    task.ownedOrderIds.push(result.order!.id);
    seller.mind.trace.push({ tick: world.tick, invocationId: task.id, definitionId: task.definitionId,
      transition: 'propose', reason: 'Fractional surplus sale', command: proposal.command! });
    const checkpoint: Checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
    expect(validateCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).toEqual(checkpoint);
  });
});
