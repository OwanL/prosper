import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Runtime } from '../src/server/runtime.ts';
import { loadCheckpoint, saveCheckpoint, validateCheckpoint } from '../src/server/checkpoint.ts';
import { ReloadCoordinator, type Backend } from '../scripts/reload.ts';
import type { ProviderResponse } from '../src/citizen/index.ts';

const directories: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'prosper-reload-'));
  directories.push(path);
  return path;
}
function runtime(options: ConstructorParameters<typeof Runtime>[0]) {
  const value = new Runtime(options);
  runtimes.push(value);
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}
function message(child: ChildProcess, types: string[]): Promise<Record<string, any>> {
  return new Promise((yes, no) => {
    const timer = setTimeout(() => finish(new Error('IPC timeout')), 10000);
    const receive = (value: any) => {
      if (types.includes(value?.type)) finish(undefined, value);
    };
    const exit = () => finish(new Error('Exited before IPC acknowledgment'));
    function finish(error?: Error, value?: Record<string, any>) {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exit);
      error ? no(error) : yes(value!);
    }
    child.on('message', receive);
    child.once('exit', exit);
  });
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.send({ type: 'stop' });
  });
}
const call = (id: string, command: unknown): ProviderResponse => ({
  toolCalls: [{ id, name: 'command', arguments: JSON.stringify(command) }],
});

describe('versioned consistent reload', () => {
  it('preserves committed work/reservations/RNG/schedule, aborts a noncooperative provider and rejects late effects', async () => {
    const root = directory();
    const pending = deferred<ProviderResponse>();
    let requests = 0;
    const old = runtime({
      directory: root,
      autoClock: false,
      runner: {
        transport: async () =>
          ++requests === 1
            ? call('committed', { type: 'remember', text: 'before reload' })
            : pending.promise,
        ledgerOptions: { maxTokens: 1_000_000 },
      },
    });
    const citizen = Object.values(old.world.citizens)[0];
    citizen.inventory['food:1'] = 10;
    citizen.inventory['fibre:1'] = 3;
    expect(old.command(citizen.id, { type: 'craft', item: 'axe', tier: 1 }).ok).toBe(true);
    // Let physical work progress without reasoning first, then start exactly one mocked live turn.
    for (const c of Object.values(old.world.citizens)) c.nextReviewTick = 1000;
    old.control({ type: 'step', ticks: 1 });
    const progress = structuredClone(citizen.action);
    old.control({ type: 'mode', mode: 'live' });
    const done = old.runner.startTurn(citizen.id);
    await flush();
    expect(citizen.memories).toContainEqual({ tick: 1, text: 'before reload' });
    expect(old.runner.budget().pending).toBe(1);
    old.control({ type: 'play' });
    const cp = old.checkpoint(true); // synchronous despite forever-pending provider
    await done;
    expect(old.snapshot().status.thinking).toEqual([]);
    expect(cp.world.citizens[citizen.id].action).toEqual(progress);
    expect(cp.world.citizens[citizen.id].nextReviewTick).toBe(cp.world.tick);
    expect(cp.runtime.running).toBe(true);
    const restored = runtime({
      directory: root,
      restore: true,
      autoClock: false,
      runner: {
        transport: async () => ({ content: 'fresh' }),
        ledgerOptions: { maxTokens: 1_000_000 },
      },
    });
    expect(restored.world).toEqual(cp.world);
    expect(restored.snapshot().status).toMatchObject({ running: true, mode: 'live' });
    expect(restored.runner.budget().pending).toBe(1);
    pending.resolve(call('late', { type: 'remember', text: 'must not apply' }));
    await flush();
    expect(old.world.citizens[citizen.id].memories.map((m) => m.text)).toEqual(['before reload']);
    expect(restored.world.citizens[citizen.id].memories.map((m) => m.text)).toEqual([
      'before reload',
    ]);
    restored.control({ type: 'pause' });
    // Complete the preserved craft directly under clock control, preventing planner changes.
    for (const c of Object.values(restored.world.citizens)) c.nextReviewTick = 1000;
    restored.control({ type: 'step', ticks: 20 });
    expect(restored.world.citizens[citizen.id].inventory['axe:1']).toBe(1);
    expect(restored.world.citizens[citizen.id].inventory['fibre:1']).toBeUndefined();
  });
  it('retains paused state and rebases a running clock without outage catchup', async () => {
    vi.useFakeTimers();
    const root = directory();
    const old = runtime({ directory: root });
    for (const c of Object.values(old.world.citizens)) c.nextReviewTick = 10000;
    old.control({ type: 'step', ticks: 2 });
    const tick = old.world.tick;
    old.checkpoint(true);
    old.close();
    vi.advanceTimersByTime(60_000);
    const paused = runtime({ directory: root, restore: true });
    vi.advanceTimersByTime(60_000);
    expect(paused.world.tick).toBe(tick);
    expect(paused.snapshot().status.running).toBe(false);
    paused.control({ type: 'play' });
    paused.checkpoint(true);
    paused.close();
    vi.advanceTimersByTime(60_000);
    const running = runtime({ directory: root, restore: true });
    expect(running.world.tick).toBe(tick);
    vi.advanceTimersByTime(249);
    expect(running.world.tick).toBe(tick);
    vi.advanceTimersByTime(1);
    expect(running.world.tick).toBe(tick + 1);
  });
  it('failed checkpoint retains last recoverable file, pauses old child and allows retry', () => {
    const root = directory();
    let broken = false;
    const old = runtime({
      directory: root,
      autoClock: false,
      checkpointWriter: (path, cp) => {
        if (broken) throw new Error('disk refused');
        saveCheckpoint(path, cp);
      },
    });
    old.checkpoint(false);
    const before = readFileSync(old.checkpointPath, 'utf8');
    old.control({ type: 'play' });
    broken = true;
    expect(() => old.checkpoint(true)).toThrow('disk refused');
    expect(readFileSync(old.checkpointPath, 'utf8')).toBe(before);
    expect(old.snapshot().status).toMatchObject({
      state: 'error',
      running: false,
      error: 'disk refused',
    });
    expect(() => old.control({ type: 'play' })).toThrow();
    broken = false;
    expect(old.checkpoint(true).runtime.running).toBe(true);
  });
  it('refuses incompatible/corrupt restore, including reservations, escrow and identity invariants', () => {
    const root = directory();
    const old = runtime({ directory: root, autoClock: false });
    const cp = old.checkpoint(true);
    for (const mutate of [
      (v: any) => (v.version = 2),
      (v: any) => (v.world.rngState = 0),
      (v: any) => v.world.citizens[Object.keys(v.world.citizens)[0]].gold++,
      (v: any) => (v.world.citizens[Object.keys(v.world.citizens)[0]].inventory['food:1'] = -1),
      (v: any) => (v.world.nextId = 1),
      (v: any) => (v.runtime.speed = Infinity),
    ]) {
      const corrupt = structuredClone(cp);
      mutate(corrupt);
      expect(() => validateCheckpoint(corrupt)).toThrow();
    }
    writeFileSync(old.checkpointPath, '{broken');
    expect(() => runtime({ directory: root, restore: true })).toThrow();
    expect(readFileSync(old.checkpointPath, 'utf8')).toBe('{broken');
  });
  it('round trips joint reproduction IDs, per-parent reservations and full physical queues', () => {
    const root = directory();
    const old = runtime({ directory: root, autoClock: false });
    const [a, b] = Object.values(old.world.citizens);
    b.x = a.x;
    b.y = a.y;
    a.inventory['food:2'] = 3;
    b.inventory['food:2'] = 3;
    old.command(a.id, { type: 'consent', partnerId: b.id, accept: true });
    old.command(b.id, { type: 'consent', partnerId: a.id, accept: true });
    expect(old.command(a.id, { type: 'reproduce', partnerId: b.id }).ok).toBe(true);
    for (const c of Object.values(old.world.citizens)) c.nextReviewTick = 1000;
    old.control({ type: 'step', ticks: 5 });
    for (let i = 0; i < 12; i++)
      old.command(a.id, { type: 'move', x: a.x, y: a.y, queue: 'append' });
    const cp = old.checkpoint(true);
    expect(cp.world.citizens[a.id].action?.id).toBe(cp.world.citizens[b.id].action?.id);
    const restored = runtime({ directory: root, restore: true, autoClock: false });
    expect(restored.world.citizens[a.id].queue).toHaveLength(12);
    restored.command(a.id, { type: 'cancel' });
    expect(restored.world.citizens[a.id].inventory['food:2']).toBe(3);
    expect(restored.world.citizens[b.id].inventory['food:2']).toBe(3);
    expect(restored.world.citizens[b.id].action).toBeNull();
  });
  it('persists remaining recorded fixtures rather than replaying committed fixture commands', async () => {
    const root = directory();
    const old = runtime({ directory: root, autoClock: false });
    const citizenId = Object.keys(old.world.citizens)[0];
    old.importFixtures([
      {
        citizenId,
        responses: [call('first', { type: 'remember', text: 'once' }), { content: 'done' }],
      },
      { citizenId, responses: [{ content: 'second' }] },
    ]);
    await old.runner.startTurn(citizenId);
    const cp = old.checkpoint(true);
    expect(cp.runtime.recorded).toHaveLength(1);
    const restored = runtime({ directory: root, restore: true, autoClock: false });
    await restored.runner.startTurn(citizenId);
    expect(restored.runner.records()[0].response).toBe('second');
    expect(restored.world.citizens[citizenId].memories.map((m) => m.text)).toEqual(['once']);
    expect(loadCheckpoint(old.checkpointPath).world.tick).toBe(old.world.tick);
  });
});

describe('real source-only child IPC', () => {
  it('acknowledges checkpoint before replacement, restores twice and visibly refuses a corrupt checkpoint', async () => {
    const root = directory();
    const children: ChildProcess[] = [];
    const launch = async (restore: boolean) => {
      const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/main.ts')], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: {
          ...process.env,
          PROSPER_DATA_DIR: root,
          PROSPER_PORT: '0',
          PROSPER_RESTORE: restore ? '1' : '0',
        },
      });
      children.push(child);
      const ready = await message(child, ['ready', 'failed']);
      return { child, ready };
    };
    try {
      const first = await launch(false);
      expect(first.ready.type).toBe('ready');
      let base = `http://127.0.0.1:${first.ready.port}`;
      const post = async (value: unknown) =>
        (
          await fetch(`${base}/api/control`, { method: 'POST', body: JSON.stringify(value) })
        ).json();
      const initial = await post({ type: 'step', ticks: 3 });
      const prepared = message(first.child, ['prepared', 'prepare-failed']);
      first.child.send({ type: 'prepare', id: 'first' });
      expect((await prepared).type).toBe('prepared');
      expect(loadCheckpoint(join(root, 'checkpoint.json')).world.tick).toBe(3);
      await stop(first.child);
      for (let i = 0; i < 2; i++) {
        const next = await launch(true);
        expect(next.ready.type).toBe('ready');
        base = `http://127.0.0.1:${next.ready.port}`;
        const state = await (await fetch(`${base}/api/state`)).json();
        expect(state.world.runId).toBe(initial.world.runId);
        expect(state.world.tick).toBe(3);
        expect(state.status).toMatchObject({ running: false, mode: 'scripted' });
        const ack = message(next.child, ['prepared', 'prepare-failed']);
        next.child.send({ type: 'prepare', id: `retry-${i}` });
        expect((await ack).type).toBe('prepared');
        await stop(next.child);
      }
      writeFileSync(join(root, 'checkpoint.json'), '{corrupt');
      const failed = await launch(true);
      expect(failed.ready.type).toBe('failed');
      expect(failed.ready.error).toBeTruthy();
      expect(readFileSync(join(root, 'checkpoint.json'), 'utf8')).toBe('{corrupt');
    } finally {
      for (const child of children) await stop(child);
    }
  }, 30000);
});

describe('debounced/coalesced supervisor handoff', () => {
  it('never kills on checkpoint failure, retries repeated saves, and restores after broken new startup', async () => {
    let brokenCheckpoint = true;
    let brokenStart = false;
    const events: string[] = [];
    const start = vi.fn(async (restore: boolean): Promise<Backend> => {
      events.push(`start:${restore}`);
      if (brokenStart) throw new Error('syntax error');
      return {
        prepare: async () => {
          events.push('prepare');
          if (brokenCheckpoint) throw new Error('disk full');
        },
        stop: async () => {
          events.push('stop');
        },
      };
    });
    const status = vi.fn();
    const reload = new ReloadCoordinator({ start, status });
    await reload.initialize(false);
    await reload.request();
    expect(events).toEqual(['start:false', 'prepare']);
    expect(status).toHaveBeenLastCalledWith('error', 'disk full');
    brokenCheckpoint = false;
    brokenStart = true;
    await reload.request();
    expect(events.slice(-3)).toEqual(['prepare', 'stop', 'start:true']);
    expect(status).toHaveBeenLastCalledWith('error', 'syntax error');
    brokenStart = false;
    await reload.request();
    expect(events.at(-1)).toBe('start:true');
    expect(status).toHaveBeenLastCalledWith('ready');
    await reload.close();
  });
  it('recovers an unexpectedly exited child only from an acknowledged checkpoint', async () => {
    let alive = true;
    const events: string[] = [];
    const reload = new ReloadCoordinator({
      status: () => {},
      start: async (restore) => {
        events.push(`start:${restore}`);
        alive = true;
        return {
          alive: () => alive,
          prepare: async () => {
            events.push('prepare');
          },
          stop: async () => {
            events.push('stop');
          },
        };
      },
    });
    await reload.initialize(false);
    await reload.request();
    alive = false;
    await reload.request();
    expect(events).toEqual(['start:false', 'prepare', 'stop', 'start:true', 'start:true']);
    await reload.close();
  });
  it('never silently resets after a child dies without any checkpoint, even on repeated retry', async () => {
    let alive = true;
    const start = vi.fn(async () => ({
      alive: () => alive,
      prepare: async () => {},
      stop: async () => {},
    }));
    const status = vi.fn();
    const reload = new ReloadCoordinator({ start, status });
    await reload.initialize(false);
    alive = false;
    await reload.request();
    await reload.request();
    expect(start).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith('error', expect.stringContaining('refusing'));
    await reload.close();
  });
  it('serializes a restart requested during initial startup', async () => {
    const gate = deferred<void>();
    let starts = 0;
    const events: string[] = [];
    const reload = new ReloadCoordinator({
      status: () => {},
      start: async (restore) => {
        events.push(`start:${restore}`);
        if (++starts === 1) await gate.promise;
        return {
          prepare: async () => {
            events.push('prepare');
          },
          stop: async () => {
            events.push('stop');
          },
        };
      },
    });
    const initial = reload.initialize(false);
    const retry = reload.request();
    expect(events).toEqual(['start:false']);
    gate.resolve();
    await initial;
    await retry;
    expect(events).toEqual(['start:false', 'prepare', 'stop', 'start:true']);
    await reload.close();
  });
  it('coalesces simultaneous saves and performs one more handoff when edits land during restart', async () => {
    const gate = deferred<void>();
    const events: string[] = [];
    let starts = 0;
    const reload = new ReloadCoordinator({
      status: () => {},
      start: async () => {
        events.push('start');
        starts++;
        if (starts === 2) await gate.promise;
        return {
          prepare: async () => {
            events.push('prepare');
          },
          stop: async () => {
            events.push('stop');
          },
        };
      },
    });
    await reload.initialize(false);
    const first = reload.request();
    await flush();
    const second = reload.request();
    const third = reload.request();
    expect(second).toBe(first);
    expect(third).toBe(first);
    gate.resolve();
    await first;
    expect(events).toEqual(['start', 'prepare', 'stop', 'start', 'prepare', 'stop', 'start']);
    await reload.close();
  });
});
