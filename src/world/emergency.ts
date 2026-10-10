import type { Citizen, Command, CommandResult, World } from '../shared/types.ts';
import { MAX_TIER, TIERS } from '../shared/tiers.ts';
import { addInventory, distance, event } from '../shared/utils.ts';
import { BALANCE, harvestDuration, MATCHING_TOOL, STATION_RESOURCE } from './config.ts';
import { findPath } from './pathfinding.ts';
import { directiveActionResult } from './directives.ts';
import { planActionResult } from './plans.ts';
import { highestToolTier } from '../shared/tool-utils.ts';

interface Actions {
  command(command: Command): CommandResult;
}
function evidence(world: World, citizen: Citizen, message: string): void {
  const text = `Emergency feeding: ${message}`.slice(0, Math.min(599, BALANCE.memoryLength));
  event(world, 'emergency', text, {
    citizenId: citizen.id,
    x: citizen.x,
    y: citizen.y,
    audience: [citizen.id],
  });
  const prefix = `Emergency feeding at tick ${citizen.emergency?.startedTick ?? world.tick}: `;
  const memory = citizen.memories.find((note) => note.text.startsWith(prefix));
  if (memory) {
    memory.text = `${memory.text} ${message}`.slice(0, Math.min(599, BALANCE.memoryLength));
    memory.tick = world.tick;
  } else {
    citizen.memories.push({
      tick: world.tick,
      text: `${prefix}${message}`.slice(0, Math.min(599, BALANCE.memoryLength)),
    });
    if (citizen.memories.length > BALANCE.memoryLimit) citizen.memories.shift();
  }
}
const edible = (citizen: Citizen) =>
  TIERS.some((tier) => (citizen.inventory[`food:${tier}`] ?? 0) > 0);
function eligible(world: World, citizen: Citizen, depositId: string): boolean {
  const deposit = world.deposits[depositId];
  if (!deposit || distance(citizen, deposit) > BALANCE.sightRadius) return false;
  const tool = highestToolTier(citizen, MATCHING_TOOL.food);
  const claims = Object.values(world.citizens)
    .filter((c) => c.alive && c.id !== citizen.id)
    .flatMap((c) => [c.action, c.emergency?.suspendedAction])
    .filter((a) => a?.command.type === 'harvest' && a.command.depositId === depositId).length;
  return (
    deposit.resource === 'food' && deposit.stock > claims && deposit.tier <= Math.min(MAX_TIER, tool + 1)
  );
}
/** Explicit cancellation/death returns parked inputs once; ordinary temporary-action
 * failure must never release the suspended action. */
export function cancelEmergency(world: World, citizen: Citizen, reason: string): void {
  if (!citizen.emergency) return;
  if (citizen.emergency.suspendedAction) {
    const action = citizen.emergency.suspendedAction;
    addInventory(citizen.inventory, action.reserved);
    const result = { ok: false, code: 'emergency-cancelled', message: reason };
    planActionResult(citizen, action.id, result);
    directiveActionResult(citizen, action.id, result);
  }
  evidence(world, citizen, `${reason}; suspended work cancelled and unused inputs returned.`);
  delete citizen.emergency;
}

/** Called before physical advancement; never searches hidden deposits or explores. */
export function beginEmergency(world: World, citizen: Citizen, actions: Actions): void {
  if (citizen.emergency || citizen.fullness !== 0 || edible(citizen)) return;
  const action = citizen.action;
  // Joint work cannot be paused one parent at a time.
  if (action?.command.type === 'reproduce') return;
  if (action?.command.type === 'harvest') {
    const depositId = action.command.depositId;
    const knownFood = Object.values(citizen.knowledge).some((tile) =>
      tile.deposits.some((d) => d.id === depositId && d.resource === 'food'),
    );
    // Preserve an existing food trip even when a detour takes its target out of
    // current sight. Its ordinary action checks decide failure, not self-care.
    if (knownFood || eligible(world, citizen, depositId)) return;
  }
  if (
    action?.command.type === 'refine' &&
    action.phase === 'work' &&
    STATION_RESOURCE[world.buildings[action.command.buildingId]?.kind] === 'food' &&
    action.duration - action.elapsed <= harvestDuration(1, 0)
  )
    return;
  const known = new Map<string, { id: string; x: number; y: number }>();
  for (const tile of Object.values(citizen.knowledge)) {
    // Check dated location BEFORE consulting current state.
    if (distance(citizen, tile) > BALANCE.sightRadius) continue;
    for (const deposit of tile.deposits)
      if (deposit.resource === 'food') known.set(deposit.id, deposit);
  }
  const choices = [...known.values()]
    .filter((d) => eligible(world, citizen, d.id))
    .map((d) => ({ deposit: d, path: findPath(world, citizen, d) }))
    .filter((d) => d.path !== null)
    .sort((a, b) => a.path!.length - b.path!.length || a.deposit.id.localeCompare(b.deposit.id));
  const destination = choices[0]?.deposit;
  if (!destination) return;
  const directive = citizen.strategy?.directives[citizen.strategy.index];
  const outsideAreas =
    !!directive &&
    'areas' in directive &&
    !directive.areas.some(
      ([x1, y1, x2, y2]) =>
        destination.x >= x1 && destination.x <= x2 && destination.y >= y1 && destination.y <= y2,
    );
  citizen.emergency = {
    startedTick: world.tick,
    depositId: destination.id,
    outsideAreas,
    stage: 'gather',
    ...(action
      ? { suspendedAction: action, suspendedPosition: { x: citizen.x, y: citizen.y } }
      : {}),
  };
  citizen.action = null;
  evidence(
    world,
    citizen,
    `starving without edible food; interrupted ${action?.command.type ?? 'idle'}${directive ? ` / directive ${directive.type} #${citizen.strategy!.index + 1} (${citizen.strategy!.id})` : ''}; known food ${destination.id} at (${destination.x},${destination.y}), outside work areas: ${outsideAreas}.`,
  );
  const result = actions.command({ type: 'harvest', depositId: destination.id });
  if (!result.ok) finishEmergency(world, citizen, actions, `failed: ${result.message}`);
}
function finishEmergency(world: World, citizen: Citizen, actions: Actions, outcome: string): void {
  const emergency = citizen.emergency;
  if (!emergency) return;
  emergency.outcome = outcome;
  emergency.stage = 'return';
  evidence(world, citizen, `${outcome}; returning to suspended work.`);
  const position = emergency.suspendedPosition;
  if (emergency.suspendedAction && position && distance(citizen, position) > 0) {
    const result = actions.command({ type: 'move', ...position });
    if (result.ok) return;
    cancelEmergency(world, citizen, `Cannot resume: ${result.message}`);
    return;
  }
  restoreEmergency(world, citizen);
}
function restoreEmergency(world: World, citizen: Citizen): void {
  const emergency = citizen.emergency;
  if (!emergency) return;
  citizen.action = emergency.suspendedAction ?? null;
  evidence(
    world,
    citizen,
    `${emergency.outcome ?? 'finished'}; resumed ${citizen.action?.command.type ?? 'prior strategy/queue'} with original progress and reservations.`,
  );
  delete citizen.emergency;
}
/** Called after automatic meals. Temporary action IDs never match parked pending IDs. */
export function advanceEmergency(world: World, citizen: Citizen, actions: Actions): void {
  const emergency = citizen.emergency;
  if (!emergency) return;
  if (emergency.stage === 'gather' && citizen.fullness > 0 && citizen.action) {
    // A remote delivery may supply an automatic meal before the harvest ends.
    // The temporary food claim carries no inputs and must not finish a second unit.
    citizen.action = null;
    finishEmergency(world, citizen, actions, 'meal eaten');
    return;
  }
  if (citizen.action) return;
  if (emergency.stage === 'return') {
    if (emergency.suspendedPosition && distance(citizen, emergency.suspendedPosition) > 0) {
      cancelEmergency(world, citizen, 'Return route failed');
      return;
    }
    restoreEmergency(world, citizen);
  } else
    finishEmergency(
      world,
      citizen,
      actions,
      citizen.fullness > 0 ? 'meal eaten' : 'food attempt failed',
    );
}
