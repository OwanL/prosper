import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Runtime } from '../src/server/runtime.ts';
import { createApiServer } from '../src/server/http.ts';
import { dataDirectory } from '../src/server/checkpoint.ts';

const directories: string[] = [];
const runtimes: Runtime[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'prosper-server-'));
  directories.push(path);
  return path;
}
async function setup() {
  const root = directory();
  const runtime = new Runtime({ directory: root, autoClock: false });
  runtimes.push(runtime);
  const server = createApiServer({ runtime, dist: root });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const base = `http://127.0.0.1:${address.port}`;
  const get = async (path: string) => (await fetch(`${base}${path}`)).json();
  const post = async (path: string, value: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    return { status: response.status, body: await response.json() };
  };
  return { root, runtime, base, get, post };
}

describe('native browser API', () => {
  it('defaults to paused scripted, controls ticks and serializes validated commands', async () => {
    const { get, post, runtime, root } = await setup();
    expect(await get('/api/health')).toMatchObject({ ready: true, state: 'ready', tick: 0 });
    expect((await get('/api/state')).status).toMatchObject({
      running: false,
      mode: 'scripted',
      speed: 1,
    });
    const citizen = Object.values(runtime.world.citizens)[0];
    const observation = await get(`/api/citizens/${citizen.id}/observation`);
    expect(observation.tick).toBe(0);
    expect(observation.ascii).toContain('@');
    const result = await post('/api/command', {
      citizenId: citizen.id,
      command: { type: 'remember', text: 'durable' },
    });
    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    expect(
      (
        await post('/api/command', {
          citizenId: citizen.id,
          command: { type: 'transfer', citizenId: citizen.id, gold: -1 },
        })
      ).status,
    ).toBe(400);
    expect((await post('/api/control', { type: 'speed', speed: 3 })).body.status.speed).toBe(3);
    expect((await post('/api/control', { type: 'play' })).body.status.running).toBe(true);
    expect((await post('/api/control', { type: 'pause' })).body.status.running).toBe(false);
    expect((await post('/api/control', { type: 'step', ticks: 3 })).body.world.tick).toBe(3);
    expect((await post('/api/control', { type: 'step', ticks: 0 })).status).toBe(400);
    const lines = readFileSync(
      join(root, 'diagnostics', `${encodeURIComponent(runtime.world.runId)}.jsonl`),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines.find((line) => line.type === 'command')).toMatchObject({
      tick: 0,
      order: 1,
      source: 'browser',
      citizenId: citizen.id,
    });
    expect(lines.filter((line) => line.type === 'tick').map((line) => line.tick)).toEqual([
      1, 2, 3,
    ]);
  });
  it('loads named scenarios and imports fixtures only explicitly, never a live fallback', async () => {
    const { get, post, runtime } = await setup();
    expect((await get('/api/scenarios')).scenarios).toContain('progression');
    const oldRun = runtime.world.runId;
    const loaded = await post('/api/control', { type: 'scenario', scenario: 'progression' });
    expect(Object.keys(loaded.body.world.citizens)).toHaveLength(3);
    expect(loaded.body.world.runId).not.toBe(oldRun);
    expect((await post('/api/control', { type: 'mode', mode: 'recorded' })).status).toBe(400);
    const citizenId = Object.keys(runtime.world.citizens)[0];
    const imported = await post('/api/fixtures', {
      turns: [{ citizenId, responses: [{ content: 'fixture only' }] }],
    });
    expect(imported.body.status).toMatchObject({ mode: 'recorded', running: false });
    expect(imported.body.budget.requests).toBe(0);
    await runtime.runner.startTurn(citizenId);
    expect(runtime.runner.records()[0].response).toBe('fixture only');
    await runtime.runner.startTurn(citizenId);
    expect(runtime.runner.records()[1].error).toContain('exhausted');
    expect(runtime.runner.budget().requests).toBe(0);
    expect((await post('/api/fixtures', { path: 'arbitrary.json' })).status).toBe(400);
    expect((await post('/api/control', { type: 'scenario', scenario: 'spike-1' })).status).toBe(
      400,
    );
  });
  it('checkpoints without resetting state and serves a production UI only if present', async () => {
    const { post, get, base, root, runtime } = await setup();
    await post('/api/control', { type: 'play' });
    const checkpoint = await post('/api/control', { type: 'checkpoint' });
    expect(checkpoint.body.status.running).toBe(true);
    expect(JSON.parse(readFileSync(runtime.checkpointPath, 'utf8')).runtime.running).toBe(true);
    writeFileSync(join(root, 'index.html'), '<h1>Production fixture</h1>');
    expect(await (await fetch(base)).text()).toContain('Production fixture');
    const prepare = await post('/api/reload', { action: 'prepare' });
    expect(prepare.body.status).toMatchObject({ state: 'reloading', running: false });
    expect((await get('/api/health')).ready).toBe(false);
    expect((await post('/api/control', { type: 'play' })).status).toBe(503);
  });
  it('forbids the old durable data directory', () => {
    expect(() => dataDirectory('.prosper')).toThrow('legacy');
    expect(() => dataDirectory('.prosper/child')).toThrow('legacy');
  });
});
