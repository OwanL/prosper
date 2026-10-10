import { describe, expect, it } from 'vitest';
import { motionPoint, retargetMotion, snapshotDuration } from '../src/ui/motion';

describe('presentation interpolation', () => {
  it('buffers slow polls without snapping from the previously painted position', () => {
    const initial = retargetMotion(undefined, { x: 0, y: 0 }, 0, 0);
    const slow = retargetMotion(initial, { x: 1, y: 0 }, 2500, snapshotDuration(2500));
    expect(motionPoint(slow, 2500).x).toBe(0);
    expect(motionPoint(slow, 3000).x).toBeGreaterThan(0);
    expect(motionPoint(slow, 3000).x).toBeLessThan(1);
    expect(motionPoint(slow, 10000).x).toBe(1);
  });
  it('spans a complete snapshot interval and never overshoots confirmed state', () => {
    const initial = retargetMotion(undefined, { x: 0, y: 1 }, 0, 700);
    const moving = retargetMotion(initial, { x: 1, y: 1 }, 700, 700);
    expect(motionPoint(moving, 1050)).toEqual({ x: 0.5, y: 1 });
    expect(motionPoint(moving, 1300).x).toBeCloseTo(6 / 7);
    expect(motionPoint(moving, 5000)).toEqual({ x: 1, y: 1 });
  });
  it('retargets from the rendered position rather than jumping to a previous endpoint', () => {
    const initial = retargetMotion(undefined, { x: 0, y: 0 }, 0, 700);
    const first = retargetMotion(initial, { x: 1, y: 0 }, 0, 700);
    const next = retargetMotion(first, { x: 2, y: 0 }, 350, 700);
    expect(motionPoint(next, 350)).toEqual({ x: 0.5, y: 0 });
    expect(motionPoint(next, 700)).toEqual({ x: 1.25, y: 0 });
  });
  it('does not restart a repeated target and snaps when animation is disabled', () => {
    const initial = retargetMotion(undefined, { x: 0, y: 0 }, 0, 0);
    const moving = retargetMotion(initial, { x: 1, y: 0 }, 0, 700);
    expect(retargetMotion(moving, { x: 1, y: 0 }, 200, 700)).toBe(moving);
    expect(motionPoint(retargetMotion(moving, { x: 1, y: 0 }, 200, 0), 200)).toEqual({
      x: 1,
      y: 0,
    });
  });
});
