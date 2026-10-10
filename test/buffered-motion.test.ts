import { describe, expect, it } from 'vitest';
import { CitizenMotionBuffer, type CitizenMotionPacket } from '../src/ui/bufferedMotion';

function packet(runId = 'run-a'): CitizenMotionPacket {
  return {
    runId,
    streamId: 'server-a',
    tick: 2,
    tickMs: 100,
    running: true,
    frames: [
      { tick: 0, at: 1000, citizens: [{ id: 'a', x: 0, y: 0, alive: true }] },
      { tick: 1, at: 1100, citizens: [{ id: 'a', x: 1, y: 0, alive: true }] },
      { tick: 2, at: 1200, citizens: [{ id: 'a', x: 1, y: 1, alive: true }] },
    ],
  };
}

describe('continuous committed motion', () => {
  it('follows an L-shaped confirmed path instead of cutting diagonally through the corner', () => {
    const buffer = new CitizenMotionBuffer();
    buffer.append(packet(), 500);
    expect(buffer.sample(470).get('a')).toEqual({ x: 0.5, y: 0 });
    expect(buffer.sample(520).get('a')).toEqual({ x: 1, y: 0 });
    expect(buffer.sample(570).get('a')).toEqual({ x: 1, y: 0.5 });
    expect(buffer.sample(5000).get('a')).toEqual({ x: 1, y: 1 });
  });

  it('snaps to the latest committed frame for pause and reduced motion', () => {
    const buffer = new CitizenMotionBuffer();
    buffer.append(packet(), 500);
    expect(buffer.sample(500, false).get('a')).toEqual({ x: 1, y: 1 });
    buffer.append({ ...packet(), running: false }, 510);
    expect(buffer.sample(510).get('a')).toEqual({ x: 1, y: 1 });
  });

  it('discards old paths on a different run or backwards tick', () => {
    const buffer = new CitizenMotionBuffer();
    buffer.append(packet(), 500);
    buffer.sample(5000);
    buffer.append(
      {
        ...packet('run-b'),
        frames: [{ tick: 1, at: 600, citizens: [{ id: 'b', x: 7, y: 8, alive: true }] }],
      },
      600,
    );
    expect([...buffer.sample(600)]).toEqual([['b', { x: 7, y: 8 }]]);
    buffer.append(
      {
        ...packet('run-b'),
        frames: [{ tick: 0, at: 700, citizens: [{ id: 'c', x: 9, y: 2, alive: true }] }],
      },
      700,
    );
    expect([...buffer.sample(700)]).toEqual([['c', { x: 9, y: 2 }]]);
  });

  it('removes dead citizens immediately and never moves backwards on jitter', () => {
    const buffer = new CitizenMotionBuffer();
    buffer.append(packet(), 500);
    expect(buffer.sample(570).get('a')).toEqual({ x: 1, y: 0.5 });
    buffer.append(packet(), 550);
    expect(buffer.sample(550).get('a')).toEqual({ x: 1, y: 0.5 });
    buffer.append(
      {
        ...packet(),
        frames: [{ tick: 3, at: 1300, citizens: [{ id: 'a', x: 1, y: 1, alive: false }] }],
      },
      600,
    );
    expect(buffer.sample(600).has('a')).toBe(false);
  });

  it('clears the old server clock when a hot reload preserves the world run', () => {
    const buffer = new CitizenMotionBuffer();
    buffer.append(packet(), 500);
    buffer.sample(5000);
    buffer.append(
      {
        ...packet(),
        streamId: 'server-b',
        frames: [{ tick: 3, at: 50, citizens: [{ id: 'a', x: 4, y: 4, alive: true }] }],
      },
      600,
    );
    expect(buffer.sample(600).get('a')).toEqual({ x: 4, y: 4 });
  });
});
