import type { Citizen } from '../shared/types.ts';

/** Eligibility, not an instruction to call. Global budget/rate/concurrency still apply.
 * Routine prosperity and messages stay with the local controller. Evidence since
 * the last attempted review supplies hysteresis even when the model fails. */
export function strategicReviewReason(
  citizen: Citizen,
  tick: number,
  localCadence = false,
): string | undefined {
  const state = citizen.autonomy;
  if (!state) return undefined;
  const since = Math.max(state.reviewedTick ?? 0, citizen.review?.strategicTick ?? 0);
  // Verified local inference is bounded by the single shared worker and its
  // fair due-time queue. Successful citizens also need a chance to reconsider
  // specialization, prices, alliances and territory before a crisis.
  if (localCadence) {
    if (state.reviewedTick === undefined && citizen.review?.strategicTick === undefined)
      return 'initial local policy review';
    if (tick - since >= 600) return 'periodic local policy review';
  }
  if (tick - since >= 10000) return 'infrequent policy age review';
  const fresh = state.evidence.filter((entry) => entry.tick > since);
  if (
    fresh.some(
      (entry) => entry.kind === 'survival' && /no.?go|forbidden|blocked.*boundar/i.test(entry.text),
    )
  )
    return 'survival blocked by explicit no-go policy';
  if (
    fresh.some(
      (entry) =>
        entry.kind === 'survival' &&
        /No usable known food or affordable sale; publicly begged for food/.test(entry.text),
    )
  )
    return 'critical food search failed despite begging';
  const attacks = fresh.filter((entry) => entry.kind === 'attack');
  if (attacks.length >= 2) return 'repeated newly witnessed harm';
  const disputes = fresh.filter(
    (entry) => entry.kind === 'competition' || entry.kind === 'trespass',
  );
  if (
    disputes.length >= 4 &&
    Object.values(state.relationships).some((relationship) => relationship.grievance >= 40)
  )
    return 'repeated resource dispute with substantial grievance';
  const deliberateSurplusPause = state.idleReason === 'surplus';
  if (
    !deliberateSurplusPause &&
    !citizen.action &&
    !state.combat &&
    tick - Math.max(state.lastProgressTick, since) >= 600
  )
    return 'local livelihood stalled despite autonomous attempts';
  return undefined;
}
