import { acceptedFamily, resolveFamily, tickFamily } from './family.mjs';
import { BIRTH_FOOD_COST, BIRTH_MIN_HEALTH } from "./economy.mjs";

import { equipmentSpec, craftRequirement } from './equipment.mjs';

const MAX_OFFERS = 32;
const MAX_DEAD = 12;
// At 8x, cover a 60s review cooldown, a 90s model timeout, and travel.
export const OFFER_TTL = 1800;
const MATURATION_TICKS = 300;
const WEAPON_DURABILITY = 12;
const RESOURCE_NAMES = new Set(["food", "wood", "bread"]);
const STAT_NAMES = ["crafted", "weapons", "trades", "births", "deaths", "attacks"];

const fail = (reason, details = {}) => ({ ok: false, reason, ...details });
const success = () => ({ ok: true });
const isInteger = (value) => Number.isSafeInteger(value);
const isBoundedNumber = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

function validEffects(effects = {}) {
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) return "effects must be an object";
  for (const key of ["event", "remember", "createChild"]) {
    if (effects[key] !== undefined && typeof effects[key] !== "function") return `effects.${key} must be a function`;
  }
  return null;
}

function validCitizen(citizen, { tombstone = false } = {}) {
  if (!citizen || typeof citizen !== "object" || Array.isArray(citizen)) return "citizen must be an object";
  if (typeof citizen.id !== "string" || citizen.id.length === 0) return "citizen ID must be a non-empty string";
  if (!isInteger(citizen.x) || citizen.x < 0 || !isInteger(citizen.y) || citizen.y < 0) return `${citizen.id} has invalid coordinates`;
  for (const resource of RESOURCE_NAMES) {
    // Legacy fixtures may omit bread entirely: a missing count reads as 0.
    if (resource === "bread" && citizen[resource] === undefined) continue;
    if (!isInteger(citizen[resource]) || citizen[resource] < 0) return `${citizen.id} has invalid ${resource} inventory`;
  }
  if (typeof citizen.alive !== "boolean" || typeof citizen.adult !== "boolean") return `${citizen.id} has invalid life-stage flags`;
  if (typeof citizen.tool !== "boolean" || typeof citizen.weapon !== "boolean" ||
      (citizen.shoes !== undefined && typeof citizen.shoes !== "boolean")) return `${citizen.id} has invalid equipment flags`;
  for (const item of ['tool', 'shoes', 'weapon']) {
    const level = citizen[item + 'Level'];
    if (level !== undefined && (!isInteger(level) || level < 0 || level > 3 || Boolean(citizen[item]) !== (level > 0))) return citizen.id + ' has invalid ' + item + ' level';
  }
  if (!isInteger(citizen.weaponDurability) || citizen.weaponDurability < 0 || citizen.weaponDurability > (equipmentSpec(citizen, 'weapon')?.durability ?? WEAPON_DURABILITY) ||
      (citizen.weapon && citizen.weaponDurability === 0) || (!citizen.weapon && citizen.weaponDurability !== 0)) {
    return `${citizen.id} has invalid weapon durability`;
  }
  if (!isBoundedNumber(citizen.health, 0, 100) || !isBoundedNumber(citizen.hunger, 0, 100) ||
      !isBoundedNumber(citizen.energy, 0, 100)) return `${citizen.id} has out-of-bounds health, hunger, or energy`;
  if (typeof citizen.familyReady !== "boolean") return `${citizen.id} has invalid family consent`;
  if (!isInteger(citizen.reproduceAfter) || citizen.reproduceAfter < 0) return `${citizen.id} has invalid reproduction cooldown`;
  if (citizen.bornAt !== null && (!isInteger(citizen.bornAt) || citizen.bornAt < 0)) return `${citizen.id} has invalid birth tick`;
  if (!citizen.adult && citizen.bornAt === null) return `${citizen.id} has no birth tick`;
  if (!citizen.relationships || typeof citizen.relationships !== "object" || Array.isArray(citizen.relationships)) {
    return `${citizen.id} has invalid relationships`;
  }
  for (const [id, value] of Object.entries(citizen.relationships)) {
    if (!id || !isBoundedNumber(value, -100, 100)) return `${citizen.id} has an invalid relationship`;
  }
  if (!Array.isArray(citizen.parents) || citizen.parents.some((id) => typeof id !== "string" || id.length === 0)) {
    return `${citizen.id} has invalid parents`;
  }
  if (!tombstone && (!citizen.alive || citizen.health <= 0)) return `${citizen.id} is not alive`;
  if (tombstone && (citizen.alive || citizen.health !== 0 || citizen.status !== "dead")) return `${citizen.id} is not a dead citizen`;
  return null;
}

function validOffer(offer) {
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) return "offer must be an object";
  if (typeof offer.id !== "string" || !/^offer-[1-9]\d*$/.test(offer.id) ||
      !Number.isSafeInteger(Number(offer.id.slice("offer-".length)))) return "offer has an invalid ID";
  if (typeof offer.makerId !== "string" || !offer.makerId) return `${offer.id} has an invalid maker`;
  if (!RESOURCE_NAMES.has(offer.give) || !RESOURCE_NAMES.has(offer.want) ||
      (offer.give === offer.want && offer.wantAmount !== 0)) return `${offer.id} has invalid resources`;
  if (offer.recipient !== null && (typeof offer.recipient !== "string" || !offer.recipient)) return `${offer.id} has an invalid recipient`;
  if (!isInteger(offer.giveAmount) || offer.giveAmount < 1 ||
      !isInteger(offer.wantAmount) || offer.wantAmount < 0) return `${offer.id} has invalid quantities`;
  if (!isInteger(offer.createdAt) || offer.createdAt < 0 || !isInteger(offer.expiresAt) ||
      offer.expiresAt <= offer.createdAt || ![240, OFFER_TTL].includes(offer.expiresAt - offer.createdAt)) return `${offer.id} has invalid times`;
  if (!["open", "filled", "expired", "cancelled"].includes(offer.status)) return `${offer.id} has invalid status`;
  return null;
}

function validateWorld(world) {
  if (!world || typeof world !== "object" || Array.isArray(world)) return "world must be an object";
  if (!isInteger(world.tick) || world.tick < 0) return "world tick must be a non-negative integer";
  if (!Array.isArray(world.citizens) || !Array.isArray(world.offers)) return "world citizens and offers must be arrays";
  if (world.width !== undefined && (!isInteger(world.width) || world.width < 1)) return "world width is invalid";
  if (world.height !== undefined && (!isInteger(world.height) || world.height < 1)) return "world height is invalid";
  if (world.stats === null || typeof world.stats !== "object" || Array.isArray(world.stats)) return "world stats must be an object";
  for (const name of STAT_NAMES) {
    if (!isInteger(world.stats[name]) || world.stats[name] < 0) return `world stats.${name} must be a non-negative integer`;
  }
  if (!isInteger(world.nextOfferId) || world.nextOfferId < 1) return "world nextOfferId must be a positive integer";
  if (!isInteger(world.nextCitizenId) || world.nextCitizenId < 1) return "world nextCitizenId must be a positive integer";
  if (world.offers.length > MAX_OFFERS) return `world exceeds ${MAX_OFFERS} recent offers`;
  if (world.dead !== undefined && !Array.isArray(world.dead)) return "world dead history must be an array";

  const ids = new Set();
  for (const citizen of world.citizens) {
    const reason = validCitizen(citizen);
    if (reason) return reason;
    if (ids.has(citizen.id)) return `duplicate citizen ID ${citizen.id}`;
    ids.add(citizen.id);
    if (world.width !== undefined && citizen.x >= world.width) return `${citizen.id} is outside world width`;
    if (world.height !== undefined && citizen.y >= world.height) return `${citizen.id} is outside world height`;
  }
  for (const citizen of world.dead ?? []) {
    const reason = validCitizen(citizen, { tombstone: true });
    if (reason) return reason;
    if (ids.has(citizen.id)) return `duplicate citizen ID ${citizen.id}`;
    ids.add(citizen.id);
  }
  const offerIds = new Set();
  const openMakers = new Set();
  let highestOfferId = 0;
  for (const offer of world.offers) {
    const reason = validOffer(offer);
    if (reason) return reason;
    if (offerIds.has(offer.id)) return `duplicate offer ID ${offer.id}`;
    offerIds.add(offer.id);
    highestOfferId = Math.max(highestOfferId, Number(offer.id.slice("offer-".length)));
    if (offer.id === `offer-${world.nextOfferId}`) return "world nextOfferId is already in use";
    if (offer.status === "open") {
      if (openMakers.has(offer.makerId)) return `${offer.makerId} has more than one open offer`;
      openMakers.add(offer.makerId);
      const maker = world.citizens.find((citizen) => citizen.id === offer.makerId);
      if (!maker) return `${offer.id} has no living maker`;
      if (offer.recipient !== null) {
        const recipient = world.citizens.find((citizen) => citizen.id === offer.recipient);
        if (!recipient || recipient.id === maker.id) return `${offer.id} has no distinct living recipient`;
      }
      if ((maker[offer.give] ?? 0) > Number.MAX_SAFE_INTEGER - offer.giveAmount) return `${offer.id} refund would overflow inventory`;
    }
  }
  if (world.nextOfferId <= highestOfferId) return "world nextOfferId does not follow the offer history";
  if ((world.dead ?? []).length > MAX_DEAD) return `world exceeds ${MAX_DEAD} dead citizens`;
  return null;
}

function citizenIn(world, ref) {
  const id = typeof ref === "string" ? ref : ref?.id;
  return world.citizens.find((citizen) => citizen.id === id);
}

function exactTask(task, keys) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return false;
  const actual = Reflect.ownKeys(task);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function resourceAdditionValid(citizen, resource, amount) {
  return Number.isSafeInteger((citizen[resource] ?? 0) + amount);
}

function adjustRelationship(citizen, otherId, delta) {
  citizen.relationships[otherId] = Math.max(-100, Math.min(100, (citizen.relationships[otherId] ?? 0) + delta));
}

function nameOf(citizen) {
  return typeof citizen.name === "string" && citizen.name ? citizen.name : citizen.id;
}

function notify(effects, text, citizenId, memories = []) {
  try { effects.event?.(text, citizenId); } catch { /* reporting effects must not undo a committed interaction */ }
  for (const [citizen, memory] of memories) {
    try { effects.remember?.(citizen, memory.slice(0, 200)); } catch { /* reporting effects must not undo a committed interaction */ }
  }
}

function oldOpenOffer(world, makerId) {
  return world.offers.find((offer) => offer.status === "open" && offer.makerId === makerId);
}

function cancelOffer(world, offer, status) {
  const maker = world.citizens.find((citizen) => citizen.id === offer.makerId);
  maker[offer.give] = (maker[offer.give] ?? 0) + offer.giveAmount;
  offer.status = status;
}

function deathPreflight(world, victim, killer) {
  const refunds = new Map();
  for (const offer of world.offers) {
    if (offer.status !== "open" || (offer.makerId !== victim.id && offer.recipient !== victim.id)) continue;
    const maker = world.citizens.find((citizen) => citizen.id === offer.makerId);
    if (!maker) return `${offer.id} has no living maker for its death refund`;
    const amounts = refunds.get(maker.id) ?? { food: 0, wood: 0, bread: 0 };
    amounts[offer.give] += offer.giveAmount;
    refunds.set(maker.id, amounts);
  }
  const victimRefund = refunds.get(victim.id) ?? { food: 0, wood: 0, bread: 0 };
  if (!Number.isSafeInteger(victim.food + victimRefund.food) || !Number.isSafeInteger(victim.wood + victimRefund.wood) ||
      !Number.isSafeInteger((victim.bread ?? 0) + victimRefund.bread)) {
    return "death escrow refund would overflow inventory";
  }
  for (const [makerId, amounts] of refunds) {
    if (makerId === victim.id) continue;
    const maker = world.citizens.find((citizen) => citizen.id === makerId);
    if (!Number.isSafeInteger(maker.food + amounts.food) || !Number.isSafeInteger(maker.wood + amounts.wood) ||
        !Number.isSafeInteger((maker.bread ?? 0) + amounts.bread)) {
      return "recipient death escrow refund would overflow inventory";
    }
  }
  if (killer) {
    const killerRefund = refunds.get(killer.id) ?? { food: 0, wood: 0, bread: 0 };
    if (!Number.isSafeInteger(killer.food + killerRefund.food + victim.food + victimRefund.food) ||
        !Number.isSafeInteger(killer.wood + killerRefund.wood + victim.wood + victimRefund.wood) ||
        !Number.isSafeInteger((killer.bread ?? 0) + killerRefund.bread + (victim.bread ?? 0) + victimRefund.bread)) {
      return "death loot would overflow inventory";
    }
  }
  if (world.stats.deaths === Number.MAX_SAFE_INTEGER) return "death counter would overflow";
  return null;
}

function killCitizenCommitted(world, victim, killer, memories) {
  // Escrow is restored before the victim's inventory is transferred as loot.
  for (const offer of world.offers) {
    if (offer.status === "open" && (offer.makerId === victim.id || offer.recipient === victim.id)) {
      cancelOffer(world, offer, "cancelled");
    }
  }
  if (killer) {
    killer.food += victim.food;
    killer.wood += victim.wood;
    const carriedBread = victim.bread ?? 0;
    killer.bread = (killer.bread ?? 0) + carriedBread;
  }
  const lootBread = (victim.bread ?? 0) > 0;
  victim.food = 0;
  victim.wood = 0;
  victim.bread = 0;
  victim.health = 0;
  victim.alive = false;
  victim.status = "dead";
  victim.tasks = [];
  victim.current = null;
  victim.order = null;
  victim.path = [];
  victim.planning = false;
  world.citizens.splice(world.citizens.indexOf(victim), 1);
  if (!Array.isArray(world.dead)) world.dead = [];
  world.dead.push(victim);
  if (world.dead.length > MAX_DEAD) world.dead.splice(0, world.dead.length - MAX_DEAD);
  world.stats.deaths += 1;

  for (const survivor of world.citizens) {
    const isFamily = survivor.parents.includes(victim.id) || victim.parents.includes(survivor.id);
    if (isFamily) {
      survivor.replanReason = "death";
      memories.push([survivor, `Tick ${world.tick}: ${nameOf(victim)} died.`]);
    }
  }
  const lootText = killer
    ? `${nameOf(killer)} received ${nameOf(victim)}'s food and wood${lootBread ? " and bread" : ""}.`
    : "Their carried resources were lost.";
  return `${nameOf(victim)} died. ${lootText}`;
}

export function killCitizen(world, citizen, killer, effects = {}) {
  const effectsError = validEffects(effects);
  if (effectsError) return fail(effectsError);
  const worldError = validateWorld(world);
  if (worldError) return fail(worldError);
  const id = typeof citizen === "string" ? citizen : citizen?.id;
  const victim = citizenIn(world, id) ?? (world.dead ?? []).find((entry) => entry.id === id);
  if (!victim) return fail("citizen is not in the living world");
  // Idempotence is intentional: death may be observed by more than one system.
  if (!victim.alive) return success();
  const killerCitizen = killer == null ? null : citizenIn(world, killer);
  if (killer != null && (!killerCitizen || killerCitizen.id === victim.id)) return fail("killer must be a distinct living citizen");
  const reason = deathPreflight(world, victim, killerCitizen);
  if (reason) return fail(reason);
  const memories = [];
  const text = killCitizenCommitted(world, victim, killerCitizen, memories);
  notify(effects, text, victim.id, memories);
  return success();
}

function validRelationshipMutation(a, b) {
  return isBoundedNumber(a.relationships[b.id] ?? 0, -100, 100) && isBoundedNumber(b.relationships[a.id] ?? 0, -100, 100);
}

function resolveCraft(world, citizen, task, effects) {
  if ((!exactTask(task, ["type", "item"]) && !exactTask(task, ["type", "item", "level"])) || !["tool", "weapon", "shoes"].includes(task.item)) {
    return fail("craft requires item 'tool', 'weapon', or 'shoes'");
  }
  const required = craftRequirement(citizen, task);
  if (required.error) return fail(required.error);
  const cost = required.cost;
  if (citizen.wood < cost) return fail(`needs ${cost} wood to craft a ${task.item}`);
  if (world.stats.crafted === Number.MAX_SAFE_INTEGER ||
      (task.item === "weapon" && world.stats.weapons === Number.MAX_SAFE_INTEGER)) return fail("craft counter would overflow");
  citizen.wood -= cost;
  citizen[task.item + 'Level'] = required.level;
  if (task.item === "tool") citizen.tool = true;
  else if (task.item === "shoes") citizen.shoes = true;
  else {
    citizen.weapon = true;
    citizen.weaponDurability = required.durability;
    world.stats.weapons += 1;
  }
  world.stats.crafted += 1;
  notify(effects, `${nameOf(citizen)} crafted ${task.item} level ${required.level}.`, citizen.id);
  return success();
}

function resolveOffer(world, citizen, task, effects) {
  const baseKeys = ["type", "give", "giveAmount", "want", "wantAmount"];
  if (!exactTask(task, baseKeys) && !exactTask(task, [...baseKeys, "recipient"])) return fail("offer has an invalid shape");
  const recipientId = task.recipient ?? null;
  if (!RESOURCE_NAMES.has(task.give) || !RESOURCE_NAMES.has(task.want) ||
      (task.give === task.want && task.wantAmount !== 0)) return fail("offer requires different resources unless it is a zero-price gift");
  if (!isInteger(task.giveAmount) || task.giveAmount < 1 ||
      !isInteger(task.wantAmount) || task.wantAmount < 0) return fail("offer quantities must be safe integers; give must be positive and want non-negative");
  if (recipientId !== null && (typeof recipientId !== "string" || !recipientId)) return fail("offer recipient must be a living citizen ID or null");
  if (recipientId !== null) {
    const recipient = citizenIn(world, recipientId);
    if (!recipient || recipient.id === citizen.id) return fail("offer recipient must be a distinct living citizen");
  }
  const prior = oldOpenOffer(world, citizen.id);
  const affordable = (citizen[task.give] ?? 0) + (prior?.give === task.give ? prior.giveAmount : 0);
  if (!Number.isSafeInteger(affordable) || affordable < task.giveAmount) return fail(`does not have ${task.giveAmount} ${task.give}`);
  if (!Number.isSafeInteger(world.tick + OFFER_TTL) || world.nextOfferId === Number.MAX_SAFE_INTEGER) return fail("offer time or ID would overflow");
  const nextId = `offer-${world.nextOfferId}`;
  if (world.offers.some((offer) => offer.id === nextId)) return fail("next offer ID is already in use");
  const retained = world.offers.filter((offer) => offer !== prior);
  const toPrune = Math.max(0, world.offers.length + 1 - MAX_OFFERS);
  const prunable = retained.filter((offer) => offer.status !== "open");
  if (prunable.length < toPrune) return fail("offer history is full of active escrow");
  const removed = new Set(prunable.slice(0, toPrune));
  const offer = {
    id: nextId, makerId: citizen.id, give: task.give, giveAmount: task.giveAmount,
    want: task.want, wantAmount: task.wantAmount, recipient: recipientId, createdAt: world.tick,
    expiresAt: world.tick + OFFER_TTL, status: "open",
  };
  // All checks complete; replacement refund, cancellation, escrow, ID, and pruning commit together.
  if (prior) cancelOffer(world, prior, "cancelled");
  citizen[task.give] = (citizen[task.give] ?? 0) - task.giveAmount;
  for (let index = world.offers.length - 1; index >= 0; index -= 1) {
    if (removed.has(world.offers[index])) world.offers.splice(index, 1);
  }
  world.offers.push(offer);
  world.nextOfferId += 1;
  const recipientText = recipientId === null ? "" : ` to ${nameOf(citizenIn(world, recipientId))}`;
  const terms = task.wantAmount === 0 ? "as a gift" : `for ${task.wantAmount} ${task.want}`;
  notify(effects, `${nameOf(citizen)} offered ${task.giveAmount} ${task.give}${recipientText} ${terms}.`, citizen.id);
  return success();
}

function resolveTrade(world, citizen, task, effects) {
  if (!exactTask(task, ["type", "offer"]) || typeof task.offer !== "string") return fail("trade requires an offer ID");
  const offer = world.offers.find((item) => item.id === task.offer);
  if (!offer || offer.status !== "open") return fail("offer is not open");
  if (offer.expiresAt <= world.tick) return fail("offer has expired");
  const maker = citizenIn(world, offer.makerId);
  if (!maker || !maker.alive || !maker.adult) return fail("offer maker must be a living adult");
  if (offer.recipient !== null && offer.recipient !== citizen.id) return fail("offer is reserved for another citizen");
  if (!citizen.adult && (offer.recipient !== citizen.id || offer.wantAmount !== 0)) {
    return fail("children may accept only a zero-price offer targeted to them");
  }
  if (maker.id === citizen.id) return fail("cannot accept your own offer");
  if (Math.abs(maker.x - citizen.x) + Math.abs(maker.y - citizen.y) > 1) return fail("offer maker is not adjacent");
  if ((citizen[offer.want] ?? 0) < offer.wantAmount) return fail(`does not have ${offer.wantAmount} ${offer.want}`);
  if (!resourceAdditionValid(citizen, offer.give, offer.giveAmount) || !resourceAdditionValid(maker, offer.want, offer.wantAmount)) {
    return fail("trade would overflow inventory");
  }
  if (world.stats.trades === Number.MAX_SAFE_INTEGER) return fail("trade counter would overflow");
  if (!validRelationshipMutation(citizen, maker)) return fail("relationship is out of bounds");
  citizen[offer.want] = (citizen[offer.want] ?? 0) - offer.wantAmount;
  maker[offer.want] = (maker[offer.want] ?? 0) + offer.wantAmount;
  citizen[offer.give] = (citizen[offer.give] ?? 0) + offer.giveAmount;
  offer.status = "filled";
  world.stats.trades += 1;
  adjustRelationship(citizen, maker.id, 10);
  adjustRelationship(maker, citizen.id, 10);
  citizen.replanReason = "trade";
  maker.replanReason = "trade";
  notify(effects, `${nameOf(citizen)} accepted ${nameOf(maker)}'s offer.`, citizen.id, [
    [citizen, `Tick ${world.tick}: completed a trade with ${nameOf(maker)}.`],
    [maker, `Tick ${world.tick}: completed a trade with ${nameOf(citizen)}.`],
  ]);
  return success();
}

function resolveAttack(world, attacker, task, effects) {
  if (!exactTask(task, ["type", "target"]) || typeof task.target !== "string") return fail("attack requires a target citizen ID");
  const defender = citizenIn(world, task.target);
  if (!defender || !defender.alive) return fail("target is not alive");
  if (defender.id === attacker.id) return fail("cannot attack themself");
  if (!attacker.adult || !defender.adult) return fail("children cannot attack or be attacked");
  if (Math.abs(attacker.x - defender.x) + Math.abs(attacker.y - defender.y) > 1) return fail("target is not adjacent");
  if (attacker.energy < 8) return fail("attacker needs 8 energy");
  if (world.stats.attacks === Number.MAX_SAFE_INTEGER) return fail("attack counter would overflow");
  if (!validRelationshipMutation(attacker, defender)) return fail("relationship is out of bounds");

  const armedHit = attacker.weapon && attacker.weaponDurability > 0;
  const damage = armedHit ? equipmentSpec(attacker, 'weapon').damage : 6;
  const defenderDies = defender.health <= damage;
  const retaliates = !defenderDies && defender.energy >= 4;
  const defenderArmed = retaliates && defender.weapon && defender.weaponDurability > 0;
  const counterDamage = defenderArmed ? equipmentSpec(defender, 'weapon').counterDamage : 4;
  const attackerDies = retaliates && attacker.health <= counterDamage;
  if (defenderDies) {
    const reason = deathPreflight(world, defender, attacker);
    if (reason) return fail(reason);
  }
  if (attackerDies) {
    const reason = deathPreflight(world, attacker, defender);
    if (reason) return fail(reason);
  }

  attacker.energy -= 8;
  defender.health = Math.max(0, defender.health - damage);
  if (armedHit) {
    attacker.weaponDurability -= 1;
    if (attacker.weaponDurability === 0) { attacker.weapon = false; attacker.weaponLevel = 0; }
  }
  world.stats.attacks += 1;
  adjustRelationship(attacker, defender.id, -30);
  adjustRelationship(defender, attacker.id, -30);
  attacker.replanReason = "attack";
  defender.replanReason = "attack";

  const memories = [];
  let outcome = `${nameOf(attacker)} hit ${nameOf(defender)} for ${damage} damage`;
  if (defenderDies) {
    const deathText = killCitizenCommitted(world, defender, attacker, memories);
    outcome += `; ${deathText}`;
  } else if (retaliates) {
    defender.energy -= 4;
    const counter = counterDamage;
    // Attacker health and death are resolved after defender's counter-cost and weapon wear.
    attacker.health = Math.max(0, attacker.health - counter);
    if (defenderArmed) {
      defender.weaponDurability -= 1;
      if (defender.weaponDurability === 0) { defender.weapon = false; defender.weaponLevel = 0; }
    }
    outcome += `; ${nameOf(defender)} retaliated for ${counter} damage`;
    if (attacker.health === 0) {
      const deathText = killCitizenCommitted(world, attacker, defender, memories);
      outcome += `; ${deathText}`;
    }
  }
  memories.push([attacker, `Tick ${world.tick}: ${outcome}.`], [defender, `Tick ${world.tick}: ${outcome}.`]);
  notify(effects, `${outcome}.`, attacker.id, memories);
  return success();
}

function makeChild(world, parent, partner, effects) {
  if (typeof effects.createChild !== "function") return fail("effects.createChild is required for reproduction");
  const citizensArray = world.citizens;
  const beforeCitizens = citizensArray.slice();
  const citizenSnapshots = new Map();
  try {
    for (const citizen of beforeCitizens) citizenSnapshots.set(citizen, structuredClone(citizen));
  } catch {
    return fail("living citizen state cannot be snapshotted for reproduction");
  }
  const statsObject = world.stats;
  const oldNextId = world.nextCitizenId;
  const oldStats = { ...statsObject };
  const restoreExisting = () => {
    for (const [citizen, snapshot] of citizenSnapshots) {
      for (const key of Reflect.ownKeys(citizen)) if (!Reflect.has(snapshot, key)) delete citizen[key];
      Object.assign(citizen, structuredClone(snapshot));
    }
    world.stats = statsObject;
    for (const key of Reflect.ownKeys(statsObject)) if (!Reflect.has(oldStats, key)) delete statsObject[key];
    Object.assign(statsObject, oldStats);
  };
  const restore = () => {
    world.citizens = citizensArray;
    citizensArray.splice(0, citizensArray.length, ...beforeCitizens);
    restoreExisting();
    world.nextCitizenId = oldNextId;
  };
  let child;
  try {
    child = effects.createChild(parent, partner);
  } catch (error) {
    restore();
    return fail(`child creation failed${error?.message ? `: ${error.message}` : ""}`);
  }
  if (world.citizens !== citizensArray) {
    restore();
    return fail("child creator must add the child to the existing living world");
  }
  const added = world.citizens.filter((citizen) => !beforeCitizens.includes(citizen));
  const preserved = beforeCitizens.every((citizen, index) => world.citizens[index] === citizen);
  const validId = child && typeof child.id === "string" && child.id.length > 0 &&
    isInteger(world.nextCitizenId) && world.nextCitizenId > 0 &&
    !beforeCitizens.some((citizen) => citizen.id === child.id) && !(world.dead ?? []).some((citizen) => citizen.id === child.id);
  if (added.length !== 1 || added[0] !== child || !preserved || world.citizens.length !== beforeCitizens.length + 1 ||
      !validId) {
    restore();
    return fail("child creator must add exactly one new child to the living world");
  }
  restoreExisting();
  // The callback owns allocation/insertion; deterministic birth mechanics own the newborn's state.
  try {
    Object.assign(child, {
      alive: true, adult: false, bornAt: world.tick, parents: [parent.id, partner.id],
      food: 2, wood: 0, bread: 0, energy: 80, health: 100, hunger: 15,
      tool: false, weapon: false, shoes: false, weaponDurability: 0, familyReady: false,
      reproduceAfter: 0, relationships: {}, work: null, routine: { family: false },
      tasks: [], current: null, order: null, path: [], planning: false,
      status: "idle", replanReason: "born",
    });
  } catch {
    restore();
    return fail("child creator returned an unusable child");
  }
  const childError = validCitizen(child);
  if (childError || (world.width !== undefined && child.x >= world.width) || (world.height !== undefined && child.y >= world.height)) {
    restore();
    return fail(childError ?? "child is outside the world");
  }
  return { ok: true, child };
}

function resolveReproduce(world, parent, task, effects) {
  if (!exactTask(task, ["type", "target"]) || typeof task.target !== "string") return fail("reproduce requires a partner citizen ID");
  const partner = citizenIn(world, task.target);
  if (!partner || !partner.alive || !parent.adult || !partner.adult) return fail("reproduction requires two living adults");
  if (partner.id === parent.id) return fail("cannot reproduce with themself");
  if (Math.abs(parent.x - partner.x) + Math.abs(parent.y - partner.y) > 1) return fail("partner is not adjacent");
  const agreement = acceptedFamily(world, parent.id, partner.id);
  if (!agreement) return fail("both partners must explicitly propose and accept this pairing before reproducing");
  // Explain the actor's known shortfall before a joint failure can be mistaken
  // for evidence about the partner. Never disclose the partner's private values.
  const missing = [];
  if (parent.health < BIRTH_MIN_HEALTH) missing.push(`health below ${BIRTH_MIN_HEALTH}`);
  if (Math.min(BIRTH_FOOD_COST, parent.food) + Math.min(1, parent.bread ?? 0) * 2 < BIRTH_FOOD_COST) missing.push(`food-equivalents below ${BIRTH_FOOD_COST}`);
  if (missing.length) return fail(`your reproduction prerequisites are unmet: ${missing.join(', ')}`, { retryable: true });
  if (partner.health < BIRTH_MIN_HEALTH) return fail(`both adults need health at least ${BIRTH_MIN_HEALTH}`, { retryable: true });
  // Each adult pays two food equivalents: raw food first, then whole bread.
  // Cap arithmetic before multiplying to remain safe for large inventories.
  const birthCosts = new Map();
  for (const adult of [parent, partner]) {
    const foodSpent = Math.min(BIRTH_FOOD_COST, adult.food);
    const breadSpent = Math.ceil((BIRTH_FOOD_COST - foodSpent) / 2);
    if ((adult.bread ?? 0) < breadSpent) {
      return fail(`each adult needs ${BIRTH_FOOD_COST} food equivalents (bread counts double)`, { retryable: true });
    }
    birthCosts.set(adult, { foodSpent, breadSpent });
  }
  if (world.stats.births === Number.MAX_SAFE_INTEGER) return fail("birth counter would overflow");
  if (!validRelationshipMutation(parent, partner)) return fail("relationship is out of bounds");
  const created = makeChild(world, parent, partner, effects);
  if (!created.ok) return created;

  const parentCost = birthCosts.get(parent);
  const partnerCost = birthCosts.get(partner);
  parent.food -= parentCost.foodSpent;
  parent.bread = (parent.bread ?? 0) - parentCost.breadSpent;
  partner.food -= partnerCost.foodSpent;
  partner.bread = (partner.bread ?? 0) - partnerCost.breadSpent;
  // Retain the legacy field for checkpoint compatibility; it no longer gates births.
  parent.reproduceAfter = 0;
  partner.reproduceAfter = 0;
  parent.familyReady = false;
  partner.familyReady = false;
  adjustRelationship(parent, partner.id, 15);
  adjustRelationship(partner, parent.id, 15);
  parent.replanReason = "birth";
  partner.replanReason = "birth";
  world.stats.births += 1;
  agreement.status = 'fulfilled';
  agreement.updatedAt = world.tick;
  notify(effects, `${nameOf(parent)} and ${nameOf(partner)} welcomed a child.`, parent.id, [
    [parent, `Tick ${world.tick}: welcomed a child with ${nameOf(partner)}.`],
    [partner, `Tick ${world.tick}: welcomed a child with ${nameOf(parent)}.`],
  ]);
  return success();
}

export function resolveInteraction(world, citizen, task, effects = {}) {
  const effectsError = validEffects(effects);
  if (effectsError) return fail(effectsError);
  const worldError = validateWorld(world);
  if (worldError) return fail(worldError);
  const actor = citizenIn(world, citizen);
  if (!actor) return fail("citizen is not in the living world");
  switch (task?.type) {
    case "craft": return resolveCraft(world, actor, task, effects);
    case "offer": return resolveOffer(world, actor, task, effects);
    case "trade": return resolveTrade(world, actor, task, effects);
    case "attack": return resolveAttack(world, actor, task, effects);
    case "reproduce": return resolveReproduce(world, actor, task, effects);
    case "propose_family":
    case "accept_family":
    case "decline_family":
    case "cancel_family": return resolveFamily(world, actor, task, effects);
    default: return fail("unsupported interaction task");
  }
}

export function tickInteractions(world, effects = {}) {
  const effectsError = validEffects(effects);
  if (effectsError) return fail(effectsError);
  const worldError = validateWorld(world);
  if (worldError) return fail(worldError);

  const expiring = world.offers.filter((offer) => offer.status === "open" && offer.expiresAt <= world.tick);
  for (const offer of expiring) {
    const maker = world.citizens.find((citizen) => citizen.id === offer.makerId);
    if (!maker || !resourceAdditionValid(maker, offer.give, offer.giveAmount)) return fail(`${offer.id} cannot be refunded safely`);
  }
  const maturing = world.citizens.filter((citizen) => !citizen.adult && isInteger(citizen.bornAt) &&
    citizen.bornAt >= 0 && world.tick - citizen.bornAt >= MATURATION_TICKS);

  for (const offer of expiring) cancelOffer(world, offer, "expired");
  tickFamily(world, effects);
  const notices = [];
  for (const citizen of maturing) {
    citizen.adult = true;
    // Adulthood grants no parent-copied reserve agenda: routine keeps only the
    // family-consent mirror, work starts empty, and the citizen's own varied
    // aspirations are retained. Missing aspirations fall back to an independent,
    // safe future of self-discovery — assigned only once, at maturation.
    citizen.routine = { family: citizen.familyReady === true };
    citizen.work = null;
    const juvenileAims = Array.isArray(citizen.aspirations) && citizen.aspirations.length === 2
      && citizen.aspirations[0] === "Grow safely" && citizen.aspirations[1] === "Find enough food";
    if (juvenileAims || !Array.isArray(citizen.aspirations) ||
        !citizen.aspirations.some((aim) => typeof aim === "string" && aim.trim())) {
      citizen.aspirations = ["Own an independent future safely", "Discover valued purpose"];
    }
    citizen.reviewAt = world.tick;
    citizen.replanReason = "became adult";
    notices.push([citizen, `${nameOf(citizen)} reached adulthood.`]);
  }
  for (const offer of expiring) {
    const maker = world.citizens.find((citizen) => citizen.id === offer.makerId);
    notices.push([maker, `${nameOf(maker)}'s offer ${offer.id} expired and was refunded.`]);
  }
  for (const [citizen, text] of notices) notify(effects, text, citizen?.id);
  return success();
}
