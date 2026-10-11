import type { DecisionObservation, ItemKey } from '../shared/types.ts';
import { equipmentRecipe, harvestDuration } from '../world/config.ts';

const integerPrice = (n: number) => Math.max(1, Math.min(100, Math.round(n)));
/** Personal effort reference, not a world price oracle. One gold represents a
 * short bout of bare-hand T1 work; equipment includes its exact material cost. */
export function effortPrice(item: ItemKey): number {
  const [kind, rawTier] = item.split(':');
  const tier = Number(rawTier) || 1;
  const material = Math.max(2, harvestDuration(tier, Math.max(0, tier - 1)) / 4) * 2 ** (tier - 1);
  if (['axe', 'knife', 'scythe', 'sword'].includes(kind!))
    return integerPrice(material * Object.values(equipmentRecipe(kind as 'axe', tier)).reduce((a, b) => a + b, 0));
  return integerPrice(material);
}
type MarketView = Pick<DecisionObservation, 'citizen' | 'markets' | 'alerts'>;
function preference(o: MarketView): number {
  const d = o.citizen.mind?.dispositions;
  if (!d) return 1;
  // All ten dispositions influence the personal willingness to wait for margin.
  return 0.7 + 0.22 * d.ambition + 0.16 * d.enterprise + 0.18 * d.patience +
    0.12 * d.economicIndependence + 0.08 * d.riskTolerance + 0.06 * d.vengefulness +
    0.05 * d.familyOrientation - 0.12 * d.generosity - 0.08 * d.morals - 0.07 * d.sociability;
}
export function quotePrice(o: MarketView, item: ItemKey, noFillAge = 0): number {
  const reference = effortPrice(item);
  const trades = o.alerts.filter((e) => e.kind === 'trade' && e.text.includes(`${item} sold`))
    .map((e) => /^(\d+(?:\.\d+)?) \S+ sold for (\d+(?:\.\d+)?)/.exec(e.text))
    .filter((m) => m && Number(m[1]) > 0).map((m) => Number(m![2])); // Event price is gold each, not total proceeds.
  const orders = o.markets.filter((order) => order.item === item && order.citizenId !== o.citizen.id);
  const asks = orders.filter((order) => order.side === 'sell').map((order) => order.price);
  const bids = orders.filter((order) => order.side === 'buy').map((order) => order.price);
  const sale = trades.length ? trades.reduce((a, b) => a + b, 0) / trades.length : reference;
  const anchor = reference * 0.6 + sale * 0.4;
  const floor = Math.max(1, reference * (0.55 + (preference(o) - 0.7) * 0.3));
  let desired = anchor * preference(o);
  if (asks.length) desired = desired * 0.7 + Math.min(...asks) * 0.3;
  desired *= Math.max(0.65, 1 - noFillAge / 1200);
  if (bids.length && Math.max(...bids) >= floor && Math.max(...bids) >= desired * 0.85)
    return integerPrice(Math.max(...bids));
  return integerPrice(Math.max(floor, desired));
}
export function buyWillingness(o: MarketView, item: ItemKey, quantity: number): number {
  const urgent = item.startsWith('food:') && o.citizen.fullness < 35;
  const reserve = urgent ? 0 : o.citizen.gold * 0.15;
  return integerPrice(Math.min((o.citizen.gold - reserve) / Math.max(1, quantity),
    effortPrice(item) * (urgent ? 5 : 3) / preference(o)));
}
/** Bounded personal buy reference. Executions come only from delivered alerts;
 * no spectator last-price field participates. */
export function knownBuyPrice(o: MarketView, item: ItemKey): number {
  const asks = o.markets.filter(x => x.item === item && x.side === 'sell' && x.citizenId !== o.citizen.id);
  if (asks.length) return integerPrice(Math.min(...asks.map(x => x.price)));
  const trades = o.alerts.filter(e => e.kind === 'trade' && e.text.includes(`${item} sold`))
    .map(e => /sold for (\d+(?:\.\d+)?)/.exec(e.text)).filter(m => m).map(m => Number(m![1]));
  return trades.length ? integerPrice(trades.at(-1)!) : integerPrice(Math.ceil(quotePrice(o, item) * 1.25));
}
export function quoteInterval(o: DecisionObservation): number {
  return Math.round(40 + 120 * (o.citizen.mind?.dispositions.patience ?? 0.5));
}
