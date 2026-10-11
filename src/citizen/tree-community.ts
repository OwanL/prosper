import type { Command, DecisionObservation } from '../shared/types.ts';
import type { Territory, ReputationLevel } from '../shared/territory-types.ts';
import { relationshipContext } from './tree-memory.ts';

/** Same directed opinion scale used by composed admission decisions. */
export const personalOpinionValue = (level?: ReputationLevel): number =>
  ({ hostile: -2, disliked: -1, neutral: 0, positive: 1, admired: 2 })[level ?? 'neutral'];

export type MembershipObservation = Pick<DecisionObservation, 'territories' | 'reputations'> & {
  citizen: Pick<DecisionObservation['citizen'], 'id'>;
};

/** Own projected roster is authoritative: death settlement removes membership.
 * Never infer a roster from sightings, nor inspect other citizens' minds.
 * Unknown/neutral opinions still count in the denominator, but not as negative.
 */
export function negativePersonalMajority(o: MembershipObservation, territoryId: string): boolean {
  const territory = o.territories?.find(t => t.id === territoryId && !!t.members[o.citizen.id]);
  if (!territory) return false;
  const others = Object.keys(territory.members).filter(id => id !== o.citizen.id);
  return others.length > 0 && others.filter(id => personalOpinionValue(o.reputations?.[id]) < 0).length * 2 > others.length;
}

/** One approved scalar; bounded calibration favors joining over founding.
 * Expansion retains its existing half-weight boost. No extra disposition state.
 */
export function communityBoost(kind: 'join' | 'found' | 'expand', weight = 0): number {
  const bounded = Number.isFinite(weight) ? Math.max(-1, Math.min(1, weight)) : 0;
  return bounded * ({ join: .75, found: .25, expand: .5 })[kind];
}

/** Missing legacy aggregates remain unknown, not a fabricated singleton. */
export function knownMemberCount(o: MembershipObservation, territory: Territory): number | undefined {
  if (territory.members[o.citizen.id]) return Object.keys(territory.members).length;
  const count = territory.memberCount;
  return count !== undefined && Number.isSafeInteger(count) && count > 0 ? count : undefined;
}
/** Diminishing public strength, capped at .35 benefit units. */
export function membershipPower(count?: number): number {
  return count !== undefined && Number.isSafeInteger(count) && count > 0 ? .35 * Math.min(1, Math.log2(1 + count) / 8) : 0;
}
/** Strength never governs departure. Known owner opinion and travel can each
 * outweigh the entire power bonus; unknown distance is not invented travel. */
export function territoryJoinValue(o: DecisionObservation, territory: Territory): number {
  const marks = (o.signs ?? []).filter(s => s.territoryId === territory.id);
  const travel = marks.length ? Math.min(.6, Math.min(...marks.map(s => Math.hypot(s.x - o.citizen.x, s.y - o.citizen.y))) / 20) : 0;
  const relation = relationshipContext(o, o.citizen.mind?.memories ?? [], territory.ownerId);
  const affinity = Math.max(-.6, Math.min(.6, .3 * personalOpinionValue(o.reputations?.[territory.ownerId]) + .1 * ((relation?.help ?? 0) + (relation?.family ?? 0) - (relation?.harm ?? 0))));
  return membershipPower(knownMemberCount(o, territory)) + affinity - travel;
}

export type VoteObservation = Pick<DecisionObservation, 'tick' | 'territories' | 'reputations' | 'visible' | 'remembered'> & {
  citizen: Pick<DecisionObservation['citizen'], 'id' | 'mind'>;
};

/** Pure, cheap and nonblocking: at most one ordinary command; recorded votes
 * suppress repeats. Caller supplies its existing seeded draw, never world truth.
 * The caller must provide a legitimate own-territory projection, not foreign rosters.
 */
export function communityVoteOpportunity(o: VoteObservation, draw: number): Command | undefined {
  const mind = o.citizen.mind;
  if (!mind) return undefined;
  for (const territory of o.territories ?? []) if (territory.members[o.citizen.id]) {
    const admission = territory.admissions.find(a => a.status === 'pending' && a.expiresTick > o.tick && a.votes[o.citizen.id] === undefined);
    if (!admission) continue;
    const relation = relationshipContext(o, mind.memories, admission.applicantId);
    const evidence = personalOpinionValue(o.reputations?.[admission.applicantId]) + (relation?.help ?? 0) + (relation?.family ?? 0) - (relation?.harm ?? 0) * 2;
    const probability = 1 / (1 + Math.exp(-(evidence + 3 * (mind.dispositions.sociability - .5) + mind.dispositions.generosity)));
    return { type: 'vote-territory', territoryId: territory.id, admissionId: admission.id, accept: draw < probability };
  }
  return undefined;
}
