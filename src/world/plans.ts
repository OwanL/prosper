import type { Citizen, Command, CommandResult, World } from '../shared/types.ts';
import { MAX_TIER, TIERS } from '../shared/tiers.ts';
import type { PlanCondition, PlanReceipt, PlanSpec, PlanState } from '../shared/plan-types.ts';
import { distance, event, fail, id, ok } from '../shared/utils.ts';
import { BALANCE, MATCHING_TOOL, nutrition } from './config.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import { observe, validateKnownCommand } from './observation.ts';
import { planSpecSchema } from '../citizen/plan-schema.ts';

import { strategyAllowed, type WorldControlOptions } from './evaluation-authority.ts';

const MAX_STEPS = 12;
const RECEIPT_LIMIT = 24;
export interface PlanActions {
  command: (command: Command) => CommandResult;
  cancel: () => void;
}
function snapshot(c: Citizen): PlanReceipt['state'] {
  return {
    x: c.x,
    y: c.y,
    inventory: { ...c.inventory },
    fullness: c.fullness,
    health: c.health,
    gold: c.gold,
  };
}
function receipt(
  world: World,
  citizen: Citizen,
  plan: PlanState,
  outcome: PlanReceipt['outcome'],
  message: string,
) {
  const result: PlanReceipt = {
    planId: plan.id,
    step: plan.stepIndex,
    tick: world.tick,
    outcome,
    message,
    state: snapshot(citizen),
  };
  citizen.planReceipts = [...(citizen.planReceipts ?? []), result].slice(-RECEIPT_LIMIT);
  event(world, 'plan-step', message, { citizenId: citizen.id, audience: [citizen.id] });
  citizen.lastResult = message;
}
/** Called by explicit replacement/cancel/death. Does not itself release work inputs. */
export function discardPlan(world: World, citizen: Citizen, message = 'Approved plan cancelled.') {
  if (!citizen.plan) return;
  receipt(world, citizen, citizen.plan, 'cancelled', message);
  delete citizen.plan;
}

/** Exact physical completion feedback, independent of unrelated social errors. */
export function planActionResult(citizen: Citizen, actionId: string, result: CommandResult): void {
  if (citizen.plan?.pending?.actionId === actionId) citizen.plan.pending.result = { ...result };
}

export function conditionMet(citizen: Citizen, condition: PlanCondition): boolean {
  switch (condition.kind) {
    case 'inventory-at-least':
      return (citizen.inventory[condition.item] ?? 0) >= condition.quantity;
    case 'health-below':
      return citizen.health < condition.health;
    case 'food-runway-below': {
      const food = TIERS.reduce(
        (total, tier) => total + (citizen.inventory[`food:${tier}`] ?? 0) * nutrition(tier),
        0,
      );
      return (citizen.fullness + food) / BALANCE.fullnessDrain < condition.ticks;
    }
  }
}

/** Revalidate static knowledge at approval, not future ingredients or unseen stock.
 * This is a gate for intent only; each action still validates when it starts. */
export function validatePlanKnowledge(
  world: World,
  citizen: Citizen,
  spec: PlanSpec,
): CommandResult {
  if (!citizen.alive)
    return fail('unavailable-citizen', 'Only a living citizen can approve a plan.');
  const combined =
    spec.mode === 'append' && citizen.plan ? [...citizen.plan.steps, ...spec.steps] : spec.steps;
  if (
    !combined.length ||
    combined.length > MAX_STEPS ||
    combined.reduce(
      (sum, step) =>
        sum + (step.type === 'gather' ? step.maxTicks : step.type === 'wait' ? step.ticks : 0),
      0,
    ) > 10000
  )
    return fail(
      'plan-full',
      'An approved plan has at most 12 steps and 10000 combined wait/gather budget ticks.',
    );
  const observation = observe(world, citizen.id);
  const tiles = [...observation.visible, ...observation.remembered];
  for (const [index, step] of spec.steps.entries()) {
    if (step.type === 'wait') continue;
    // Resource intent is not an entity ID. Earlier travel can discover local
    // matching deposits; inspect only when gathering actually starts.
    if (step.type === 'gather') continue;
    const command = step.command;
    const point = command.type === 'move' || command.type === 'build' ? command : undefined;
    if (
      point &&
      (!Number.isInteger(point.x) ||
        !Number.isInteger(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x >= world.width ||
        point.y >= world.height)
    )
      return fail('invalid-destination', `Step ${index}: destination must be inside the map.`);
    // Coordinate-based construction can follow scouting, but the core still
    // requires current sight before inspecting occupancy or reserving inputs.
    const known =
      command.type === 'harvest'
        ? tiles.some((t) => t.deposits.some((d) => d.id === command.depositId))
        : command.type === 'refine'
          ? tiles.some((t) => t.buildings.some((b) => b.id === command.buildingId))
          : command.type === 'loot'
            ? tiles.some((t) => t.loot.some((l) => l.id === command.lootId))
            : true;
    if (!known)
      return fail(
        'unknown-plan-target',
        `Step ${index}: target is no longer in your current or dated knowledge. No remote state inspected.`,
      );
  }
  if (
    spec.mode === 'append' &&
    citizen.plan &&
    citizen.plan.steps.length + spec.steps.length > MAX_STEPS
  )
    return fail(
      'plan-full',
      `Appending would exceed ${MAX_STEPS} plan steps; explicitly replace or wait for completion.`,
    );
  return ok(
    'Plan intent uses known information. Actual prerequisites remain conditional until execution.',
  );
}

/** Caller has validated the spec's shape. Approval is synchronous and atomic. */
export function approvePlan(
  world: World,
  citizenId: string,
  spec: PlanSpec,
  actions: Pick<PlanActions, 'cancel'>,
  options?: WorldControlOptions,
): CommandResult & { planId?: string } {
  if (!strategyAllowed(citizenId, options))
    return fail('evaluation-authority', 'Plan commits are disabled for this citizen.');
  const citizen = world.citizens[citizenId];
  if (!citizen) return fail('unavailable-citizen', 'Citizen unavailable.');
  const parsed = planSpecSchema.safeParse(spec);
  if (!parsed.success)
    return fail('invalid-plan', parsed.error.issues[0]?.message ?? 'Invalid plan.');
  spec = parsed.data as PlanSpec;
  const validity = validatePlanKnowledge(world, citizen, spec);
  if (!validity.ok) return validity;
  if (spec.mode === 'append' && citizen.plan) {
    citizen.plan.steps.push(...structuredClone(spec.steps));
    return {
      ...ok('Steps appended to the existing approved plan; current work preserved.'),
      planId: citizen.plan.id,
    };
  }
  if (spec.mode === 'replace') actions.cancel();
  citizen.plan = {
    ...structuredClone(spec),
    id: id(world, 'plan'),
    approvedTick: world.tick,
    stepIndex: 0,
  };
  event(world, 'plan-approved', `Approved ${spec.steps.length} plan steps (${spec.mode}).`, {
    citizenId,
    audience: [citizenId],
  });
  return {
    ...ok(
      'Plan approved. It will execute independently after existing work, unless explicitly replaced.',
    ),
    planId: citizen.plan.id,
  };
}

function finishStep(
  world: World,
  citizen: Citizen,
  outcome: 'completed' | 'condition' | 'failed',
  message: string,
) {
  const plan = citizen.plan!;
  const step = plan.steps[plan.stepIndex];
  receipt(world, citizen, plan, outcome, message);
  if (outcome === 'failed' && step.onFailure !== 'continue') {
    delete citizen.plan;
    event(world, 'error', `Plan stopped for review: ${message}`, {
      citizenId: citizen.id,
      audience: [citizen.id],
    });
    return;
  }
  plan.stepIndex++;
  delete plan.pending;
  delete plan.stepStartedTick;
  delete plan.gatheringTargetId;
  delete plan.wakeTick;
  if (plan.stepIndex >= plan.steps.length) {
    delete citizen.plan;
    event(world, 'plan-complete', 'Approved plan completed; ready for the next decision.', {
      citizenId: citizen.id,
      audience: [citizen.id],
    });
  }
}
function issue(
  world: World,
  citizen: Citizen,
  command: Command,
  actions: PlanActions,
): CommandResult {
  const gate = validateKnownCommand(world, citizen.id, command, 'activation');
  if (!gate.ok) return gate;
  const sequence = world.nextId - 1;
  const result = actions.command(command);
  if (result.ok && citizen.action)
    citizen.plan!.pending = { actionId: citizen.action.id, eventSequence: sequence };
  return result;
}

/** Runs at ordinary tick boundaries. No inference, promises, free yields or remote targets. */
export function advancePlan(world: World, citizen: Citizen, actions: PlanActions, options?: WorldControlOptions): void {
  if (!strategyAllowed(citizen.id, options)) return;
  const plan = citizen.plan;
  if (!plan || !citizen.alive) return;
  const step = plan.steps[plan.stepIndex];
  if (!step) {
    delete citizen.plan;
    return;
  }
  // Existing legacy work is preserved under append. Its time is not a step budget.
  if (plan.stepStartedTick === undefined) {
    if (citizen.action || citizen.queue.length) return;
    plan.stepStartedTick = world.tick;
  }
  if (step.stopWhen && conditionMet(citizen, step.stopWhen)) {
    if (plan.pending && citizen.action?.id === plan.pending.actionId) actions.cancel();
    // cancel hook only releases this action, never the whole plan.
    finishStep(
      world,
      citizen,
      'condition',
      `Step ${plan.stepIndex}: chosen stop condition reached.`,
    );
    return;
  }
  // Physical completion and automatic meals run before plan advancement.
  // Honour an available carried target on the deadline tick before timing out.
  if (
    step.type === 'gather' &&
    step.targetQuantity !== undefined &&
    (citizen.inventory[`${step.resource}:${step.tier}`] ?? 0) >= step.targetQuantity
  ) {
    if (plan.pending && citizen.action?.id === plan.pending.actionId) actions.cancel();
    finishStep(
      world,
      citizen,
      'completed',
      `Step ${plan.stepIndex}: carried ${step.resource}:${step.tier} target ${step.targetQuantity} reached.`,
    );
    return;
  }
  if (step.type === 'gather' && world.tick - plan.stepStartedTick >= step.maxTicks) {
    if (plan.pending && citizen.action?.id === plan.pending.actionId) actions.cancel();
    finishStep(
      world,
      citizen,
      step.targetQuantity === undefined ? 'completed' : 'failed',
      `Step ${plan.stepIndex}: ${step.targetQuantity === undefined ? 'bounded gathering completed' : 'gathering time budget exhausted'}.`,
    );
    return;
  }
  if (plan.pending) {
    if (citizen.action?.id === plan.pending.actionId) return;
    if (citizen.action) {
      discardPlan(world, citizen, 'Plan displaced by different physical work.');
      return;
    }
    const result = plan.pending.result;
    delete plan.pending;
    if (!result || !result.ok) {
      finishStep(
        world,
        citizen,
        'failed',
        `Step ${plan.stepIndex}: ${result?.message ?? 'Physical work ended without a completion receipt.'}`,
      );
      return;
    }
    if (step.type === 'command') {
      finishStep(world, citizen, 'completed', `Step ${plan.stepIndex}: ${result.message}`);
      return;
    }
  }
  if (citizen.action || citizen.queue.length) return;
  if (step.type === 'wait') {
    plan.wakeTick ??= plan.stepStartedTick + step.ticks;
    if (world.tick >= plan.wakeTick)
      finishStep(world, citizen, 'completed', `Step ${plan.stepIndex}: bounded wait completed.`);
    return;
  }
  if (step.type === 'command') {
    const result = issue(world, citizen, step.command, actions);
    if (!result.ok)
      finishStep(world, citizen, 'failed', `Step ${plan.stepIndex}: ${result.message}`);
    else if (!citizen.action)
      finishStep(world, citizen, 'completed', `Step ${plan.stepIndex}: ${result.message}`);
    return;
  }
  const item = `${step.resource}:${step.tier}`;
  const toolTier = highestToolTier(citizen, MATCHING_TOOL[step.resource]);
  if (step.tier > Math.min(MAX_TIER, toolTier + 1)) {
    finishStep(
      world,
      citizen,
      'failed',
      `Step ${plan.stepIndex}: matching tool required for ${item}.`,
    );
    return;
  }
  if (plan.wakeTick && world.tick < plan.wakeTick) return;
  delete plan.wakeTick;
  const observation = observe(world, citizen.id);
  const visible = observation.visible
    .flatMap((t) => t.deposits)
    .filter((d) => d.resource === step.resource && d.tier === step.tier);
  const dated = observation.remembered
    .flatMap((t) => t.deposits)
    .filter((d) => d.resource === step.resource && d.tier === step.tier);
  const nearest = <T extends { x: number; y: number }>(values: T[]) =>
    values.sort((a, b) => distance(citizen, a) - distance(citizen, b))[0];
  const candidates = visible.filter((d) => d.stock > 0);
  // Rotate after a locally rejected claim rather than retrying the same busy
  // node forever when another observed node is available.
  const stocked = nearest(
    candidates.length > 1 ? candidates.filter((d) => d.id !== plan.gatheringTargetId) : candidates,
  );
  if (stocked) {
    plan.gatheringTargetId = stocked.id;
    const result = issue(world, citizen, { type: 'harvest', depositId: stocked.id }, actions);
    if (!result.ok) {
      // Current competition may reserve visible stock; bounded local retry, not a review storm.
      if (result.code === 'depleted-deposit') plan.wakeTick = world.tick + BALANCE.moveTicks;
      else finishStep(world, citizen, 'failed', `Step ${plan.stepIndex}: ${result.message}`);
    }
    return;
  }
  const destination = nearest(dated);
  if (destination) {
    plan.gatheringTargetId = destination.id;
    const result = issue(
      world,
      citizen,
      { type: 'move', x: destination.x, y: destination.y },
      actions,
    );
    if (!result.ok)
      finishStep(world, citizen, 'failed', `Step ${plan.stepIndex}: ${result.message}`);
    return;
  }
  if (visible.length) {
    const nextRegrow = Math.min(
      ...visible.map((d) =>
        d.regrowAt > world.tick ? d.regrowAt : world.tick + BALANCE.regrowTicks,
      ),
    );
    plan.wakeTick = Math.min(nextRegrow, plan.stepStartedTick + step.maxTicks);
    return;
  }
  finishStep(
    world,
    citizen,
    'failed',
    `Step ${plan.stepIndex}: no currently known ${item} deposits remain; choose a new decision.`,
  );
}
