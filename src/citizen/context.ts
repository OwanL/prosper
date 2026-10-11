import type { CitizenObservation, TileMemory, WorldEvent } from '../shared/types.ts';
import { isTier } from '../shared/tiers.ts';

const RECENT_ROUTINE_ALERTS = 8;
const routineWork =
  /^(?:Started|Completed) (?:move|harvest|craft|build|refine)(?:\.| with travel\.)$/;
const queuedWork =
  /^Queued (?:move|harvest|craft|build|refine); inputs will be checked and reserved when it starts\.$/;

/** Only clearly redundant feedback is eligible. Unknown and consequential events stay intact. */
function isRoutine(alert: WorldEvent): boolean {
  if (alert.kind === 'meal') {
    const meal = /^Ate T([1-9]\d*) food\.$/.exec(alert.text);
    return meal !== null && isTier(Number(meal[1]));
  }
  if (alert.kind !== 'command' && alert.kind !== 'completion') return false;
  return (
    routineWork.test(alert.text) ||
    queuedWork.test(alert.text) ||
    [
      'Goals replaced.',
      'Memory saved; oldest notes are evicted when full.',
      'Message sent.',
    ].includes(alert.text)
  );
}

function compactTile(tile: TileMemory) {
  return {
    x: tile.x,
    y: tile.y,
    seenTick: tile.seenTick,
    ...(tile.observedTerritoryId !== undefined
      ? { observedTerritoryId: tile.observedTerritoryId }
      : {}),
    ...(tile.citizens.length ? { citizens: tile.citizens } : {}),
    ...(tile.deposits.length ? { deposits: tile.deposits } : {}),
    ...(tile.buildings.length ? { buildings: tile.buildings } : {}),
    ...(tile.loot.length ? { loot: tile.loot } : {}),
  };
}

/** Provider-only projection. Never change authoritative observation/knowledge or consult world truth. */
export function providerContext(observation: CitizenObservation) {
  // Select by tick, preserving original delivery order in the resulting context.
  const routine = observation.alerts
    .map((alert, index) => ({ alert, index }))
    .filter(({ alert }) => isRoutine(alert))
    .sort((a, b) => b.alert.tick - a.alert.tick || b.index - a.index);
  const retained = new Set(routine.slice(0, RECENT_ROUTINE_ALERTS).map(({ index }) => index));
  const omittedByKind: Record<string, number> = {};
  const alerts = observation.alerts.filter((alert, index) => {
    if (!isRoutine(alert) || retained.has(index)) return true;
    omittedByKind[alert.kind] = (omittedByKind[alert.kind] ?? 0) + 1;
    return false;
  });
  const remembered: ReturnType<typeof compactTile>[] = [];
  const rememberedEmpty: ([number, number, number] | [number, number, number, string | null])[] = [];
  for (const tile of observation.remembered) {
    if (tile.citizens.length || tile.deposits.length || tile.buildings.length || tile.loot.length)
      remembered.push(compactTile(tile));
    else if (tile.observedTerritoryId !== undefined)
      rememberedEmpty.push([tile.x, tile.y, tile.seenTick, tile.observedTerritoryId]);
    else rememberedEmpty.push([tile.x, tile.y, tile.seenTick]);
  }
  return {
    visible: observation.visible.map(compactTile),
    visibleFormat:
      'Current sightings at the snapshot tick. Missing entity arrays are empty, not unknown.',
    alerts,
    ...(routine.length > RECENT_ROUTINE_ALERTS
      ? {
          alertHistoryOmitted: {
            routineOnly: true,
            omittedByKind,
            retainedRoutineLimit: RECENT_ROUTINE_ALERTS,
          },
        }
      : {}),
    remembered,
    rememberedEmpty: rememberedEmpty.length ? rememberedEmpty : undefined,
    rememberedFormat: observation.remembered.length
      ? 'Dated sightings, not live facts. Missing entity arrays are empty. rememberedEmpty entries are [x,y,seenTick] when territory is unknown, or [x,y,seenTick,observedTerritoryId] when territory was observed (null means no mark): observed empty then, not never explored.'
      : undefined,
  };
}
