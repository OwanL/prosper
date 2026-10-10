import { highestToolTier } from '../shared/tool-utils.ts';
import { TIERS } from '../shared/types.ts';
import type { PlanCondition, PlanSpec } from '../shared/plan-types.ts';
import type { CitizenObservation, Command, Inventory, Point, Tier } from '../shared/types.ts';
import { BALANCE, buildingRecipe, equipmentRecipe, harvestDuration, MATCHING_TOOL, nutrition, STATION_RESOURCE, canRefine, refinementRecipe, refinementOutput } from '../world/config.ts';

export interface ForecastRange { min: number; max: number }
export interface ForecastTime {
  /** A duration envelope, not a promise of successful completion. null means unknown. */
  min: number;
  max: number | null;
  /** No contention, shortest orthogonal travel, no inference delay. */
  conditional: ForecastRange;
}
export interface ForecastState {
  inventory: Record<string, ForecastRange>;
  fullness: ForecastRange;
  health: ForecastRange;
  foodRunway: ForecastRange;
}
export interface ForecastStep {
  index: number;
  duration: ForecastTime;
  ticks: ForecastTime;
  state: ForecastState;
  /** Exact input quantities required/consumed on success, never also nutrition. */
  costsOnSuccess: Inventory;
  feasibility: 'likely' | 'conditional' | 'blocked' | 'skipped';
  warnings: string[];
  assumptions: string[];
}
export interface PlanForecast {
  mode: PlanSpec['mode'];
  observationTick: number;
  startDelay: ForecastTime;
  projectedRefund: Inventory;
  steps: ForecastStep[];
  state: ForecastState;
  feasibility: 'likely' | 'conditional' | 'blocked';
  warnings: string[];
  assumptions: string[];
}

// Two explicit conditional scenarios keep this modest: uncontended success and
// unsuccessful resource collection. These are useful estimates, NOT exhaustive
// bounds over combat, trading, route changes, arbitrary failures or future policy.
interface Model extends Point {
  inventory: Inventory;
  fullness: number;
  health: number;
  elapsed: number;
}
const LIMIT = 10_000;
const range = (a: number, b = a): ForecastRange => ({ min: Math.min(a, b), max: Math.max(a, b) });
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const bounded = (n: number) => Math.max(0, Math.min(LIMIT, Number.isFinite(n) ? Math.floor(n) : 0));
const quantity = (m: Model, key: string) => m.inventory[key] ?? 0;
const tool = (m: Model, resource: keyof typeof MATCHING_TOOL) => highestToolTier(m, MATCHING_TOOL[resource]);
function runway(m: Model): number {
  return (m.fullness + TIERS.reduce((sum, tier) => sum + quantity(m, `food:${tier}`) * nutrition(tier), 0)) / BALANCE.fullnessDrain;
}
function matches(m: Model, c?: PlanCondition): boolean {
  if (!c) return false;
  if (c.kind === 'health-below') return m.health < c.health;
  if (c.kind === 'food-runway-below') return runway(m) < c.ticks;
  return quantity(m, c.item) >= c.quantity;
}
function advance(m: Model, ticks: number, stop?: PlanCondition): number {
  let count = 0;
  while (count < bounded(ticks) && m.health > 0 && !matches(m, stop)) {
    m.elapsed++; count++;
    m.fullness = Math.max(0, m.fullness - BALANCE.fullnessDrain);
    for (const tier of TIERS) {
      const key = `food:${tier}`, restored = nutrition(tier);
      if (quantity(m, key) > 0 && (BALANCE.maxFullness - m.fullness + 1e-9 >= restored || m.fullness <= 1e-9)) {
        m.inventory[key]--; m.fullness = Math.min(BALANCE.maxFullness, m.fullness + restored); break;
      }
    }
    m.health = m.fullness <= 1e-9 ? Math.max(0, m.health - BALANCE.starvationDamage) : Math.min(BALANCE.maxHealth, m.health + BALANCE.healing);
  }
  return count;
}
function snapshot(a: Model, b: Model): ForecastState {
  const keys = new Set([...Object.keys(a.inventory), ...Object.keys(b.inventory)]);
  return {
    inventory: Object.fromEntries([...keys].sort().map(key => [key, range(quantity(a, key), quantity(b, key))])),
    fullness: range(a.fullness, b.fullness), health: range(a.health, b.health), foodRunway: range(runway(a), runway(b)),
  };
}
function pay(m: Model, costs: Inventory): boolean {
  if (Object.entries(costs).some(([key, n]) => quantity(m, key) < n)) return false;
  for (const [key, n] of Object.entries(costs)) m.inventory[key] = quantity(m, key) - n;
  return true;
}

/** Pure prediction using only the supplied citizen projection. No dispatcher or world access. */
export function forecastPlan(observation: CitizenObservation, spec: PlanSpec): PlanForecast {
  const c = observation.citizen;
  const initial: Model = { x: c.x, y: c.y, inventory: { ...c.inventory }, fullness: c.fullness, health: c.health, elapsed: 0 };
  const good = structuredClone(initial), poor = structuredClone(initial);
  const warnings: string[] = [];
  const assumptions = [
    'Draft only; nothing is executed, reserved, cancelled or mutated.',
    'State ranges span conditional uncontended-success and failed-collection scenarios, not guaranteed bounds. No attacks, trades, unseen loot contents or inference delay are predicted.',
    'Conditional travel uses Manhattan distance, not a route through hidden walls. Travel may fail or take longer; null upper time means unknown.',
    'Absolute conditional ticks assume immediate approval; approval/inference delay is unknown, so absolute tick upper bounds are null.',
    'Food is eaten automatically lowest tier first; reserved recipe inputs give no nutrition. Health estimates exclude external damage.',
  ];
  const tiles = [...observation.visible, ...observation.remembered];
  const deposits = tiles.flatMap(t => t.deposits.map(d => ({ ...d, seenTick: t.seenTick })));
  // Keep the optimistic depletion timeline across steps; never refresh memories.
  const availableAt = new Map(deposits.map(d => [d.id, d.stock > 0 ? 0 : d.regrowAt > 0 ? Math.max(0, d.regrowAt - observation.tick) : LIMIT + 1]));
  const buildings = tiles.flatMap(t => t.buildings);
  const refunds = spec.mode === 'replace' ? { ...c.action?.reserved } : {};
  for (const [key, n] of Object.entries(refunds)) {
    good.inventory[key] = quantity(good, key) + n;
    poor.inventory[key] = quantity(poor, key) + n;
  }
  const pending = spec.mode === 'append' && (!!c.action || c.queue.length > 0 || !!c.plan);
  const startDelay: ForecastTime = { min: 0, max: pending ? null : 0, conditional: range(0) };
  if (pending) {
    warnings.push('Append starts after existing action/queue/plan. Their success, outputs, refunds, meals, position and start delay are uncertain; step state estimates below use the current carried baseline and must be reviewed at activation.');
    if (c.action?.phase === 'work') startDelay.conditional = range(Math.max(0, c.action.duration - c.action.elapsed));
  }
  if (spec.mode === 'replace' && (c.action || c.queue.length)) warnings.push('On approval replace cancels existing physical work/queue; only active unconsumed work inputs are projected back, not market escrow. Unfinished output is discarded.');
  let review = false;
  // Discovery is possible after explicit travel, but its yields are not numerical
  // inputs to either scenario. Track dependencies separately from carried stock.
  const discoveryDependent = new Set<string>();
  let conditionalReview = false;
  const steps: ForecastStep[] = [];

  function command(m: Model, cmd: Command, success: boolean, stop?: PlanCondition): { costs: Inventory; warnings: string[]; blocked: boolean; uncertain: boolean; nominal: number } {
    const notes: string[] = [];
    if (matches(m, stop)) return { costs: {}, warnings: ['stopWhen is already satisfied in this scenario.'], blocked: false, uncertain: false, nominal: 0 };
    let costs: Inventory = {}, output: Inventory = {}, work = 0, target: Point = m;
    let uncertain = false, blocked = false;
    switch (cmd.type) {
      case 'move': target = cmd; work = distance(m, cmd) === 0 ? BALANCE.moveTicks : 0; break;
      case 'craft': costs = equipmentRecipe(cmd.item, cmd.tier); output = { [`${cmd.item}:${cmd.tier}`]: 1 }; work = BALANCE.craftTicks; break;
      case 'build': {
        costs = buildingRecipe(cmd.kind, cmd.tier); work = BALANCE.buildTicks; target = cmd; uncertain = true;
        const tile = tiles.find(t => t.x === cmd.x && t.y === cmd.y);
        if (tile?.buildings.length || tile?.deposits.length || (cmd.kind === 'wall' && (tile?.citizens.length || distance(m, cmd) === 0))) {
          blocked = true; notes.push('Last observed build site is occupied.');
        }
        notes.push('Site occupancy, construction claims and access are rechecked at activation.');
        break;
      }
      case 'harvest': {
        const d = deposits.find(d => d.id === cmd.depositId);
        uncertain = true;
        if (!d) { blocked = true; notes.push('Unknown deposit; inspect before planning work.'); break; }
        target = d; work = harvestDuration(d.tier, tool(m, d.resource));
        if (d.tier > tool(m, d.resource) + 1) { blocked = true; notes.push(`Carry matching ${MATCHING_TOOL[d.resource]} T${d.tier - 1} or better.`); }
        const available = success ? availableAt.get(d.id) ?? 0 : d.stock > 0 ? 0 : d.regrowAt > 0 ? Math.max(0, d.regrowAt - observation.tick) : LIMIT + 1;
        if (available > m.elapsed) { blocked = true; notes.push('Projected stock is depleted; direct harvest does not wait for regrowth.'); }
        notes.push(`Stock seen at tick ${d.seenTick} is not a yield guarantee; competing claims are private.`);
        output = success ? { [`${d.resource}:${d.tier}`]: 1 } : {};
        break;
      }
      case 'refine': {
        const b = buildings.find(b => b.id === cmd.buildingId);
        uncertain = true;
        if (!b) { blocked = true; notes.push('No known station details; inspect before refining.'); break; }
        const resource = STATION_RESOURCE[b.kind];
        target = b; work = BALANCE.refineTicks[b.tier];
        if (!resource || b.ownerId !== c.id || b.health <= 0 || !canRefine(b.tier, cmd.fromTier, cmd.direction) || observation.markets.some(o => o.item === `building:${b.id}` && o.side === 'sell')) {
          blocked = true; notes.push('Last observed station cannot operate: check kind, ownership, health, listing and tier.');
        }
        if (resource && canRefine(b.tier, cmd.fromTier, cmd.direction)) { costs = refinementRecipe(resource, cmd.fromTier, cmd.direction); output = refinementOutput(resource, cmd.fromTier, cmd.direction); }
        notes.push('Station existence, ownership and access remain conditional.');
        break;
      }
      case 'loot': {
        const l = tiles.flatMap(t => t.loot).find(l => l.id === cmd.lootId);
        uncertain = true; work = BALANCE.lootTicks;
        if (!l) { blocked = true; notes.push('Unknown loot.'); } else target = l;
        notes.push('Loot contents are private/unknown and may be taken first; no inventory or gold yield is invented.');
        break;
      }
      default: blocked = true; notes.push('Unsupported forecast command.');
    }
    if (['harvest', 'refine', 'loot', 'build'].includes(cmd.type) && distance(m, target) > BALANCE.sightRadius) {
      blocked = true;
      notes.push('Target is outside predicted sight at activation. Add an explicit move to its last-known location before this command; it does not autonomously travel from outside sight.');
    }
    const travel = Math.max(0, distance(m, target) - (cmd.type === 'build' && cmd.kind === 'wall' ? 1 : 0)) * BALANCE.moveTicks;
    if (travel > 0) { uncertain = true; notes.push('Travel estimate assumes a shortest open route; hidden walls and detours have no known upper bound.'); }
    const deficits = Object.entries(costs).filter(([key, n]) => quantity(m, key) < n);
    if (!blocked && deficits.length && deficits.every(([key]) => discoveryDependent.has(key))) {
      notes.push('Inputs are discovery-dependent: this action may fail at activation. No unknown yield or dependent output is added to the numeric scenario.');
      for (const key of Object.keys(output)) discoveryDependent.add(key);
      return { costs, warnings: notes, blocked: false, uncertain: true, nominal: 0 };
    }
    if (blocked || !pay(m, costs)) {
      if (!blocked) notes.push('Insufficient carried inputs at activation in this scenario; at least one deficit has no modeled source.');
      return { costs, warnings: notes, blocked: true, uncertain, nominal: 0 };
    }
    const duration = travel + work;
    // Output arrives on the final physical tick, before that tick's meal.
    const spent = advance(m, Math.max(0, duration - 1), stop);
    if (!matches(m, stop) && m.health > 0 && (duration === 0 || spent === duration - 1)) {
      for (const [key, n] of Object.entries(output)) m.inventory[key] = quantity(m, key) + n;
      if (duration) advance(m, 1, stop);
      if (cmd.type === 'harvest' && success) availableAt.set(cmd.depositId, m.elapsed + BALANCE.regrowTicks);
      if (cmd.type !== 'build' || cmd.kind !== 'wall') { m.x = target.x; m.y = target.y; }
    } else {
      // Early cancellation returns unconsumed recipe reservations.
      for (const [key, n] of Object.entries(costs)) m.inventory[key] = quantity(m, key) + n;
    }
    return { costs, warnings: notes, blocked: false, uncertain, nominal: duration };
  }

  for (const [index, step] of spec.steps.entries()) {
    const beforeGood = good.elapsed, beforePoor = poor.elapsed;
    const notes: string[] = [], stepAssumptions: string[] = [];
    let costs: Inventory = {}, feasible: ForecastStep['feasibility'] = 'likely', uncertain = false;
    if (review) { feasible = 'skipped'; notes.push('Not projected past an earlier failure with onFailure review.'); }
    else if (matches(good, step.stopWhen) && matches(poor, step.stopWhen)) { feasible = 'skipped'; notes.push('stopWhen is already satisfied.'); }
    else if (step.type === 'wait') {
      advance(good, step.ticks, step.stopWhen); advance(poor, step.ticks, step.stopWhen);
      if (bounded(step.ticks) !== step.ticks) notes.push(`Forecast wait model capped at ${LIMIT} ticks.`);
    } else if (step.type === 'command') {
      const a = command(good, step.command, true, step.stopWhen), b = command(poor, step.command, false, step.stopWhen);
      costs = a.costs; notes.push(...a.warnings, ...b.warnings); uncertain = a.uncertain || b.uncertain;
      feasible = a.blocked && b.blocked ? 'blocked' : a.blocked || b.blocked || uncertain ? 'conditional' : 'likely';
    } else {
      uncertain = true; feasible = 'conditional';
      const key = `${step.resource}:${step.tier}`, limit = bounded(step.maxTicks);
      const needsWork = (m: Model) => step.targetQuantity === undefined || quantity(m, key) < step.targetQuantity;
      const candidates = deposits.filter(d => d.resource === step.resource && d.tier === step.tier).map(d => ({ ...d, available: availableAt.get(d.id) ?? 0 }));
      notes.push('Gather repeats among locally discovered or remembered matching deposits. Regrowth/yields assume no contention; carried targets include automatic food consumption. No remote stock is refreshed.');
      if (step.targetQuantity === undefined) notes.push('No carried target: continue chosen resource work until maxTicks or stopWhen; the deadline completes the step, not a target failure.');
      stepAssumptions.push('Uncontended scenario uses dated capacity/stock, completion + regrowTicks, shortest travel and the currently projected matching tool.');
      if (needsWork(good) && step.tier > tool(good, step.resource) + 1) {
        feasible = 'blocked'; notes.push(`Carry matching ${MATCHING_TOOL[step.resource]} T${step.tier - 1} or better; the projected tool cannot harvest this tier.`);
      } else if (needsWork(good) && !candidates.length) {
        discoveryDependent.add(key);
        notes.push('No matching deposit is known now. Discovery in future local sight is conditional; inspect on arrival. Yields cannot yet be estimated, and local discovery may fail. Numeric scenarios show zero unknown yield, not a guaranteed inventory bound.');
        if (step.targetQuantity !== undefined) notes.push('The carried target may fail at its deadline; this is conditional, not proof of impossibility. stopWhen can instead end work successfully.');
        stepAssumptions.push('Zero-known-yield scenarios attempt up to the budget; no unseen target, travel destination or output is invented.');
        advance(good, limit, step.stopWhen); advance(poor, limit, step.stopWhen);
      } else {
        while (good.elapsed - beforeGood < limit && needsWork(good) && good.health > 0 && !matches(good, step.stopWhen)) {
          const now = good.elapsed;
          candidates.sort((a, b) => (Math.max(now + distance(good, a) * BALANCE.moveTicks, a.available) - Math.max(now + distance(good, b) * BALANCE.moveTicks, b.available)));
          const d = candidates[0];
          if (!d) break;
          const travel = distance(good, d) * BALANCE.moveTicks;
          const ticks = Math.max(travel, d.available - now) + harvestDuration(d.tier, tool(good, d.resource));
          if (ticks > limit - (good.elapsed - beforeGood)) { advance(good, limit - (good.elapsed - beforeGood), step.stopWhen); break; }
          const spent = advance(good, ticks - 1, step.stopWhen);
          if (spent < ticks - 1 || matches(good, step.stopWhen) || good.health <= 0) break;
          good.inventory[key] = quantity(good, key) + 1;
          advance(good, 1, step.stopWhen); good.x = d.x; good.y = d.y;
          d.available = good.elapsed + BALANCE.regrowTicks;
          availableAt.set(d.id, d.available);
        }
        if (needsWork(poor)) advance(poor, limit, step.stopWhen);
        if (step.targetQuantity !== undefined && quantity(good, key) < step.targetQuantity) notes.push('Carried target is not reached in the uncontended scenario. The step may fail at its deadline; this is conditional, not proof of impossibility. stopWhen can instead end work successfully; death ends all work.');
      }
      if (limit !== step.maxTicks) notes.push(`Forecast gather model capped at ${LIMIT} ticks.`);
    }
    if (conditionalReview && feasible !== 'skipped') {
      notes.push('Projection assumes earlier conditional work permits continuation; a failure with onFailure review may prevent this step from starting.');
      if (feasible === 'likely') feasible = 'conditional';
    }
    if (step.stopWhen) notes.push('stopWhen is checked during modeled ticks and before work; it can end the step early and refund unfinished inputs.');
    if (feasible === 'conditional' && step.onFailure !== 'continue') conditionalReview = true;
    if (feasible === 'blocked' && step.onFailure !== 'continue') review = true;
    if (pending && feasible === 'likely') feasible = 'conditional';
    const duration = range(good.elapsed - beforeGood, poor.elapsed - beforePoor);
    // Finite bounded wait/gather steps are caps on attempted work, not successful yield.
    const boundedStep = step.type !== 'command';
    const time: ForecastTime = { min: step.stopWhen || uncertain ? 0 : duration.min, max: boundedStep ? bounded(step.type === 'wait' ? step.ticks : step.maxTicks) : uncertain ? null : duration.max, conditional: duration };
    steps.push({ index, duration: time, ticks: { min: observation.tick, max: null, conditional: range(observation.tick + good.elapsed, observation.tick + poor.elapsed) }, state: snapshot(good, poor), costsOnSuccess: costs, feasibility: feasible, warnings: [...new Set(notes)], assumptions: stepAssumptions });
  }
  return { mode: spec.mode, observationTick: observation.tick, startDelay, projectedRefund: refunds, steps, state: snapshot(good, poor), feasibility: steps.some(s => s.feasibility === 'blocked') ? 'blocked' : pending || steps.some(s => s.feasibility === 'conditional') ? 'conditional' : 'likely', warnings, assumptions };
}
