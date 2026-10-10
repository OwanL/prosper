import type { Point } from '../shared/types';

/** Absorb poll jitter without treating a slow response as an authoritative teleport. */
export function snapshotDuration(gap: number): number {
  return Math.min(2400, Math.max(700, gap * 1.15));
}

export interface Motion {
  from: Point;
  to: Point;
  started: number;
  duration: number;
}

/** Presentation only: never extrapolate beyond a confirmed position. */
export function motionPoint(motion: Motion, now: number): Point {
  const t =
    motion.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * t,
    y: motion.from.y + (motion.to.y - motion.from.y) * t,
  };
}

export function retargetMotion(
  previous: Motion | undefined,
  to: Point,
  now: number,
  duration: number,
): Motion {
  if (!previous || duration <= 0) return { from: to, to, started: now, duration: 0 };
  // Repeated stationary snapshots must not restart a nearly-finished animation.
  if (previous.to.x === to.x && previous.to.y === to.y) return previous;
  return { from: motionPoint(previous, now), to, started: now, duration };
}
