import type { Inventory, World } from '../shared/types.ts';
import { TIERS } from '../shared/tiers.ts';
import {
  HISTORY_CADENCE, HISTORY_LIMIT,
  type CitizenHistory, type GlobalHistory, type HistoryFrame, type MarketSample,
  type WorldTelemetry,
} from '../shared/telemetry-types.ts';
import { EQUIPMENT, RESOURCES } from './config.ts';

// Commodity keys are bounded by the configured economy, never unique building IDs.
const commodities = [...RESOURCES, ...EQUIPMENT].flatMap((kind) => TIERS.map((tier) => `${kind}:${tier}`));
const commoditySet = new Set(commodities);
// Sample new frames defensively; retained history and authoritative state are untouched.
const currencyRoundoff = (value: number) => value < 0 && value >= -1e-9 ? 0 : value;

function frame(world: World, telemetry: WorldTelemetry): HistoryFrame {
  const previous = telemetry.frames.at(-1);
  const citizens: HistoryFrame['citizens'] = {};
  const markets: Record<string, MarketSample> = {};
  for (const item of commodities) {
    const last = telemetry.last[item];
    markets[item] = {
      bid: null, ask: null, lastPrice: last?.price ?? null, lastTick: last?.tick ?? null,
      supply: 0, demand: 0, carried: 0, held: 0, ground: 0,
      units: telemetry.pending[item]?.units ?? 0,
      turnover: telemetry.pending[item]?.turnover ?? 0,
      fills: telemetry.pending[item]?.fills ?? 0,
    };
  }
  const inventory = (items: Inventory | undefined, field: 'carried' | 'held') => {
    for (const [item, quantity] of Object.entries(items ?? {})) {
      if (markets[item]) markets[item][field] += quantity;
    }
  };
  const escrow: Record<string, number> = {};
  for (const order of Object.values(world.orders)) {
    escrow[order.citizenId] = (escrow[order.citizenId] ?? 0) + currencyRoundoff(order.escrowGold);
    const market = markets[order.item];
    if (!market) continue;
    if (order.side === 'buy') {
      market.demand += order.quantity;
      market.bid = market.bid === null ? order.price : Math.max(market.bid, order.price);
    } else {
      market.supply += order.quantity;
      market.ask = market.ask === null ? order.price : Math.min(market.ask, order.price);
      inventory(order.escrowItems, 'held');
    }
  }
  let population = 0, health = 0, fullness = 0;
  for (const citizen of Object.values(world.citizens)) {
    if (citizen.alive) {
      population++;
      health += citizen.health;
      fullness += citizen.fullness;
      // Carried tools are counted in inventory alongside resources.
      inventory(citizen.inventory, 'carried');
      inventory(citizen.action?.reserved, 'held');
      inventory(citizen.emergency?.suspendedAction?.reserved, 'held');
    }
    if (citizen.alive || previous?.citizens[citizen.id]?.alive) {
      citizens[citizen.id] = {
        alive: citizen.alive, cash: currencyRoundoff(citizen.gold), escrow: currencyRoundoff(escrow[citizen.id] ?? 0),
        health: citizen.health, fullness: citizen.fullness,
      };
    }
  }
  for (const deposit of Object.values(world.deposits)) {
    const market = markets[`${deposit.resource}:${deposit.tier}`];
    if (market) market.ground += deposit.stock;
  }
  return { tick: world.tick, population, meanHealth: population ? health / population : 0,
    meanFullness: population ? fullness / population : 0, citizens, markets };
}

/** Legacy worlds begin at their actual current tick, without invented history. */
export function ensureTelemetry(world: World): WorldTelemetry {
  if (world.telemetry) return world.telemetry;
  const telemetry: WorldTelemetry = { version: 1, startedTick: world.tick, frames: [], pending: {}, last: {} };
  world.telemetry = telemetry;
  telemetry.frames.push(frame(world, telemetry));
  return telemetry;
}

/** Called only after settlement; one fill is one matched pair, not one order. */
export function recordTelemetryFill(world: World, item: string, units: number, price: number): void {
  const telemetry = ensureTelemetry(world);
  if (!commoditySet.has(item)) return;
  const pending = telemetry.pending[item] ??= { units: 0, turnover: 0, fills: 0 };
  pending.units += units;
  pending.turnover += units * price;
  pending.fills++;
  telemetry.last[item] = { price, tick: world.tick };
}

/** Sample committed tick state, never interpolate missing ticks or repeat a tick. */
export function sampleTelemetry(world: World): void {
  const telemetry = ensureTelemetry(world);
  const lastTick = telemetry.frames.at(-1)?.tick ?? telemetry.startedTick;
  if (world.tick - lastTick < HISTORY_CADENCE) return;
  telemetry.frames.push(frame(world, telemetry));
  if (telemetry.frames.length > HISTORY_LIMIT) telemetry.frames.splice(0, telemetry.frames.length - HISTORY_LIMIT);
  telemetry.pending = {};
}

function meta(world: World, telemetry: WorldTelemetry) {
  return { runId: world.runId, tick: world.tick, startedTick: telemetry.startedTick,
    cadence: HISTORY_CADENCE, limit: HISTORY_LIMIT };
}

/** Detached spectator projections; never add these to citizen observations. */
export function globalHistory(world: World): GlobalHistory {
  const telemetry = ensureTelemetry(world);
  return { ...meta(world, telemetry), frames: telemetry.frames.map(({ citizens: _citizens, ...rest }) => structuredClone(rest)) };
}

export function citizenHistory(world: World, citizenId: string): CitizenHistory {
  const telemetry = ensureTelemetry(world);
  return { ...meta(world, telemetry), citizenId, points: telemetry.frames.flatMap((frame) => {
    const sample = frame.citizens[citizenId];
    return sample ? [{ tick: frame.tick, ...sample }] : [];
  }) };
}
