import type { Citizen, Command, CommandResult, Order, World } from '../shared/types.ts';
import { addInventory, event, fail, id, ok, takeInventory } from '../shared/utils.ts';

const tradableItem = /^(food|wood|fibre|axe|scythe|knife|sword):[123]$/;
const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;
const buildingIdFor = (item: string) => (item.startsWith('building:') ? item.slice(9) : null);

/** A listed building stays attackable, but core must prohibit starting/continuing work. */
export function isBuildingListed(world: World, buildingId: string): boolean {
  return Object.values(world.orders).some(
    (order) => order.side === 'sell' && order.item === `building:${buildingId}`,
  );
}

function cancelOrder(world: World, order: Order): void {
  const citizen = world.citizens[order.citizenId];
  // Refund even to a dead citizen: the death dispatcher collects these holdings next.
  if (citizen) {
    citizen.gold += order.escrowGold;
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

function processing(citizen: Citizen, buildingId: string): boolean {
  const command = citizen.action?.command;
  return command?.type === 'refine' && command.buildingId === buildingId;
}

function validOrder(world: World, order: Order): boolean {
  const citizen = world.citizens[order.citizenId];
  if (!citizen?.alive || citizen.health <= 0) return false;
  const buildingId = buildingIdFor(order.item);
  if (buildingId === null) return true;
  const building = world.buildings[buildingId];
  return (
    !!building &&
    building.health > 0 &&
    (order.side === 'buy' ||
      (building.ownerId === order.citizenId && !processing(citizen, buildingId)))
  );
}

function match(world: World, incoming: Order): void {
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
    const buildingId = buildingIdFor(incoming.item);
    if (buildingId !== null) {
      world.buildings[buildingId].ownerId = buyer.id;
    } else {
      takeInventory(sell.escrowItems, { [sell.item]: quantity });
      addInventory(buyer.inventory, { [sell.item]: quantity });
    }
    buy.escrowGold -= quantity * buy.price;
    buyer.gold += quantity * (buy.price - price);
    seller.gold += quantity * price;
    buy.quantity -= quantity;
    sell.quantity -= quantity;
    event(world, 'trade', `${quantity} ${incoming.item} sold for ${price} gold each.`, {
      citizenId: buyer.id,
      targetId: seller.id,
      audience: [buyer.id, seller.id],
    });
    if (!resting.quantity) delete world.orders[resting.id];
    if (!incoming.quantity) {
      delete world.orders[incoming.id];
      break;
    }
  }
}

/** Caller serializes this synchronous transaction with ticks and all other commands. */
export function marketCommand(world: World, citizenId: string, command: Command): CommandResult {
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
      if (!Number.isSafeInteger(recipient.gold + command.gold))
        return fail('invalid-gold', 'Recipient balance would exceed the integer limit.');
      citizen.gold -= command.gold;
      recipient.gold += command.gold;
    }
    return ok(`Transferred ${command.gold} gold to ${recipient.id}.`);
  }
  if (command.type === 'cancel-order') {
    const order = world.orders[command.orderId];
    if (!order || order.citizenId !== citizenId)
      return fail('unavailable-order', 'Only your own existing orders can be cancelled.');
    cancelOrder(world, order);
    return ok('Order cancelled; remaining escrow refunded.');
  }
  if (command.type !== 'order') return fail('unsupported-command', 'Not a market command.');
  if (command.side !== 'buy' && command.side !== 'sell')
    return fail('invalid-side', 'Order side must be buy or sell.');
  if (
    !positiveInteger(command.quantity) ||
    !positiveInteger(command.price) ||
    !Number.isSafeInteger(command.quantity * command.price)
  ) {
    return fail(
      'invalid-order',
      'Quantity and unit price must be positive whole safe integers, with a safe total.',
    );
  }
  if (typeof command.item !== 'string')
    return fail('invalid-item', 'Choose an exact item and tier or building:<id>.');
  const buildingId = buildingIdFor(command.item);
  if (buildingId === null && !tradableItem.test(command.item))
    return fail('invalid-item', 'Unknown item or tier.');
  if (buildingId !== null) {
    const building = world.buildings[buildingId];
    if (!building || building.health <= 0)
      return fail('unavailable-building', 'Building does not exist or is destroyed.');
    if (command.quantity !== 1)
      return fail('invalid-quantity', 'A building is unique; quantity must be one.');
    if (command.side === 'sell') {
      if (building.ownerId !== citizenId)
        return fail('not-owner', 'Only the owner can sell a building.');
      if (isBuildingListed(world, buildingId))
        return fail('already-listed', 'Cancel the existing listing before replacing it.');
      if (processing(citizen, buildingId))
        return fail('building-busy', 'Cancel active processing before listing the building.');
    }
  }
  const total = command.quantity * command.price;
  if (command.side === 'buy' && citizen.gold < total)
    return fail('insufficient-gold', 'Not enough unreserved gold.');
  if (command.side === 'sell' && buildingId === null) {
    // Work inputs are already removed into Action.reserved by core. Equipment is a
    // reference to one carried unit, so only that copy is excluded from sale.
    const equipped = Object.values(citizen.equipment).includes(command.item) ? 1 : 0;
    if ((citizen.inventory[command.item] ?? 0) - equipped < command.quantity) {
      return fail('insufficient-items', 'Not enough unreserved, unequipped copies.');
    }
  }
  const sequence = world.nextId;
  const order: Order = {
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
      command.side === 'sell' && buildingId === null ? { [command.item]: command.quantity } : {},
  };
  if (command.side === 'buy') citizen.gold -= total;
  else takeInventory(citizen.inventory, order.escrowItems);
  world.orders[order.id] = order;
  match(world, order);
  return ok(`Order ${order.id} accepted; ${order.quantity} remaining.`);
}
