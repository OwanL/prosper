import type { Command, CommandResult, Order, World } from '../shared/types.ts';
import { addInventory, event, fail, id, ok, takeInventory } from '../shared/utils.ts';
import { CARRIED_ITEM_RE, EQUIPMENT_ITEM_RE } from '../shared/tiers.ts';
import { ensureTelemetry, recordTelemetryFill } from './telemetry.ts';

// Currency arithmetic may leave a negative residual after fractional fills.
// Never relax funding checks or round positive balances: that could mint money.
const currencyRoundoff = (value: number) => value < 0 && value >= -1e-9 ? 0 : value;
const tradableItem = CARRIED_ITEM_RE;
const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;
const buildingIdFor = (item: string) => (item.startsWith('building:') ? item.slice(9) : null);

/** Building listings are compatibility data only, never active market behavior. */
export function isBuildingListed(_world: World, _buildingId: string): boolean { return false; }

function cancelOrder(world: World, order: Order): void {
  const citizen = world.citizens[order.citizenId];
  // Refund even to a dead citizen: the death dispatcher collects these holdings next.
  if (citizen) {
    order.escrowGold = currencyRoundoff(order.escrowGold);
    citizen.gold = currencyRoundoff(currencyRoundoff(citizen.gold) + order.escrowGold);
    addInventory(citizen.inventory, order.escrowItems);
  }
  delete world.orders[order.id];
}

export function cancelCitizenOrders(world: World, citizenId: string): void {
  for (const order of Object.values(world.orders)) {
    if (order.citizenId === citizenId) cancelOrder(world, order);
  }
}

export function cancelBuildingOrders(world: World, buildingId: string): void {
  for (const order of Object.values(world.orders)) {
    if (order.item === `building:${buildingId}`) cancelOrder(world, order);
  }
}

/** Restore owners should call this before exposing a historical checkpoint. */
export function cancelLegacyBuildingOrders(world: World): void {
  for (const order of Object.values(world.orders)) {
    if (buildingIdFor(order.item) !== null) cancelOrder(world, order);
  }
}

function validOrder(world: World, order: Order): boolean {
  const citizen = world.citizens[order.citizenId];
  return !!citizen?.alive && citizen.health > 0 && buildingIdFor(order.item) === null;
}

function match(world: World, incoming: Order, delivery?: (order: Order, quantity: number) => void): number {
  let settledGold = 0;
  const candidates = Object.values(world.orders)
    .filter(
      (order) =>
        order.id !== incoming.id &&
        order.item === incoming.item &&
        order.side !== incoming.side &&
        order.citizenId !== incoming.citizenId &&
        (incoming.side === 'buy' ? order.price <= incoming.price : order.price >= incoming.price),
    )
    .sort(
      (a, b) =>
        (incoming.side === 'buy' ? a.price - b.price : b.price - a.price) ||
        a.createdTick - b.createdTick ||
        a.sequence - b.sequence,
    );
  for (const resting of candidates) {
    if (!validOrder(world, incoming)) {
      cancelOrder(world, incoming);
      break;
    }
    if (!validOrder(world, resting)) {
      cancelOrder(world, resting);
      continue;
    }
    const buy = incoming.side === 'buy' ? incoming : resting;
    const sell = incoming.side === 'sell' ? incoming : resting;
    const quantity = Math.min(buy.quantity, sell.quantity);
    const price = resting.price;
    const buyer = world.citizens[buy.citizenId];
    const seller = world.citizens[sell.citizenId];
    takeInventory(sell.escrowItems, { [sell.item]: quantity });
    addInventory(buyer.inventory, { [sell.item]: quantity });
    delivery?.(buy, quantity);
    buy.escrowGold = currencyRoundoff(buy.escrowGold - quantity * buy.price);
    buyer.gold = currencyRoundoff(currencyRoundoff(buyer.gold) + quantity * (buy.price - price));
    seller.gold = currencyRoundoff(currencyRoundoff(seller.gold) + quantity * price);
    settledGold += quantity * price;
    buy.quantity -= quantity;
    sell.quantity -= quantity;
    recordTelemetryFill(world, incoming.item, quantity, price);
    event(world, 'trade', `${quantity} ${incoming.item} sold for ${price} gold each.`, {
      citizenId: buyer.id,
      targetId: seller.id,
      audience: [buyer.id, seller.id],
      trade: {
        buyOrderId: buy.id,
        sellOrderId: sell.id,
        item: incoming.item,
        quantity,
        price,
        buyerId: buyer.id,
        sellerId: seller.id,
      },
    });
    // Return any floating-point escrow remainder rather than dropping it on completion.
    if (!resting.quantity) cancelOrder(world, resting);
    if (!incoming.quantity) {
      cancelOrder(world, incoming);
      break;
    }
  }
  return settledGold;
}

/** Caller serializes this synchronous transaction with ticks and all other commands. */
export function marketCommand(world: World, citizenId: string, command: Command, delivery?: (order: Order, quantity: number) => void, requestId?: string | null): CommandResult {
  cancelLegacyBuildingOrders(world);
  const citizen = world.citizens[citizenId];
  if (!citizen?.alive || citizen.health <= 0)
    return fail('unavailable-citizen', 'A living citizen is required.');
  if (command.type === 'transfer') {
    const recipient = world.citizens[command.citizenId];
    if (!recipient?.alive || recipient.health <= 0)
      return fail('unavailable-recipient', 'Recipient must be alive.');
    if (!positiveInteger(command.gold))
      return fail('invalid-gold', 'Transfer a positive whole number of gold.');
    if (citizen.gold < command.gold)
      return fail('insufficient-gold', 'Not enough unreserved gold.');
    if (citizen.id !== recipient.id) {
      if ((!Number.isFinite(recipient.gold + command.gold) || recipient.gold + command.gold > Number.MAX_SAFE_INTEGER))
        return fail('invalid-gold', 'Recipient balance would exceed the integer limit.');
      ensureTelemetry(world);
      citizen.gold = currencyRoundoff(citizen.gold - command.gold);
      recipient.gold = currencyRoundoff(currencyRoundoff(recipient.gold) + command.gold);
    }
    return ok(`Transferred ${command.gold} gold to ${recipient.id}.`);
  }
  if (command.type === 'cancel-order') {
    const order = world.orders[command.orderId];
    if (!order || order.citizenId !== citizenId)
      return fail('unavailable-order', 'Only your own existing orders can be cancelled.');
    ensureTelemetry(world);
    cancelOrder(world, order);
    return ok('Order cancelled; remaining escrow refunded.');
  }
  if (command.type !== 'order') return fail('unsupported-command', 'Not a market command.');
  if (command.side !== 'buy' && command.side !== 'sell')
    return fail('invalid-side', 'Order side must be buy or sell.');
  if (typeof command.item !== 'string')
    return fail('invalid-item', 'Choose an exact commodity or tool and tier.');
  if (buildingIdFor(command.item) !== null)
    return fail('building-trading-disabled', 'Buildings cannot be bought or sold.');
  if (!tradableItem.test(command.item))
    return fail('invalid-item', 'Unknown item or tier.');
  if (
    !Number.isFinite(command.quantity) || command.quantity <= 0 ||
    command.quantity > Number.MAX_SAFE_INTEGER ||
    (EQUIPMENT_ITEM_RE.test(command.item) && !positiveInteger(command.quantity)) ||
    !positiveInteger(command.price) ||
    !Number.isFinite(command.quantity * command.price) ||
    command.quantity * command.price > Number.MAX_SAFE_INTEGER
  ) {
    return fail('invalid-order', 'Quantity must be positive and finite (whole for tools); unit price must be a positive whole safe integer, with a safe total.');
  }
  const total = command.quantity * command.price;
  if (command.side === 'buy' && citizen.gold < total)
    return fail('insufficient-gold', 'Not enough unreserved gold.');
  if (command.side === 'sell') {
    // Work inputs are already removed into Action.reserved by core; carried tools are saleable.
    if ((citizen.inventory[command.item] ?? 0) < command.quantity) {
      return fail('insufficient-items', 'Not enough unreserved copies.');
    }
  }
  ensureTelemetry(world);
  const sequence = world.nextId;
  const order: Order = {
    ...(requestId !== undefined ? { requestId } : {}),
    id: id(world, 'order'),
    citizenId,
    side: command.side,
    item: command.item,
    quantity: command.quantity,
    price: command.price,
    createdTick: world.tick,
    sequence,
    escrowGold: command.side === 'buy' ? total : 0,
    escrowItems:
      command.side === 'sell' ? { [command.item]: command.quantity } : {},
  };
  if (command.side === 'buy') citizen.gold = currencyRoundoff(citizen.gold - total);
  else takeInventory(citizen.inventory, order.escrowItems);
  world.orders[order.id] = order;
  const settledGold = match(world, order, delivery);
  const filledQuantity = command.quantity - order.quantity;
  return {
    ...ok(
      `Order ${order.id} accepted; ${order.quantity} remaining. Filled ${filledQuantity}/${command.quantity} ${command.item} now; ${command.side === 'buy' ? 'paid' : 'received'} ${settledGold} gold. Remaining quantity is reserved, not delivered.`,
    ),
    order: {
      id: order.id,
      side: command.side,
      item: command.item,
      requestedQuantity: command.quantity,
      filledQuantity,
      remainingQuantity: order.quantity,
      goldPaid: command.side === 'buy' ? settledGold : 0,
      goldReceived: command.side === 'sell' ? settledGold : 0,
    },
  };
}
