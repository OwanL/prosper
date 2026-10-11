import { MIND_LIMITS, type CitizenMind, type StructuredMemory } from '../shared/tree-types.ts';
import type { DecisionObservation } from '../shared/types.ts';

/** Inputs must already be personal observations/confirmed feedback, not spectator events.
 * First retained id wins: replaying an event cannot refresh its date or rewrite evidence. */
export function updateMemories(memories: readonly StructuredMemory[], evidence: readonly StructuredMemory[], tick: number, omitted = 0): { memories: StructuredMemory[]; memoriesOmitted: number } {
  const unique = new Map<string, StructuredMemory>();
  for (const memory of [...memories, ...evidence]) {
    if (!memory.id || !Number.isFinite(memory.tick) || memory.tick < 0 || memory.tick > tick || unique.has(memory.id)) continue;
    unique.set(memory.id, { ...memory, text: memory.text.slice(0, 240), ...(memory.location ? { location: { x: memory.location.x, y: memory.location.y } } : {}) });
  }
  const sorted = [...unique.values()].sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  const dropped = Math.max(0, sorted.length - MIND_LIMITS.memories);
  return { memories: sorted.slice(dropped), memoriesOmitted: Math.max(0, Number.isFinite(omitted) ? omitted : 0) + dropped };
}
/** Provisional tuning: victim +.5, third-party eyewitness +.25, cap 1,
 * linear fade of one unit per 1200 ticks. Only engine event-N identities count.
 * Audience alone is not witnessing (remote owners can receive attack alerts).
 * Caller attests actual current sight or same-tick dated personal tile evidence. */
export function updateCommunityWeight(mind: CitizenMind, observation: Pick<DecisionObservation, 'tick' | 'alerts'> & { citizen: { id: string } }, witnessed: (event: DecisionObservation['alerts'][number]) => boolean): void {
  const state = mind.community ??= { weight: 0, tick: observation.tick, eventCursor: 0 };
  const events = observation.alerts.filter(e => e.tick <= observation.tick && /^event-\d+$/.test(e.id))
    .sort((a, b) => a.tick - b.tick || Number(a.id.slice(6)) - Number(b.id.slice(6)));
  for (const event of events) {
    const cursor = Number(event.id.slice(6));
    if (cursor <= state.eventCursor) continue;
    state.eventCursor = cursor;
    const victim = event.targetId === observation.citizen.id;
    const actor = event.citizenId === observation.citizen.id;
    if (event.kind !== 'attack' || actor || !(victim || witnessed(event))) continue;
    // Late evidence retains its actual date, never refreshes an old incident.
    const eventTick = Math.max(state.tick, event.tick);
    state.weight = Math.max(0, state.weight - (eventTick - state.tick) / 1200);
    state.weight = Math.min(1, state.weight + Math.max(0, (victim ? .5 : .25) - (eventTick - event.tick) / 1200));
    state.tick = eventTick;
  }
  state.weight = Math.max(0, state.weight - Math.max(0, observation.tick - state.tick) / 1200);
  state.tick = observation.tick;
}
export interface RelationshipContext {
  otherId: string; lastEvidenceTick?: number; harm: number; help: number; trades: number; family: number;
}
/** Directed personal evidence only; does not infer the other person's opinion or intent. */
export function relationshipContext(observation: Pick<DecisionObservation, 'tick' | 'visible' | 'remembered'>, memories: readonly StructuredMemory[], otherId: string): RelationshipContext | undefined {
  const evidence = memories.filter(m => m.otherId === otherId && m.tick <= observation.tick);
  const known = evidence.length > 0 || [...observation.visible, ...observation.remembered].some(tile => tile.citizens.some(c => c.id === otherId));
  if (!known) return undefined;
  const result: RelationshipContext = { otherId, harm: 0, help: 0, trades: 0, family: 0 };
  for (const memory of evidence) {
    result.lastEvidenceTick = Math.max(result.lastEvidenceTick ?? 0, memory.tick);
    if (memory.kind === 'harm') result.harm++;
    if (memory.kind === 'help') result.help++;
    if (memory.kind === 'trade') result.trades++;
    if (memory.kind === 'family') result.family++;
  }
  return result;
}
