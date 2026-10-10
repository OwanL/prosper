import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/server/runtime.ts';
import { createApiServer } from '../src/server/http.ts';
import { verifiedLocalModel } from '../src/server/local-model.ts';
import { BALANCE } from '../src/world/config.ts';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

it('only verifies a real installed local model, never a loopback cloud proxy', async () => {
  const mock = (show: unknown, size = 6e9) => (async (url: string | URL | Request) => new Response(JSON.stringify(
    String(url).endsWith('/show') ? show : { models: [{ name: 'qwen3.5:9b', size }] },
  ))) as typeof fetch;
  const info = { details: { format: 'gguf' }, model_info: { 'general.architecture': 'qwen35' } };
  expect(await verifiedLocalModel('qwen3.5:9b', mock(info))).toBe('qwen3.5:9b');
  expect(await verifiedLocalModel('qwen3.5:9b', mock({ ...info, remote_host: 'https://ollama.com' }))).toBeUndefined();
  expect(await verifiedLocalModel('qwen3.5:9b', mock(info, 400))).toBeUndefined();
  expect(await verifiedLocalModel('alias:cloud', mock(info))).toBeUndefined();
});

it('publishes every authoritative step without notebooks or jumping a route corner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-motion-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new Runtime({ directory, autoClock: false, autonomy: false });
  cleanups.push(() => runtime.close());
  const citizen = Object.values(runtime.world.citizens)[0];
  citizen.x = 1; citizen.y = 1;
  citizen.action = {
    id: 'motion-route', command: { type: 'move', x: 2, y: 2 }, phase: 'travel',
    path: [{ x: 2, y: 1 }, { x: 2, y: 2 }], target: { x: 2, y: 2 },
    elapsed: 0, duration: BALANCE.moveTicks, reserved: {}, startedTick: runtime.world.tick,
  };
  const frames: ReturnType<Runtime['motionSnapshot']>[] = [];
  const unsubscribe = runtime.subscribeMotion(frame => frames.push(frame));
  runtime.control({ type: 'step', ticks: BALANCE.moveTicks * 2 });
  unsubscribe();
  const points = frames.map(frame => frame.frames[0].citizens.find(person => person.id === citizen.id)!);
  expect(points.some(point => point.x === 2 && point.y === 1)).toBe(true);
  expect(points.every(point => point.y === 1 || point.x === 2)).toBe(true);
  expect(frames.length).toBeGreaterThanOrEqual(BALANCE.moveTicks * 2 + 1);
  expect(JSON.stringify(frames)).not.toContain('knowledge');
  const count = frames.length;
  runtime.control({ type: 'step' });
  expect(frames).toHaveLength(count);
});

it('streams through HTTP immediately and publishes pause without a full snapshot poll', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-motion-http-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new Runtime({ directory, autoClock: false, autonomy: false });
  cleanups.push(() => runtime.close());
  const server = createApiServer({ runtime });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as { port: number }).port;
  const abort = new AbortController();
  cleanups.push(() => abort.abort());
  const response = await fetch(`http://127.0.0.1:${port}/api/motion`, { signal: abort.signal });
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('"running":false');
  runtime.control({ type: 'play' });
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"running":true');
  runtime.control({ type: 'pause' });
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"running":false');
  await reader.cancel();
});
