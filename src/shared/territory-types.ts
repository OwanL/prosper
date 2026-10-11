import type { Point, Tier } from './types.ts';
export type ReputationLevel = 'hostile' | 'disliked' | 'neutral' | 'positive' | 'admired';
export const REPUTATION_LEVELS: readonly ReputationLevel[] = ['hostile', 'disliked', 'neutral', 'positive', 'admired'];
export interface TerritoryMembership { citizenId: string; joinedTick: number; sequence: number }
export interface TerritoryAdmission {
  id: string; applicantId: string; requestedTick: number; expiresTick: number;
  votes: Record<string, boolean>; status: 'pending' | 'admitted' | 'rejected' | 'expired';
}
/** Tile membership is authoritative in signs, not a bounding rectangle. */
export interface Territory {
  id: string; ownerId: string; createdTick: number;
  members: Record<string, TerritoryMembership>; admissions: TerritoryAdmission[];
  /** Public aggregate on known-territory projections only; never an authoritative counter. */
  memberCount?: number;
}
/** Separate from buildings: both may occupy the same tile. */
export interface TerritorySign extends Point {
  id: string; territoryId: string; woodTier: Tier; health: number; maxHealth: number;
}
/** Directed observer -> subject opinion; absent entries mean neutral. */
export type ReputationMatrix = Record<string, Record<string, ReputationLevel>>;
export interface House extends Point {
  id: string; ownerId: string; tier: Tier; health: number; maxHealth: number;
}
export interface RestState { value: number; sleepingHouseId?: string }
