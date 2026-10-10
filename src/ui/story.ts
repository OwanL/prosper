import type { Citizen, Order, Point, WorldEvent } from '../shared/types';

export const storyKinds: Record<string, { label: string; icon: string; priority: number }> = {
  death: { label: 'Death', icon: '†', priority: 100 },
  attack: { label: 'Combat', icon: '⚔', priority: 95 },
  extortion: { label: 'Extortion', icon: '!', priority: 85 },
  threat: { label: 'Threat', icon: '!', priority: 80 },
  birth: { label: 'New life', icon: '✦', priority: 75 },
  destruction: { label: 'Destruction', icon: '×', priority: 70 },
  alliance: { label: 'Alliance', icon: '◇', priority: 65 },
  trespass: { label: 'Trespass', icon: '↗', priority: 60 },
  claim: { label: 'Territory', icon: '⚑', priority: 55 },
  flee: { label: 'Fleeing', icon: '↗', priority: 50 },
  trade: { label: 'Trade', icon: '⇄', priority: 40 },
  loot: { label: 'Loot', icon: '◈', priority: 35 },
};

/** Coordinates belong to the committed event, never a participant's current location. */
export function eventPoint(event: WorldEvent, width: number, height: number): Point | undefined {
  return Number.isFinite(event.x) &&
    Number.isFinite(event.y) &&
    event.x! >= 0 &&
    event.y! >= 0 &&
    event.x! < width &&
    event.y! < height
    ? { x: event.x!, y: event.y! }
    : undefined;
}

export function recentStories(events: WorldEvent[], tick: number, limit = 5): WorldEvent[] {
  return events
    .filter((event) => storyKinds[event.kind] && event.tick <= tick && tick - event.tick <= 180)
    .sort((a, b) => b.tick - a.tick || storyKinds[b.kind]!.priority - storyKinds[a.kind]!.priority)
    .slice(0, limit);
}

export function directorCandidate(
  events: WorldEvent[],
  tick: number,
  width: number,
  height: number,
  afterTick = -1,
): WorldEvent | undefined {
  return recentStories(events, tick, events.length)
    .filter((event) => event.tick > afterTick && eventPoint(event, width, height))
    .sort(
      (a, b) => storyKinds[b.kind]!.priority - storyKinds[a.kind]!.priority || b.tick - a.tick,
    )[0];
}

export function humanizeEvent(
  text: string,
  citizens: Record<string, Pick<Citizen, 'name'>>,
): string {
  const names = Object.entries(citizens).sort(([a], [b]) => b.length - a.length);
  let result = text;
  for (const [id, citizen] of names) {
    result = result.split(`${citizen.name} (${id})`).join(citizen.name);
    result = result.split(id).join(citizen.name);
  }
  return result;
}

export function marketQuotes(orders: Order[]) {
  const quotes = new Map<
    string,
    { item: string; ask?: number; bid?: number; supply: number; demand: number }
  >();
  for (const order of orders) {
    const row = quotes.get(order.item) ?? { item: order.item, supply: 0, demand: 0 };
    if (order.side === 'sell') {
      row.ask = Math.min(row.ask ?? Infinity, order.price);
      row.supply += order.quantity;
    } else {
      row.bid = Math.max(row.bid ?? -Infinity, order.price);
      row.demand += order.quantity;
    }
    quotes.set(order.item, row);
  }
  return [...quotes.values()].sort((a, b) => a.item.localeCompare(b.item));
}
