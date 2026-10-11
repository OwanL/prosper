import type { SpectatorCitizen, SpectatorWorld, World } from '../shared/types.ts';
import { worldEventHistory } from '../shared/utils.ts';

/** Spectator transport is not a checkpoint. Omit private notebooks, analytics and
 * disabled diagnostics before cloning; the result has no authoritative aliases. */
export function projectSpectatorWorld(world: World, decisionTreeDebug = false): SpectatorWorld {
  const { telemetry: _telemetry, ...scene } = world;
  return structuredClone({
    ...scene,
    events: worldEventHistory(world),
    significantEvents: undefined,
    citizens: Object.fromEntries(
      Object.entries(world.citizens).map(([id, { knowledge: _knowledge, mind, ...citizen }]) => {
        const projected: SpectatorCitizen = { ...citizen, knowledge: {} };
        if (mind) {
          const task = mind.tasks.find((task) => task.id === mind.activeTaskId) ??
            mind.tasks.find((task) => task.status === 'running');
          projected.mind = {
            dispositions: mind.dispositions,
            memories: mind.memories.slice(-12),
            memoriesOmitted: mind.memoriesOmitted,
            memoriesPayloadOmitted: Math.max(0, mind.memories.length - 12),
            ...(task ? { currentTask: {
              id: task.id, definitionId: task.definitionId, status: task.status,
              phase: task.phase, delivered: task.delivered, request: task.request,
            } } : {}),
          };
          if (decisionTreeDebug) projected.treeDebug = mind;
        }
        return [id, projected];
      }),
    ),
  });
}
