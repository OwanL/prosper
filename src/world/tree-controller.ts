import type { Citizen, Command, DecisionObservation, ReputationLevel, Resource, World } from '../shared/types.ts';
import { MIND_LIMITS, type CitizenMind, type StructuredMemory, type TreeTaskState, type TreeTraceEvent } from '../shared/tree-types.ts';
import { optionalAttackValue } from '../citizen/tree-combat.ts';
import { quotePrice, buyWillingness, knownBuyPrice } from '../citizen/tree-market.ts';
import { backgroundSaleReserves, carriedSurplus, committedReserves, observedDemand } from '../citizen/tree-surplus.ts';
import { CONDITIONS, DELEGATES, foodAcquisitionTicks, stepTreeTask } from '../citizen/tree-actions.ts';
import { chooseOption, initializeDispositions, seededDraw, type PreparedOption } from '../citizen/tree-selection.ts';
import { relationshipContext, updateCommunityWeight, updateMemories } from '../citizen/tree-memory.ts';
import { settlementClaimEligible, settlementOccupancy, territoryLandPressure } from '../citizen/tree-spatial.ts';
import { BALANCE, buildingRecipe, canRefine, equipmentRecipe, nutrition, refinementRecipe } from './config.ts';
import { distance, worldEventHistory } from '../shared/utils.ts';
import { TIERS } from '../shared/tiers.ts';
import { communityBoost, communityVoteOpportunity, territoryJoinValue } from '../citizen/tree-community.ts';
import { observeCommunityVote, observeDecision, observeEntry, validateKnownCommand } from './observation.ts';
import { dispatch } from './core.ts';

export interface TreeCandidate { task: TreeTaskState; forecast: PreparedOption }
/** Common projected decision view for the controller: `observe()` and
 * `observeDecision()` both satisfy it. Own directed opinions are projected
 * through `reputations`; the controller never reads the world's private
 * reputation matrix directly. The decision projection omits the duplicate self
 * notebook (`citizen.knowledge`, carried by visible+remembered) and text
 * surfaces; full public observations remain assignable, so no private-mind or
 * full-notebook claim is made anywhere in the tree contracts. */
export type PersonalObservation = DecisionObservation;
const opinionValue = (level?: ReputationLevel) => ({ hostile: -2, disliked: -1, neutral: 0, positive: 1, admired: 2 })[level ?? 'neutral'];
/** Continuous conscience weighting in score units: the penalty on attack options
 * grows linearly with morals and has no personality cutoff; the shared softmax
 * keeps dominated feasible options at small nonzero probability. */
const MORAL_CONSCIENCE_WEIGHT = 24;
/** Freshness window for engine-attested attacks on this citizen. */
const DANGER_WINDOW_TICKS = 48;
/** Definitions that just failed are not re-selected within this window. */
const FAILURE_COOLDOWN_TICKS = 120;
/** A running task that has done nothing but wait for this many consecutive idle
 * boundaries is an invalid assumption (e.g. a resting sale with no demand or an
 * unfilled bid); the interruption cleanup cancels owned work and orders, and the
 * failure cooldown redirects effort instead of waiting forever. The bound equals
 * the 120-tick admission timeout so legitimate civic waits resolve there first. */
const WAIT_STREAK_TICKS = 120;
/** A failed ObtainResource prerequisite child defers the next attempt once by
 * this window: deposit regrowth and contested-harvest settlement resolve most
 * transient route failures, so the persistent chain retries instead of aborting. */
const PREREQUISITE_RETRY_TICKS = 40;
/** Whole-chain budget for one ObtainTool invocation's prerequisite retries;
 * beyond it a failed child terminates the chain so selection can redirect effort. */
const PREREQUISITE_CHAIN_TICKS = 1200;
/** Pause after an explore success before another frontier survey is offered;
 * bounded idle-free pacing that returns selection to productive work. */
const EXPLORE_FRONTIER_COOLDOWN_TICKS = 60;
/** Failure-cooldown scoping: for these definitions the request's resource/tier
 * is the meaningful goal identity, so a failure of one goal must not lock out
 * the others for the whole window. Invocation ids embed resource and tier. */
const RESOURCE_SCOPED_DEFINITIONS: ReadonlySet<string> = new Set(['ObtainResource', 'ObtainFoodNow', 'Harvest', 'RefineResource', 'BuildResourceBuilding']);
const failureKey = (definitionId: string, invocationId: string): string => {
  const parts = invocationId.split(':');
  if (definitionId === 'Reproduce') return `${definitionId}:${parts[5] ?? ''}`;
  if (!RESOURCE_SCOPED_DEFINITIONS.has(definitionId)) return definitionId;
  return `${definitionId}:${parts[3] ?? ''}:${parts[4] ?? ''}`;
};
/** Short bounded deferral if observed eligibility races with partner work. */
const REPRODUCE_COORDINATION_RETRY_TICKS = 24;
const guards: Record<string, string> = { Harvest: 'CanHarvestResource', ObtainFoodNow: 'CanObtainFoodNow', ObtainResource: 'CanObtainResource', ObtainTool: 'CanObtainTool', CraftTool: 'CanCraftTool', RefineResource: 'CanRefineResource', BuildResourceBuilding: 'CanBuildResourceBuilding', BuildHouse: 'CanBuildHouse', BuildWall: 'CanBuildWall', Sleep: 'CanSleep', SellItem: 'CanSellItem', GiveGift: 'CanGiveGift', Explore: 'CanExplore', Reproduce: 'CanReproduce', AttackCitizen: 'CanAttackCitizen', AttackStructure: 'CanAttackStructure', CreateTerritory: 'CanCreateTerritory', ExpandTerritory: 'CanExpandTerritory', JoinTerritory: 'CanJoinTerritory', LeaveTerritory: 'CanLeaveTerritory' };
function task(o: DecisionObservation, definitionId: string, resource: Resource = 'food', tier = 1): TreeTaskState {
  const id = `${o.citizen.id}:${o.tick}:${definitionId}:${resource}:${tier}`;
  return { id, definitionId, request: { id, resource, tier, quantity: 1, allowMarket: true, purpose: resource === 'food' ? 'Maintain food reserve' : `Produce ${resource}`, urgency: o.citizen.fullness < 30 ? 'survival' : 'routine' }, ancestry: [], phase: 'start', status: 'running', startedTick: o.tick, lastProgressTick: o.tick, delivered: 0, receiptIds: [], ownedOrderIds: [] };
}
/** Preparation reads only personal observations. Estimates are provisional, not promised returns. */
/** Failed deposit evidence is shared across acquisition/harvest definitions for
 * one regrowth window, including reservations absent from tile stock. No
 * synthetic trace rows; fresh stock alone cannot attest an ended reservation. */
function groundedObservation(o: PersonalObservation): PersonalObservation {
  const failed = (o.citizen.mind?.tasks ?? []).filter(t => t.status === 'failed' && t.targetId &&
    o.tick - t.lastProgressTick <= FAILURE_COOLDOWN_TICKS && /depleted|reserved/i.test(t.reason ?? ''));
  const clean = (tiles: DecisionObservation['visible']) => tiles.map(tile => ({ ...tile,
    // Keep deposit occupancy for placement and exploration; only invalidate its
    // harvestable stock. Removing rows would invent free building sites.
    deposits: tile.deposits.map(d => failed.some(t => t.targetId === d.id) ? { ...d, stock: 0 } : d),
  }));
  return { ...o, visible: clean(o.visible), remembered: clean(o.remembered) };
}
const INVITATION_MEMORY_PREFIX = 'Observed family invitation: '; // legacy evidence compatibility
export function prepareTreeCandidates(observation: PersonalObservation): TreeCandidate[] {
  const o = groundedObservation(observation);
  const result: TreeCandidate[] = [];
  /** Unmet family-tool inputs supply search purposes, not speculative station
   * reservations. Only selected running tasks reserve construction stock. */
  const constructionReserve = new Map<string, number>();
  const add = (t: TreeTaskState, benefit: number, affinities: PreparedOption['affinities'] = {}, cost = .15, risk = .05) => {
    let feasible = CONDITIONS[guards[t.definitionId] ?? '']?.evaluate(o, t).ok;
    if (!feasible && (t.definitionId === 'BuildResourceBuilding' || (t.definitionId === 'ObtainTool' && t.targetId))) {
      const [kind, tier] = (t.targetId ?? '').split(':');
      const recipe = t.definitionId === 'BuildResourceBuilding' ? buildingRecipe(({wood:'lumbermill',fibre:'spinning-wheel',food:'butchery'} as const)[t.request.resource], t.request.tier) : equipmentRecipe(kind as 'axe', Number(tier));
      feasible = Object.entries(recipe).every(([item, amount]) => {
        if ((o.citizen.inventory[item] ?? 0) >= amount) return true;
        const [resource, exactTier] = item.split(':');
        const prerequisite = task(o, 'ObtainResource', resource as Resource, Number(exactTier));
        prerequisite.ancestry = [t.definitionId];
        prerequisite.request.quantity = amount - (o.citizen.inventory[item] ?? 0);
        return CONDITIONS.CanObtainResource!.evaluate(o, prerequisite).ok;
      });
    }
    if (!feasible) return;
    if (t.definitionId === 'Reproduce') t.id += `:${t.targetId}`;
    t.id += `:${result.length}`; t.request.id = t.id;
    result.push({ task: t, forecast: { id: t.id, feasible: true, benefit, cost, risk, delay: .15, uncertainty: .2, affinities } });
  };
  const hunger = 1 - o.citizen.fullness / 100;
  const knownPeers = new Map([...o.remembered, ...o.visible].flatMap(tile => tile.citizens)
    .filter(c => c.alive && c.id !== o.citizen.id).map(c => [c.id, c]));
  const missingFamilyFood = BALANCE.reproductionFood - (o.citizen.inventory[`food:${BALANCE.reproductionFoodTier}`] ?? 0);
  const intendedPartner = [...knownPeers.keys()][0];
  const familyAffinities = { familyOrientation: 1, sociability: .5 };
  const familyBenefit = .8;
  const familyPurpose = (purpose: string) => intendedPartner ? `${purpose}; family intention toward ${intendedPartner}` : purpose;
  const familyReady = knownPeers.size > 0 && o.citizen.health >= BALANCE.reproductionHealth && o.citizen.reproductionCooldown <= o.tick;
  for (const resource of ['food', 'wood', 'fibre'] as const) for (const tier of TIERS) {
    for (const def of ['ObtainResource', 'Harvest', 'RefineResource']) {
      const t = task(o, def, resource, tier);
      // Select exact station/direction before stepping: the leaf captures its
      // direction at entry, so selection and execution must be separate phases.
      if (def === 'RefineResource') {
        const kind = { food: 'butchery', wood: 'lumbermill', fibre: 'spinning-wheel' }[resource];
        const choice = (['up', 'down'] as const).flatMap(direction => {
          const from = tier + (direction === 'up' ? -1 : 1);
          return [...o.visible, ...o.remembered].flatMap(tile => tile.buildings.filter(b => b.kind === kind && b.ownerId === o.citizen.id && b.health > 0 &&
            canRefine(b.tier, from, direction) && Object.entries(refinementRecipe(resource, from, direction)).every(([item, n]) => (o.citizen.inventory[item] ?? 0) >= n))
            .map(b => ({ b, direction, tile })));
        })[0];
        if (!choice) continue;
        t.targetId = choice.b.id; t.target = { x: choice.tile.x, y: choice.tile.y };
        t.strategyId = `refine-${choice.direction}`; t.phase = 'travel:0';
      }
      const item = `${resource}:${tier}`;
      const held = (o.citizen.inventory[item] ?? 0) + o.markets.filter(x => x.citizenId === o.citizen.id && x.side === 'sell' && x.item === item).reduce((n,x) => n + x.quantity, 0);
      const profitable = resource !== 'food' || o.markets.some(order => order.citizenId !== o.citizen.id && order.side === 'buy' && order.item === item && order.price >= quotePrice(o, item));
      const demand = profitable ? observedDemand(o, item) : 0;
      const readySurplus = carriedSurplus(o, item);
      const use = (committedReserves(o)[item] ?? 0) > held || (resource === 'food' ? demand > readySurplus && readySurplus <= 0 : demand > held);
      if (!use && (resource !== 'food' || held * nutrition(tier) >= Math.max(20, 60 - o.citizen.fullness))) continue;
      add(t, resource === 'food' ? Math.max(hunger, demand > 0 && readySurplus <= 0 ? .9 : 0) : .35, { economicIndependence: 1, ambition: .3, ...(resource === 'food' && demand > 0 ? { enterprise: .6 } : {}) });
    }
    if (resource === 'food') add(task(o, 'ObtainFoodNow', resource, tier), hunger, { economicIndependence: -1 }, .1);
    const stationKind = { food: 'butchery', wood: 'lumbermill', fibre: 'spinning-wheel' } as const;
    const owned = [...o.visible, ...o.remembered].some(tile => tile.buildings.some(b => b.ownerId === o.citizen.id && b.kind === stationKind[resource] && b.tier >= tier && b.health > 0));
    if (!owned) {
      add(task(o, 'BuildResourceBuilding', resource, tier), .35, { enterprise: 1, ambition: 1 }, .5);
    }
  }
  for (const kind of ['axe', 'scythe', 'knife', 'sword']) for (const tier of TIERS) {
    if ((o.citizen.inventory[`${kind}:${tier}`] ?? 0) > 0) continue;
    for (const def of ['ObtainTool', 'CraftTool']) { const t = task(o, def, 'wood', tier); t.targetId = `${kind}:${tier}`; add(t, .4, { enterprise: 1, patience: .5 }, .35); }
  }
  for (const def of ['BuildHouse', 'BuildWall', 'CreateTerritory']) add(task(o, def, 'wood'), .35, { ambition: 1, enterprise: 1 }, .4);
  const sleep = task(o, 'Sleep'); sleep.request.quantity = 85;
  // Sleep safety: resting through actual starvation drains health to death while
  // a remedy could still gather food, so rest keeps candidacy only while some
  // fullness remains; food work outranks sleep at actual starvation.
  if (o.citizen.fullness > 0) add(sleep, 1 - (o.citizen.rest?.value ?? 100) / 100, { patience: .3 }, .05);
  // Ordinary exploration surveys genuinely unknown land. Merely moving a known
  // deposit out of sight is not a new need: that old goal caused repeated short
  // refresh successes rather than motivated frontier trips.
  const exploration = task(o, 'Explore');
  // A pending construction material with no observed supply at all is the search
  // purpose itself: frontier walking stops as soon as the needed resource tier
  // is sighted (goal evidence appears in the same request contract).
  // Missing family provisions need a search candidate even when procurement's
  // route guard rejects them. Previously rejection erased the goal entirely.
  const searchReserves = new Map(constructionReserve);
  if (familyReady && missingFamilyFood > 0) searchReserves.set(`food:${BALANCE.reproductionFoodTier}`, BALANCE.reproductionFood);
  const familyItem = `food:${BALANCE.reproductionFoodTier}`;
  const searchPurpose = [...searchReserves.entries()].sort(([a], [b]) => Number(b === familyItem) - Number(a === familyItem)).find(([item]) => {
    const [resource, tierText] = item.split(':');
    const supplyKnown = [...o.visible, ...o.remembered].some(tile =>
      tile.deposits.some(d => d.resource === resource && d.tier === Number(tierText)));
    if (supplyKnown) return false;
    return !o.markets.some(order => order.item === item && order.side === 'sell' && order.citizenId !== o.citizen.id);
  });
  if (searchPurpose) {
    const [resource, tierText] = searchPurpose[0].split(':');
    exploration.request.purpose = searchPurpose[0] === familyItem ? familyPurpose(`deposit ${resource} T${tierText}`) : `deposit ${resource} T${tierText}`;
  } else {
    exploration.request.purpose = 'Survey the frontier for unknown land';
  }
  // A frontier survey right after any explore success offers nothing the just-
  // gained information did not; a bounded pause returns the selection to real
  // work without touching goal-directed searches. Trace-dated, no new state.
  // Food-urgent citizens are never throttled: the search may be their remedy.
  const lastExploreSuccess = [...o.citizen.mind?.trace ?? []].reverse()
    .find(entry => entry.transition === 'succeed' && entry.definitionId === 'Explore');
  const frontierOnly = !searchPurpose;
  if (!frontierOnly || hunger > 0.5 || !lastExploreSuccess || o.tick - lastExploreSuccess.tick > EXPLORE_FRONTIER_COOLDOWN_TICKS)
    add(exploration, searchPurpose?.[0] === familyItem ? .7 : .25 + hunger * .3,
      { riskTolerance: .4, ...(searchPurpose?.[0] === familyItem ? { familyOrientation: 1 } : {}) }, .2);
  const surplus = (item: string) => carriedSurplus(o, item);
  const familyReserve = (item: string, _quantity: number) => surplus(item) < 1;
  const constructionReserveMet = (item: string, _quantity: number) => surplus(item) <= 0;
  for (const [item, quantity] of Object.entries(o.citizen.inventory))
    if (surplus(item) > 0) {
      const t = task(o, 'SellItem'); t.targetId = item; t.request.quantity = surplus(item);
      add(t, item.startsWith('food:') ? (observedDemand(o, item) > 0 ? 1.2 : .15) : .6 + Math.min(.5, t.request.quantity / 20), { ambition: .5, ...(item.startsWith('food:') && observedDemand(o, item) > 0 ? { enterprise: .5 } : {}) });
    }
  const peers = new Map(o.visible.flatMap(tile => tile.citizens).filter(c => c.alive && c.id !== o.citizen.id).map(c => [c.id, c]));
  let bestPredation: { peerId: string; value: NonNullable<ReturnType<typeof optionalAttackValue>> } | undefined;
  for (const peer of peers.values()) {
    const relation = relationshipContext(o, o.citizen.mind?.memories ?? [], peer.id);
    const family = o.citizen.parents.includes(peer.id);
    // Continuous grievance from dated personal evidence: directed opinion and
    // remembered harm scale desire and vengefulness; no hostile/not-hostile cutoff.
    const grievance = Math.min(1, Math.max(0, -opinionValue(o.reputations?.[peer.id])) / 2 + (relation?.harm ?? 0) / 2);
    // Negative opinions alone do not attest harm. Fresh victim alerts also work
    // before they have been folded into durable personal memory.
    const harmed = (relation?.harm ?? 0) > 0 || o.alerts.some(e => e.kind === 'attack' && e.citizenId === peer.id && e.targetId === o.citizen.id);
    if (harmed) {
      const attack = task(o, 'AttackCitizen'); attack.targetId = peer.id;
      add(attack, .05 + .45 * Math.max(.5, grievance), { morals: -1, vengefulness: Math.max(.5, grievance), riskTolerance: .5 }, .6, .8);
    } else {
      const value = optionalAttackValue(o, peer);
      if (value && value.gain > 0 && (!bestPredation || value.gain > bestPredation.value.gain ||
        (value.gain === bestPredation.value.gain && peer.id.localeCompare(bestPredation.peerId) < 0))) bestPredation = { peerId: peer.id, value };
    }
    for (const [item, quantity] of Object.entries(o.citizen.inventory))
      if (quantity > 2 && !familyReserve(item, quantity) && !constructionReserveMet(item, quantity)) {
        const gift = task(o, 'GiveGift'); gift.targetId = peer.id; gift.strategyId = item;
      add(gift, family ? .5 : .2, { generosity: 1, sociability: .5, familyOrientation: family ? 1 : 0 }, .3);
    }
  }
  // One partner-specific preparation opportunity avoids duplicate procurement
  // options; each known partner still offers its own ready reproduction option.
  // No partner's private inventory or willingness is inferred.
  for (const peer of knownPeers.values()) {
    const reproduction = task(o, 'Reproduce'); reproduction.targetId = peer.id;
    reproduction.request.purpose = `Form a family; family intention toward ${peer.id}`;
    // Readiness is observed; the engine alone checks the partner's reserves.
    add(reproduction, 1, familyAffinities, .35);
  }
  if (familyReady && missingFamilyFood > 0) {
    const provision = task(o, 'ObtainResource', 'food', BALANCE.reproductionFoodTier);
    provision.request.quantity = missingFamilyFood; provision.request.purpose = familyPurpose('Prepare own family provisions');
    add(provision, familyBenefit, familyAffinities, .35);
  }
  // One ticket, not one per bystander: crowds do not amplify pure predation.
  if (bestPredation) {
    const attack = task(o, 'AttackCitizen'); attack.targetId = bestPredation.peerId; attack.strategyId = 'optional-predation';
    add(attack, bestPredation.value.benefit, { morals: -1, riskTolerance: .5, ambition: .3 }, .6, bestPredation.value.risk);
  }
  for (const territory of o.territories ?? []) {
    for (const def of ['JoinTerritory', 'LeaveTerritory', 'ExpandTerritory']) { const t = task(o, def, 'wood'); t.targetId = territory.id; add(t, .25, { sociability: def === 'LeaveTerritory' ? -1 : 1, ambition: def === 'ExpandTerritory' ? 1 : 0 }, .3); }
  }
  for (const tile of o.visible) for (const b of tile.buildings) if (b.ownerId !== o.citizen.id) { const t = task(o, 'AttackStructure'); t.targetId = b.id; add(t, .05, { morals: -1, vengefulness: .5 }, .6, .7); }
  // Signs are executable attack candidates through the same AttackStructure
  // executor (attack-sign commands); dated sign evidence keeps them honest.
  for (const sign of o.signs ?? []) { const t = task(o, 'AttackStructure', 'wood'); t.targetId = sign.id; add(t, .05, { morals: -1, vengefulness: .5 }, .6, .7); }
  // Spatial forecasts retain dated evidence; not an omniscient placement map.
  for (const c of result) {
    if (!['CreateTerritory', 'ExpandTerritory'].includes(c.task.definitionId)) continue;
    const anchors = (o.signs ?? []).filter(s => s.territoryId === c.task.targetId);
    const feasible = o.visible.filter(tile => settlementClaimEligible(o, tile) &&
      (c.task.definitionId === 'CreateTerritory' || anchors.some(a => Math.abs(a.x - tile.x) + Math.abs(a.y - tile.y) === 1)));
    // Usable settlement space and shared buildings dominate resource potential;
    // resource evidence contributes only on an actually feasible target tile.
    const value = Math.max(0, ...feasible.map(tile => {
      const adjacent = anchors.filter(a => Math.abs(a.x - tile.x) + Math.abs(a.y - tile.y) === 1).length;
      const { shared: building, empty } = settlementOccupancy(o, tile);
      return (.4 + (building ? .35 : empty ? .3 : 0) + Math.min(.15, adjacent * .05) + (tile.deposits.length ? .1 : 0)) /
        (1 + Math.hypot(tile.x - o.citizen.x, tile.y - o.citizen.y) / 20);
    }));
    c.forecast.benefit *= value * (c.task.definitionId === 'ExpandTerritory' ? 1 + 3 * territoryLandPressure(o, c.task.targetId!) : 1);
  }
  // Safety pull applies only to constructive civic goals, never departure.
  // Benefit units leave disposition affinities and authoritative guards intact.
  for (const c of result) if (['JoinTerritory', 'CreateTerritory', 'ExpandTerritory'].includes(c.task.definitionId))
    c.forecast.benefit += communityBoost(c.task.definitionId === 'JoinTerritory' ? 'join' : c.task.definitionId === 'CreateTerritory' ? 'found' : 'expand', o.citizen.mind?.community?.weight);
  for (const c of result) if (c.task.definitionId === 'JoinTerritory') {
    const territory = o.territories?.find(t => t.id === c.task.targetId);
    if (territory) c.forecast.benefit += territoryJoinValue(o, territory);
  }
  // Rank every eligible known destination, but retain one joining ticket so
  // simply seeing more groups does not multiply the overall joining lottery.
  const joins = result.filter(c => c.task.definitionId === 'JoinTerritory').sort((a, b) =>
    b.forecast.benefit - a.forecast.benefit || a.task.targetId!.localeCompare(b.task.targetId!));
  return result.filter(c => c.task.definitionId !== 'JoinTerritory' || c === joins[0]);
}
/** One shared bounded softmax from tree-selection: no controller-local sampling
 * duplicate and no exploration floor. Moral weighting stays continuous. */
function select(candidates: TreeCandidate[], mind: CitizenMind, seed: number): TreeCandidate | undefined {
  const choice = chooseOption(candidates.map(c => ({
    ...c.forecast,
    bias: c.task.definitionId.startsWith('Attack') ? -MORAL_CONSCIENCE_WEIGHT * mind.dispositions.morals : 0,
  })), mind.dispositions, seed);
  return choice.id ? candidates.find(c => c.forecast.id === choice.id) : undefined;
}
function commit(world: World, citizen: Citizen, command: Command, owner?: TreeTaskState): boolean {
  const gate = validateKnownCommand(world, citizen.id, command);
  if (!gate.ok) { citizen.lastResult = gate.message; return false; }
  const result = dispatch(world, citizen.id, command, 'external', undefined, owner?.request.id ?? null);
  // Even immediately filled orders identify the task's own settlement evidence.
  if (result.ok && result.order && owner && !owner.ownedOrderIds.includes(result.order.id)) {
    owner.ownedOrderIds.push(result.order.id);
  }
  return result.ok;
}
function recordTrace(mind: CitizenMind, tick: number, transition: TreeTraceEvent['transition'], reason: string, invocation: Pick<TreeTaskState, 'id' | 'definitionId' | 'parentId'>, command?: Command): void {
  mind.trace.push({ tick, invocationId: invocation.id, definitionId: invocation.definitionId, ...(invocation.parentId ? { parentId: invocation.parentId } : {}), transition, reason, ...(command ? { command } : {}) });
  if (mind.trace.length > MIND_LIMITS.trace) { mind.trace.shift(); mind.traceOmitted++; }
}
/** Prunes childless terminal goals first until at most `capacity` remain; the
 * default is the shared bound itself. */
function pruneTasks(mind: CitizenMind, capacity: number = MIND_LIMITS.tasks): void {
  while (mind.tasks.length > capacity) {
    const index = mind.tasks.findIndex(t => t.status !== 'running' && !mind.tasks.some(child => child.parentId === t.id));
    if (index < 0) break;
    mind.tasks.splice(index, 1);
  }
}
/** Bounded task admission: creation must cap BEFORE the shared bound is exceeded,
 * never overflow and shrink afterwards. The active ancestry is reserved implicitly
 * and provably: running tasks are never pruned, and a terminal parent of a retained
 * running child is only evicted after that child ends (child-first cascade), so
 * admission pressure evicts childless terminal goals only. Interrupt/Cleanup exit
 * cascades keep `activeTaskId` occupied through every settle step, so at selection
 * time (dangling pointer) no running tasks exist and a pruned-to-full list cannot
 * occur; refusal there is a defensive invariant, not a reachable state. */
function admitTask(mind: CitizenMind): boolean {
  pruneTasks(mind, MIND_LIMITS.tasks - 1);
  return mind.tasks.length < MIND_LIMITS.tasks;
}

// ------------------------------------------------------- personal memory evidence

/** Engine-emitted personal alert kinds mapped to durable memory kinds. Spectator
 * and own command chatter (`command`, `error`, `directive`, `completion`) is
 * deliberately excluded: it would flood bounded memory and evict relationship
 * history that selection actually reads. */
const MEMORY_KINDS: Readonly<Record<string, StructuredMemory['kind']>> = {
  attack: 'harm', death: 'harm', destruction: 'harm', trade: 'trade', help: 'help',
  gift: 'help', birth: 'family', claim: 'territory', meal: 'survival', loot: 'work',
};
function personalEvidence(o: Pick<DecisionObservation, 'tick' | 'alerts'> & { citizen: Pick<Citizen, 'id'> }): StructuredMemory[] {
  const result: StructuredMemory[] = [];
  for (const entry of o.alerts) {
    if (entry.familyInvitation?.toId === o.citizen.id) {
      result.push({ id: entry.id, tick: entry.tick, kind: 'work', otherId: entry.familyInvitation.fromId,
        text: INVITATION_MEMORY_PREFIX + JSON.stringify(entry.familyInvitation) });
      continue;
    }
    const kind = MEMORY_KINDS[entry.kind];
    if (!kind) continue;
    // Witnessing harm to another is not a personal retaliation entitlement.
    if (entry.kind === 'attack' && entry.targetId !== o.citizen.id) continue;
    // Property destruction: the attacker's view lacks the owner identity, so the
    // attacker records no otherId row; the owner does record their wrongdoer.
    if (entry.kind === 'destruction' && entry.citizenId === o.citizen.id) continue;
    result.push({
      id: entry.id, tick: entry.tick, kind,
      otherId: entry.citizenId === o.citizen.id ? entry.targetId : entry.citizenId,
      ...(entry.x !== undefined && entry.y !== undefined ? { location: { x: entry.x, y: entry.y } } : {}),
      text: entry.text,
    });
  }
  return result;
}

// ------------------------------------------------------------------ danger model

interface DangerSignal { key: string; eventId: string; attackerId: string }
/** Engine-attested material danger: a fresh attack event on this citizen, visible
 * through the citizen's own alert projection. Persistent states (hunger, fatigue,
 * empty markets) are deliberately NOT dangers: they persist for many ticks and
 * must not keep interrupting the active remedy for the same condition. */
function materialDanger(o: PersonalObservation): DangerSignal | undefined {
  for (let i = o.alerts.length - 1; i >= 0; i--) {
    const entry = o.alerts[i]!;
    if (o.tick - entry.tick > DANGER_WINDOW_TICKS) return undefined;
    if (entry.kind === 'attack' && entry.targetId === o.citizen.id && entry.citizenId && entry.citizenId !== o.citizen.id)
      return { key: `material-danger:${entry.id}`, eventId: entry.id, attackerId: entry.citizenId };
  }
  return undefined;
}
const interruptedDanger = (mind: CitizenMind, danger: DangerSignal): boolean =>
  mind.trace.some(entry => entry.transition === 'interrupt' && entry.reason === danger.key);
const attemptedDefense = (mind: CitizenMind, danger: DangerSignal): boolean =>
  mind.trace.some(entry => entry.transition === 'select' && entry.reason === danger.key);
const isExitPhase = (task: TreeTaskState): boolean => task.phase.startsWith('exit') || task.phase.startsWith('done');
/** True when the running physical work is exactly the tracked active task's own
 * proposal; foreign or spectator work is never preempted. */
function ownsAction(task: TreeTaskState, action: Citizen['action']): boolean {
  return !!action && !!task.actionId &&
    (action.id === task.actionId || task.actionId === `pending:${JSON.stringify(action.command)}`);
}

// ------------------------------------------------------------ critical hunger

/** Newly critical hunger interrupts NON-survival non-remedy work, but hunger is
 * a persistent state: each band below 30 fullness (30/20/10) may interrupt only
 * once, so the same hunger never cancels or resamples repeatedly, and the keys
 * clear when fullness recovers above the threshold so a later episode keeps its
 * bounded interrupt budget. Actual starvation (fullness exhausted, health
 * draining) additionally interrupts any running non-remedy task — including
 * sleep and survival-urgent work — because resting through starvation is fatal. */
const HUNGER_CRITICAL_FULLNESS = 30;
const STARVATION_KEY = 'starvation-critical';
const HUNGER_REASONS = /^(hunger|starvation)-critical/;
const hungerBandKey = (fullness: number): string =>
  `hunger-critical:${Math.floor(fullness / 10)}`;
const interruptedTransition = (mind: CitizenMind, reason: string): boolean =>
  mind.trace.some(entry => entry.transition === 'interrupt' && entry.reason === reason);
/** Food remedies (and food-directed exploration) never get hunger-interrupted,
 * nor do tasks parented under one whose purpose they serve: the same hunger
 * must not cancel its own treatment each tick. */
const isFoodRemedy = (mind: CitizenMind, t: TreeTaskState, seen = new Set<string>()): boolean => {
  if (t.definitionId === 'ObtainFoodNow') return true;
  if (['ObtainResource', 'Harvest', 'RefineResource'].includes(t.definitionId) && t.request.resource === 'food') return true;
  if (t.definitionId === 'Explore' && /food/i.test(t.request.purpose)) return true;
  if (!t.parentId || seen.has(t.id)) return false;
  seen.add(t.id);
  const parent = mind.tasks.find(p => p.id === t.parentId);
  return !!parent && isFoodRemedy(mind, parent, seen);
};
/** The task belongs to an ObtainFoodNow invocation: it is the root itself or a
 * descendant through parent links. A tree already treating the starvation
 * directly is never re-interrupted or re-entered by the same hunger. */
const inObtainFoodNowTree = (mind: CitizenMind, t: TreeTaskState, seen = new Set<string>()): boolean => {
  if (t.definitionId === 'ObtainFoodNow') return true;
  if (!t.parentId || seen.has(t.id)) return false;
  seen.add(t.id);
  const parent = mind.tasks.find(p => p.id === t.parentId);
  return !!parent && inObtainFoodNowTree(mind, parent, seen);
};
/** One hunger interrupt reason per boundary: actual starvation outranks band
 * criticality, then the freshest unused band key; recovery clears old keys. */
const hungerSignal = (mind: CitizenMind, fullness: number): string | undefined => {
  if (fullness >= HUNGER_CRITICAL_FULLNESS) {
    if (mind.trace.some(entry => entry.transition === 'interrupt' && HUNGER_REASONS.test(entry.reason)))
      mind.trace = mind.trace.filter(entry => !(entry.transition === 'interrupt' && HUNGER_REASONS.test(entry.reason)));
    return undefined;
  }
  if (fullness <= 0 && !interruptedTransition(mind, STARVATION_KEY)) return STARVATION_KEY;
  const band = hungerBandKey(fullness);
  return interruptedTransition(mind, band) ? undefined : band;
};

// ------------------------------------------------------------------- controller

/** Background need procurement is independent of task selection and physical
 * work. Both fast and full entry paths run this same bounded admission. */
function reconcileFoodDemand(world: World, citizen: Citizen): void {
  if (world.tick === 0 || (world.tick !== 1 && world.tick % 20 !== 0)) return;
  const o = { citizen, markets: Object.values(world.orders).map(order => ({ ...order,
    escrowGold: order.citizenId === citizen.id ? order.escrowGold : 0,
    escrowItems: order.citizenId === citizen.id ? { ...order.escrowItems } : {},
  })), alerts: worldEventHistory(world).filter(entry => entry.audience?.includes(citizen.id)) };
  let own = o.markets.filter(order => order.citizenId === citizen.id);
  const refresh = () => {
    o.markets = Object.values(world.orders).map(order => ({ ...order,
      escrowGold: order.citizenId === citizen.id ? order.escrowGold : 0,
      escrowItems: order.citizenId === citizen.id ? { ...order.escrowItems } : {},
    }));
    own = o.markets.filter(order => order.citizenId === citizen.id);
  };
  const owned = new Set(citizen.mind?.tasks.flatMap(t => t.ownedOrderIds) ?? []);
  const background = own.filter(order => order.side === 'buy' && order.item.startsWith('food:') && !owned.has(order.id) && !order.requestId);
  // Restore sell custody before reserving recipes/runway. Task-owned listings
  // are never reclaimed by this independent background policy.
  const custody = { ...citizen, inventory: { ...citizen.inventory } };
  for (const order of own.filter(x => x.side === 'sell')) custody.inventory[order.item] = (custody.inventory[order.item] ?? 0) + order.quantity;
  const reserves = committedReserves({ citizen: custody });
  for (const [item, quantity] of Object.entries(backgroundSaleReserves(o)))
    reserves[item] = (reserves[item] ?? 0) + quantity;
  let actions = 0;
  for (const order of own.filter(x => x.side === 'sell' && !owned.has(x.id) && !x.requestId)) {
    if ((citizen.inventory[order.item] ?? 0) < (reserves[order.item] ?? 0) && actions < 2) {
      dispatch(world, citizen.id, {type:'cancel-order', orderId:order.id}); actions++; refresh();
    }
  }
  if (world.tick % 100 === 0) for (const order of own.filter(x => x.side === 'sell' && !owned.has(x.id) && !x.requestId)) {
    if (actions >= 2 || world.tick - order.createdTick < 100) continue;
    const price = Math.max(order.price - 2, Math.min(quotePrice(o, order.item), order.price + 2));
    if (price === order.price) continue;
    const cancelled = dispatch(world, citizen.id, {type:'cancel-order', orderId:order.id});
    if (cancelled.ok) dispatch(world, citizen.id, {type:'order', side:'sell', item:order.item, quantity:order.quantity, price}, 'external', undefined, null);
    actions++; refresh();
  }
  for (const [item, quantity] of Object.entries(citizen.inventory)) {
    if (actions >= 2) break;
    if (own.some(x => x.item === item) || !/^(food|wood|fibre|axe|knife|scythe|sword):\d+$/.test(item)) continue;
    const surplus = quantity - (reserves[item] ?? 0);
    if (surplus < .05) continue;
    dispatch(world, citizen.id, {type:'order', side:'sell', item, quantity:surplus, price:quotePrice(o,item)}, 'external', undefined, null);
    actions++; refresh();
  }
  const availableNutrition = Object.entries(citizen.inventory).reduce((sum, [item, n]) =>
    sum + (item.startsWith('food:') ? n * nutrition(Number(item.split(':')[1])) : 0), 0) +
    own.filter(order => order.side === 'sell' && order.item.startsWith('food:')).reduce((sum, order) => sum + order.quantity * nutrition(Number(order.item.split(':')[1])), 0);
  const familyGoal = citizen.mind?.tasks.some(t => t.status === 'running' &&
    (t.definitionId === 'Reproduce' || /family intention|family provision/.test(t.request.purpose)));
  const familyShortage = familyGoal ? Math.max(0, BALANCE.reproductionFood - (citizen.inventory[`food:${BALANCE.reproductionFoodTier}`] ?? 0)) : 0;
  const need = Math.max(familyShortage * nutrition(BALANCE.reproductionFoodTier), Math.max(0, Math.max(20, 60 - citizen.fullness) - availableNutrition));
  const fundedNutrition = own.filter(order => order.side === 'buy' && order.item.startsWith('food:') &&
    (!familyShortage || order.item === `food:${BALANCE.reproductionFoodTier}`)).reduce((sum, order) => sum + order.quantity * nutrition(Number(order.item.split(':')[1])), 0);
  // Preserve resting prices and identities unless acquired food makes their
  // remaining quantity materially excessive. Task-owned procurement stays intact.
  if (need <= 0) {
    for (const order of background) dispatch(world, citizen.id, { type: 'cancel-order', orderId: order.id });
    return;
  }
  const dust = background.filter(order => order.quantity < 1e-9);
  for (const order of dust) dispatch(world, citizen.id, { type: 'cancel-order', orderId: order.id });
  const resting = background.filter(order => order.quantity >= 1e-9);
  const taskNutrition = own.filter(order => order.side === 'buy' && order.item.startsWith('food:') && owned.has(order.id) &&
    (!familyShortage || order.item === `food:${BALANCE.reproductionFoodTier}`))
    .reduce((sum, order) => sum + order.quantity * nutrition(Number(order.item.split(':')[1])), 0);
  let remaining = Math.max(0, need - taskNutrition);
  // Only independent procurement escrow is refundable for this budget; do not
  // credit unrelated task funding. Allocate the half-cash cap once across bids.
  let budget = (citizen.gold + resting.reduce((sum,x) => sum + x.escrowGold, 0)) * .5;
  for (const order of resting) {
    const perUnit = nutrition(Number(order.item.split(':')[1]));
    const quantity = familyShortage && order.item !== `food:${BALANCE.reproductionFoodTier}` ? 0 : Math.min(order.quantity, remaining / perUnit, budget / order.price);
    budget = Math.max(0, budget - quantity * order.price);
    remaining = Math.max(0, remaining - quantity * perUnit);
    if (order.quantity - quantity <= 1e-9) continue;
    const cancelled = dispatch(world, citizen.id, { type: 'cancel-order', orderId: order.id });
    if (cancelled.ok && quantity >= 1e-9)
      dispatch(world, citizen.id, { type: 'order', side: 'buy', item: order.item, quantity, price: order.price }, 'external', undefined, null);
  }
  if (resting.length) {
    // Reprice only aged bids, every 100 ticks, by at most two gold toward
    // personally known evidence. Existing escrow is refundable cash, once.
    if (world.tick % 100 === 0) for (const order of resting.slice(0, 1)) {
      if (!world.orders[order.id] || world.tick - order.createdTick < 100) continue;
      refresh();
      const current = own.filter(x => x.side === 'buy' && x.item.startsWith('food:') && !owned.has(x.id) && !x.requestId);
      const cap = (citizen.gold + current.reduce((sum,x) => sum + x.escrowGold, 0)) * .5;
      const allowance = Math.max(0, cap - current.filter(x => x.id !== order.id).reduce((sum,x) => sum + x.escrowGold, 0));
      const cash = citizen.gold + order.escrowGold;
      const choices = TIERS.map(tier => {
        const item = `food:${tier}` as const;
        const known = item === order.item || o.markets.some(x => x.side === 'sell' && x.citizenId !== citizen.id && x.item === item);
        const target = knownBuyPrice(o, item);
        const price = Math.min(Math.max(order.price - 2, Math.min(target, order.price + 2)), buyWillingness({...o,citizen:{...citizen,gold:cash}},item,order.quantity));
        const ask = o.markets.filter(x => x.side === 'sell' && x.citizenId !== citizen.id && x.item === item && x.quantity > 1e-9);
        const comparisonPrice = ask.length ? Math.min(...ask.map(x => x.price)) : target;
        return {item, price, known, value: nutrition(tier) / Math.max(price, comparisonPrice)};
      }).filter(x => x.known && (!familyShortage || x.item === `food:${BALANCE.reproductionFoodTier}`) && !own.some(y => y.side === 'sell' && y.item === x.item)).sort((a,b) => b.value - a.value);
      const choice = choices[0];
      if (!choice) continue;
      const quantity = Math.min(order.quantity * nutrition(Number(order.item.split(':')[1])) / nutrition(Number(choice.item.split(':')[1])), allowance / choice.price);
      if ((choice.price !== order.price || choice.item !== order.item) && quantity >= 1e-9) {
        const cancelled = dispatch(world,citizen.id,{type:'cancel-order',orderId:order.id});
        if (cancelled.ok) dispatch(world,citizen.id,{type:'order',side:'buy',item:choice.item,quantity,price:choice.price},'external',undefined,null);
        refresh();
      }
    }
    return;
  }
  if (fundedNutrition >= need) return;
  // Listed supply is handled by the existing immediate acquisition/urgent
  // guards, never pre-empted by the background admission before interruption.
  // Known higher-tier asks participate in the same bounded nutrition budget.
  const active = citizen.mind?.tasks.find(t => t.id === citizen.mind?.activeTaskId && t.status === 'running');
  // A critical food remedy already owns procurement and its interruption
  // semantics. Background demand remains available during unrelated work.
  if (citizen.fullness <= 0 || (active && citizen.fullness < HUNGER_CRITICAL_FULLNESS && isFoodRemedy(citizen.mind!, active))) return;
  const choices = TIERS.map(tier => {
    const item = `food:${tier}` as const;
    const required = Math.min(3, (need - fundedNutrition) / nutrition(tier));
    const asks = o.markets.filter(x => x.side === 'sell' && x.citizenId !== citizen.id && x.item === item && x.quantity > 1e-9);
    const quoted = knownBuyPrice(o,item);
    // Executable fractional food is bounded by total cash, not unit price.
    // An unmatched optimistic bid must not outrank nutrition available now.
    const price = asks.length ? quoted : Math.min(quoted, buyWillingness(o,item,required));
    const quantity = Math.min(required, budget / price);
    const known = asks.length > 0 || o.alerts.some(e => e.kind === 'trade' && e.text.includes(`${item} sold`));
    const executable = asks.filter(x => x.price <= price).reduce((sum,x) => sum + x.quantity, 0);
    const useful = Math.min(quantity, executable) * nutrition(tier);
    return {item, quantity, price, known, executable: useful > 1e-9, value: asks.length ? useful / (Math.min(quantity, executable) * price) : nutrition(tier) / quoted};
  }).filter(x => (!familyShortage || x.item === `food:${BALANCE.reproductionFoodTier}`) && !own.some(order => order.side === 'sell' && order.item === x.item) &&
    x.quantity > 1e-9 && (x.known || x.item === 'food:1'))
    .sort((a,b) => Number(b.executable) - Number(a.executable) || b.value - a.value);
  const choice = choices[0];
  if (!choice) return;
  const {item,quantity,price} = choice;
  // Keep half liquid for actual asks and regular work; fractional resource bids
  // obey the same atomic escrow engine as every other order.
  const posting = Math.min(quantity, citizen.gold * .5 / price);
  if (posting > 1e-9) dispatch(world, citizen.id, { type: 'order', side: 'buy', item, quantity: posting, price }, 'external', undefined, null);
}

/** Core adapter: exclusively owns composed minds; never invokes legacy autonomy. */
export function advanceTree(world: World, citizen: Citizen): boolean {
  if (!citizen.alive) return false;
  const mind = citizen.mind ??= { version: 1, dispositions: initializeDispositions(world.seed + Number(citizen.id.replace(/\D/g, ''))), memories: [], memoriesOmitted: 0, tasks: [], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: world.tick + 600 };
  reconcileFoodDemand(world, citizen);
  // Synchronous housekeeping never owns or preempts the body's physical task.
  // Shared entry point keeps busy and forced-full paths on identical vote draws.
  const civic = observeCommunityVote(world, citizen);
  if (civic) {
    const vote = communityVoteOpportunity(civic, seededDraw(world.seed ^ world.tick ^ citizen.id.length).value);
    if (vote) commit(world, citizen, vote);
  }
  // Classify before any task/memory edits. Low fullness always falls back: the
  // starvation override must use the complete authoritative food guard.
  const entry = citizen.action && citizen.fullness >= HUNGER_CRITICAL_FULLNESS
    ? observeEntry(world, citizen.id) : undefined;
  const busyEntry = entry && !entry.alerts.some(e => e.kind === 'attack' &&
    e.targetId === citizen.id && e.citizenId && e.citizenId !== citizen.id &&
    world.tick - e.tick <= DANGER_WINDOW_TICKS) ? entry : undefined;
  // Retired allocations can outlive the bounded engine ledger. Drop only their
  // obsolete evidence and recompute its retained sum; running credit is never
  // silently discarded. Parent tasks stay retained while any child refers to them.
  const receipts = new Map(mind.receipts.map(receipt => [receipt.id, receipt]));
  for (const retired of mind.tasks) if (retired.status !== 'running') {
    retired.receiptIds = retired.receiptIds.filter(id => receipts.has(id));
    retired.delivered = retired.receiptIds.reduce((sum, id) => sum + receipts.get(id)!.quantity, 0);
  }
  pruneTasks(mind);
  const updateSafety = (view: Pick<DecisionObservation, 'tick' | 'alerts'> & { citizen: { id: string } }) =>
    updateCommunityWeight(mind, view, event => event.x !== undefined && event.y !== undefined &&
      ((event.tick === world.tick && distance(citizen, { x: event.x, y: event.y }) <= BALANCE.sightRadius) ||
       Object.values(citizen.knowledge).some(tile => tile.x === event.x && tile.y === event.y && tile.seenTick === event.tick)));
  if (busyEntry) {
    updateSafety(busyEntry);
    Object.assign(mind, updateMemories(mind.memories, personalEvidence(busyEntry), world.tick, mind.memoriesOmitted));
    hungerSignal(mind, citizen.fullness); // recovery removes the same episode keys
    const active = mind.tasks.find(t => t.id === mind.activeTaskId);
    if (active?.definitionId === 'Reproduce' && citizen.action?.command.type === 'reproduce' &&
      citizen.action.command.partnerId === active.targetId) active.actionId = citizen.action.id;
    return true;
  }
  // Adapter projects only the actor's directed opinions, never other citizens' rows.
  // The decision projection carries the full mind clone but omits the duplicate
  // self notebook; visible+remembered are the projected notebook.
  const o = groundedObservation(observeDecision(world, citizen.id));
  updateSafety(o);
  if (o.citizen.mind) o.citizen.mind.community = { ...mind.community! };
  Object.assign(mind, updateMemories(mind.memories, personalEvidence(o), world.tick, mind.memoriesOmitted));
  let active = mind.tasks.find(t => t.id === mind.activeTaskId);
  const danger = materialDanger(o);
  const canInterruptDanger = !!danger && !!active && !active.evidenceIds?.includes(danger.eventId) &&
    active.status === 'running' && !isExitPhase(active) && !interruptedDanger(mind, danger);
  // Newly critical hunger: interrupt a non-survival, non-remedy task once per
  // band; at actual starvation the explicit override above yields any running
  // task (including food-remedy roots) to a guard-true ObtainFoodNow once per
  // episode key. The shared exit cleanup cancels owned work and orders, and
  // reconsideration runs through normal selection.
  const starving = citizen.fullness <= 0;
  /** Explicit starvation rule, eligibility through the authoritative engine guard
   * only: CanObtainFoodNow over any food tier attests a fundable immediate route
   * (own recoverable food escrow, or a listed ask that gold plus cumulative
   * funding covers). It is a pure condition probe on a throwaway task — no
   * commands, no state, and never a speculative foodAcquisitionTicks estimate. */
  const starvingFoodNowGuard = starving && TIERS.some(tier =>
    CONDITIONS.CanObtainFoodNow!.evaluate(o, task(o, 'ObtainFoodNow', 'food', tier)).ok);
  const hungerKey = hungerSignal(mind, citizen.fullness);
  /** The user's explicit starvation override: at actual starvation (fullness
   * exhausted, health draining) the current task yields to an ObtainFoodNow root
   * exactly when the authoritative guard passes — including an ongoing food
   * trip/harvest/partial-delivery root that the band rules below exempt. The
   * guard, not a route estimate, decides: guard failure abandons no usable work
   * and causes no thrash. Eligibility does not consume the one-per-episode
   * hunger keys and is not suppressed by a recent failed ObtainFoodNow goal:
   * stability comes from the existing ObtainFoodNow subtree check (root or
   * descendant is never re-interrupted or re-entered while it runs), so a failed
   * or interrupted remedy attempt leaves the override armed — it can never be
   * idle or re-choose replaceable work while affordable food stays listed.
   * Combat escape and fresh danger interrupts keep precedence. */
  const starvingFoodNowOverride = !!active && !canInterruptDanger &&
    active.status === 'running' && !isExitPhase(active) && active.strategyId !== 'escape' &&
    !inObtainFoodNowTree(mind, active) && starvingFoodNowGuard;
  // Reassess persistent acquisition at idle boundaries only: accepted work is
  // not repeatedly cancelled as competitors arrive. Escalate through ordinary
  // cleanup if the exact-tier goal no longer offers food within the body runway.
  // The estimate stays a lesser-urgency heuristic and defers to the direct
  // override: at a starvation override boundary the guard decides, not the guess.
  const runway = citizen.fullness / BALANCE.fullnessDrain + citizen.health / BALANCE.starvationDamage;
  const failedFoodRoute = !starvingFoodNowOverride && !!active && !citizen.action && active.status === 'running' && !isExitPhase(active) &&
    ['ObtainResource', 'Harvest'].includes(active.definitionId) && active.request.resource === 'food' &&
    citizen.fullness < HUNGER_CRITICAL_FULLNESS && !active.delivered &&
    !mind.receipts.some(r => r.tick >= active!.startedTick && r.item === `food:${active!.request.tier}` &&
      (!r.requestId || r.requestId === active!.request.id) && r.quantity > 0) &&
    (foodAcquisitionTicks(o, active) >= runway || o.tick - active.startedTick >= runway);
  if (failedFoodRoute && active) {
    recordTrace(mind, world.tick, 'interrupt', 'food-route: no useful acquisition within starving runway', active);
    active.phase = 'exit:failed:invalidated';
    active.reason = 'food-route: no useful acquisition within starving runway';
  }
  const canInterruptHunger = !!active && !canInterruptDanger &&
    active.status === 'running' && !isExitPhase(active) && active.strategyId !== 'escape' &&
    (starvingFoodNowOverride ||
      (!!hungerKey && !isFoodRemedy(mind, active) && (starving || active.request.urgency !== 'survival')));
  // Consecutive idle wait boundaries of one task: bounded waiting on hopeless
  // resting orders instead of an indefinite no-op stall.
  let waitStreak = 0;
  for (let i = mind.trace.length - 1; i >= 0; i--) {
    if (mind.trace[i]!.transition !== 'wait') break;
    waitStreak++;
  }
  const stalled = !!active && !canInterruptDanger && !canInterruptHunger && active.status === 'running' &&
    !isExitPhase(active) && !citizen.action && citizen.queue.length === 0 &&
    waitStreak >= WAIT_STREAK_TICKS;
  // A joint action is installed on both parents by the mechanics. Adopt only
  // the action matching this citizen's independently selected family task.
  if (active?.definitionId === 'Reproduce' && citizen.action?.command.type === 'reproduce' &&
    citizen.action.command.partnerId === active.targetId) active.actionId = citizen.action.id;
  // Birth evidence names the two parents asymmetrically; both participants must
  // settle before rechecking food/cooldown.
  if (active?.definitionId === 'Reproduce' && active.actionId && !citizen.action) {
    const birth = o.alerts.find(e => e.kind === 'birth' && e.tick >= active!.startedTick &&
      (e.text.includes(`born to ${citizen.id} and ${active!.targetId}.`) ||
       e.text.includes(`born to ${active!.targetId} and ${citizen.id}.`)));
    if (birth) { active.phase = 'exit:succeeded'; active.reason = `Reproduction completed: ${birth.text}`; }
  }
  // Guard ALL active physical work, including spectator or another subsystem's work.
  // Material danger may preempt exactly one work item that the tracked active task
  // itself proposed, once per danger purpose; cleanup still runs through the task.
  const preemptible = (canInterruptDanger || canInterruptHunger) && !!citizen.action && ownsAction(active!, citizen.action);
  if ((citizen.action || citizen.queue.length) && !preemptible) return true;
  if (canInterruptDanger && active) {
    (active.evidenceIds ??= []).push(danger!.eventId);
    recordTrace(mind, world.tick, 'interrupt', danger!.key, active);
    active.phase = 'exit:failed:invalidated';
    active.reason = `interrupted: ${danger!.key}`;
  } else if (canInterruptHunger && active) {
    // The override may fire without a fresh per-episode key; a guard-true
    // remedy replacement always carries the starvation reason itself.
    recordTrace(mind, world.tick, 'interrupt', starvingFoodNowOverride ? STARVATION_KEY : hungerKey!, active);
    active.phase = 'exit:failed:invalidated';
    active.reason = `interrupted: ${hungerKey!}`;
  } else if (stalled && active) {
    recordTrace(mind, world.tick, 'interrupt', `stall: ${active.definitionId}`, active);
    active.phase = 'exit:failed:invalidated';
    active.reason = `waited ${waitStreak} idle boundaries without progress; invalid assumption`;
  }
  active = mind.tasks.find(t => t.id === mind.activeTaskId) ?? active;
  if (!active) {
    // Recently failed goals are excluded for a cooldown window so the same
    // infeasible goal is not re-selected every tick (stall and churn guard).
    // The cooldown is scoped to the failed goal's own intent: resource-typed
    // requests key on definition+resource+tier (a failed wood procurement
    // never blocks food work or a different tier), while definitions whose
    // request resource is incidental key on the definition alone.
    const failedRecently = new Set(mind.trace
      .filter(entry => entry.transition === 'fail' && o.tick - entry.tick <= FAILURE_COOLDOWN_TICKS)
      .map(entry => failureKey(entry.definitionId, entry.invocationId)));
    const candidates = prepareTreeCandidates(o);
    if (danger) {
      const attackerTile = o.visible.find(tile => tile.citizens.some(c => c.id === danger.attackerId));
      const distance = (p: { x: number; y: number }) => attackerTile ? Math.hypot(p.x - attackerTile.x, p.y - attackerTile.y) : 0;
      const escapeSite = o.visible.filter(tile => Math.max(Math.abs(tile.x - citizen.x), Math.abs(tile.y - citizen.y)) === 1 &&
        distance(tile) > distance(citizen) && !tile.buildings.some(b => b.kind === 'wall') &&
        !(citizen.autonomy?.policy.noGo ?? []).some(area => tile.x >= area[0] && tile.y >= area[1] && tile.x <= area[2] && tile.y <= area[3]))
        .sort((a, b) => distance(b) - distance(a))[0];
      if (escapeSite) {
        const escape = task(o, 'Explore'); escape.strategyId = 'escape'; escape.target = { x: escapeSite.x, y: escapeSite.y };
        escape.request.purpose = 'Avoid observed attacker'; escape.request.urgency = 'survival';
        candidates.push({ task: escape, forecast: { id: escape.id, feasible: true, benefit: .4, cost: .15, risk: .05, delay: .15, uncertainty: .2, affinities: { riskTolerance: -1, morals: 1 } } });
      }
    }
    const remedies = citizen.fullness < HUNGER_CRITICAL_FULLNESS ? candidates.filter(c => isFoodRemedy(mind, c.task)) : [];
    const eligible = remedies.length ? remedies : candidates;
    const fresh = eligible.filter(c => c.task.strategyId === 'escape' || !failedRecently.has(failureKey(c.task.definitionId, c.task.id)));
    // Urgent procurement compares projected edible arrival against survival
    // runway. Lower-tier food can be preferable to a distant high-tier promise;
    // outside urgency the shared stochastic preferences remain unchanged.
    const urgentFood = citizen.fullness < HUNGER_CRITICAL_FULLNESS ? fresh
      .map(c => ({ c, ticks: foodAcquisitionTicks(o, c.task) }))
      .filter(e => Number.isFinite(e.ticks))
      .sort((a, b) => Number(a.ticks >= runway) - Number(b.ticks >= runway) ||
        (a.ticks >= runway ? a.ticks - b.ticks :
          a.ticks / Math.max(1, nutrition(a.c.task.request.tier) - a.ticks * BALANCE.fullnessDrain) -
          b.ticks / Math.max(1, nutrition(b.c.task.request.tier) - b.ticks * BALANCE.fullnessDrain))) : [];
    // Direct override selection at actual starvation: when the authoritative
    // CanObtainFoodNow guard passes, the ObtainFoodNow root is chosen outright
    // instead of leaving the pick to the speculative route ranking, and it
    // bypasses the failed-goal cooldown: interruption and replacement share the
    // same guard-true eligibility, so the override never cancels work and then
    // locks out its own remedy (a recently failed ObtainFoodNow otherwise
    // drove cancel-wood → fresh ObtainResource → interrupt again → idle despite
    // affordable food). Without a guard-true route ordinary selection
    // (including the ranked urgent remedies) stands. Fresh danger still
    // outranks the starvation remedy choice. Within the guard-true roots the
    // fastest feasible route wins rather than blind tier order: gold is fixed
    // during starvation, and a merely fundable low tier is no reason to prefer
    // it over a directly funded ask the guard also attests.
    const foodNowDirect = starvingFoodNowGuard && !danger ?
      candidates.filter(c => c.task.definitionId === 'ObtainFoodNow')
        .map(c => ({ c, ticks: foodAcquisitionTicks(o, c.task) }))
        .sort((a, b) => a.ticks - b.ticks)
        .map(e => e.c) : [];
    const choice = foodNowDirect[0] ?? urgentFood[0]?.c ?? select(fresh.length ? fresh : [], mind, world.seed ^ world.tick ^ Math.floor(citizen.gold * 31));
    if (!choice || !admitTask(mind)) return false;
    active = choice.task;
    if (danger) {
      (active.evidenceIds ??= []).push(danger.eventId);
      if (!attemptedDefense(mind, danger)) recordTrace(mind, world.tick, 'select', danger.key, active);
    }
    mind.tasks.push(active); mind.activeTaskId = active.id;
  }
  // Tool material prerequisites preserve purpose and ancestry across ticks.
  // The chain is persistent: a child carries the full still-missing amount, and
  // a transient child failure defers the next attempt (PREREQUISITE_* window)
  // instead of aborting the whole tool task — progress already paid for stays
  // in carried inventory and the chain resumes for the remaining amount.
  if ((active.definitionId === 'BuildResourceBuilding' || (active.definitionId === 'ObtainTool' && active.targetId)) && !isExitPhase(active) &&
    !active.actionId && active.ownedOrderIds.length === 0 && !active.delivered && !active.target?.x) {
    // Let the leaf consume its own work/trade evidence before inspecting recipe
    // stock: crafting consumes the ingredients, not the task's completion.
    const [kind, tier] = (active.targetId ?? '').split(':');
    const recipe = active.definitionId === 'BuildResourceBuilding' ? buildingRecipe(({wood:'lumbermill',fibre:'spinning-wheel',food:'butchery'} as const)[active.request.resource], active.request.tier) : equipmentRecipe(kind as 'axe', Number(tier));
    const missing = Object.entries(recipe).find(([item, amount]) => (citizen.inventory[item] ?? 0) < amount);
    if (missing && DELEGATES[active.definitionId]?.includes('ObtainResource') && !active.ancestry.includes('ObtainResource')) {
      if ((active.wakeTick ?? 0) > o.tick) {
        recordTrace(mind, o.tick, 'wait', `Awaiting a ${PREREQUISITE_RETRY_TICKS}-tick prerequisite retry for ${missing[0]}`, active);
        return true;
      }
      const [resource, exactTier] = missing[0].split(':'); const child = task(o, 'ObtainResource', resource as Resource, Number(exactTier));
      child.id += `:child:${active.id}`; child.request.id = child.id; child.parentId = active.id; child.request.quantity = missing[1] - (citizen.inventory[missing[0]] ?? 0);
      active.wakeTick = undefined;
      child.ancestry = [...active.ancestry, active.definitionId]; child.request.purpose = active.request.purpose; child.request.urgency = active.request.urgency;
      child.request.allowMarket = active.request.allowMarket; child.request.deadlineTick = active.request.deadlineTick;
      // Admission reserves the bound before the child is created: at a retained
      // full list the attempt defers exactly like a transiently unavailable
      // prerequisite instead of overflowing past MIND_LIMITS.tasks. Once the
      // whole-chain budget is spent the leaf still exits through its own failure.
      const feasible = CONDITIONS.CanObtainResource!.evaluate(o, child).ok;
      if (feasible && admitTask(mind)) { mind.tasks.push(child); mind.activeTaskId = child.id; active = child; }
      else if (o.tick - active.startedTick <= PREREQUISITE_CHAIN_TICKS) {
        active.wakeTick = o.tick + PREREQUISITE_RETRY_TICKS;
        active.reason = feasible
          ? `Prerequisite deferred: retained task list at capacity; next attempt deferred to tick ${active.wakeTick}`
          : `Prerequisite unavailable transiently; next attempt deferred to tick ${active.wakeTick}`;
        recordTrace(mind, o.tick, 'wait', `Awaiting a ${PREREQUISITE_RETRY_TICKS}-tick prerequisite retry for ${missing[0]}`, active);
        return true;
      }
    }
  }
  // Production-for-sale prerequisite: a sale with a stock shortfall delegates
  // production of the listed item, preserving the sale request purpose. The
  // Explicit shared delegation approval is required, including its ancestry edge.
  if (active.definitionId === 'SellItem' && DELEGATES.SellItem?.includes('ObtainResource') && !isExitPhase(active) && active.targetId && active.ownedOrderIds.length === 0 && !active.ancestry.includes('ObtainResource')) {
    const saleItem = active.targetId;
    const [resource, tierText] = saleItem.split(':');
    const tier = Number(tierText);
    const parent = active;
    if (['food', 'wood', 'fibre'].includes(resource) && TIERS.includes(tier) && !mind.tasks.some(t => t.parentId === parent.id)) {
      const carried = citizen.inventory[saleItem] ?? 0;
      const listed = o.markets.filter(order => order.citizenId === citizen.id && order.side === 'sell' && order.item === saleItem)
        .reduce((sum, order) => sum + order.quantity, 0);
      if (carried + listed < parent.request.quantity) {
        const child = task(o, 'ObtainResource', resource as Resource, tier);
        child.id += `:sale-child:${parent.id}`; child.request.id = child.id;
        child.parentId = parent.id;
        child.ancestry = [...parent.ancestry, 'SellItem'];
        child.request.purpose = `Produce ${saleItem} for sale: ${parent.request.purpose}`;
        child.request.urgency = parent.request.urgency;
        child.request.allowMarket = parent.request.allowMarket; child.request.deadlineTick = parent.request.deadlineTick;
        // Same pre-push admission as prerequisite children: capacity-blocked sale
        // production simply stays with the active sale for this boundary; the
        // shortfall re-attempts once pressure evicts terminal evidence.
        if (CONDITIONS.CanObtainResource!.evaluate(o, child).ok && admitTask(mind)) { mind.tasks.push(child); mind.activeTaskId = child.id; active = child; }
      }
    }
  }
  if (['ObtainResource', 'ObtainFoodNow', 'Harvest', 'RefineResource', 'ObtainTool'].includes(active.definitionId)) {
    const requestedItem = active.definitionId === 'ObtainTool' ? active.targetId : `${active.request.resource}:${active.request.tier}`;
    for (const receipt of mind.receipts) if (receipt.source !== 'market' && !receipt.requestId && receipt.tick >= active.startedTick && receipt.item === requestedItem) receipt.requestId = active.request.id;
  }
  // Territory's civic engine accepts notebook-known tiles, not newly sighted
  // tiles pending the next knowledge update. The decision projection omits the
  // duplicate self notebook: its projected content is exactly the
  // visible+remembered known coordinate set (a projection overlays current-sight
  // tiles into the citizen clone), so the historical citizen.knowledge filter
  // becomes membership in that same set — provably a no-op on the projection,
  // kept to preserve the constraint explicitly if the overlay ever changes.
  const knownCoordinates = new Set([...o.visible, ...o.remembered].map(tile => `${tile.x},${tile.y}`));
  const actionObservation = active.definitionId.includes('Territory') ? { ...o,
    visible: o.visible.filter(tile => knownCoordinates.has(`${tile.x},${tile.y}`)),
    remembered: o.remembered.filter(tile => knownCoordinates.has(`${tile.x},${tile.y}`)),
  } : o;
  if (active.strategyId === 'escape' && !isExitPhase(active)) {
    if (citizen.x === active.target!.x && citizen.y === active.target!.y) active.phase = 'exit:succeeded';
    else {
      const command: Command = { type: 'move', x: active.target!.x, y: active.target!.y };
      recordTrace(mind, world.tick, 'propose', 'Leave observed attack range', active, command);
      if (!commit(world, citizen, command)) { active.phase = 'exit:failed:rejected'; active.reason = citizen.lastResult; }
      else if (citizen.action) active.actionId = citizen.action.id;
      return true;
    }
  }
  const phaseBeforeStep = active.phase;
  const result = stepTreeTask(actionObservation, active);
  recordTrace(mind, world.tick, result.command ? 'propose' : result.status === 'succeeded' ? 'succeed' : result.status === 'failed' ? 'fail' : 'wait', result.reason, active, result.command);
  if (result.command) {
    if (!commit(world, citizen, result.command, active)) {
      // A joint reproduction proposal rejected only for coordination timing
      // (partner became busy) defers briefly rather than discarding the task.
      if (result.command.type === 'reproduce' && /must finish/i.test(citizen.lastResult ?? '') &&
        o.tick - active.startedTick < 240) {
        // Coordination is not an attempted joint action. Keep the leaf attempt
        // budget for actual starts, with an independent bounded refusal window.
        active.phase = phaseBeforeStep;
        active.wakeTick = o.tick + REPRODUCE_COORDINATION_RETRY_TICKS;
        active.reason = `Joint reproduction deferred: ${citizen.lastResult}`;
        recordTrace(mind, world.tick, 'wait', `Deferred joint reproduction: ${citizen.lastResult}`, active);
      } else { active.phase = 'exit:failed:rejected'; active.reason = citizen.lastResult; }
    }
    else { const accepted = world.citizens[citizen.id]?.action; if (accepted) active.actionId = accepted.id; }
  }
  if (result.status !== 'running') {
    mind.activeTaskId = active.parentId;
    if (result.status === 'failed' && active.parentId) {
      const parent = mind.tasks.find(t => t.id === active!.parentId);
      const chainBudgetOk = !!parent && ['ObtainTool', 'BuildResourceBuilding'].includes(parent.definitionId) && active.definitionId === 'ObtainResource' &&
        o.tick - parent.startedTick <= PREREQUISITE_CHAIN_TICKS;
      if (parent && chainBudgetOk) {
        // Persistent economic chain: a transient prerequisite failure (a
        // contested/depleted deposit, a vanished market ask) defers one bounded
        // retry of ObtainTool's approved delegation instead of discarding the
        // whole tool task and its paid-for inventory progress.
        parent.wakeTick = o.tick + PREREQUISITE_RETRY_TICKS;
        parent.reason = `Prerequisite failed transiently (${result.reason}); next attempt deferred to tick ${parent.wakeTick}`;
      } else if (parent) {
        parent.phase = 'exit:failed:infeasible'; parent.reason = 'Prerequisite failed';
      }
    }
  }
  return true;
}