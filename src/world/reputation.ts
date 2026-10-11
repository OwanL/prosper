import type { Point, ReputationLevel, Territory, World } from '../shared/types.ts';
import { REPUTATION_LEVELS } from '../shared/territory-types.ts';
import { COMPOSED_BALANCE } from './config.ts';
import { territoryAt, territoryOf } from './territory.ts';

// Directed observer -> subject reputation for the composed controller. Absent
// entries mean neutral. These helpers never dispatch or force combat; they only
// record opinions. Witness propagation stays knowledge-bounded: the caller
// confirms that a triggering witness actually saw the offense, then this module
// applies the one sanctioned consequence to every living territory member once.

const levelIndex = (level: ReputationLevel) => REPUTATION_LEVELS.indexOf(level);

/** Absent entries and dead/missing observers mean neutral. */
export function reputationLevel(world: World, observerId: string, subjectId: string): ReputationLevel {
  return world.reputations?.[observerId]?.[subjectId] ?? 'neutral';
}

/** Move one or more directed steps; clamped at hostile and admired. Neutral
 * results delete the entry. Returns the new level, or undefined for a no-op. */
export function changeReputation(world: World, observerId: string, subjectId: string, delta: number): ReputationLevel | undefined {
  if (!delta || observerId === subjectId) return undefined;
  if (!world.citizens[observerId] || !world.citizens[subjectId]) return undefined;
  const opinions = (world.reputations ??= {})[observerId] ??= {};
  const next = Math.min(REPUTATION_LEVELS.length - 1, Math.max(0, levelIndex(opinions[subjectId] ?? 'neutral') + delta));
  const level = REPUTATION_LEVELS[next];
  if (level === 'neutral') delete opinions[subjectId];
  else opinions[subjectId] = level;
  return level;
}

export type TerritoryOffense = 'harvest' | 'trespass' | 'structure' | 'attack-member';

/** Apply the sanctioned consequence of one witnessed offense to all living members
 * of the relevant territory. `location` (inside the territory) locates harvest,
 * trespass and structure offenses; an attack on a member uses the witnessing
 * member's territory. Same-territory actors are exempt except for member attacks.
 * Cooldown is per territoryId:actorId:offense key, suppressing repeat sanctioning
 * within COMPOSED_BALANCE.offenseCooldownTicks. Returns the applied level. */
export function witnessTerritoryOffense(
  world: World,
  offense: TerritoryOffense,
  actorId: string,
  witnessId: string,
  location?: Point,
): ReputationLevel | undefined {
  const witness = world.citizens[witnessId];
  if (!witness?.alive) return undefined;
  const territory: Territory | undefined = offense === 'attack-member'
    ? territoryOf(world, witnessId)
    : location ? territoryAt(world, location) : undefined;
  if (!territory || !territory.members[witnessId]) return undefined;
  if (offense !== 'attack-member' && territory.members[actorId]) return undefined;
  const members = Object.keys(territory.members).filter(
    (memberId) => world.citizens[memberId]?.alive && memberId !== actorId);
  if (!members.length) return undefined;
  const cooldownKey = `${territory.id}:${actorId}:${offense}`;
  if ((world.offenseCooldowns?.[cooldownKey] ?? 0) > world.tick) return undefined;
  world.offenseCooldowns ??= {};
  world.offenseCooldowns[cooldownKey] = world.tick + COMPOSED_BALANCE.offenseCooldownTicks;
  let applied: ReputationLevel | undefined;
  for (const memberId of members) {
    if (offense === 'attack-member') {
      // A witnessed attack on a member puts every member's view at the minimum.
      (world.reputations ??= {})[memberId] ??= {};
      world.reputations[memberId]![actorId] = 'hostile';
      applied = 'hostile';
    } else {
      // Harvesting, trespass or structure damage witnessed inside a territory
      // drops every member's view one level, bounded by hostile.
      applied = changeReputation(world, memberId, actorId, -1);
    }
  }
  return applied;
}

/** Convenience wrappers over witnessTerritoryOffense; all knowledge-bounded by the caller. */
export const witnessTerritoryHarvest = (world: World, harvesterId: string, witnessId: string, location: Point) =>
  witnessTerritoryOffense(world, 'harvest', harvesterId, witnessId, location);
export const witnessTerritoryTrespass = (world: World, trespasserId: string, witnessId: string, location: Point) =>
  witnessTerritoryOffense(world, 'trespass', trespasserId, witnessId, location);
export const witnessStructureAttack = (world: World, attackerId: string, witnessId: string, location: Point) =>
  witnessTerritoryOffense(world, 'structure', attackerId, witnessId, location);
export const witnessMemberAttack = (world: World, attackerId: string, witnessId: string) =>
  witnessTerritoryOffense(world, 'attack-member', attackerId, witnessId);