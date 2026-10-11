import { TIERS } from '../shared/types.ts';
import { strategyAllowed, type WorldControlOptions } from './evaluation-authority.ts';
import type {
  Citizen,
  Command,
  CommandResult,
  Inventory,
  Point,
  Resource,
  Tier,
  World,
} from '../shared/types.ts';
import type {
  Directive,
  DirectiveState,
  StrategySpec,
  WorkRect,
} from '../shared/directive-types.ts';
import { distance, event, fail, id, itemKey, ok } from '../shared/utils.ts';
import {
  BALANCE,
  buildingRecipe,
  equipmentRecipe,
  MATCHING_TOOL,
  STATION_RESOURCE,
  canRefine,
  refinementRecipe,
} from './config.ts';
import { observe, validateKnownCommand } from './observation.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import { conditionMet } from './plans.ts';
import { parseStrategySpec } from '../citizen/directive-schema.ts';
import { sequencingWarnings } from '../shared/directive-guidance.ts';
import { setAutonomyPolicy, validateAutonomyPolicy } from './autonomy.ts';

export interface DirectiveActions {
  command(command: Command): CommandResult;
  cancel(): void;
}
export const inWorkAreas = (point: Point, areas: WorkRect[]) =>
  areas.some(
    ([x0, y0, x1, y1]) => point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1,
  );
function receipt(
  world: World,
  citizen: Citizen,
  state: DirectiveState,
  outcome: NonNullable<Citizen['directiveReceipts']>[number]['outcome'],
  message: string,
) {
  citizen.directiveReceipts = [
    ...(citizen.directiveReceipts ?? []),
    { tick: world.tick, strategyId: state.id, index: state.index, outcome, message },
  ].slice(-24);
  event(world, 'directive', message, { citizenId: citizen.id, audience: [citizen.id] });
  citizen.lastResult = message;
}
export function discardStrategy(world: World, citizen: Citizen, message = 'Strategy cancelled.') {
  if (!citizen.strategy) return;
  receipt(world, citizen, citizen.strategy, 'cancelled', message);
  delete citizen.strategy;
}
function advance(world: World, citizen: Citizen, message: string, stopped = false) {
  const state = citizen.strategy!;
  receipt(world, citizen, state, stopped ? 'stopped' : 'completed', message);
  state.index++;
  state.progress = 0;
  state.attempted = [];
  delete state.pending;
  delete state.wakeTick;
  delete state.startedTick;
  state.lastProgressTick = world.tick;
  if (state.index >= state.directives.length) state.status = stopped ? 'stopped' : 'completed';
}
function block(world: World, citizen: Citizen, message: string, retainJointCancellation = false) {
  const state = citizen.strategy!;
  state.status = 'blocked';
  state.blockedReason = message;
  // Retain exact lifecycle evidence only for a still-selected joint intent. A
  // later core-consented joint start may reconcile it; blocked execution cannot retry.
  if (!retainJointCancellation) delete state.pending;
  delete state.wakeTick;
  receipt(world, citizen, state, 'blocked', message);
}
/** Validate intent from citizen knowledge only. No inspection of remote prerequisites. */
export function commitStrategy(
  world: World,
  citizenId: string,
  input: StrategySpec,
  actions: DirectiveActions,
  options?: WorldControlOptions,
): CommandResult & { metadataResults?: CommandResult[]; warnings?: string[] } {
  if (!strategyAllowed(citizenId, options))
    return fail('evaluation-authority', 'Strategy commits are disabled for this citizen.');
  let spec: StrategySpec;
  try {
    spec = parseStrategySpec(input);
  } catch (error) {
    return fail('invalid-strategy', (error as Error).message);
  }
  const citizen = world.citizens[citizenId];
  if (!citizen?.alive)
    return fail('unavailable-citizen', 'Only a living citizen can choose a strategy.');
  if (spec.policy) {
    const policyValidation = validateAutonomyPolicy(world, citizen, spec.policy);
    if (!policyValidation.ok) return policyValidation;
  }
  const observation = observe(world, citizenId);
  const tiles = [...observation.visible, ...observation.remembered];
  for (const directive of spec.directives ?? []) {
    if (
      'areas' in directive &&
      directive.areas.some((r) => r[2] >= world.width || r[3] >= world.height)
    )
      return fail(
        'invalid-area',
        `Rectangles must fit x=0..${world.width - 1}, y=0..${world.height - 1}.`,
      );
    if ('x' in directive && (directive.x >= world.width || directive.y >= world.height))
      return fail('invalid-destination', 'Destination must be inside the map.');
    if (directive.type === 'build' && !inWorkAreas(directive, directive.areas))
      return fail('outside-work-area', 'The build site must be within an authorized rectangle.');
    if (directive.type === 'operate') {
      const building = tiles.flatMap((t) => t.buildings).find((b) => b.id === directive.buildingId);
      if (!building) return fail('unknown-station', 'Choose a personally known station ID.');
      if (building.ownerId !== citizenId || !STATION_RESOURCE[building.kind])
        return fail('not-owned-station', 'Choose your own known processing station, not a wall.');
      if (!inWorkAreas(building, directive.areas))
        return fail('outside-work-area', 'Include the station in the work rectangles.');
      if (!canRefine(building.tier, directive.fromTier, directive.direction))
        return fail('invalid-refining-tier', 'This adjacent-tier conversion is outside the station capability.');
    }
    if (directive.type === 'reproduce') {
      const gate = validateKnownCommand(world, citizenId, {
        type: 'reproduce',
        partnerId: directive.partnerId,
      });
      if (!gate.ok) return gate;
    }
  }
  for (const message of spec.communications ?? []) {
    const gate = validateKnownCommand(world, citizenId, { type: 'message', ...message });
    if (!gate.ok) return gate;
  }
  const old = citizen.strategy;
  const retained =
    spec.mode === 'append' && old?.status === 'active' ? old.directives.slice(old.index) : [];
  if (retained.length + (spec.directives?.length ?? 0) > 4)
    return fail(
      'strategy-full',
      'At most four remaining directives; explicitly keep or replace instead.',
    );
  if (spec.mode === 'replace') actions.cancel();
  if (spec.mode !== 'keep') {
    if (spec.mode === 'append' && old?.status === 'active' && citizen.strategy === old) {
      // Preserve the exact active directive and its pending action/progress.
      old.directives = [...old.directives.slice(old.index), ...(spec.directives ?? [])];
      old.index = 0;
      old.reviewTick = world.tick + (spec.reviewAfter ?? 600);
      receipt(
        world,
        citizen,
        old,
        'accepted',
        'Additional directives appended; current work retained.',
      );
    } else {
      discardStrategy(world, citizen, 'Previous strategy replaced by a new decision.');
      const directives = spec.directives ?? [];
      citizen.strategy = {
        id: id(world, 'strategy'),
        approvedTick: world.tick,
        directives,
        index: 0,
        status: directives.length ? 'active' : 'completed',
        reviewTick: world.tick + (spec.reviewAfter ?? 600),
        progress: 0,
        lastProgressTick: world.tick,
        attempted: [],
      };
      receipt(
        world,
        citizen,
        citizen.strategy,
        'accepted',
        'Strategy committed; execution will handle travel, local discovery and required inputs.',
      );
    }
  } else if (old) old.reviewTick = world.tick + (spec.reviewAfter ?? 600);
  else
    citizen.strategy = {
      id: id(world, 'strategy'),
      approvedTick: world.tick,
      directives: [],
      index: 0,
      status: 'completed',
      reviewTick: world.tick + (spec.reviewAfter ?? 600),
      progress: 0,
      lastProgressTick: world.tick,
      attempted: [],
    };
  const metadataResults: CommandResult[] = [];
  if (spec.policy) metadataResults.push(setAutonomyPolicy(world, citizen, spec.policy));
  if (spec.memory !== undefined)
    metadataResults.push(actions.command({ type: 'remember', text: spec.memory }));
  if (spec.goals !== undefined)
    metadataResults.push(actions.command({ type: 'goals', goals: spec.goals }));
  for (const message of spec.communications ?? [])
    metadataResults.push(actions.command({ type: 'message', ...message }));
  const warnings =
    citizen.strategy?.status === 'active'
      ? sequencingWarnings(citizen.strategy.directives, citizen.strategy.index)
      : [];
  return {
    ...ok(
      spec.mode === 'keep'
        ? 'Current execution retained; reflection does not expire work.'
        : 'Strategy accepted and running independently. No approval response needed.',
    ),
    metadataResults,
    ...(warnings.length ? { warnings } : {}),
  };
}
/** Only executor-owned gathering handles depletion by waiting and retrying locally. */
export function isDirectiveGatherRetry(
  citizen: Citizen,
  command: Command,
  result: CommandResult,
  actionId?: string,
): boolean {
  const state = citizen.strategy;
  return (
    !result.ok &&
    result.code === 'depleted-deposit' &&
    command.type === 'harvest' &&
    state?.status === 'active' &&
    !citizen.emergency &&
    !citizen.plan &&
    !citizen.queue.length &&
    (actionId === undefined ||
      (state.pending?.actionId === actionId && state.pending.purpose === 'gather'))
  );
}
/** Called only by the authoritative joint-start transaction, after readiness and
 * mutual consent checks. Bind the actor's own matching intent to the actual shared
 * ID before an older travel/cancellation receipt can displace it. A block from
 * that exact joint-cancellation receipt may also reconcile after core tick order
 * has consumed it. Other blockers and terminal/discarded intents remain untouched.
 * Never infer consent or adopt arbitrary live work. */
export function directiveJointActionStarted(world: World, citizen: Citizen): void {
  const state = citizen.strategy;
  const action = citizen.action;
  const directive = state?.directives[state.index];
  const staleJointBlock =
    state?.status === 'blocked' &&
    state.pending?.purpose === 'work' &&
    state.pending.result?.code === 'joint-cancelled' &&
    !state.pending.result.ok &&
    state.blockedReason === state.pending.result.message;
  const partner = action?.partnerId ? world.citizens[action.partnerId] : undefined;
  if (
    !state ||
    (state.status !== 'active' && !staleJointBlock) ||
    !citizen.alive ||
    !partner?.alive ||
    partner.action?.id !== action?.id ||
    partner.action?.partnerId !== citizen.id ||
    partner.action?.command.type !== 'reproduce' ||
    partner.action.command.partnerId !== citizen.id ||
    directive?.type !== 'reproduce' ||
    action?.command.type !== 'reproduce' ||
    action.partnerId !== directive.partnerId ||
    action.command.partnerId !== directive.partnerId ||
    citizen.emergency ||
    citizen.plan ||
    citizen.queue.length
  )
    return;
  state.status = 'active';
  delete state.blockedReason;
  state.startedTick ??= world.tick;
  state.lastProgressTick = world.tick;
  state.pending = { actionId: action.id, purpose: 'work' };
  delete state.wakeTick;
}
export function directiveActionResult(
  citizen: Citizen,
  actionId: string,
  result: CommandResult,
): void {
  if (citizen.strategy?.pending?.actionId === actionId)
    citizen.strategy.pending.result = { ...result };
}
function issue(
  world: World,
  citizen: Citizen,
  command: Command,
  purpose: NonNullable<DirectiveState['pending']>['purpose'],
  actions: DirectiveActions,
): CommandResult {
  const gate = validateKnownCommand(world, citizen.id, command, 'activation');
  if (!gate.ok) return gate;
  const result = actions.command(command);
  if (result.ok && citizen.action)
    citizen.strategy!.pending = { actionId: citizen.action.id, purpose };
  return result;
}
const attempt = (state: DirectiveState, key: string) => {
  if (!state.attempted.includes(key)) state.attempted.push(key);
};
/** Coverage uses only current sight and dated sightings, never remote truth. */
function explorationFeedback(world: World, citizen: Citizen, areas: WorkRect[]): string {
  const observation = observe(world, citizen.id);
  const known = new Set(
    [...observation.visible, ...observation.remembered].map((tile) => `${tile.x},${tile.y}`),
  );
  const unseen = new Set<string>();
  for (const [x0, y0, x1, y1] of areas)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (!known.has(`${x},${y}`)) unseen.add(`${x},${y}`);
  const coverage = unseen.size
    ? `${unseen.size} unseen tiles remain; executor could not start further exploration moves. Their contents and the cause are unknown.`
    : 'fully observed through current sight or dated sightings, not a live remote scan.';
  return `Authorized rectangles ${JSON.stringify(areas)}: ${coverage} This does not establish enclosure or global resource absence. Choose new areas explicitly or another supply method.`;
}
/** Discover only through actual movement/sight, not a hidden resource search. */
function explore(
  world: World,
  citizen: Citizen,
  areas: WorkRect[],
  actions: DirectiveActions,
): boolean {
  const state = citizen.strategy!;
  const observation = observe(world, citizen.id);
  const known = new Set(
    [...observation.visible, ...observation.remembered].map((t) => `${t.x},${t.y}`),
  );
  const choices: Point[] = [];
  const seen = new Set<string>();
  for (const [x0, y0, x1, y1] of areas)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}`;
        if (!seen.has(key) && !known.has(key) && !state.attempted.includes(`tile:${key}`))
          choices.push({ x, y });
        seen.add(key);
      }
  choices.sort((a, b) => distance(citizen, a) - distance(citizen, b) || a.y - b.y || a.x - b.x);
  for (const point of choices) {
    attempt(state, `tile:${point.x},${point.y}`);
    if (issue(world, citizen, { type: 'move', ...point }, 'explore', actions).ok) return true;
  }
  return false;
}
function gather(
  world: World,
  citizen: Citizen,
  resource: Resource,
  tier: Tier,
  areas: WorkRect[],
  actions: DirectiveActions,
  preparation?: { item: string; required: number; available: number },
) {
  const state = citizen.strategy!;
  const gatherBlock = (message: string) => {
    const prefix = preparation
      ? `Preparing ${state.directives[state.index].type} directive index ${state.index} (zero-based): ${preparation.item} required ${preparation.required}, currently available ${preparation.available} unreserved. Authorized rectangles ${JSON.stringify(areas)}. `
      : '';
    block(
      world,
      citizen,
      `${prefix}${message}${
        preparation
          ? ' Choose new areas explicitly, buy inputs explicitly, or replace the parent directive.'
          : ''
      }`,
    );
  };
  const kind = MATCHING_TOOL[resource];
  const level = highestToolTier(citizen, kind);
  if (tier > level + 1) {
    gatherBlock(
      `Gathering ${resource}:${tier} requires a carried matching tool; choose an equipment investment or another supply method.`,
    );
    return;
  }
  const observation = observe(world, citizen.id);
  const matches = (d: { resource: Resource; tier: Tier; x: number; y: number }) =>
    d.resource === resource && d.tier === tier && inWorkAreas(d, areas);
  const visible = observation.visible.flatMap((t) => t.deposits).filter(matches);
  const dated = observation.remembered.flatMap((t) => t.deposits).filter(matches);
  const nearest = <T extends Point>(values: T[]) =>
    values.sort((a, b) => distance(citizen, a) - distance(citizen, b))[0];
  const stocked = nearest(
    visible.filter((d) => d.stock > 0 && !state.attempted.includes(`busy:${d.id}`)),
  );
  if (stocked) {
    const result = issue(
      world,
      citizen,
      { type: 'harvest', depositId: stocked.id },
      'gather',
      actions,
    );
    if (!result.ok) {
      if (result.code === 'depleted-deposit') {
        attempt(state, `busy:${stocked.id}`);
        state.wakeTick = world.tick + BALANCE.moveTicks;
      } else if (result.code === 'unreachable') attempt(state, `busy:${stocked.id}`);
      else gatherBlock(result.message);
    }
    return;
  }
  const destination = nearest(dated.filter((d) => !state.attempted.includes(`site:${d.id}`)));
  if (destination) {
    attempt(state, `site:${destination.id}`);
    const result = issue(
      world,
      citizen,
      { type: 'move', x: destination.x, y: destination.y },
      'travel',
      actions,
    );
    if (!result.ok) state.wakeTick = world.tick + BALANCE.moveTicks;
    return;
  }
  if (explore(world, citizen, areas, actions)) return;
  if (visible.length || dated.length) {
    if (world.tick - state.lastProgressTick >= 600) {
      gatherBlock(
        `No harvesting progress for 600 ticks within the permitted ${resource}:${tier} work areas ${JSON.stringify(areas)}; choose how to proceed.`,
      );
      return;
    }
    // Dated availability is only a retry estimate. Never inspect remote stock.
    const available = visible.map((d) =>
      d.regrowAt > world.tick ? d.regrowAt : world.tick + BALANCE.moveTicks,
    );
    state.wakeTick = Math.min(world.tick + BALANCE.regrowTicks, ...available);
    state.attempted = state.attempted.filter(
      (key) => !key.startsWith('busy:') && !key.startsWith('site:'),
    );
    return;
  }
  gatherBlock(
    `Work areas explored or inaccessible: no personally known ${resource}:${tier} supply. ${explorationFeedback(world, citizen, areas)}`,
  );
}
function inside(
  world: World,
  citizen: Citizen,
  areas: WorkRect[],
  actions: DirectiveActions,
): boolean {
  if (inWorkAreas(citizen, areas)) return true;
  const destinations = areas
    .map(([x0, y0, x1, y1]) => ({
      x: Math.max(x0, Math.min(x1, citizen.x)),
      y: Math.max(y0, Math.min(y1, citizen.y)),
    }))
    .sort((a, b) => distance(citizen, a) - distance(citizen, b));
  for (const destination of destinations)
    if (issue(world, citizen, { type: 'move', ...destination }, 'travel', actions).ok) return false;
  block(world, citizen, 'No route into an authorized work area.');
  return false;
}
function prepare(
  world: World,
  citizen: Citizen,
  cost: Inventory,
  areas: WorkRect[],
  actions: DirectiveActions,
): boolean {
  for (const [item, amount] of Object.entries(cost))
    if ((citizen.inventory[item] ?? 0) < amount) {
      const [resource, tier] = item.split(':');
      gather(world, citizen, resource as Resource, Number(tier) as Tier, areas, actions, {
        item,
        required: amount,
        available: citizen.inventory[item] ?? 0,
      });
      return false;
    }
  return true;
}
/** Tick-owned state machine. Legacy work and starvation feeding retain priority. */
export function advanceDirectives(world: World, citizen: Citizen, actions: DirectiveActions, options?: WorldControlOptions): void {
  if (!strategyAllowed(citizen.id, options)) return;
  const state = citizen.strategy;
  if (
    !state ||
    state.status !== 'active' ||
    !citizen.alive ||
    citizen.emergency ||
    citizen.plan ||
    citizen.queue.length
  )
    return;
  const directive = state.directives[state.index];
  if (!directive) {
    state.status = 'completed';
    return;
  }
  if (state.startedTick === undefined) {
    if (citizen.action) return; // Append begins after previously selected physical work.
    state.startedTick = world.tick;
    state.lastProgressTick = world.tick;
  }
  const chosenStop =
    ('stopWhen' in directive && directive.stopWhen && conditionMet(citizen, directive.stopWhen)) ||
    ('maxTicks' in directive &&
      directive.maxTicks !== undefined &&
      world.tick - state.startedTick >= directive.maxTicks);
  // A completed physical output on the boundary counts before a time/condition stop.
  if (chosenStop && !state.pending?.result?.ok) {
    if (state.pending && citizen.action?.id === state.pending.actionId) actions.cancel();
    advance(world, citizen, 'Chosen directive stop condition or time limit reached.', true);
    return;
  }
  if (state.pending) {
    if (citizen.action?.id === state.pending.actionId) return;
    if (citizen.action) {
      block(world, citizen, 'Directive displaced by unrelated physical work.');
      return;
    }
    const { result, purpose } = state.pending;
    if (!result?.ok) {
      if (purpose === 'gather' && result?.code === 'depleted-deposit') {
        delete state.pending;
        state.wakeTick = world.tick + BALANCE.moveTicks;
        return;
      }
      const message = result?.message ?? 'Physical execution ended without a completion receipt.';
      block(
        world,
        citizen,
        purpose === 'explore' && directive.type === 'explore'
          ? `${message} Exploration stopped within authorized rectangles ${JSON.stringify(directive.areas)}. This does not establish full observation, enclosure or global resource absence. Retry or choose new areas explicitly.`
          : message,
        directive.type === 'reproduce' && purpose === 'work' && result?.code === 'joint-cancelled',
      );
      return;
    }
    delete state.pending;
    if (
      purpose === 'work' ||
      purpose === 'gather' ||
      (purpose === 'explore' && directive.type === 'explore')
    )
      state.lastProgressTick = world.tick;
    if (purpose === 'work' || (purpose === 'gather' && directive.type === 'gather'))
      state.progress++;
    if (
      (purpose === 'work' &&
        (directive.type === 'craft'
          ? state.progress >= (directive.quantity ?? 1)
          : directive.type !== 'operate')) ||
      directive.type === 'move'
    ) {
      advance(world, citizen, `Completed ${directive.type} directive.`);
      return;
    }
    if (
      'quantity' in directive &&
      directive.quantity !== undefined &&
      state.progress >= directive.quantity
    ) {
      advance(world, citizen, `Completed ${directive.quantity} new units for ${directive.type}.`);
      return;
    }
  }
  if (chosenStop) {
    advance(world, citizen, 'Chosen directive stop condition or time limit reached.', true);
    return;
  }
  if (citizen.action) return;
  if (state.wakeTick && world.tick < state.wakeTick) return;
  delete state.wakeTick;
  if (directive.type === 'move') {
    const result = issue(
      world,
      citizen,
      { type: 'move', x: directive.x, y: directive.y },
      'work',
      actions,
    );
    if (!result.ok) block(world, citizen, result.message);
    return;
  }
  if (directive.type === 'explore') {
    if (!explore(world, citizen, directive.areas, actions))
      advance(world, citizen, explorationFeedback(world, citizen, directive.areas));
    return;
  }
  if (directive.type === 'gather') {
    gather(world, citizen, directive.resource, directive.tier, directive.areas, actions);
    return;
  }
  if (directive.type === 'craft') {
    if (
      !prepare(
        world,
        citizen,
        equipmentRecipe(directive.item, directive.tier),
        directive.areas,
        actions,
      ) ||
      !inside(world, citizen, directive.areas, actions)
    )
      return;
    const result = issue(
      world,
      citizen,
      { type: 'craft', item: directive.item, tier: directive.tier },
      'work',
      actions,
    );
    if (!result.ok) block(world, citizen, result.message);
    return;
  }
  if (directive.type === 'build') {
    if (
      !prepare(
        world,
        citizen,
        buildingRecipe(directive.kind, directive.tier),
        directive.areas,
        actions,
      )
    )
      return;
    if (distance(citizen, directive) > BALANCE.sightRadius) {
      const result = issue(
        world,
        citizen,
        { type: 'move', x: directive.x, y: directive.y },
        'travel',
        actions,
      );
      if (!result.ok) block(world, citizen, result.message);
      return;
    }
    const result = issue(
      world,
      citizen,
      { type: 'build', kind: directive.kind, tier: directive.tier, x: directive.x, y: directive.y },
      'work',
      actions,
    );
    if (!result.ok) block(world, citizen, result.message);
    return;
  }
  const observation = observe(world, citizen.id);
  const tiles = [...observation.visible, ...observation.remembered];
  if (directive.type === 'operate') {
    const station = tiles.flatMap((t) => t.buildings).find((b) => b.id === directive.buildingId);
    if (
      !station ||
      station.ownerId !== citizen.id ||
      !STATION_RESOURCE[station.kind] ||
      !inWorkAreas(station, directive.areas)
    ) {
      block(
        world,
        citizen,
        'The chosen station is no longer known, owned or within the work areas.',
      );
      return;
    }
    if (!canRefine(station.tier, directive.fromTier, directive.direction)) {
      block(world, citizen, 'This adjacent-tier conversion is outside the station capability.');
      return;
    }
    const cost = refinementRecipe(STATION_RESOURCE[station.kind]!, directive.fromTier, directive.direction);
    if (!prepare(world, citizen, cost, directive.areas, actions)) return;
    const visible = observation.visible.some((t) => t.buildings.some((b) => b.id === station.id));
    const result = visible
      ? issue(
          world,
          citizen,
          { type: 'refine', buildingId: station.id, fromTier: directive.fromTier, direction: directive.direction },
          'work',
          actions,
        )
      : issue(world, citizen, { type: 'move', x: station.x, y: station.y }, 'travel', actions);
    if (!result.ok) block(world, citizen, result.message);
    return;
  }
  if (directive.type === 'reproduce') {
    if (
      !prepare(
        world,
        citizen,
        { [itemKey('food', BALANCE.reproductionFoodTier)]: BALANCE.reproductionFood },
        directive.areas,
        actions,
      )
    )
      return;
    const partner = tiles.flatMap((t) => t.citizens).find((c) => c.id === directive.partnerId);
    if (!partner) {
      block(
        world,
        citizen,
        'Partner no longer personally located; request contact rather than tracking hidden position.',
      );
      return;
    }
    if (!inWorkAreas(partner, directive.areas)) {
      block(
        world,
        citizen,
        'Partner is outside the selected work areas; choose meeting areas or communicate.',
      );
      return;
    }
    if (distance(citizen, partner) > 1) {
      const result = issue(
        world,
        citizen,
        { type: 'move', x: partner.x, y: partner.y },
        'travel',
        actions,
      );
      if (!result.ok) block(world, citizen, result.message);
      return;
    }
    const result = issue(
      world,
      citizen,
      { type: 'reproduce', partnerId: directive.partnerId },
      'work',
      actions,
    );
    if (!result.ok) block(world, citizen, result.message);
  }
}
