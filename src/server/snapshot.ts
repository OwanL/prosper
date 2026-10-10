import type { World } from '../shared/types.ts';
import { worldEventHistory } from '../shared/utils.ts';

/** Spectator transport is not a checkpoint. The selected citizen's complete
 * notebook is served separately through its observation endpoint. Omit before
 * cloning so notebooks and analytics never enter the polling serialization hot path. */
export function projectSpectatorWorld(world: World): World {
  const { telemetry: _telemetry, ...scene } = world;
  return structuredClone({
    ...scene,
    events: worldEventHistory(world),
    significantEvents: undefined,
    citizens: Object.fromEntries(
      Object.entries(world.citizens).map(([id, { knowledge: _knowledge, ...citizen }]) => [
        id,
        { ...citizen, knowledge: {} },
      ]),
    ),
  });
}
