import { TIERS } from '../shared/tiers.ts';
import type { Citizen, CitizenObservation, Command, World } from '../shared/types.ts';
import { distance } from '../shared/utils.ts';
import { BALANCE, harvestDuration, nutrition } from '../world/config.ts';

export const PLANNING_HORIZON_TICKS = 120;
export const REVIEW_COOLDOWN_TICKS = 12;

export function foodRunwayTicks(citizen: Citizen): number {
  const food = TIERS.reduce(
    (sum, tier) => sum + (citizen.inventory[`food:${tier}`] ?? 0) * nutrition(tier),
    0,
  );
  return Math.floor((citizen.fullness + food) / BALANCE.fullnessDrain);
}
export function foodRisk(citizen: Citizen): 0 | 1 | 2 {
  const runway = foodRunwayTicks(citizen);
  // Warn early enough for this citizen's learned reasoning lead, while retaining
  // the legacy floor. This changes review timing, not food/work intentions.
  const horizon = Math.max(
    PLANNING_HORIZON_TICKS,
    citizen.review?.replanLeadTicks ?? PLANNING_HORIZON_TICKS,
  );
  return runway <= 0 ? 2 : runway <= horizon ? 1 : 0;
}

function workId(citizen: Citizen): string | undefined {
  return citizen.strategy
    ? `${citizen.strategy.id}:${citizen.strategy.status}`
    : citizen.plan
      ? `${citizen.plan.id}:${citizen.plan.steps.length}`
      : citizen.action?.id;
}

/** Personal plan estimate only; no lookup of hidden entities or other citizens. */
export function remainingWorkTicks(citizen: Citizen, tick: number): number | undefined {
  if (citizen.strategy?.status === 'active') return undefined; // Routine directives do not review per harvest.
  const tiles = Object.values(citizen.knowledge);
  const work = (command: Command) =>
    command.type === 'move'
      ? 0
      : command.type === 'build'
        ? BALANCE.buildTicks
        : command.type === 'craft'
          ? BALANCE.craftTicks
          : command.type === 'loot'
            ? BALANCE.lootTicks
            : command.type === 'refine'
              ? BALANCE.refineTicks[
                  tiles.flatMap((t) => t.buildings).find((b) => b.id === command.buildingId)
                    ?.tier ?? 1
                ]
              : command.type === 'harvest'
                ? BALANCE.harvestTicks
                : undefined;
  const active = citizen.action;
  const activeWork = active ? work(active.command) : 0;
  if (activeWork === undefined) return undefined; // Indefinite combat/joint decisions stay event-driven.
  let remaining = active
    ? active.phase === 'work'
      ? active.duration - active.elapsed
      : active.path.length * BALANCE.moveTicks - active.elapsed + activeWork
    : 0;
  if (!citizen.plan) return citizen.queue.length ? undefined : active ? remaining : undefined;
  const plan = citizen.plan;
  if (plan.stepStartedTick === undefined) return undefined; // Waiting for prior legacy work.
  let point = { x: citizen.x, y: citizen.y };
  if (active) point = active.target;
  remaining = 0;
  for (let index = plan.stepIndex; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    if (step.type === 'gather' || step.type === 'wait') {
      remaining += Math.max(
        0,
        (step.type === 'gather' ? step.maxTicks : step.ticks) -
          (index === plan.stepIndex ? Math.max(0, tick - plan.stepStartedTick) : 0),
      );
      continue;
    }
    if (index === plan.stepIndex && plan.pending && active) {
      remaining +=
        active.phase === 'work'
          ? active.duration - active.elapsed
          : active.path.length * BALANCE.moveTicks - active.elapsed + activeWork;
      continue;
    }
    const command = step.command;
    const target =
      command.type === 'move' || command.type === 'build'
        ? command
        : command.type === 'harvest'
          ? tiles.flatMap((t) => t.deposits).find((d) => d.id === command.depositId)
          : command.type === 'refine'
            ? tiles.flatMap((t) => t.buildings).find((b) => b.id === command.buildingId)
            : command.type === 'loot'
              ? tiles.flatMap((t) => t.loot).find((l) => l.id === command.lootId)
              : undefined;
    if (target) {
      remaining += distance(point, target) * BALANCE.moveTicks;
      point = target;
    }
    remaining += work(command) ?? 0;
  }
  return remaining;
}

export function reviewState(world: World, citizen: Citizen): NonNullable<Citizen['review']> {
  return {
    eventSequence: world.nextId - 1,
    foodRisk: foodRisk(citizen),
    planningWorkId:
      citizen.strategy?.status === 'active' && world.tick - citizen.strategy.lastProgressTick >= 600
        ? `${workId(citizen)}:stall:${citizen.strategy.lastProgressTick}`
        : workId(citizen),
    replanLeadTicks: citizen.review?.replanLeadTicks ?? PLANNING_HORIZON_TICKS,
  };
}

/** Only personal state and explicitly delivered information can wake a busy citizen. */
export function reviewReason(world: World, citizen: Citizen): string | undefined {
  if (!citizen.review) return 'initial or interrupted review';
  if (foodRisk(citizen) > citizen.review.foodRisk) return 'food runway deteriorated';
  const newer = (id: string) =>
    Number(id.slice(id.lastIndexOf('-') + 1)) > citizen.review!.eventSequence;
  const alert = world.events.find(
    (e) =>
      newer(e.id) &&
      e.audience?.includes(citizen.id) &&
      (e.kind === 'error' ||
        e.kind === 'trade' ||
        (e.kind === 'attack' && e.citizenId !== citizen.id)),
  );
  if (alert) return `personal ${alert.kind} alert`;
  if (world.messages.some((m) => newer(m.id) && m.to === citizen.id && m.from !== citizen.id))
    return 'direct message received';
  const strategy = citizen.strategy;
  if (strategy) {
    if (world.tick >= strategy.reviewTick) return 'citizen-selected strategy review';
    const changed = workId(citizen) !== citizen.review.planningWorkId;
    if (strategy.status !== 'active') {
      if (changed)
        return `strategy ${strategy.status}: ${strategy.blockedReason ?? 'review outcome'}`;
      return undefined; // keep-idle is a decision, not an empty-queue loop.
    }
    // The executor reports meaningful blocked/progress outcomes. Regrowth waiting is not a stall.
    if (
      !citizen.emergency &&
      !citizen.action &&
      !strategy.wakeTick &&
      world.tick - strategy.lastProgressTick >= 600 &&
      citizen.review.planningWorkId !== `${workId(citizen)}:stall:${strategy.lastProgressTick}`
    )
      return 'strategy progress stalled';
    return undefined;
  }
  if (!citizen.action && !citizen.queue.length && !citizen.plan) return 'work queue empty';
  const remaining = remainingWorkTicks(citizen, world.tick);
  if (
    workId(citizen) !== citizen.review.planningWorkId &&
    remaining !== undefined &&
    remaining <= (citizen.review.replanLeadTicks ?? PLANNING_HORIZON_TICKS)
  )
    return 'work approaching completion; plan ahead while execution continues';
  return undefined;
}

/** Public balance facts plus the observer's own state; never inspect spectator targets. */
export function planningContext(
  observation: CitizenObservation,
  cooldownTicks = REVIEW_COOLDOWN_TICKS,
) {
  return {
    scheduling:
      'Choose reviewAfter for your next review. Ongoing routines continue without model calls and reviews do not cancel work. Blocked/completed work, meaningful stalls, personal errors, incoming attacks/property damage, fills, direct messages or worsening food risk can request an earlier review. Successful emergency feeding is disclosed at the next review, not a separate acknowledgement call.',
    minimumReviewCooldownTicks: cooldownTicks,
    replanLeadTicks: observation.citizen.review?.replanLeadTicks ?? PLANNING_HORIZON_TICKS,
    actionTimingTicks: {
      movePerOrthogonalStep: BALANCE.moveTicks,
      travelEstimate:
        'Manhattan distance × movePerOrthogonalStep is a lower bound; walls, detours and moving targets can add time. Add travel to work below. Consecutive queued actions travel from the previous endpoint, not your original position.',
      harvestByMatchingToolTier: [0, ...TIERS].map((toolTier) => ({
        toolTier,
        // Retain the historical context key for integrations; the full table follows.
        depositTiers1Through3: TIERS.slice(0, 3).map((tier) =>
          tier > toolTier + 1 ? null : harvestDuration(tier, toolTier),
        ),
        depositTiers: TIERS.map((tier) =>
          tier > toolTier + 1 ? null : harvestDuration(tier, toolTier),
        ),
        // Deprecated compatibility alias; values cover all configured tiers.
        depositTiers1Through6: TIERS.map((tier) =>
          tier > toolTier + 1 ? null : harvestDuration(tier, toolTier),
        ),
      })),
      harvestNotes:
        'One unit per harvest. null means the tool cannot harvest that tier. A depleted deposit is not a wait action; regrowth and other citizens can invalidate queued work.',
      craft: BALANCE.craftTicks,
      build: BALANCE.buildTicks,
      refineByStationTier: BALANCE.refineTicks,
      attackPerStrike: BALANCE.attackTicks,
      attackNotes:
        'Repeated strikes continue until the target is defeated or lost; total duration is uncertain.',
      loot: BALANCE.lootTicks,
      reproduction: BALANCE.reproductionTicks,
      regrowthAfterHarvest: BALANCE.regrowTicks,
      instant:
        'orders, cancel-order, transfer, consent, message, goals, remember, cancel; these do not extend your physical-work horizon and are not delayed by queue=append.',
    },
    food: {
      snapshotTick: observation.tick,
      fullnessDrainPerTick: BALANCE.fullnessDrain,
      starvationDamagePerTick: BALANCE.starvationDamage,
      availableFoodRunwayTicks: foodRunwayTicks(observation.citizen),
      hungerOnsetTicks: foodRunwayTicks(observation.citizen),
      starvationTicksAtCurrentHealth: observation.citizen.health / BALANCE.starvationDamage,
      approximateUnassistedDeathHorizonTicks:
        foodRunwayTicks(observation.citizen) +
        observation.citizen.health / BALANCE.starvationDamage,
      caveat:
        'Hunger onset (food runway) is when fullness runs out, NOT death. The death horizon adds starvation time at your CURRENT health, not maximum health. These are approximate simulation ticks from snapshotTick, not wall-clock deadlines or guarantees: discrete meals/tick thresholds and fed healing can change timing; attacks can shorten it. Uses only current fullness and carried unreserved food; work reservations and market escrow are not edible. Does not predict future harvests, trades or market fills; future ingredient costs or sales reduce this runway. World time, work and meals continue during inference/reasoning, so elapsed simulation ticks reduce the remaining horizon before your decision applies.',
    },
  };
}
