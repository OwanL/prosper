import type { AppSnapshot, World } from '../../src/shared/types';
import { projectSpectatorWorld } from '../../src/server/snapshot';

/** Mechanics fixtures retain authority for observations; only projected payloads reach the UI. */
export type AuthoritativeFixture = Omit<AppSnapshot, 'world'> & { world: World };
export function spectatorFixture(fixture: AuthoritativeFixture): AppSnapshot {
  return { ...fixture, world: projectSpectatorWorld(fixture.world, fixture.status.decisionTreeDebug) };
}
