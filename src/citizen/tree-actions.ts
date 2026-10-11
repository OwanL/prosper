import { optionalAttackValue } from './tree-combat.ts';

/** Executable responsibility subtrees: bounded module over citizen observations.
 *
 * Contracts (docs/research/decision-tree/plan.md §4, §11 approved pair boundaries):
 * - Pure `CONDITIONS` guards and stateful `ACTIONS` steps over
 *   `CitizenObservation + TreeTaskState`, proposing at most one ordinary
 *   `Command` per call on an idle decision boundary. No `World` access, no
 *   dispatching, no hidden spectator state.
 * - `CanX` guards are feasibility checks that preserve dated evidence;
 *   `X` steps confirm outcomes from citizen-visible evidence. Acceptance of a
 *   command is never completion.
 * - Ancestry exclusion: a definition identity present in `task.ancestry` is
 *   excluded before selection (cycle prevention), and delegation edges are
 *   restricted by `DELEGATES` so helper chains cannot form strategy cycles.
 * - Delivery: acquisition requests are satisfied by one full NET delivered
 *   exact-tier unit through the receipt contract (`DeliveryReceipt` records
 *   allocated to the request via `receipt.requestId === task.request.id`). `task.delivered`
 *   is the exact running sum of allocated receipt quantities — never clamped to the
 *   request and never event-derived, so taxed fractional settlements are retained
 *   exactly. Provisional engine-visible fallbacks (private completion events, personal
 *   trade fills) exist only for settlements the receipt contract cannot attribute
 *   (tools, sales, refinement output); their confirmed units accumulate in `task.accounting.units`
 *   and their WorldEvent ids in `task.evidenceIds`, never in `receiptIds`. When the
 *   engine emits receipts, they take precedence and these fallbacks never also credit
 *   the same settlement; no evidence id is ever consumed twice.
 * - Cleanup order on exit: stop owned work first (one `cancel`), then cancel
 *   owned orders one at a time, then report the terminal status. No exit is
 *   reported before owned work and orders are settled.
 *
 * Provisional defaults under the planning detail policy are marked `PROVISIONAL`.
 * Task field conventions (all serializable, replay auditable):
 * - `task.strategyId` holds the selected route id (e.g. 'harvest', 'buy').
 * - `task.targetId` holds an entity id (deposit/station/order/recipient) or the
 *   exact `ItemKey` for item-typed requests (tools, sales, gifts).
 * - `task.target` holds grid coordinates only. `task.accounting` retains exact
 *   nonspatial units, escrow quantity, pre-gift gold and territory marking tallies
 *   (territory marking only marks current-sight land).
 * - `task.phase` holds route execution phases with `:n` attempt counters, and
 *   `exit:<status>:<failure>` during cleanup before a terminal report.
 * - `task.actionId` is an accepted action id or `pending:<JSON command>` until
 *   the body exposes that exact proposed command; unrelated work is never adopted.
 * - `task.receiptIds` holds consumed DeliveryReceipt ids only; WorldEvent ids of
 *   direct completion, sale, civic and family evidence go to `task.evidenceIds`.
 */
import type {
  Building, CitizenObservation, Command, DecisionObservation, ItemKey, Order, Point, Resource, Tier,
} from '../shared/types.ts';
import { MIND_LIMITS, type DeliveryReceipt, type TreeStepResult, type TreeTaskState } from '../shared/tree-types.ts';
import { CARRIED_ITEM_RE, MAX_TIER, TIERS } from '../shared/tiers.ts';
import { distance, itemKey } from '../shared/utils.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import {
  BALANCE, COMPOSED_BALANCE, EQUIPMENT, MATCHING_TOOL, STATION_RESOURCE,
  buildingRecipe, canRefine, equipmentRecipe, harvestDuration, houseRecipe,
  refinementOutput, refinementRecipe,
} from '../world/config.ts';
import type { Territory } from '../shared/territory-types.ts';
import { settlementOccupancy, settlementClaimEligible, foreignMark, settlementSiteCost } from './tree-spatial.ts';
import { buyWillingness, quoteInterval, quotePrice } from './tree-market.ts';
import { harvestCost } from './tree-harvest.ts';
import { carriedSurplus } from './tree-surplus.ts';
import { negativePersonalMajority } from './tree-community.ts';

/** Inverse of STATION_RESOURCE: which station refines which resource. */
export const STATION_FOR = { wood: 'lumbermill', fibre: 'spinning-wheel', food: 'butchery' } as const;

// ---------------------------------------------------------------- definitions

/** A pure condition: no commands, no state. Feasibility only, never preference. */
export interface GuardResult { ok: boolean; reason: string }
export interface ConditionDef {
  id: string;
  evaluate(observation: DecisionObservation, task: TreeTaskState): GuardResult;
}
/** A stateful step: mutates only the task it owns, proposes at most one command. */
export interface ActionDef {
  id: string;
  step(observation: DecisionObservation, task: TreeTaskState): TreeStepResult;
}

/** Stable strategy identities used for exclusion and delegation edges.
 * Leaves take no acquisition helpers inside this module. The SellItem edge
 * records the controller-approved production prerequisite: a sale with a stock
 * shortfall delegates acquisition of the listed resource. */
export const DELEGATES: Readonly<Record<string, readonly string[]>> = {
  ObtainFoodNow: ['ObtainResource', 'SellItem'],
  ObtainResource: ['Harvest', 'RefineResource', 'SellItem', 'AttackCitizen'],
  ObtainTool: ['ObtainResource', 'CraftTool', 'SellItem'],
  BuildResourceBuilding: ['ObtainResource'],
  SellItem: ['ObtainResource'],
};

/** Cycle prevention: (1) a definition identity on the active ancestry is
 * excluded before selection, whatever invocation id or request parameters say;
 * (2) delegated requests may only enter approved helper definitions. */
export function identityViolation(task: TreeTaskState): string | null {
  if (task.ancestry.includes(task.definitionId))
    return `${task.definitionId} is an active ancestor (cycle exclusion)`;
  const parent = task.ancestry.at(-1);
  if (parent && !(DELEGATES[parent] ?? []).includes(task.definitionId))
    return `${task.definitionId} is not an approved delegation from ${parent}`;
  return null;
}

// ------------------------------------------------------------- observation facts

const self = (observation: DecisionObservation) => observation.citizen;
const knownTiles = (observation: DecisionObservation) => [...observation.visible, ...observation.remembered];
const ownOrders = (observation: DecisionObservation): Order[] =>
  observation.markets.filter((order) => order.citizenId === self(observation).id);
const othersAsk = (observation: DecisionObservation, item: ItemKey): number | null => {
  const asks = observation.markets.filter((o) => o.item === item && o.side === 'sell' && o.citizenId !== self(observation).id);
  return asks.length ? Math.min(...asks.map((o) => o.price)) : null;
};
const othersBid = (observation: DecisionObservation, item: ItemKey): { price: number; quantity: number } | null => {
  const bids = observation.markets.filter((o) => o.item === item && o.side === 'buy' && o.citizenId !== self(observation).id);
  if (!bids.length) return null;
  const price = Math.max(...bids.map((o) => o.price));
  return { price, quantity: bids.filter((o) => o.price === price).reduce((sum, o) => sum + o.quantity, 0) };
};
/** Dated deposit evidence; stock reflects the last sighting, never live truth. */
const depositEvidence = (observation: DecisionObservation, resource: Resource, tier: Tier) =>
  knownTiles(observation).flatMap((tile) =>
    tile.deposits.filter((d) => d.resource === resource && d.tier === tier)
      .map((d) => ({ deposit: d, evidenceTick: tile.seenTick, from: { x: tile.x, y: tile.y } })));
const buildingEvidence = (observation: DecisionObservation, match: (b: Building) => boolean) =>
  knownTiles(observation).flatMap((tile) =>
    tile.buildings.filter((b) => match(b)).map((b) => ({ building: b, evidenceTick: tile.seenTick, from: { x: tile.x, y: tile.y } })));
const sightings = (observation: DecisionObservation, citizenId: string) =>
  knownTiles(observation).filter((tile) => tile.citizens.some((c) => c.id === citizenId && c.alive))
    .map((tile) => ({ sighting: tile.citizens.find((c) => c.id === citizenId)!, evidenceTick: tile.seenTick, from: { x: tile.x, y: tile.y } }));
const toolTierFor = (observation: DecisionObservation, resource: Resource): number =>
  highestToolTier(self(observation), MATCHING_TOOL[resource]);
/** Receipt records allocated to this request; unallocated receipts are visible
 * evidence but require explicit allocation before they can satisfy a request. */
const allocatedReceipts = (observation: DecisionObservation, task: TreeTaskState): DeliveryReceipt[] =>
  (self(observation).mind?.receipts ?? []).filter((r) => r.requestId === task.request.id && r.citizenId === self(observation).id);

// --------------------------------------------------------------- delivery credit

function consume(ids: string[], id: string): boolean {
  if (!ids.includes(id)) { ids.push(id); return true; }
  return false;
}
/** Event-evidence channel: WorldEvent ids consumed exactly once into
 * `task.evidenceIds`, never into `receiptIds`, so checkpoint receipt allocation
 * and the delivered exact sum stay separable from ordinary evidence. The
 * channel is bounded by MIND_LIMITS.evidence: expired event ids (gone from the
 * personal alert window, so they can never re-match) are dropped first, and a
 * channel full of active evidence refuses further consumption rather than
 * dropping live ids — a settlement can therefore never be re-consumed and
 * double-credited into `task.accounting.units`. */
function consumeEvidence(observation: DecisionObservation, task: TreeTaskState, id: string): boolean {
  task.evidenceIds ??= [];
  if (task.evidenceIds.length >= MIND_LIMITS.evidence) {
    const resident = new Set(observation.alerts.map((entry) => entry.id));
    while (task.evidenceIds.length >= MIND_LIMITS.evidence) {
      const expired = task.evidenceIds.findIndex((eid) => !resident.has(eid));
      if (expired === -1) return false;
      task.evidenceIds.splice(expired, 1);
    }
  }
  return consume(task.evidenceIds, id);
}
/** Priority channel: NET quantities from receipts allocated to the request.
 * `task.delivered` is their exact sum, never clamped to the request, so
 * overdelivery through taxed fractional receipts is retained exactly. Only
 * receipts whose item is the exact requested resource tier are consumed here:
 * the checkpoint invariant binds receiptIds to that item, and foreign-item
 * allocations (e.g. tool receipts on a material request) stay unattributed.
 * Active-receipt ledger pruning (with allocation-preserving aggregation) is
 * delegated to core, so consumed ids and the MIND_LIMITS.receipts ledger bound
 * stay consistent by construction; this task only consumes existing ids. */
function creditReceipts(observation: DecisionObservation, task: TreeTaskState, item: ItemKey): number {
  let added = 0;
  for (const receipt of allocatedReceipts(observation, task)) {
    if (receipt.item !== item || receipt.item !== itemKey(task.request.resource, task.request.tier) || receipt.quantity <= 0) continue;
    if (!consume(task.receiptIds, receipt.id)) continue;
    added += receipt.quantity;
  }
  if (added) task.delivered += added;
  return added;
}
/** Direct settlement evidence: private completion events of our own tracked work,
 * consumed into the evidence channel, never into receiptIds. */
function completionEvidence(observation: DecisionObservation, task: TreeTaskState, match: (event: { tick: number; kind: string; text: string }) => boolean) {
  return observation.alerts.find((entry) =>
    entry.kind === 'completion' && entry.tick <= observation.tick && entry.tick > (task.lastProgressTick ?? 0) &&
    match({ tick: entry.tick, kind: entry.kind, text: entry.text }) &&
    consumeEvidence(observation, task, entry.id));
}

// ------------------------------------------------------------------- exit and cleanup

function propose(observation: DecisionObservation, task: TreeTaskState, command: Command, reason: string, waiting: TreeStepResult['waiting']): TreeStepResult {
  task.lastProgressTick = observation.tick;
  if (waiting === 'action' && command.type !== 'cancel')
    task.actionId = `pending:${JSON.stringify(command)}`;
  return { status: 'running', reason, command, waiting };
}
function startExit(task: TreeTaskState, status: 'succeeded' | 'failed', failure: Exclude<TreeStepResult['failure'], undefined> | undefined, reason: string): void {
  task.phase = `exit:${status}${failure ? `:${failure}` : ''}`;
  task.reason = reason;
}
/** Exit routine: stop owned work first, then settle owned orders oldest-first;
 * the terminal status is only reported when nothing owned remains. */
function settleExit(observation: DecisionObservation, task: TreeTaskState): TreeStepResult {
  const action = self(observation).action;
  if (task.actionId && action && (action.id === task.actionId || task.actionId === `pending:${JSON.stringify(action.command)}`))
    return propose(observation, task, { type: 'cancel' }, `Cleanup: stopping owned work before handoff (${task.reason})`, 'action');
  task.actionId = undefined;
  const markets = new Map(observation.markets.map((order) => [order.id, order]));
  while (task.ownedOrderIds.length) {
    const orderId = task.ownedOrderIds[0]!;
    const order = markets.get(orderId);
    if (!order || order.citizenId !== self(observation).id) { task.ownedOrderIds = task.ownedOrderIds.slice(1); continue; }
    return propose(observation, task, { type: 'cancel-order', orderId }, `Cleanup: settling owned order ${orderId} (${task.reason})`, 'order');
  }
  const exitPhase = task.phase;
  const status: TreeStepResult['status'] = exitPhase.startsWith('exit:succeeded') ? 'succeeded' : 'failed';
  const failureToken = exitPhase.split(':')[2] as TreeStepResult['failure'];
  task.status = status;
  task.phase = 'done';
  return {
    status,
    reason: task.reason ?? 'exit cleanup complete',
    ...(status === 'failed' && failureToken ? { failure: failureToken } : {}),
  };
}

// ------------------------------------------------------------------- shared routes

const attempt = (phase: string): number => Number(phase.split(':')[1] ?? 0);
const withAttempt = (phase: string, n: number): string => `${phase.split(':')[0]}:${n}`;
const deadlineExceeded = (observation: DecisionObservation, task: TreeTaskState): boolean =>
  task.request.deadlineTick !== undefined && observation.tick > task.request.deadlineTick;

/** Provisional fallback channel for settlements the receipt contract cannot
 * attribute (tool purchases, sales): personal trade events of `${item} sold`
 * are consumed exactly once via `task.tradeEventCursor`; `task.evidenceIds`
 * retains only a bounded diagnostic sample and units accumulate in
 * `task.accounting.units`. Never applied to receipt-channel items, so one fill is
 * never credited through both channels. */
function fallbackTrades(observation: DecisionObservation, task: TreeTaskState, item: ItemKey): number {
  const floor = Math.max(task.startedTick, task.wakeTick ?? 0);
  // Engine event-N ids use the persisted monotonic world.nextId sequence.
  // Advance over the entire visible batch, including unrelated events. This
  // high-water mark, not the bounded diagnostic sample, prevents replay credit.
  const entries = observation.alerts.map((entry) => ({ entry, sequence: Number(/^event-(\d+)$/.exec(entry.id)?.[1]) }))
    .filter(({ sequence }) => Number.isSafeInteger(sequence))
    .sort((a, b) => a.sequence - b.sequence);
  let units = 0;
  for (const { entry, sequence } of entries) {
    if (sequence <= (task.tradeEventCursor ?? 0)) continue;
    task.tradeEventCursor = sequence;
    const trade = entry.trade;
    const selling = task.definitionId === 'SellItem';
    // Legacy prose has no reliable order identity: never attribute it to a
    // current responsibility. Order ids are supplied by dispatch feedback.
    if (task.wakeTick === undefined || entry.kind !== 'trade' || entry.tick < floor ||
      !trade || trade.item !== item ||
      (selling ? trade.sellerId : trade.buyerId) !== self(observation).id ||
      !task.ownedOrderIds.includes(selling ? trade.sellOrderId : trade.buyOrderId) ||
      task.evidenceIds?.includes(entry.id)) continue;
    const quantity = trade.quantity;
    if (quantity > 0) {
      units += quantity;
      task.evidenceIds ??= [];
      if (task.evidenceIds.length < MIND_LIMITS.evidence) task.evidenceIds.push(entry.id);
    }
  }
  return units;
}
/** Cumulative count of this task's consumed evidence events still resident in
 * the personal alert window (bounded memory; consumption never erases delivery,
 * it only bounds this provisional recount). */
function evidenceCount(observation: DecisionObservation, task: TreeTaskState, match: (event: { tick: number; kind: string; text: string }) => boolean): number {
  return (task.evidenceIds ?? []).filter((id) => {
    const entry = observation.alerts.find((a) => a.id === id);
    return !!entry && match({ tick: entry.tick, kind: entry.kind, text: entry.text });
  }).length;
}
/** Confirmed units toward one requested item across both evidence channels:
 * allocated receipt sums live exactly in `task.delivered`; settlements the
 * receipt ledger cannot attribute (fallback items) accumulate in `task.accounting.units`. */
/** Lazy compatibility for valid legacy accounting targets only. Spatial tasks are
 * never normalized; the checkpoint validator still rejects fractional tiles. */
function accounting(task: TreeTaskState): NonNullable<TreeTaskState['accounting']> {
  const counters = task.accounting ??= {};
  const legacy = task.target;
  if (!legacy) return counters;
  if (['SellItem', 'ObtainTool', 'CraftTool'].includes(task.definitionId)) {
    counters.units ??= legacy.x;
  } else if (task.definitionId === 'GiveGift' && task.phase === 'gift-gold') {
    counters.goldBefore ??= legacy.x;
  } else if (['ObtainFoodNow', 'ObtainResource'].includes(task.definitionId) &&
      task.strategyId === 'recover-escrow' && task.phase === 'recover-cancel') {
    counters.escrowQuantity ??= legacy.x;
  } else if (['CreateTerritory', 'ExpandTerritory'].includes(task.definitionId)) {
    counters.marked ??= legacy.x;
    counters.signBaseline ??= legacy.y;
  } else return counters;
  task.target = undefined;
  return counters;
}
function confirmedUnits(task: TreeTaskState, item: ItemKey): number {
  const fallback = item !== itemKey(task.request.resource, task.request.tier);
  return task.delivered + (fallback ? accounting(task).units ?? 0 : 0);
}

/** Stale-recourse guard: personal error events that rejected our deposit
 * acquisition work (depleted, missing or tool-required). Each failure is
 * consumed once into the evidence channel and recounted from it, so retries
 * never loop on the same stale target and stay bounded across re-selections. */
const ACQUISITION_ERROR_RE = /(deposit|matching tool)/i;
function consumeAcquisitionFailure(observation: DecisionObservation, task: TreeTaskState): { tick: number; text: string } | null {
  const entry = observation.alerts.find((a) =>
    a.kind === 'error' && a.citizenId === self(observation).id && a.tick >= task.startedTick &&
    ACQUISITION_ERROR_RE.test(a.text) && consumeEvidence(observation, task, a.id));
  return entry ? { tick: entry.tick, text: entry.text } : null;
}
function acquisitionFailures(observation: DecisionObservation, task: TreeTaskState): number {
  return evidenceCount(observation, task, (event) =>
    event.kind === 'error' && ACQUISITION_ERROR_RE.test(event.text));
}

/** Travel phase shared by all routes: moves toward `task.target`, one command
 * per idle boundary; counts unreachable/lost attempts before invalidation. */
function stepTravel(observation: DecisionObservation, task: TreeTaskState, nextPhase: string, limit = 4): TreeStepResult {
  const body = self(observation);
  const dest = task.target!;
  if (body.x === dest.x && body.y === dest.y) {
    task.phase = withAttempt(nextPhase, 0);
    return { status: 'running', reason: `Arrived at (${dest.x},${dest.y}) for ${task.strategyId ?? task.definitionId}.` };
  }
  if (body.action) return waitAction(observation, task);
  const tries = attempt(task.phase);
  if (tries >= limit) {
    startExit(task, 'failed', 'invalidated', `Travel target (${dest.x},${dest.y}) unreachable after ${tries} attempts`);
    return settleExit(observation, task);
  }
  task.phase = withAttempt(task.phase, tries + 1);
  return propose(observation, task, { type: 'move', x: dest.x, y: dest.y },
    `Travelling to (${dest.x},${dest.y}) (attempt ${tries + 1})`, 'action');
}

/** While accepted work runs, the task waits; command feedback is not completion.
 * Only a pending exact command proposed by this task may become owned tracking. */
function waitAction(observation: DecisionObservation, task: TreeTaskState): TreeStepResult {
  const action = self(observation).action!;
  if (action.id !== task.actionId) {
    if (task.actionId !== `pending:${JSON.stringify(action.command)}`)
      return { status: 'running', reason: 'Waiting for unrelated work; not adopting ownership.', waiting: 'action' };
    task.actionId = action.id;
    task.lastProgressTick = observation.tick;
    return { status: 'running', reason: `Tracking accepted ${action.command.type} work (${action.id}).`, waiting: 'action' };
  }
  return { status: 'running', reason: `Waiting on accepted ${action.command.type} work (${action.id}).`, waiting: 'action' };
}
/** Completion evidence for our own accepted work: only consulted when the body
 * is idle, after adopting/waiting through `waitAction`. `task.actionId` is kept
 * for exit cleanup; stale ids simply stop matching. */
function attemptIdleEvidence(observation: DecisionObservation, task: TreeTaskState, match: (event: { tick: number; kind: string; text: string }) => boolean) {
  // Stale completions from earlier work (including prior task invocations) never
  // satisfy this task: evidence counts only after this task proposed work itself.
  if (attempt(task.phase) === 0 || !task.actionId) return undefined;
  return completionEvidence(observation, task, match);
}
/** Proposal with cumulative attempt accounting: arrivals preserve the counter,
 * every work proposal increments it, and retries report the failed attempt. */
function proposeWork(observation: DecisionObservation, task: TreeTaskState, workPhase: string, command: Command, reason: string, what: string): TreeStepResult {
  const tries = attempt(task.phase) + 1;
  task.phase = withAttempt(workPhase, tries);
  return propose(observation, task, command, tries > 1 ? `${what} attempt ${tries - 1} ended without completion; retrying` : reason, 'action');
}
/** An accepted work attempt ended without completion evidence: retry while the
 * attempt budget lasts, then invalidate and clean up. */
function failAttempts(observation: DecisionObservation, task: TreeTaskState, what: string, limit: number): TreeStepResult {
  const tries = attempt(task.phase) + 1;
  if (tries < limit) {
    task.phase = withAttempt(task.phase.split(':')[0], tries);
    return { status: 'running', reason: `${what} attempt ${tries} ended without completion; retrying.` };
  }
  startExit(task, 'failed', 'no-progress', `${what} did not complete after ${tries} attempts`);
  return settleExit(observation, task);
}

// ------------------------------------------------------------------- market routes

/** Order acceptance and resting order projections are never settlement credit:
 * the receipt channel (and, for unattributable fallback items, consumed trade
 * events) confirms buy and sell settlements. */
const trackedOrder = (observation: DecisionObservation, task: TreeTaskState, side: 'buy' | 'sell', item: ItemKey): Order | undefined =>
  ownOrders(observation).find((o) => o.side === side && o.item === item && task.ownedOrderIds.includes(o.id));
/** Net confirmed buy units for the requested item; posting sizes derive from it. */
function confirmedBuyUnits(task: TreeTaskState, item: ItemKey): number {
  return confirmedUnits(task, item);
}
function stepBuy(observation: DecisionObservation, task: TreeTaskState, item: ItemKey): TreeStepResult {
  const body = self(observation);
  const confirmed = confirmedBuyUnits(task, item);
  if (confirmed >= task.request.quantity) {
    startExit(task, 'succeeded', undefined, `Buy order settlement confirmed ${confirmed} ${item} delivered`);
    return settleExit(observation, task);
  }
  // Legacy orders retain the old bounded adoption path. Explicit background
  // provenance cannot be adopted by an unrelated task.
  const adoptable = ownOrders(observation).find(o => o.side === 'buy' && o.item === item &&
    (o.requestId === task.request.id || (o.requestId === undefined && task.wakeTick !== undefined &&
      o.createdTick >= task.wakeTick && o.createdTick <= observation.tick)) && !task.ownedOrderIds.includes(o.id));
  if (adoptable) task.ownedOrderIds.push(adoptable.id);
  const adopted = trackedOrder(observation, task, 'buy', item);
  if (adopted) {
    task.lastProgressTick = observation.tick;
    return { status: 'running', reason: `Waiting for buy fills on ${adopted.id} (remaining ${adopted.quantity}); acceptance is not delivery.`, waiting: 'order' };
  }
  // An own order vanished without prior cleanup: it settled within a posting
  // dispatch or filled fully while resting. Credit arrives only from the fill's
  // allocated market receipt (consumed at the route entry) or, for fallback
  // items, its personal trade event; a vanished order never invents units.
  const price = othersAsk(observation, item);
  if (price === null) {
    startExit(task, 'failed', 'infeasible', `No seller is offering ${item}; a postable bid alone is not supply`);
    return settleExit(observation, task);
  }
  if (price > buyWillingness(observation, item, task.request.quantity - confirmed))
    return startInfeasible(observation, task, `Observed ${item} ask ${price} exceeds personal budget willingness`);
  const needed = price * (task.request.quantity - confirmed);
  if (body.gold < needed) {
    const funded = runFunding(observation, task, item, needed - body.gold);
    return funded ?? startInfeasible(observation, task, `Gold ${body.gold} and funding capacity cannot cover ${needed} for ${item}`);
  }
  task.wakeTick = observation.tick;
  return propose(observation, task, { type: 'order', side: 'buy', item, quantity: Math.ceil(task.request.quantity - confirmed), price }, `Posting funded bid for ${task.request.quantity - confirmed} ${item} at ask ${price}`, 'order');
}
function startInfeasible(observation: DecisionObservation, task: TreeTaskState, reason: string): TreeStepResult {
  startExit(task, 'failed', 'infeasible', reason);
  return settleExit(observation, task);
}
/** Funding chain: refunds, then inventory sales to bids, then recover own
 * escrow and resell it. One command per step; gold is rechecked on entry. */
function immediateFoodFunding(observation: DecisionObservation, task?: TreeTaskState): boolean {
  return !!task && task.request.resource === 'food' &&
    ['ObtainFoodNow', 'ObtainResource'].includes(task.definitionId) &&
    task.request.urgency === 'survival' && self(observation).fullness <= 0 &&
    othersAsk(observation, resourceItem(task)) !== null;
}
function runFunding(observation: DecisionObservation, task: TreeTaskState, item: ItemKey, shortfall: number): TreeStepResult | null {
  const body = self(observation);
  const emergency = immediateFoodFunding(observation, task);
  if (emergency && fundingCapacity(observation, task).total < shortfall) return null;
  const refundOrder = ownOrders(observation).find((o) => o.side === 'buy');
  if (refundOrder) {
    task.ownedOrderIds.push(refundOrder.id);
    return propose(observation, task, { type: 'cancel-order', orderId: refundOrder.id }, `Funding: cancelling own buy ${refundOrder.id} for ${refundOrder.escrowGold} refund`, 'order');
  }
  const bidItem = Object.keys(body.inventory).find((key) => {
    const bid = othersBid(observation, key);
    return CARRIED_ITEM_RE.test(key) && key !== item && !!bid && bid.quantity > 0 && carriedSurplus(observation, key, task, emergency) > 0;
  });
  if (bidItem) {
    const bid = othersBid(observation, bidItem)!;
    return propose(observation, task, { type: 'order', side: 'sell', item: bidItem, quantity: Math.min(carriedSurplus(observation, bidItem, task, emergency), bid.quantity, emergency ? (/^(wood|food|fibre):/.test(bidItem) ? shortfall / bid.price : Math.ceil(shortfall / bid.price)) : Infinity), price: bid.price },
      `Funding: selling carried ${bidItem} into current bid demand`, 'order');
  }
  const escrow = ownOrders(observation).find((o) => o.side === 'sell' && o.item !== item);
  if (escrow) {
    task.ownedOrderIds.push(escrow.id);
    return propose(observation, task, { type: 'cancel-order', orderId: escrow.id }, `Funding: recovering own ${escrow.item} escrow for resale`, 'order');
  }
  return null;
}

// ------------------------------------------------------------------- conditions registry

const resourceItem = (task: TreeTaskState): ItemKey => itemKey(task.request.resource, task.request.tier);

interface ResourceRoute { route: string; reason: string; cost: number; targetId?: string; target?: Point; escrowQuantity?: number }

/** Select the cheapest finite route for one unit of `task.request.resource:tier`,
 * excluding routes rejected by the optional filter (stale acquisition feedback). */
function chooseRoute(observation: DecisionObservation, task: TreeTaskState, blocked?: (route: { route: string; targetId?: string }) => boolean): string | null {
  const routes = routesFeasible(observation, task, blocked).filter((r) => Number.isFinite(r.cost))
    .sort((a, b) => a.cost - b.cost);
  const selected = routes[0];
  if (!selected) return null;
  task.strategyId = selected.route;
  task.targetId = selected.targetId;
  task.target = selected.target;
  if (selected.escrowQuantity !== undefined) (task.accounting ??= {}).escrowQuantity = selected.escrowQuantity;
  task.phase = selected.route === 'recover-escrow' ? 'recover-cancel' :
    selected.route === 'buy' ? 'buy' : 'travel';
  if (selected.target) task.phase = 'travel:0';
  task.reason = selected.reason;
  return `Selected ${selected.route}: ${selected.reason}`;
}

/** Choose a known feasible harvest deposit for one unit, excluding `blockedId`
 * (a deposit just rejected by the engine, whose cached sighting is stale) and
 * honouring the tier/tool restrictions. */
function selectDeposit(observation: DecisionObservation, task: TreeTaskState, blockedId: string | undefined, rejection: string | undefined): TreeStepResult {
  const item = resourceItem(task);
  const evidence = depositEvidence(observation, task.request.resource, task.request.tier)
    .filter((e) => e.deposit.id !== blockedId && e.deposit.stock > 0 &&
      e.deposit.tier <= Math.min(MAX_TIER, toolTierFor(observation, task.request.resource) + 1))
    .filter((e) => Number.isFinite(harvestCost(observation, e.deposit, e.from, toolTierFor(observation, task.request.resource))))
    .sort((a, b) => harvestCost(observation, a.deposit, a.from, toolTierFor(observation, task.request.resource)) -
      harvestCost(observation, b.deposit, b.from, toolTierFor(observation, task.request.resource)))[0];
  if (!evidence) {
    startExit(task, 'failed', 'infeasible', rejection ?
      `${rejection} leaves no other known deposit for ${item} under hard restrictions` :
      `No known ${item} deposit under hard restrictions`);
    return settleExit(observation, task);
  }
  task.targetId = evidence.deposit.id;
  task.target = evidence.from;
  task.phase = 'travel:0';
  task.reason = `Selected ${item} deposit at (${evidence.from.x},${evidence.from.y})`;
  return { status: 'running', reason: task.reason };
}

function routesFeasible(observation: DecisionObservation, task: TreeTaskState, blocked?: (route: { route: string; targetId?: string }) => boolean): ResourceRoute[] {
  const routes: ResourceRoute[] = [];
  const body = self(observation);
  const item = resourceItem(task);
  for (const evidence of depositEvidence(observation, task.request.resource, task.request.tier)) {
    const toolTier = toolTierFor(observation, task.request.resource);
    if (evidence.deposit.stock <= 0) continue;
    if (evidence.deposit.tier > Math.min(MAX_TIER, toolTier + 1)) continue;
    if (blocked?.({ route: 'harvest', targetId: evidence.deposit.id })) continue;
    routes.push({
      route: 'harvest',
      reason: `Known ${item} deposit at (${evidence.from.x},${evidence.from.y}) seen tick ${evidence.evidenceTick}`,
      cost: harvestCost(observation, evidence.deposit, evidence.from, toolTier),
      targetId: evidence.deposit.id,
      target: evidence.from,
    });
  }
  const ownStation = buildingEvidence(observation, (b) =>
    b.kind === STATION_FOR[task.request.resource] && b.ownerId === body.id && b.health > 0)
    .find((e) => e.building.kind === STATION_FOR[task.request.resource]);
  for (const direction of ['up', 'down'] as const) {
    const fromTier = direction === 'up' ? task.request.tier - 1 : task.request.tier + 1;
    if (!ownStation || fromTier < 1 || fromTier > MAX_TIER) continue;
    if (!canRefine(ownStation.building.tier, fromTier, direction)) continue;
    const recipe = refinementRecipe(task.request.resource, fromTier, direction);
    if (!Object.entries(recipe).every(([key, n]) => (body.inventory[key] ?? 0) >= n)) continue;
    routes.push({
      route: 'refine',
      reason: `Own ${ownStation.building.kind} T${ownStation.building.tier} can ${direction}-convert ${item}`,
      cost: distance(body, ownStation.from) * BALANCE.moveTicks + BALANCE.refineTicks[ownStation.building.tier],
      targetId: ownStation.building.id,
      target: ownStation.from,
    });
  }
  if (task.request.allowMarket) {
    const escrow = ownOrders(observation).find((o) => o.side === 'sell' && o.item === item && o.quantity > 0);
    if (escrow) routes.push({ route: 'recover-escrow', reason: `Own ${item} sell escrow ${escrow.quantity} may be recovered`, cost: 0, targetId: escrow.id, escrowQuantity: escrow.escrowItems[item] ?? escrow.quantity });
    const ask = othersAsk(observation, item);
    if (ask !== null) {
      const funded = body.gold >= ask * task.request.quantity;
      if (funded || fundingCapacity(observation, task).total + body.gold >= ask * task.request.quantity)
        routes.push({ route: 'buy', reason: `${item} offered at ${ask} gold (${funded ? 'funded' : 'fundable'})`, cost: task.request.resource === 'food' && task.request.urgency === 'survival' ? (funded ? 1 : 4) : ask });
      else routes.push({ route: 'buy', reason: `${item} offered at ${ask} but not fundable`, cost: Number.POSITIVE_INFINITY });
    }
  }
  return routes;
}

/** Observation-only time estimate for urgent food selection and idle reassessment.
 * Price is a feasibility constraint, not simulation time. No remembered public
 * work is treated as a current reservation. */
export function foodAcquisitionTicks(observation: DecisionObservation, task: TreeTaskState): number {
  if (task.request.resource !== 'food' || !['Harvest', 'ObtainResource', 'ObtainFoodNow', 'RefineResource'].includes(task.definitionId)) return Infinity;
  const routes = routesFeasible(observation, task).filter(r =>
    task.definitionId === 'Harvest' ? r.route === 'harvest' :
    task.definitionId === 'ObtainFoodNow' ? ['buy', 'recover-escrow'].includes(r.route) :
    task.definitionId === 'RefineResource' ? r.route === 'refine' : true);
  return Math.min(Infinity, ...routes.map(r => r.cost + 1));
}

/** Cumulative funding sources: refunds, then inventory sales, then own sell-escrow
 * recovery valued at current bids (can-obtain-food-now contract). Never mutates. */
export function fundingCapacity(observation: DecisionObservation, task?: TreeTaskState): {
  refund: number; inventorySales: number; escrowSales: number; total: number;
} {
  const body = self(observation);
  const refund = ownOrders(observation).filter((o) => o.side === 'buy').reduce((sum, o) => sum + o.escrowGold, 0);
  const bidValue = (item: ItemKey, quantity: number): number => {
    const bids = observation.markets
      .filter((o) => o.item === item && o.side === 'buy' && o.citizenId !== body.id)
      .sort((a, b) => b.price - a.price);
    let value = 0;
    let left = quantity;
    for (const bid of bids) {
      if (left <= 0) break;
      const units = Math.min(left, bid.quantity);
      value += units * bid.price;
      left -= units;
    }
    return value;
  };
  const emergency = immediateFoodFunding(observation, task);
  const inventorySales = Object.entries(body.inventory)
    .filter(([key]) => CARRIED_ITEM_RE.test(key) && (!task || key !== resourceItem(task)))
    .reduce((sum, [key, count]) => sum + bidValue(key, Math.min(count, carriedSurplus(observation, key, task, emergency))), 0);
  const escrowSales = ownOrders(observation).filter((o) => o.side === 'sell' && (!task || o.item !== resourceItem(task)))
    .reduce((sum, o) => sum + bidValue(o.item, Math.max(0, carriedSurplus({ ...observation, citizen: { ...body, inventory: { ...body.inventory, [o.item]: (body.inventory[o.item] ?? 0) + (o.escrowItems[o.item] ?? o.quantity) } } }, o.item, task, emergency) - carriedSurplus(observation, o.item, task, emergency))), 0);
  return { refund, inventorySales, escrowSales, total: refund + inventorySales + escrowSales };
}

function guardIdentityCondition(task: TreeTaskState, ok: boolean, reason: string): GuardResult {
  const violation = identityViolation(task);
  if (violation) return { ok: false, reason: `excluded: ${violation}` };
  return { ok, reason };
}

export const CONDITIONS: Record<string, ConditionDef> = {
  CanObtainFoodNow: {
    id: 'CanObtainFoodNow',
    evaluate: (observation, task) => {
      const item = itemKey('food', task.request.tier);
      if (!task.request.allowMarket)
        return guardIdentityCondition(task, false, 'allowMarket false excludes all market routes; food now has no other immediate route');
      const ownFood = ownOrders(observation).some((o) => o.side === 'sell' && o.item === item && o.quantity > 0);
      if (ownFood) return guardIdentityCondition(task, true, `Own ${item} sell escrow is recoverable`);
      const ask = othersAsk(observation, item);
      if (ask === null) return guardIdentityCondition(task, false, `No ${item} offers are listed; funding cannot buy supply that does not exist`);
      const body = self(observation);
      if (body.gold >= ask) return guardIdentityCondition(task, true, `Gold ${body.gold} covers ${item} ask ${ask}`);
      const funds = fundingCapacity(observation, task);
      if (funds.total + body.gold >= ask)
        return guardIdentityCondition(task, true, `Refunds ${funds.refund} + inventory sales ${funds.inventorySales} + escrow sales ${funds.escrowSales} cover the shortfall`);
      return guardIdentityCondition(task, false, `Cheapest ${item} ask ${ask} exceeds gold ${body.gold} and cumulative funding ${funds.total}`);
    },
  },
  CanObtainResource: {
    id: 'CanObtainResource',
    evaluate: (observation, task) => {
      const feasible = routesFeasible(observation, task).filter((r) => Number.isFinite(r.cost));
      return guardIdentityCondition(task, feasible.length > 0,
        feasible.length ? `${feasible.map((r) => r.route).join(',')}: ${feasible[0]!.reason}` :
          `No known feasible route for one unit of ${resourceItem(task)}`);
    },
  },
  CanObtainTool: {
    id: 'CanObtainTool',
    evaluate: (observation, task) => {
      const item = task.targetId ?? '';
      const kind = item.split(':')[0] ?? '';
      const tier = Number(item.split(':')[1]);
      if (!EQUIPMENT.includes(kind as never) || !TIERS.includes(tier) || item.split(':').length !== 2)
        return guardIdentityCondition(task, false, 'Request one exact tool kind:tier (axe, scythe, knife or sword)');
      const craftable = Object.entries(equipmentRecipe(kind as 'axe', tier))
        .every(([key, n]) => (self(observation).inventory[key] ?? 0) >= n);
      if (craftable) return guardIdentityCondition(task, true, `Recipe materials for ${item} are carried`);
      if (task.request.allowMarket && othersAsk(observation, item) !== null)
        return guardIdentityCondition(task, true, `${item} is offered for purchase`);
      if (task.request.allowMarket && ownOrders(observation).some((o) => o.side === 'sell' && o.item === item))
        return guardIdentityCondition(task, true, `Own ${item} sell escrow is recoverable`);
      return guardIdentityCondition(task, false, `No carried materials, purchase offer or recoverable escrow for ${item}`);
    },
  },
  CanHarvestResource: {
    id: 'CanHarvestResource',
    evaluate: (observation, task) => {
      const evidence = depositEvidence(observation, task.request.resource, task.request.tier)
        .find((e) => e.deposit.stock > 0 && e.deposit.tier <= Math.min(MAX_TIER, toolTierFor(observation, task.request.resource) + 1) &&
          Number.isFinite(harvestCost(observation, e.deposit, e.from, toolTierFor(observation, task.request.resource))));
      return guardIdentityCondition(task, !!evidence,
        evidence ? `Known reachable ${resourceItem(task)} deposit at (${evidence.from.x},${evidence.from.y})` :
          `No known ${resourceItem(task)} deposit under hard restrictions`);
    },
  },
  CanRefineResource: {
    id: 'CanRefineResource',
    evaluate: (observation, task) => {
      const body = self(observation);
      for (const direction of ['up', 'down'] as const) {
        const fromTier = direction === 'up' ? task.request.tier - 1 : task.request.tier + 1;
        if (fromTier < 1 || fromTier > MAX_TIER) continue;
        const station = buildingEvidence(observation, (b) =>
          b.kind === STATION_FOR[task.request.resource] && b.ownerId === body.id && b.health > 0 &&
          canRefine(b.tier, fromTier, direction))[0];
        if (!station) continue;
        const recipe = refinementRecipe(task.request.resource, fromTier, direction);
        if (Object.entries(recipe).every(([key, n]) => (body.inventory[key] ?? 0) >= n))
          return guardIdentityCondition(task, true, `Own ${station.building.kind} at (${station.from.x},${station.from.y}) with exact inputs for ${direction} conversion`);
      }
      return guardIdentityCondition(task, false, `No own usable station plus exact inputs for one ${resourceItem(task)} conversion`);
    },
  },
  CanCraftTool: {
    id: 'CanCraftTool',
    evaluate: (observation, task) => {
      const item = task.targetId ?? '';
      const kind = item.split(':')[0] ?? '';
      const tier = Number(item.split(':')[1]);
      if (!EQUIPMENT.includes(kind as never) || !TIERS.includes(tier))
        return guardIdentityCondition(task, false, 'Request one exact tool kind:tier');
      const recipe = equipmentRecipe(kind as 'axe', tier);
      const have = Object.entries(recipe).every(([key, n]) => (self(observation).inventory[key] ?? 0) >= n);
      return guardIdentityCondition(task, have, have ? `Recipe stock present for ${item}` : `Missing recipe stock: ${JSON.stringify(recipe)}`);
    },
  },
  /** Materials-only guard: no placement, site choice or acquisition (approved boundary). */
  CanBuildResourceBuilding: {
    id: 'CanBuildResourceBuilding',
    evaluate: (observation, task) => {
      const kind = STATION_FOR[task.request.resource];
      const tier = task.request.tier;
      const recipe = buildingRecipe(kind!, tier);
      const have = Object.entries(recipe).every(([key, n]) => (self(observation).inventory[key] ?? 0) >= n);
      return guardIdentityCondition(task, have, have ? `Carried construction materials for ${kind} T${tier}` : `Missing materials: ${JSON.stringify(recipe)}`);
    },
  },
  CanBuildHouse: {
    id: 'CanBuildHouse',
    evaluate: (observation, task) => {
      const recipe = houseRecipe(task.request.tier);
      const have = Object.entries(recipe).every(([key, n]) => (self(observation).inventory[key] ?? 0) >= n);
      return guardIdentityCondition(task, have, have ? `Carried materials for T${task.request.tier} house` : `Missing materials: ${JSON.stringify(recipe)}`);
    },
  },
  CanBuildWall: {
    id: 'CanBuildWall',
    evaluate: (observation, task) => {
      const recipe = buildingRecipe('wall', task.request.tier);
      const have = Object.entries(recipe).every(([key, n]) => (self(observation).inventory[key] ?? 0) >= n * Math.max(1, task.request.quantity));
      const site = wallSites(observation)[0];
      return guardIdentityCondition(task, have && !!site,
        have && site ? `Wall T${task.request.tier} materials with a known placement at (${site.x},${site.y})` :
          !site ? 'No known feasible wall placement' : `Missing materials: ${JSON.stringify(recipe)}`);
    },
  },
  /** Outdoor rest is permitted; request.quantity is the requested rest target. */
  CanSleep: {
    id: 'CanSleep',
    evaluate: (observation, task) => {
      const rest = self(observation).rest;
      const target = task.request.quantity;
      if (rest === undefined) return guardIdentityCondition(task, false, 'This citizen does not track rest');
      return guardIdentityCondition(task, rest.value < target, rest.value < target ?
        `Rest ${rest.value.toFixed(1)} below requested target ${target}` : `Rest ${rest.value.toFixed(1)} already meets ${target}`);
    },
  },
  CanSellItem: {
    id: 'CanSellItem',
    evaluate: (observation, task) => {
      const item = task.targetId ?? '';
      const quantity = task.request.quantity;
      if (!CARRIED_ITEM_RE.test(item)) return guardIdentityCondition(task, false, 'Sell one exact carried item:tier');
      if (!task.request.allowMarket) return guardIdentityCondition(task, false, 'allowMarket false excludes market commands');
      const listed = ownOrders(observation).filter((o) => o.side === 'sell' && o.item === item);
      const inHand = (self(observation).inventory[item] ?? 0) + listed.reduce((sum, o) => sum + o.quantity, 0);
      return guardIdentityCondition(task, inHand >= quantity,
        inHand >= quantity ? `${inHand} ${item} available (carried or already listed)` : `Only ${inHand} ${item} available for ${quantity}`);
    },
  },
  CanGiveGift: {
    id: 'CanGiveGift',
    evaluate: (observation, task) => {
      const item = task.strategyId ?? '';
      if (item !== 'gold' && !CARRIED_ITEM_RE.test(item)) return guardIdentityCondition(task, false, 'Gift gold or one exact carried item:tier');
      const have = (item === 'gold' ? self(observation).gold : carriedSurplus(observation, item, task)) >= task.request.quantity;
      const recipient = sightings(observation, task.targetId ?? '')[0];
      return guardIdentityCondition(task, have && !!recipient,
        have && recipient ? `Gift available; recipient last seen (${recipient.from.x},${recipient.from.y}) tick ${recipient.evidenceTick}` :
          have ? 'Gift available but recipient is not known' : `Missing ${task.request.quantity} ${item}`);
    },
  },
  CanExplore: {
    id: 'CanExplore',
    evaluate: (observation, task) => {
      if (!task.request.purpose.trim()) return guardIdentityCondition(task, false, 'The parent supplies a search purpose');
      const mapSize = observation.mapSize;
      if (!mapSize) return guardIdentityCondition(task, false, 'Map geometry unknown; no known permitted route');
      const body = self(observation);
      const goal = goalEvidence(observation, task.request.purpose, true);
      const frontier = [...observation.visible, ...observation.remembered].some((tile) =>
        neighbors8(tile).some((p) => p.x >= 0 && p.y >= 0 && p.x < mapSize.width && p.y < mapSize.height &&
          !knownTiles(observation).some((t) => t.x === p.x && t.y === p.y)));
      const within = body.x >= 0 && body.y >= 0 && body.x < mapSize.width && body.y < mapSize.height;
      return guardIdentityCondition(task, within && (frontier || !!goal),
        within && (frontier || goal) ?
          `Known investigation route: ${goal ? `refreshing dated goal evidence ${goal.reason}` : 'frontier of known tiles'}` :
          !within ? 'Citizen outside known geometry' : 'No known route offering new or refreshed information');
    },
  },
  CanReproduce: {
    id: 'CanReproduce',
    evaluate: (observation, task) => {
      const body = self(observation);
      const partner = observation.visible.flatMap(tile => tile.citizens).find(c => c.id === task.targetId);
      const partnerOk = !!partner && partner.id !== body.id && partner.alive && partner.health >= BALANCE.reproductionHealth && !partner.busy && distance(body, partner) <= 1;
      const healthOk = body.health >= BALANCE.reproductionHealth;
      const ready = body.reproductionCooldown <= observation.tick;
      const foodOk = (body.inventory[itemKey('food', BALANCE.reproductionFoodTier)] ?? 0) >= BALANCE.reproductionFood;
      const ok = healthOk && ready && foodOk && partnerOk;
      return guardIdentityCondition(task, ok, ok ?
        `Own prerequisites met; nearby living idle partner observed (${partner!.x},${partner!.y})` :
        `Prerequisites: health ${body.health}/${BALANCE.reproductionHealth}, cooldown ${body.reproductionCooldown - observation.tick}, food:${BALANCE.reproductionFoodTier} ${(body.inventory[itemKey('food', BALANCE.reproductionFoodTier)] ?? 0)}/${BALANCE.reproductionFood}, partner known ${!!partner}`);
    },
  },
  CanAttackCitizen: {
    id: 'CanAttackCitizen',
    evaluate: (observation, task) => {
      const target = sightings(observation, task.targetId ?? '')[0];
      if (task.targetId === self(observation).id) return guardIdentityCondition(task, false, 'Never attack self');
      // Selection-only intent marker; mechanical/debug attacks remain unchanged.
      // Once combat starts, do not invent a mid-strike profitability interruption.
      if (task.strategyId === 'optional-predation' && !task.actionId) {
        const visible = observation.visible.flatMap(t => t.citizens).find(c => c.id === task.targetId);
        if (!visible || (optionalAttackValue(observation, visible)?.gain ?? 0) <= 0)
          return guardIdentityCondition(task, false, 'Visible carried gain no longer covers combat risk');
      }
      return guardIdentityCondition(task, !!target && target.sighting.health > 0,
        target ? `Known living target, ${target.sighting.health.toFixed(0)} health at last sighting` : 'Target citizen is not known');
    },
  },
  CanAttackStructure: {
    id: 'CanAttackStructure',
    evaluate: (observation, task) => {
      const target = buildingEvidence(observation, (b) => b.id === task.targetId && b.health > 0)[0];
      const sign = observation.signs?.find((s) => s.id === task.targetId && s.health > 0);
      return guardIdentityCondition(task, !!target || !!sign,
        target ? `Known structure at (${target.from.x},${target.from.y}), ${target.building.health.toFixed(0)} health` : 'Structure is not known or already destroyed');
    },
  },
  CanCreateTerritory: {
    id: 'CanCreateTerritory',
    evaluate: (observation, task) => {
      const body = self(observation);
      const member = territoryMemberships(observation, body.id);
      if (member.length) return guardIdentityCondition(task, false, `Already a member of ${member.map((t) => t.id).join(',')}; leave first`);
      const need = Math.max(1, task.request.quantity) * COMPOSED_BALANCE.territoryWoodPerTile;
      const wood = (body.inventory[itemKey('wood', task.request.tier)] ?? 0);
      const tiles = claimableTiles(observation, body.id);
      const ok = wood >= need && tiles.length >= task.request.quantity;
      return guardIdentityCondition(task, ok, ok ?
        `Wood ${wood} covers ${need} and ${tiles.length} eligible tiles exist` :
        `Wood ${wood}/${need} or only ${tiles.length} eligible tiles`);
    },
  },
  CanExpandTerritory: {
    id: 'CanExpandTerritory',
    evaluate: (observation, task) => {
      const body = self(observation);
      const territory = (observation.territories ?? []).find((t) => t.id === task.targetId);
      const member = !!territory && !!territory.members[body.id];
      const need = Math.max(1, task.request.quantity) * COMPOSED_BALANCE.territoryWoodPerTile;
      const wood = (body.inventory[itemKey('wood', task.request.tier)] ?? 0);
      const tiles = claimableTiles(observation, body.id);
      const ok = !!territory && member && wood >= need && tiles.length >= Math.max(1, task.request.quantity);
      return guardIdentityCondition(task, ok, ok ?
        `Member of ${territory!.id}; wood ${wood} covers ${need}; ${tiles.length} additions eligible` :
        territory ? `Membership ${member}, wood ${wood}/${need}, ${tiles.length} eligible tiles` : 'Target territory is not known');
    },
  },
  CanJoinTerritory: {
    id: 'CanJoinTerritory',
    evaluate: (observation, task) => {
      const body = self(observation);
      const member = territoryMemberships(observation, body.id);
      if (member.length) return guardIdentityCondition(task, false, `Membership exists (${member.map((t) => t.id).join(',')}); not a silent switch`);
      const territory = (observation.territories ?? []).find((t) => t.id === task.targetId);
      return guardIdentityCondition(task, !!territory,
        territory ? `Territory ${territory.id} has an admission process; acceptance is not guaranteed` : 'Territory is not known');
    },
  },
  CanLeaveTerritory: {
    id: 'CanLeaveTerritory',
    evaluate: (observation, task) => {
      const member = territoryMemberships(observation, self(observation).id);
      const ok = member.some((t) => t.id === task.targetId) && negativePersonalMajority(observation, task.targetId ?? '');
      return guardIdentityCondition(task, ok, ok ? `Negative personal opinions of a strict majority of other members of ${task.targetId}` : 'Departure requires negative personal opinions of a strict majority of other living members');
    },
  },
  // ---------------------------------------------------------- pure local facts
  InTerritory: {
    id: 'InTerritory',
    evaluate: (observation, task) => {
      const point = task.target;
      const signs = observation.signs ?? [];
      const hit = point ? signs.some((sign) => sign.x === point.x && sign.y === point.y) : false;
      return { ok: hit, reason: hit ? `Tile (${point!.x},${point!.y}) is marked` : point ? `Tile (${point.x},${point.y}) is not marked in known signs` : 'Provide task.target' };
    },
  },
  OwnsTerritory: {
    id: 'OwnsTerritory',
    evaluate: (observation, task) => {
      const territory = (observation.territories ?? []).find((t) => t.id === task.targetId);
      return { ok: !!territory && territory.ownerId === self(observation).id,
        reason: territory ? `Owner is ${territory.ownerId}` : 'Territory is not known' };
    },
  },
  IsTerritoryMember: {
    id: 'IsTerritoryMember',
    evaluate: (observation, task) => {
      const territory = (observation.territories ?? []).find((t) => t.id === task.targetId);
      const member = !!territory && !!territory.members[self(observation).id];
      return { ok: member,
        reason: member ? `Membership of ${self(observation).id} held` : 'Not a known territory member' };
    },
  },
  CanUseBuilding: {
    id: 'CanUseBuilding',
    evaluate: (observation, task) => {
      const building = buildingEvidence(observation, (b) => b.id === task.targetId)[0]?.building ??
        observation.houses?.find((h) => h.id === task.targetId);
      if (!building || building.health <= 0) return { ok: false, reason: 'Building is not known or destroyed' };
      if (building.ownerId === self(observation).id) return { ok: true, reason: 'Own building' };
      const sign = observation.signs?.find((s) => s.x === building.x && s.y === building.y);
      const shared = self(observation).alive && (observation.territories ?? []).some((territory) =>
        territory.id === sign?.territoryId && !!territory.members[self(observation).id]);
      return { ok: shared, reason: shared ? 'Shared use through current membership at the marked building tile' : 'Owner presence is not permission' };
    },
  },
};

function territoryMemberships(observation: DecisionObservation, citizenId: string): Territory[] {
  return (observation.territories ?? []).filter((t) => !!t.members[citizenId]);
}
/** Dated candidate tiles near the citizen: unmarked, no other active claim and
 * no nonmember-owned building tile in the latest sighting. Selection evidence
 * only — `liveEligible` revalidates at the mark boundary before any command. */
function claimableTiles(observation: DecisionObservation, citizenId: string): Point[] {
  const tiles = knownTiles(observation).filter(tile => settlementClaimEligible(observation, tile));
  return tiles
    .map((tile) => {
      const adjacent = (observation.signs ?? []).filter(s =>
        (observation.territories ?? []).some(t => t.id === s.territoryId && t.members[citizenId]) &&
        Math.abs(s.x - tile.x) + Math.abs(s.y - tile.y) === 1).length;
      const occupancy = settlementOccupancy(observation, tile);
      const useful = occupancy.shared ? 8 : occupancy.empty ? 5 : 1;
      return { tile, d: distance(tile, self(observation)) - useful - adjacent * 2 };
    })
    .sort((a, b) => a.d - b.d || a.tile.x - b.tile.x || a.tile.y - b.tile.y)
    .map(({ tile }) => ({ x: tile.x, y: tile.y }));
}
function neighbors8(tile: Point): Point[] {
  return [{ x: tile.x - 1, y: tile.y }, { x: tile.x + 1, y: tile.y }, { x: tile.x, y: tile.y - 1 }, { x: tile.x, y: tile.y + 1 }];
}
/** Engine territory connectivity is 4-way; marking increments must connect through it. */
const OFFSETS4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** An active (unexpired) record claim covering a tile. */
const activeClaimAt = (observation: DecisionObservation, p: Point): boolean =>
  (observation.claims ?? []).some((claim) => claim.expiresTick > observation.tick &&
    p.x >= claim.areas[0] && p.y >= claim.areas[1] && p.x <= claim.areas[2] && p.y <= claim.areas[3]);
/** Signs of one territory currently in sight; the civic projection exposes only
 * visible-tile signs, so every mark count here is sight-bounded evidence. */
const visibleSignsOf = (observation: DecisionObservation, territoryId: string) =>
  (observation.signs ?? []).filter((sign) => sign.territoryId === territoryId);
const tileKey = (p: Point): string => `${p.x},${p.y}`;
function wallSites(observation: DecisionObservation): Point[] {
  return knownTiles(observation)
    .filter((tile) => settlementOccupancy(observation, tile).empty && !tile.citizens.some((c) => c.alive))
    .map((tile) => ({ tile, d: distance(tile, self(observation)) }))
    .sort((a, b) => a.d - b.d)
    .map(({ tile }) => ({ x: tile.x, y: tile.y }));
}
/** Dated goal evidence for exploration purposes like 'deposit food T2'. */
function goalEvidence(observation: DecisionObservation, purpose: string, datedOnly = false): { reason: string; target: Point } | null {
  const match = /deposit (food|wood|fibre) T(\d+)/.exec(purpose);
  if (!match) return null;
  const evidence = depositEvidence(observation, match[1] as Resource, Number(match[2]))
    .filter((e) => !datedOnly || !observation.visible.some((tile) => tile.x === e.from.x && tile.y === e.from.y))
    .sort((a, b) =>
    distance(a.from, self(observation)) - distance(b.from, self(observation)));
  return evidence.length ? { reason: `(${evidence[0]!.from.x},${evidence[0]!.from.y}) seen tick ${evidence[0]!.evidenceTick}`, target: evidence[0]!.from } : null;
}

// --------------------------------------------------------------------- actions registry

export const ACTIONS: Record<string, ActionDef> = {
  // ----------------------------------------------------------------- food now
  ObtainFoodNow: {
    id: 'ObtainFoodNow',
    step: (observation, task) => {
      const item = itemKey('food', task.request.tier);
      creditReceipts(observation, task, item);
      if (task.delivered >= task.request.quantity) {
        startExit(task, 'succeeded', undefined, `Food delivery confirmed: ${task.delivered} ${item} (exact receipt sum)`);
        return settleExit(observation, task);
      }
      // Route 1: recover own food sell escrow. The cancel-order settlement emits
      // a recovery DeliveryReceipt, credited exclusively through the receipt
      // channel; the vanished order itself never invents delivery units.
      const ownFood = ownOrders(observation).filter((o) => o.side === 'sell' && o.item === item && o.quantity > 0);
      if (ownFood.length && task.request.allowMarket) {
        if (task.strategyId !== 'recover-escrow') {
          task.strategyId = 'recover-escrow';
          task.targetId = ownFood[0]!.id;
          task.phase = 'recover-cancel';
          task.reason = `Cancelling own ${item} listing to recover ${ownFood[0]!.quantity}`;
        }
        const order = observation.markets.find((o) => o.id === task.targetId);
        if (order) {
          task.ownedOrderIds.push(order.id);
          (task.accounting ??= {}).escrowQuantity ??= order.escrowItems[item] ?? order.quantity;
          task.target = undefined;
          return propose(observation, task, { type: 'cancel-order', orderId: order.id }, `Cancelling own ${item} escrow (${order.quantity} left)`, 'order');
        }
        // Order gone: recovery receipts were consumed at the entry of this step;
        // if the escrow sold instead, only trade evidence records that outcome.
        const soldInstead = fallbackTrades(observation, task, item) > 0;
        task.strategyId = undefined;
        task.target = undefined;
        return { status: 'running', reason: soldInstead ?
          `Own ${item} escrow was sold instead of recovered; re-selecting route.` :
          `Own ${item} escrow order vanished; recovery receipts credited ${task.delivered}; re-selecting route.` };
      }
      if (ownFood.length && !task.request.allowMarket) {
        startExit(task, 'failed', 'infeasible', 'allowMarket false excludes escrow recovery');
        return settleExit(observation, task);
      }
      // Route 2: direct funded purchase; retained buy routes handle their own
 // settlement credit even when the ask vanishes with the fill.
      if (task.request.allowMarket && task.strategyId === 'buy')
        return stepBuy(observation, task, item);
      if (task.request.allowMarket && othersAsk(observation, item) !== null) {
        if (self(observation).gold >= othersAsk(observation, item)!) {
          task.strategyId = 'buy';
          task.phase = 'buy';
          return stepBuy(observation, task, item);
        }
        // Route 3: funding chain: refunds -> inventory sales -> escrow recovery + resale.
        const funding = runFunding(observation, task, item, (othersAsk(observation, item) ?? 0) - self(observation).gold);
        if (funding) return funding;
        startExit(task, 'failed', 'infeasible', `Funding capacity cannot cover ${item} ask ${othersAsk(observation, item)}`);
        return settleExit(observation, task);
      }
      startExit(task, 'failed', 'infeasible', `No ${item} offers, funding exhausted or market routes excluded; caller may explore`);
      return settleExit(observation, task);
    },
  },

  // -------------------------------------------------------------- generic resource
  ObtainResource: {
    id: 'ObtainResource',
    step: (observation, task) => {
      const item = resourceItem(task);
      const needed = task.request.quantity - task.delivered;
      if (needed <= 0) {
        startExit(task, 'succeeded', undefined, `Delivery confirmed: ${task.delivered} ${item}`);
        return settleExit(observation, task);
      }
      creditReceipts(observation, task, item);
      if (task.delivered >= task.request.quantity) {
        startExit(task, 'succeeded', undefined, `Delivery confirmed: exact receipt sum ${task.delivered} ${item}`);
        return settleExit(observation, task);
      }
      if (!task.strategyId) {
        const reason = chooseRoute(observation, task);
        return reason
          ? { status: 'running', reason }
          : startInfeasible(observation, task, `No feasible route for one unit of ${item}; caller reconsiders or explores`);
      }
      switch (task.strategyId) {
        case 'harvest': {
          const deposit = task.targetId;
          if (self(observation).action) return waitAction(observation, task);
          if (attemptIdleEvidence(observation, task, (entry) => entry.text === 'Completed harvest.')) {
            // Delivery is credited exclusively from allocated NET receipts.
            task.lastProgressTick = observation.tick;
            task.strategyId = undefined;
            task.phase = 'select';
            return { status: 'running', reason: `Harvest settled; NET ${item} credited ${task.delivered}.` };
          }
          // Fresh action-failure feedback beats cached sighting feasibility: the
          // engine just rejected work on this deposit (depleted, gone or
          // tool-required), so the cached stock is proven stale for this task and
          // retrying the same target would only churn. Re-select from other known
          // routes instead; an evidence-backed failure budget bounds the loop and
          // leaves the caller to explore or reconsider.
          const failure = consumeAcquisitionFailure(observation, task);
          if (failure) {
            task.strategyId = undefined;
            if (acquisitionFailures(observation, task) >= 3) {
              startExit(task, 'failed', 'no-progress', `Acquisition of ${item} rejected at the engine ${acquisitionFailures(observation, task)} times (${failure.text}); no further stale retry`);
              return settleExit(observation, task);
            }
            const blocked = deposit ? (route: { route: string; targetId?: string }) => route.route === 'harvest' && route.targetId === deposit : undefined;
            const selected = chooseRoute(observation, task, blocked);
            return selected ? { status: 'running', reason: selected }
              : startInfeasible(observation, task, `Harvest of ${item} rejected at the engine (${failure.text}); no other known route for ${item}`);
          }
          if (!deposit || !depositEvidence(observation, task.request.resource, task.request.tier).some((e) => e.deposit.id === deposit && e.deposit.stock > 0)) {
            task.strategyId = undefined;
            return { status: 'running', reason: `Selected deposit evidence is depleted or gone; re-selecting route for ${item}.` };
          }
          const live = depositEvidence(observation, task.request.resource, task.request.tier).find((e) => e.deposit.id === deposit);
          if (live && !Number.isFinite(harvestCost(observation, live.deposit, live.from, toolTierFor(observation, task.request.resource)))) {
            const selected = chooseRoute(observation, task);
            return selected ? { status: 'running', reason: `Current competitor completion changed route. ${selected}` }
              : startInfeasible(observation, task, 'Current public work leaves no viable acquisition route');
          }
          if (task.phase.split(':')[0] === 'travel') return stepTravel(observation, task, 'harvest:0', 4);
          if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Harvest of ${item}`, 3);
          return proposeWork(observation, task, 'harvest', { type: 'harvest', depositId: deposit },
            `Harvesting ${item} at (${task.target?.x},${task.target?.y})`, `Harvest of ${item}`);
        }
        case 'refine': {
          if (self(observation).action) return waitAction(observation, task);
          if (attemptIdleEvidence(observation, task, (entry) => entry.text === 'Completed refine.')) {
            // Refinement output carries no delivery receipt: one conversion delivers
            // at least one output unit, and cumulative conversions are recounted from
 // the task's consumed evidence (bounded personal alert window).
            const fromTier = task.request.tier > 1 ? task.request.tier - 1 : task.request.tier + 1;
            const direction = task.request.tier > fromTier ? 'up' : 'down';
            const unitsPerConversion = Object.values(refinementOutput(task.request.resource, fromTier, direction as 'up' | 'down'))[0] ?? 1;
            const conversions = evidenceCount(observation, task, (entry) => entry.kind === 'completion' && entry.text === 'Completed refine.');
            if (task.delivered + conversions * unitsPerConversion >= task.request.quantity) {
              startExit(task, 'succeeded', undefined, `Refinement evidence confirms ${task.delivered} receipt units plus ${conversions} conversions of ${item}`);
              return settleExit(observation, task);
            }
            task.strategyId = undefined;
            task.phase = 'select';
            return { status: 'running', reason: `Refinement delivered ${conversions * unitsPerConversion} ${item} without receipts; delivered ${task.delivered} receipt units.` };
          }
          const station = buildingEvidence(observation, (b) => b.id === task.targetId && b.ownerId === self(observation).id && b.health > 0)[0];
          if (!station) {
            task.strategyId = undefined;
            return { status: 'running', reason: 'Station evidence gone; re-selecting route.' };
          }
          if (task.phase.split(':')[0] === 'travel') return stepTravel(observation, task, 'refine:0', 4);
          if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Refinement to ${item}`, 3);
          const fromTier = task.request.tier > 1 ? task.request.tier - 1 : task.request.tier + 1;
          const direction = task.request.tier > fromTier ? 'up' : 'down';
          return proposeWork(observation, task, 'refine', { type: 'refine', buildingId: task.targetId!, fromTier: fromTier as Tier, direction },
            `Refining ${item} at ${task.targetId}`, `Refinement to ${item}`);
        }
        case 'recover-escrow': {
          const order = observation.markets.find((o) => o.id === task.targetId && o.citizenId === self(observation).id);
          if (order) {
            task.ownedOrderIds.push(order.id);
            (task.accounting ??= {}).escrowQuantity ??= order.escrowItems[item] ?? order.quantity;
            task.target = undefined;
            return propose(observation, task, { type: 'cancel-order', orderId: order.id }, `Cancelling own ${item} escrow to recover stock`, 'order');
          }
          // The cancel-order settlement receipt is consumed at the entry of this
          // action; a vanished order never invents delivery units. If the escrow
          // sold instead of recovering, only trade evidence records that outcome.
          const soldInstead = fallbackTrades(observation, task, item) > 0;
          task.strategyId = undefined;
          task.target = undefined;
          task.phase = 'select';
          return { status: 'running', reason: soldInstead ? 'Escrow order was sold instead of recovered; re-selecting route.' : 'Escrow order no longer recoverable; re-selecting route.' };
        }
        case 'buy':
          return stepBuy(observation, task, item);
        default:
          task.strategyId = undefined;
          return { status: 'running', reason: `Unknown retained route ${task.strategyId}; re-selecting.` };
      }
    },
  },

  // ---------------------------------------------------------------------- tool
  ObtainTool: {
    id: 'ObtainTool',
    step: (observation, task) => {
      const item = task.targetId ?? '';
      const [kind, tierValue] = [item.split(':')[0] ?? '', Number(item.split(':')[1])];
      creditReceipts(observation, task, item);
      // Purchase fills of tools carry no attributable receipt; their personal
      // trade events are the fallback channel, accumulated once in task.accounting.units.
      const purchased = fallbackTrades(observation, task, item);
      if (purchased) {
        const counters = accounting(task);
        counters.units = (counters.units ?? 0) + purchased;
      }
      if (self(observation).action) return waitAction(observation, task);
      // Route: craft from carried materials; completion evidence first, since
      // consumption may already have emptied the recipe stock. A completed craft
      // carries no delivery receipt: one consumed completion event is one
      // confirmed exact-tier tool, accumulated with purchases in task.accounting.units.
      const recipe = equipmentRecipe(kind as 'axe', tierValue);
      if (attemptIdleEvidence(observation, task, (entry) => entry.text === 'Completed craft.')) {
        const counters = accounting(task);
        counters.units = (counters.units ?? 0) + 1;
        task.strategyId = undefined;
      }
      const confirmed = confirmedUnits(task, item);
      if (confirmed >= task.request.quantity) {
        startExit(task, 'succeeded', undefined, `${item} delivery confirmed: ${confirmed} confirmed units`);
        return settleExit(observation, task);
      }
      if (Object.entries(recipe).every(([key, n]) => (self(observation).inventory[key] ?? 0) >= n)) {
        task.strategyId = 'craft';
        if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Craft of ${item}`, 3);
        return proposeWork(observation, task, 'craft', { type: 'craft', item: kind as 'axe', tier: tierValue },
          `Crafting ${item} from carried materials`, `Craft of ${item}`);
      }
      // Route: purchase / escrow (allowMarket), else prerequisite child request.
      if (task.request.allowMarket) {
        if (self(observation).action && task.phase.split(':')[0] === 'buy') return waitAction(observation, task);
        task.strategyId = 'buy';
        task.phase = 'buy';
        return stepBuy(observation, task, item);
      }
      task.phase = 'prerequisite';
      const materials = Object.entries(recipe).filter(([key, n]) => (self(observation).inventory[key] ?? 0) < n)
        .map(([key, n]) => `${key} x${n}`);
      startExit(task, 'failed', 'infeasible',
        `No ${item} route without market: missing recipe materials (${materials.join(', ')}); parent may delegate prerequisite acquisition`);
      return settleExit(observation, task);
    },
  },

  // ------------------------------------------------------------------ standalone executors
  /** One more net exact-tier unit into holdings; the parent repeats for quantity. */
  Harvest: {
    id: 'Harvest',
    step: (observation, task) => {
      const item = resourceItem(task);
      creditReceipts(observation, task, item);
      if (task.delivered >= 1) {
        startExit(task, 'succeeded', undefined, `NET ${item} delivery confirmed`);
        return settleExit(observation, task);
      }
      if (self(observation).action) return waitAction(observation, task);
      if (attemptIdleEvidence(observation, task, (entry) => entry.text === 'Completed harvest.')) {
        // A gross completion cannot supplement a taxed NET receipt.
        task.phase = 'work:0';
        return {
          status: 'running',
          reason: `Harvest completed for ${item}; delivered ${task.delivered}.`,
        };
      }
      const base = task.phase.split(':')[0];
      // Fresh action-failure feedback beats cached sighting feasibility: rejected
      // work proves the cached stock sighting stale, so re-select other known
      // deposits instead of retrying the same target; the evidence-backed budget
      // bounds the loop and reports no-progress for the caller to explore.
      const failure = base === 'work' || base === 'harvest' ? consumeAcquisitionFailure(observation, task) : null;
      if (failure) {
        if (acquisitionFailures(observation, task) >= 3) {
          startExit(task, 'failed', 'no-progress', `Harvest of ${item} rejected at the engine ${acquisitionFailures(observation, task)} times (${failure.text}); no further stale retry`);
          return settleExit(observation, task);
        }
        return selectDeposit(observation, task, task.targetId, `failed ${item} acquisition`);
      }
      if (base !== 'travel' && base !== 'work' && base !== 'harvest') {
        return selectDeposit(observation, task, undefined, undefined);
      }
      const live = depositEvidence(observation, task.request.resource, task.request.tier).find((e) => e.deposit.id === task.targetId);
      if (live && !Number.isFinite(harvestCost(observation, live.deposit, live.from, toolTierFor(observation, task.request.resource))))
        return selectDeposit(observation, task, task.targetId, 'Current competitor finishes earlier');
      if (base === 'travel') return stepTravel(observation, task, 'work', 4);
      if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Harvest of ${item}`, 3);
      return proposeWork(observation, task, 'harvest', { type: 'harvest', depositId: task.targetId! },
        `Harvesting ${item} at (${task.target?.x},${task.target?.y})`, `Harvest of ${item}`);
    },
  },
  RefineResource: {
    id: 'RefineResource',
    step: (observation, task) => {
      const item = resourceItem(task);
      creditReceipts(observation, task, item);
      if (task.delivered >= (task.request.quantity || 1)) {
        startExit(task, 'succeeded', undefined, `Conversion output for ${item} confirmed`);
        return settleExit(observation, task);
      }
      if (self(observation).action) return waitAction(observation, task);
      const direction = task.strategyId === 'refine-up' ? 'up' : task.strategyId === 'refine-down' ? 'down' : undefined;
      if (attemptIdleEvidence(observation, task, (entry) => entry.text === 'Completed refine.')) {
        // Direction stored at selection time; inputs are reserved with the work.
        // Refinement output carries no delivery receipt: one conversion delivers at
        // least one net output unit, and cumulative conversions are recounted from
 // the task's consumed evidence (bounded personal alert window).
        const fromTier = (direction ?? 'up') === 'up' ? task.request.tier - 1 : task.request.tier + 1;
        const unitsPerConversion = Object.values(refinementOutput(task.request.resource, fromTier, (direction ?? 'up') as 'up' | 'down'))[0] ?? 1;
        const conversions = evidenceCount(observation, task, (entry) => entry.kind === 'completion' && entry.text === 'Completed refine.');
        task.phase = 'work:0';
        if (task.delivered + conversions * unitsPerConversion >= (task.request.quantity || 1)) {
          startExit(task, 'succeeded', undefined, `Refinement confirmed for ${item}: ${task.delivered} receipt units plus ${conversions} conversions`);
          return settleExit(observation, task);
        }
        return { status: 'running', reason: `Refinement completed for ${item}; ${task.delivered} receipt units plus ${conversions} conversions.` };
      }
      const base = task.phase.split(':')[0];
      const select = (['up', 'down'] as const).map((candidate) => {
        const fromTier = candidate === 'up' ? task.request.tier - 1 : task.request.tier + 1;
        if (fromTier < 1 || fromTier > MAX_TIER) return null;
        const station = buildingEvidence(observation, (b) =>
          b.kind === STATION_FOR[task.request.resource] && b.ownerId === self(observation).id && b.health > 0 &&
          (base !== '' && task.targetId !== undefined ? b.id === task.targetId : true) &&
          canRefine(b.tier, fromTier, candidate))[0];
        if (!station) return null;
        // Inputs must be unreserved carried stock; they may already sit reserved
        // with accepted work, which selection never reaches again.
        if (!Object.entries(refinementRecipe(task.request.resource, fromTier, candidate))
          .every(([key, n]) => (self(observation).inventory[key] ?? 0) >= n)) return null;
        return { candidate, fromTier, station };
      }).find((choice) => choice !== null);
      if (base === '' || (base === 'travel' && !direction)) {
        if (!select) {
          startExit(task, 'failed', 'infeasible', 'No own usable station plus exact inputs for the requested conversion');
          return settleExit(observation, task);
        }
        task.targetId = select.station.building.id;
        task.strategyId = select.candidate === 'up' ? 'refine-up' : 'refine-down';
        task.phase = 'travel:0';
      }
      if (base === 'travel') {
        const station = buildingEvidence(observation, (b) => b.id === task.targetId && b.ownerId === self(observation).id && b.health > 0)[0];
        if (!station) {
          startExit(task, 'failed', 'invalidated', 'Station evidence is gone');
          return settleExit(observation, task);
        }
        task.target = station.from;
        return stepTravel(observation, task, 'work', 4);
      }
      const chosen = direction ?? 'up';
      const fromTier = chosen === 'up' ? task.request.tier - 1 : task.request.tier + 1;
      if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Refinement to ${item}`, 3);
      return proposeWork(observation, task, 'refine', { type: 'refine', buildingId: task.targetId!, fromTier: fromTier as Tier, direction: chosen as 'up' | 'down' },
        `Refining ${item} at ${task.targetId}`, `Refinement to ${item}`);
    },
  },
  CraftTool: {
    id: 'CraftTool',
    step: (observation, task) => {
      const item = task.targetId ?? '';
      const [kind, tierValue] = [item.split(':')[0] ?? '', Number(item.split(':')[1])];
      creditReceipts(observation, task, item);
      if (self(observation).action) return waitAction(observation, task);
      if (attemptIdleEvidence(observation, task, (entry) => entry.text === 'Completed craft.')) {
        // Completed crafts carry no delivery receipt; each consumed completion
        // event is one confirmed exact-tier tool, accumulated in task.accounting.units.
        const counters = accounting(task);
        counters.units = (counters.units ?? 0) + 1;
      }
      const confirmed = confirmedUnits(task, item);
      if (confirmed >= (task.request.quantity || 1)) {
        startExit(task, 'succeeded', undefined, `${item} crafted and delivered: ${confirmed} confirmed units`);
        return settleExit(observation, task);
      }
      const recipe = equipmentRecipe(kind as 'axe', tierValue);
      const guard = CONDITIONS.CanCraftTool.evaluate(observation, task);
      if (!guard.ok) {
        startExit(task, 'failed', 'infeasible', `Precondition lost: ${guard.reason}`);
        return settleExit(observation, task);
      }
      if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Craft of ${item}`, 3);
      void recipe;
      return proposeWork(observation, task, 'craft', { type: 'craft', item: kind as 'axe', tier: tierValue }, `Crafting ${item}`, `Craft of ${item}`);
    },
  },
  BuildResourceBuilding: {
    id: 'BuildResourceBuilding',
    step: (observation, task) => {
      const kind = STATION_FOR[task.request.resource];
      const confirm = () => buildingEvidence(observation, (b) =>
        b.kind === kind && b.tier === task.request.tier && b.ownerId === self(observation).id &&
        task.target !== undefined && b.x === task.target!.x && b.y === task.target!.y &&
        task.lastProgressTick !== undefined && task.lastProgressTick <= observation.tick)[0];
      if (self(observation).action) return waitAction(observation, task);
      if (confirm()) {
        startExit(task, 'succeeded', undefined, `${kind} T${task.request.tier} confirmed at (${task.target?.x},${task.target?.y})`);
        return settleExit(observation, task);
      }
      const site = buildingSites(observation, task.target)[0];
      if (!site) {
        startExit(task, 'failed', 'infeasible', 'No known feasible free tile near known ground');
        return settleExit(observation, task);
      }
      if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Construction of ${kind}`, 3);
      task.target = site;
      return proposeWork(observation, task, 'build', { type: 'build', kind: kind as 'lumbermill', tier: task.request.tier, x: task.target.x, y: task.target.y },
        `Selecting site (${task.target.x},${task.target.y}) for ${kind} T${task.request.tier}`, `Construction of ${kind}`);
    },
  },
  BuildHouse: {
    id: 'BuildHouse',
    step: (observation, task) => {
      const confirm = () => (observation.houses ?? []).some((house) =>
        house.ownerId === self(observation).id && house.tier === task.request.tier &&
        task.target !== undefined && house.x === task.target.x && house.y === task.target.y);
      if (self(observation).action) return waitAction(observation, task);
      if (task.actionId && confirm()) {
        startExit(task, 'succeeded', undefined, `House T${task.request.tier} confirmed at (${task.target?.x},${task.target?.y})`);
        return settleExit(observation, task);
      }
      const site = buildingSites(observation, task.target)[0];
      if (!site) {
        startExit(task, 'failed', 'infeasible', 'No known feasible free tile near known ground');
        return settleExit(observation, task);
      }
      if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, 'House construction', 3);
      task.target = site;
      return proposeWork(observation, task, 'build', { type: 'build-house', tier: task.request.tier, x: task.target.x, y: task.target.y },
        `Selecting site (${task.target.x},${task.target.y}) for a T${task.request.tier} house`, 'House construction');
    },
  },
  BuildWall: {
    id: 'BuildWall',
    step: (observation, task) => {
      const built = () => buildingEvidence(observation, (b) =>
        b.kind === 'wall' && b.tier === task.request.tier && b.ownerId === self(observation).id &&
        task.target !== undefined && b.x === task.target.x && b.y === task.target.y)[0];
      if (self(observation).action) return waitAction(observation, task);
      if (task.actionId && built()) {
        startExit(task, 'succeeded', undefined,
          `Wall section confirmed at (${task.target?.x},${task.target?.y}); the parent owns extent`);
        return settleExit(observation, task);
      }
      const site = wallSites(observation)[0];
      if (!site) {
        startExit(task, 'failed', 'infeasible', 'No known feasible wall placement');
        return settleExit(observation, task);
      }
      if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, 'Wall construction', 3);
      task.target = site;
      return proposeWork(observation, task, 'build', { type: 'build', kind: 'wall', tier: task.request.tier, x: site.x, y: site.y },
        `Placing wall T${task.request.tier} at (${site.x},${site.y})`, 'Wall construction');
    },
  },
  Sleep: {
    id: 'Sleep',
    step: (observation, task) => {
      const rest = self(observation).rest;
      const target = task.request.quantity || COMPOSED_BALANCE.maxRest;
      if (rest === undefined) {
        startExit(task, 'failed', 'infeasible', 'This citizen does not track rest');
        return settleExit(observation, task);
      }
      if (rest.value >= target) {
        startExit(task, 'succeeded', undefined, `Requested rest level ${target} confirmed`);
        return settleExit(observation, task);
      }
      if (self(observation).action) return waitAction(observation, task);
      return propose(observation, task, { type: 'sleep', targetRest: target }, `Sleeping toward rest ${target}`, 'action');
    },
  },
  SellItem: {
    id: 'SellItem',
    step: (observation, task) => {
      const item = task.targetId ?? '';
      const quantity = task.request.quantity;
      // Sale settlements carry no DeliveryReceipt for the seller: each matching
      // fill emits a personal trade event, consumed exactly once via the
      // event cursor, and its units accumulate in `task.accounting.units` across
      // postings. A resting order's quantity is never settlement credit.
      const sold = fallbackTrades(observation, task, item);
      if (sold) {
        const counters = accounting(task);
        counters.units = (counters.units ?? 0) + sold;
        task.lastProgressTick = observation.tick;
      }
      const confirmed = accounting(task).units ?? 0;
      if (confirmed >= quantity) {
        startExit(task, 'succeeded', undefined, `Confirmed sale of ${confirmed} ${item}`);
        return settleExit(observation, task);
      }
      // Consume the complete visible batch before retiring closed identities.
      // The persisted cursor prevents replay even after repricing/save/restore;
      // an open order stays tracked for future partial fills. Dispatch records
      // even fully-filled incoming ids before this observation boundary.
      task.ownedOrderIds = task.ownedOrderIds.filter((id) => ownOrders(observation).some((order) => order.id === id));
      const adopted = trackedOrder(observation, task, 'sell', item);
      if (adopted) {
        const age = observation.tick - Math.max(adopted.createdTick, task.lastProgressTick ?? task.startedTick);
        const revised = quotePrice(observation, item, observation.tick - task.startedTick);
        if (age >= quoteInterval(observation) && revised !== adopted.price) {
          // Consume fills above before recovering only the resting remainder.
          // wakeTick is deliberately unchanged: it is the sale-event floor.
          return propose(observation, task, { type: 'cancel-order', orderId: adopted.id },
            `Revising unfilled ${item} ask ${adopted.price} toward ${revised}`, 'order');
        }
        return { status: 'running', reason: `Waiting for buyers on ${adopted.id} (${adopted.quantity} ${item} resting); a resting order is not a promise.`, waiting: 'order' };
      }
      // Disappearance is not evidence of a fill. Only exact attributed trades
      // above contribute; reposting uses remaining carried stock.
      if ((self(observation).inventory[item] ?? 0) < quantity - confirmed) {
        startExit(task, 'failed', 'infeasible', `Requested ${quantity} ${item} no longer available unlisted`);
        return settleExit(observation, task);
      }
      if (carriedSurplus(observation, item, task) + 1e-9 < quantity - confirmed)
        return startInfeasible(observation, task, 'Sale would dispose of committed reserves');
      const price = quotePrice(observation, item, observation.tick - task.startedTick);
      task.wakeTick ??= observation.tick;
      const posting = quantity - confirmed;
      accounting(task).units ??= confirmed;
      return propose(observation, task, { type: 'order', side: 'sell', item, quantity: posting, price },
        `Listing ${posting} ${item} at ${price} (no guaranteed buyer)`, 'order');
    },
  },
  GiveGift: {
    id: 'GiveGift',
    step: (observation, task) => {
      const item = task.strategyId ?? '';
      const goldBefore = accounting(task).goldBefore;
      if (task.phase === 'gift-gold' && goldBefore !== undefined && self(observation).gold === goldBefore - task.request.quantity) {
        startExit(task, 'succeeded', undefined, 'Gold gift confirmed by synchronous custody change');
        return settleExit(observation, task);
      }
      if (self(observation).action) return waitAction(observation, task);
      const delivered = task.actionId && observation.alerts.find((entry) => entry.kind === 'help' && entry.citizenId === self(observation).id &&
        entry.targetId === task.targetId && entry.tick >= (task.lastProgressTick ?? 0) &&
        consumeEvidence(observation, task, entry.id));
      if (delivered) {
        startExit(task, 'succeeded', undefined, `Gift of ${task.request.quantity} ${item} to ${task.targetId} confirmed by receipt evidence`);
        return settleExit(observation, task);
      }
      const recipient = sightings(observation, task.targetId ?? '')[0];
      if (!recipient) {
        startExit(task, 'failed', 'invalidated', 'Recipient evidence is gone');
        return settleExit(observation, task);
      }
      if (item !== 'gold' && carriedSurplus(observation, item, task) < task.request.quantity)
        return startInfeasible(observation, task, 'Gift would dispose of committed reserves');
      if (distance(self(observation), recipient.from) <= 1) {
        if (item === 'gold') { task.phase = 'gift-gold'; accounting(task).goldBefore = self(observation).gold; task.target = undefined; }
        return propose(observation, task, item === 'gold'
          ? { type: 'transfer', citizenId: task.targetId!, gold: task.request.quantity }
          : { type: 'give', citizenId: task.targetId!, item, quantity: task.request.quantity },
          `Giving ${task.request.quantity} ${item} to ${task.targetId}`, 'action');
      }
      task.target = recipient.from;
      return stepTravel(observation, task, 'give:0', 4);
    },
  },
  Explore: {
    id: 'Explore',
    step: (observation, task) => {
      const mapSize = observation.mapSize;
      if (!mapSize) {
        startExit(task, 'failed', 'infeasible', 'Map geometry unknown');
        return settleExit(observation, task);
      }
      const goal = goalEvidence(observation, task.request.purpose, !task.target);
      if (task.phase.startsWith('explore-goal') && goal && task.target && observation.visible.some((tile) => tile.x === goal.target.x && tile.y === goal.target.y && tile.seenTick > task.startedTick)) {
        startExit(task, 'succeeded', undefined, `Search goal refreshed in sight: ${goal.reason}`);
        return settleExit(observation, task);
      }
      if (self(observation).action) return waitAction(observation, task);
      const isFrontier = task.phase.split(':')[0] === 'explore-frontier';
      const arrived = task.target && distance(self(observation), task.target) === 0;
      if (arrived) {
        if (isFrontier) {
          // The selected frontier tile was unknown when chosen; arrival is new information
          // by the guard route, not a discovery guarantee.
          startExit(task, 'succeeded', undefined, `New information gained at (${self(observation).x},${self(observation).y}); the caller may continue the search`);
          return settleExit(observation, task);
        }
        startExit(task, 'failed', 'infeasible', `Investigation target (${task.target!.x},${task.target!.y}) yielded no new route; search ends without discovery`);
        return settleExit(observation, task);
      }
      const target = task.target ?? goal?.target ?? exploreFrontier(observation, mapSize);
      if (!target) {
        startExit(task, 'failed', 'infeasible', 'No known route offering new or refreshed information');
        return settleExit(observation, task);
      }
      task.target = target;
      if (!task.phase.startsWith('explore-')) task.phase = goal ? 'explore-goal' : 'explore-frontier';
      task.reason = goal ? `Travelling to dated goal evidence ${goal.reason}` : `Travelling to frontier near (${target.x},${target.y})`;
      return stepTravel(observation, task, task.phase, 6);
    },
  },
  Reproduce: {
    id: 'Reproduce',
    step: (observation, task) => {
      const body = self(observation);
      const born = task.actionId && observation.alerts.find((entry) => entry.kind === 'birth' && entry.tick > (task.lastProgressTick ?? 0) &&
        entry.text.includes(`born to ${body.id}`) && consumeEvidence(observation, task, entry.id));
      if (born) {
        startExit(task, 'succeeded', undefined, `Reproduction completed: ${born.text}`);
        return settleExit(observation, task);
      }
      if (body.action) return waitAction(observation, task);
      if (attemptIdleEvidence(observation, task, (entry) => entry.text.startsWith('Reproduction completed')))
        return { status: 'running', reason: 'Reproduction completed; awaiting birth evidence.' };
      const guard = CONDITIONS.CanReproduce.evaluate(observation, task);
      if (!guard.ok) {
        startExit(task, 'failed', 'infeasible', `Precondition lost: ${guard.reason}`);
        return settleExit(observation, task);
      }
      const partner = sightings(observation, task.targetId ?? '')[0]!;
      task.target = partner.from;
      if (attempt(task.phase) + 1 >= 4) {
        startExit(task, 'failed', 'rejected', 'Joint reproduction did not start; partner may be unavailable');
        return settleExit(observation, task);
      }
      return proposeWork(observation, task, 'reproduce', { type: 'reproduce', partnerId: task.targetId! },
        `Proposing joint reproduction with ${task.targetId} at last-seen position`, 'Joint reproduction');
    },
  },
  AttackCitizen: {
    id: 'AttackCitizen',
    step: (observation, task) => {
      if (self(observation).action) return waitAction(observation, task);
      if (attemptIdleEvidence(observation, task, (entry) => entry.text.startsWith(`Defeated ${task.targetId}`))) {
        startExit(task, 'succeeded', undefined, `Target ${task.targetId} defeated`);
        return settleExit(observation, task);
      }
      const guard = CONDITIONS.CanAttackCitizen.evaluate(observation, task);
      if (!guard.ok) {
        startExit(task, 'failed', 'invalidated', `No longer engageable: ${guard.reason}`);
        return settleExit(observation, task);
      }
      if (attempt(task.phase) + 1 >= 3) return failAttempts(observation, task, `Combat with ${task.targetId}`, 3);
      return proposeWork(observation, task, 'attack', { type: 'attack', targetId: task.targetId! },
        `Attacking ${task.targetId} (pursuit is owned by the body; no invented location)`, `Combat with ${task.targetId}`);
    },
  },
  AttackStructure: {
    id: 'AttackStructure',
    step: (observation, task) => {
      const destroyed = task.actionId && observation.alerts.find((entry) => entry.kind === 'destruction' &&
        (entry.targetId === task.targetId || (task.strategyId === 'attack-sign' && entry.citizenId === self(observation).id && entry.x === task.target?.x && entry.y === task.target?.y)) && entry.tick > (task.lastProgressTick ?? 0) &&
        consumeEvidence(observation, task, entry.id));
      if (destroyed) {
        startExit(task, 'succeeded', undefined, `Structure ${task.targetId} destroyed; resources returned by the body are already carried`);
        return settleExit(observation, task);
      }
      if (self(observation).action) return waitAction(observation, task);
      if (task.strategyId === 'attack-sign' && task.actionId && task.target &&
        observation.visible.some((t) => t.x === task.target!.x && t.y === task.target!.y) &&
        !observation.signs?.some((s) => s.id === task.targetId) &&
        attemptIdleEvidence(observation, task, (entry) => entry.text === 'Completed attack-sign.')) {
        startExit(task, 'succeeded', undefined, `Sign ${task.targetId} destruction confirmed in sight after owned attack`);
        return settleExit(observation, task);
      }
      if (attemptIdleEvidence(observation, task, (entry) => entry.text.startsWith(`Defeated ${task.targetId}`)))
        return { status: 'running', reason: 'Destruction feedback recorded; awaiting destruction evidence.' };
      const guard = CONDITIONS.CanAttackStructure.evaluate(observation, task);
      if (!guard.ok) {
        startExit(task, 'failed', 'invalidated', `No longer attackable: ${guard.reason}`);
        return settleExit(observation, task);
      }
      const limit = task.strategyId === 'attack-sign' || observation.signs?.some((s) => s.id === task.targetId) ? 64 : 3;
      if (attempt(task.phase) + 1 >= limit) return failAttempts(observation, task, `Attack on ${task.targetId}`, limit);
      const sign = observation.signs?.find((s) => s.id === task.targetId);
      if (sign) { task.strategyId = 'attack-sign'; task.target = { x: sign.x, y: sign.y }; }
      return proposeWork(observation, task, 'attack', sign
        ? { type: 'attack-sign', signId: task.targetId! }
        : { type: 'attack', targetId: task.targetId! },
        `Attacking structure ${task.targetId}`, `Attack on ${task.targetId}`);
    },
  },
  // Territory executors confirm citizen-visible civic outcomes; marking only
  // proposes tiles the citizen can see right now.
  CreateTerritory: {
    id: 'CreateTerritory',
    step: (observation, task) => {
      // Own territories become the continuation target only after this task has
      // proposed founding work (task.actionId), never through inherited leadership.
      const founded = (observation.territories ?? []).find((t) => t.ownerId === self(observation).id);
      if (founded && task.actionId) {
        task.targetId = founded.id;
        return stepTerritoryMarking(observation, task, {
          territoryId: founded.id, count: Math.max(1, task.request.quantity),
          woodTier: task.request.tier, what: 'Territory expansion',
        });
      }
      return stepTerritoryMarking(observation, task, {
        count: Math.max(1, task.request.quantity), woodTier: task.request.tier,
        what: 'Territory founding',
      });
    },
  },
  ExpandTerritory: {
    id: 'ExpandTerritory',
    step: (observation, task) => {
      const territory = (observation.territories ?? []).find((t) => t.id === task.targetId);
      if (!territory) {
        startExit(task, 'failed', 'infeasible', 'Target territory is not known');
        return settleExit(observation, task);
      }
      if (!territory.members[self(observation).id]) {
        startExit(task, 'failed', 'infeasible', 'Membership lapsed; only current members expand');
        return settleExit(observation, task);
      }
      return stepTerritoryMarking(observation, task, {
        territoryId: task.targetId, count: Math.max(1, task.request.quantity),
        woodTier: task.request.tier, what: `Expansion of ${task.targetId}`,
      });
    },
  },
  JoinTerritory: {
    id: 'JoinTerritory',
    step: (observation, task) => {
      const territory = (observation.territories ?? []).find((t) => t.id === task.targetId);
      if (territory && !!territory.members[self(observation).id]) {
        startExit(task, 'succeeded', undefined, `Confirmed membership of ${territory.id} with shared building access`);
        return settleExit(observation, task);
      }
      const closed = territory?.admissions.find((a) => a.applicantId === self(observation).id &&
        a.requestedTick >= task.startedTick && (a.status === 'rejected' || a.status === 'expired'));
      if (closed) {
        startExit(task, 'failed', closed.status === 'rejected' ? 'rejected' : 'no-progress',
          `Own admission ${closed.id} ${closed.status === 'rejected' ? 'refused' : 'expired'}`);
        return settleExit(observation, task);
      }
      const admission = territory?.admissions.find((a) => a.applicantId === self(observation).id && a.status === 'pending');
      if (admission) return { status: 'running', reason: 'Waiting for current-member admission votes.', waiting: 'wake' };
      return propose(observation, task, { type: 'join-territory', territoryId: task.targetId! },
        `Requesting admission to ${task.targetId} through current-member voting; refusal is not success`, 'action');
    },
  },
  LeaveTerritory: {
    id: 'LeaveTerritory',
    step: (observation, task) => {
      const member = territoryMemberships(observation, self(observation).id).find((t) => t.id === task.targetId);
      if (!member) {
        startExit(task, 'succeeded', undefined, `${task.targetId} membership ended; owner departure disbands`);
        return settleExit(observation, task);
      }
      const confirm = (observation.territories ?? []).find((t) => t.id === task.targetId);
      if (!confirm || !confirm.members[self(observation).id]) {
        startExit(task, 'succeeded', undefined, `${task.targetId} membership confirmed withdrawn`);
        return settleExit(observation, task);
      }
      const guard = CONDITIONS.CanLeaveTerritory!.evaluate(observation, task);
      if (!guard.ok) {
        startExit(task, 'failed', 'invalidated', guard.reason);
        return settleExit(observation, task);
      }
      return propose(observation, task, { type: 'leave-territory' }, `Ending membership of ${task.targetId}`, 'action');
    },
  },
};

/** PROVISIONAL site selection: if a previously selected site is still eligible it
 * is retained; otherwise the nearest known free tile with no deposit, building or
 * living sighting evidence. */
function buildingSites(observation: DecisionObservation, candidate?: Point): Point[] {
  const sites = wallSites(observation).filter(p => !foreignMark(observation, p))
    .sort((a, b) => settlementSiteCost(observation, a) - settlementSiteCost(observation, b) || a.x - b.x || a.y - b.y);
  if (candidate && sites.some((point) => point.x === candidate.x && point.y === candidate.y)) return [candidate, ...sites];
  return sites;
}
function exploreFrontier(observation: DecisionObservation, mapSize: { width: number; height: number }): Point | null {
  const known = knownTiles(observation);
  const seen = new Set(known.map((tile) => `${tile.x},${tile.y}`));
  let best: { point: Point; d: number } | null = null;
  for (const tile of known) {
    for (const next of neighbors8(tile)) {
      if (next.x < 0 || next.y < 0 || next.x >= mapSize.width || next.y >= mapSize.height) continue;
      if (seen.has(`${next.x},${next.y}`)) continue;
      const gain = neighbors8(next).filter((p) => p.x >= 0 && p.y >= 0 && p.x < mapSize.width && p.y < mapSize.height && !seen.has(`${p.x},${p.y}`)).length;
      const d = distance(next, self(observation)) / Math.max(1, gain);
      if (!best || d < best.d) best = { point: next, d };
    }
  }
  return best?.point ?? null;
}

// --------------------------------------------------------------------- marking eligibility

/** Live mark-time eligibility, revalidated from current sight alone: dated
 * selection evidence may route the citizen toward land, but only a tile visible
 * right now with no sign, active claim or nonmember-owned building may be
 * proposed for marking, so dated memory never exposes remote occupancy. */
function liveEligible(observation: DecisionObservation, citizenId: string, tile: Point): boolean {
  const mapSize = observation.mapSize;
  if (mapSize && (tile.x < 0 || tile.y < 0 || tile.x >= mapSize.width || tile.y >= mapSize.height)) return false;
  const sighting = observation.visible.find((t) => t.x === tile.x && t.y === tile.y);
  if (!sighting) return false;
  return settlementClaimEligible(observation, sighting);
}
/** One connected marking increment over live-eligible candidates (nearest
 * first): founding grows from the nearest candidate, expansion from candidates
 * 4-adjacent to a visible mark, so the engine's connectivity rule holds. */
function connectedIncrement(candidates: Point[], anchors: Point[], limit: number): Point[] {
  const available = new Set(candidates.map(tileKey));
  const seeds = anchors.length
    ? candidates.filter((c) => OFFSETS4.some(([dx, dy]) =>
      anchors.some((anchor) => anchor.x === c.x + dx && anchor.y === c.y + dy)))
    : candidates.slice(0, 1);
  const start = seeds[0];
  if (!start || limit <= 0) return [];
  const chosen: Point[] = [];
  const reached = new Set([tileKey(start)]);
  const queue: Point[] = [start];
  while (queue.length && chosen.length < limit) {
    const current = queue.shift()!;
    chosen.push(current);
    for (const [dx, dy] of OFFSETS4) {
      const next = tileKey({ x: current.x + dx, y: current.y + dy });
      if (available.has(next) && !reached.has(next)) {
        reached.add(next);
        queue.push(candidates.find((p) => tileKey(p) === next)!);
      }
    }
  }
  return chosen;
}
/** Sight travel for territory marking: move toward dated candidate land that is
 * currently out of sight (mode 'sight') or onto a visible mark whose adjacent
 * land is not fully known yet (mode 'tile' survey); `task.target` is never
 * routed through, so the confirmed/baseline tally survives travel untouched.
 * Attempt counting restarts only after confirmed progress (a settled mark). */
function stepSightTravel(observation: DecisionObservation, task: TreeTaskState, destination: Point, mode: 'sight' | 'tile', limit = 8): TreeStepResult {
  const body = self(observation);
  const arrived = mode === 'tile'
    ? body.x === destination.x && body.y === destination.y
    : observation.visible.some((tile) => tile.x === destination.x && tile.y === destination.y);
  if (arrived) {
    return { status: 'running', reason:
      `${mode === 'tile' ? 'Surveying around' : 'Sight regained at'} (${destination.x},${destination.y}); revalidating marking eligibility from current sight.` };
  }
  const tries = attempt(task.phase);
  if (tries >= limit) {
    startExit(task, 'failed', 'invalidated',
      `Marking travel to (${destination.x},${destination.y}) produced no sight-verified land after ${tries} attempts`);
    return settleExit(observation, task);
  }
  task.phase = `sight:${tries + 1}`;
  return propose(observation, task, { type: 'move', x: destination.x, y: destination.y },
    `Travelling to dated land (${destination.x},${destination.y}) to verify it in current sight before marking (attempt ${tries + 1})`, 'action');
}
interface MarkingPlan { territoryId?: string; count: number; woodTier: Tier; what: string }
/** Marking state machine shared by Create/Expand. `task.accounting` holds
 * confirmed marked tiles and the visible-sign baseline at the current vantage. A pending mark is confirmed by the current-sight sign
 * delta of the synchronous command (its tiles were visible and unmarked when
 * proposed and the body has not moved since), so each tile is tallied exactly
 * once and later travel snapshots a fresh baseline instead of re-crediting
 * previously counted signs. Only sight-verified tiles are ever marked. */
function stepTerritoryMarking(observation: DecisionObservation, task: TreeTaskState, plan: MarkingPlan): TreeStepResult {
  const body = self(observation);
  const tally = accounting(task);
  tally.marked ??= 0;
  tally.signBaseline ??= 0;
  const marked = plan.territoryId ? visibleSignsOf(observation, plan.territoryId).length : 0;
  if (task.phase.startsWith('mark:')) {
    if (marked > tally.signBaseline) {
      tally.marked += marked - tally.signBaseline;
      tally.signBaseline = marked;
      task.phase = '';
    } else if (attempt(task.phase) >= 2) {
      startExit(task, 'failed', 'no-progress', `${plan.what} produced no confirmable marked tiles`);
      return settleExit(observation, task);
    } else task.phase = `mark:${attempt(task.phase) + 1}`;
  }
  const confirmed = tally.marked;
  if (confirmed >= plan.count) {
    startExit(task, 'succeeded', undefined,
      `${plan.what} confirmed: ${confirmed} tiles marked by this task, ${marked} signs visible`);
    return settleExit(observation, task);
  }
  if (self(observation).action) return waitAction(observation, task);
  const remaining = plan.count - confirmed;
  const carried = body.inventory[itemKey('wood', plan.woodTier)] ?? 0;
  const candidates = claimableTiles(observation, body.id);
  const live = candidates.filter((tile) => liveEligible(observation, body.id, tile));
  const anchors = plan.territoryId
    ? visibleSignsOf(observation, plan.territoryId).map((sign) => ({ x: sign.x, y: sign.y }))
    : [];
  const increment = connectedIncrement(live, anchors, Math.min(remaining, COMPOSED_BALANCE.maxTerritoryTilesPerCommand));
  if (increment.length) {
    const woodNeed = COMPOSED_BALANCE.territoryWoodPerTile * increment.length;
    if (carried < woodNeed) {
      startExit(task, 'failed', 'infeasible',
        `${plan.what} needs ${woodNeed} wood:${plan.woodTier} for ${increment.length} more tiles and carries ${carried}; parent may delegate wood acquisition`);
      return settleExit(observation, task);
    }
    tally.signBaseline = marked; // baseline snapshot; confirmed advances only on the sight delta
    task.phase = `mark:${attempt(task.phase)}`;
    return propose(observation, task, plan.territoryId
      ? { type: 'expand-territory', territoryId: plan.territoryId, tiles: increment, woodTier: plan.woodTier }
      : { type: 'create-territory', tiles: increment, woodTier: plan.woodTier },
      plan.territoryId
        ? `Marking ${increment.length} sight-verified additions to ${plan.territoryId} (${confirmed} confirmed toward ${plan.count})`
        : `Marking ${increment.length}${increment.length < plan.count ? ` of the requested ${plan.count} tiles, growing through expansion` : ''} starting (${increment[0]!.x},${increment[0]!.y}); partial marking is not success`,
      'action');
  }
  // Nothing live-eligible: travel into current sight before marking; unseen land
  // is never marked from dated memory.
  if (!plan.territoryId) {
    const see = (p: Point) => observation.visible.some((tile) => tile.x === p.x && tile.y === p.y);
    const destination = candidates.find((p) => !see(p));
    if (destination) return stepSightTravel(observation, task, destination, 'sight');
  } else if (anchors.length) {
    const see = (p: Point) => observation.visible.some((tile) => tile.x === p.x && tile.y === p.y);
    const adjacent = candidates.find((p) => !see(p) && OFFSETS4.some(([dx, dy]) =>
      anchors.some((anchor) => anchor.x === p.x + dx && anchor.y === p.y + dy)));
    if (adjacent) return stepSightTravel(observation, task, adjacent, 'sight');
    const survey = anchors.find((anchor) =>
      (anchor.x !== body.x || anchor.y !== body.y) &&
      OFFSETS4.some(([dx, dy]) => !knownTiles(observation).some((tile) =>
        tile.x === anchor.x + dx && tile.y === anchor.y + dy)));
    if (survey) return stepSightTravel(observation, task, survey, 'tile');
  } else {
    startExit(task, 'failed', 'invalidated',
      `No mark of ${plan.territoryId} is in current sight; expansion eligibility cannot be verified remotely`);
    return settleExit(observation, task);
  }
  startExit(task, 'failed', 'infeasible', plan.territoryId
    ? `No sight-verified eligible addition for ${plan.territoryId} among known land (${confirmed}/${plan.count} tiles)`
    : 'No eligible known tiles for founding a territory');
  return settleExit(observation, task);
}

// ---------------------------------------------------------------------- entry point

/** Straightforward stateful step for one task invocation. Returns
 * `running | succeeded | failed`, at most one proposed command, and mutates only
 * `task` (route, phase, targets, delivered credit, receipt ids, owned orders). */
export function stepTreeTask(observation: DecisionObservation, task: TreeTaskState): TreeStepResult {
  accounting(task);
  if (task.phase.startsWith('exit:')) return settleExit(observation, task);
  const violation = identityViolation(task);
  if (violation) {
    task.status = 'failed';
    task.reason = `excluded: ${violation}`;
    task.phase = 'done';
    return { status: 'failed', reason: task.reason, failure: 'excluded' };
  }
  const definition = ACTIONS[task.definitionId];
  if (!definition) {
    task.status = 'failed';
    task.reason = `unbound-definition:${task.definitionId}`;
    task.phase = 'done';
    return { status: 'failed', reason: task.reason, failure: 'invalidated' };
  }
  if (deadlineExceeded(observation, task)) {
    startExit(task, 'failed', 'no-progress', `Deadline ${task.request.deadlineTick} exceeded before completion`);
    return settleExit(observation, task);
  }
  // Sequential ownership: an already-running body action is not this task's work.
  if (self(observation).action && !task.actionId)
    return { status: 'running', reason: 'Waiting for unrelated work before starting responsibility.', waiting: 'action' };
  const result = definition.step(observation, task);
  task.reason = result.reason;
  task.status = result.status;
  // A route that just decided to exit cleans up in the same boundary.
  if (task.phase.startsWith('exit:')) return settleExit(observation, task);
  return result;
}