import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/server/runtime.ts';
import { createApiServer } from '../src/server/http.ts';

const runtimes: Runtime[] = [];
const directories: string[] = [];
function runtime(options: ConstructorParameters<typeof Runtime>[0] = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-speed-'));
  directories.push(directory);
  const result = new Runtime({ directory, population: 1, ...options });
  runtimes.push(result);
  return result;
}
afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('simulation speed', () => {
  it('offers the existing and higher speeds and retains custom restored values', () => {
    const app = readFileSync('src/ui/App.tsx', 'utf8');
    expect(app).toContain('[1, 2, 4, 8, 16, 32, 64, snapshot?.status.speed ?? 1]');
    expect(app).toContain("control({ type: 'speed', speed: Number(event.target.value) })");
  });

  it('accepts higher speeds through the HTTP API and rejects invalid values without changing speed', async () => {
    const value = runtime({ autoClock: false });
    const server = createApiServer({ runtime: value });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      const control = (speed: unknown) => fetch(`http://127.0.0.1:${address.port}/api/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'speed', speed }),
      });
      for (const speed of [1, 2, 4, 8, 16, 32, 64, 0.5, 100]) {
        const response = await control(speed);
        expect(response.status).toBe(200);
        expect((await response.json()).status.speed).toBe(speed);
      }
      for (const speed of [0, -1, 101, '64', null]) {
        expect((await control(speed)).status).toBe(400);
        expect(value.snapshot().status.speed).toBe(100);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it.each([16, 32, 64])('restores %sx and schedules one ordered tick per timer callback', (speed) => {
    vi.useFakeTimers();
    const original = runtime();
    original.control({ type: 'speed', speed });
    original.checkpoint(false);
    original.close();
    const restored = runtime({ directory: original.directory, restore: true });
    expect(restored.snapshot().status.speed).toBe(speed);
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const initialTick = restored.world.tick;
    restored.control({ type: 'play' });
    const delay = 250 / speed;
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), delay);
    // Node truncates fractional timeout milliseconds. Exercise the clock rather
    // than claiming any CPU-bound wall-time throughput from this fake clock.
    const timerMs = Math.floor(delay);
    vi.advanceTimersByTime(timerMs - 1);
    expect(restored.world.tick).toBe(initialTick);
    vi.advanceTimersByTime(1);
    expect(restored.world.tick).toBe(initialTick + 1);
    vi.advanceTimersByTime(timerMs * 3);
    expect(restored.world.tick).toBe(initialTick + 4);
    restored.control({ type: 'pause' });
    vi.advanceTimersByTime(100);
    expect(restored.world.tick).toBe(initialTick + 4);
    schedule.mockRestore();
  });
});
