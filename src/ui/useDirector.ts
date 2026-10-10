import { useEffect, useRef, useState } from 'react';
import type { WorldEvent } from '../shared/types';
import { directorCandidate } from './story';

/** The camera observes events. It never schedules citizen behavior or world ticks. */
export function useDirector(
  events: WorldEvent[],
  tick: number,
  width: number,
  height: number,
  enabled: boolean,
) {
  const [shot, setShot] = useState<WorldEvent>();
  const lastCut = useRef(0);
  const lastEventTick = useRef(-1);
  useEffect(() => {
    if (!enabled) {
      setShot(undefined);
      lastEventTick.current = -1;
      lastCut.current = 0;
      return;
    }
    const choose = () => {
      const candidate = directorCandidate(events, tick, width, height, lastEventTick.current);
      if (!candidate) {
        if (shot && tick - shot.tick > 180) setShot(undefined);
        return;
      }
      setShot(candidate);
      lastEventTick.current = candidate.tick;
      lastCut.current = performance.now();
    };
    // Hold every shot for at least eight seconds; high event volume cannot cause jitter.
    const remaining =
      lastCut.current === 0 ? 0 : Math.max(0, 8000 - (performance.now() - lastCut.current));
    if (!remaining) choose();
    else {
      const timer = setTimeout(choose, remaining);
      return () => clearTimeout(timer);
    }
  }, [events, tick, width, height, enabled, shot]);
  return enabled ? shot : undefined;
}
