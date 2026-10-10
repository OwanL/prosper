import type { World } from '../shared/types.ts';

/** Opt-in runner metadata. Never stored in World or serialized with a save. */
export type CitizenAuthority = 'direct' | 'passive-body' | 'local-ai';
export interface EvaluationAuthority {
  /** Every existing citizen must be listed. tickWorld registers births here. */
  citizens: Record<string, CitizenAuthority>;
  newbornAuthority?: CitizenAuthority;
}
export interface WorldControlOptions {
  authority?: EvaluationAuthority;
}

const validAuthority = (value: unknown): value is CitizenAuthority =>
  value === 'direct' || value === 'passive-body' || value === 'local-ai';

/** Missing/invalid authority is a fixture error, never a Local AI fallback. */
export function strategyAllowed(citizenId: string, options?: WorldControlOptions): boolean {
  const authority = options?.authority;
  if (!authority) return true;
  const value = Object.hasOwn(authority.citizens, citizenId) ? authority.citizens[citizenId] : undefined;
  if (!validAuthority(value)) throw new Error(`Missing or invalid evaluation authority for ${citizenId}.`);
  return value === 'local-ai';
}

export function validateWorldAuthority(world: World, options?: WorldControlOptions): void {
  const authority = options?.authority;
  if (!authority) return;
  if (authority.newbornAuthority !== undefined && !validAuthority(authority.newbornAuthority))
    throw new Error('Invalid newborn evaluation authority.');
  for (const citizenId of Object.keys(world.citizens)) strategyAllowed(citizenId, options);
}
