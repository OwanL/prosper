import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

async function startApp(t) {
  const planner = {
    model: 'offline-server-test',
    endpoint: 'http://mock.invalid/v1',
    check: async () => {},
    plan: async () => ({
      plan: {
        thought: 'Wait and observe.',
        goals: ['Stay well'],
        memory: '',
        tasks: [{ type: 'wait', ticks: 2 }],
      },
      tokens: 1,
    }),
  };
  const app = createApp({ planner, autoTick: false });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const address = app.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    app.simulation.close();
    await new Promise((resolve) => app.server.close(resolve));
  });
  return { ...app, base };
}

test('HTTP state, health, control, and static routes use the expected protocol', async (t) => {
  const { base } = await startApp(t);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const initialResponse = await fetch(`${base}/api/state`);
  assert.equal(initialResponse.status, 200);
  assert.match(initialResponse.headers.get('content-type'), /application\/json/);
  const initial = await initialResponse.json();
  assert.equal(initial.running, false);
  assert.equal(initial.speed, 1);
  assert.equal(initial.planner.connection, 'unchecked');
  assert.equal(initial.world.citizens.length, 8);

  const speedResponse = await fetch(`${base}/api/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'speed', speed: 3 }),
  });
  assert.equal(speedResponse.status, 200);
  assert.equal((await speedResponse.json()).speed, 3);

  const playResponse = await fetch(`${base}/api/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'play' }),
  });
  assert.equal(playResponse.status, 200);
  assert.equal((await playResponse.json()).running, true);

  const pauseResponse = await fetch(`${base}/api/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'pause' }),
  });
  assert.equal(pauseResponse.status, 200);
  assert.equal((await pauseResponse.json()).running, false);

  for (const [path, contentType] of [
    ['/', /text\/html/],
    ['/app.js', /text\/javascript/],
    ['/style.css', /text\/css/],
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `${path} should be served`);
    assert.match(response.headers.get('content-type'), contentType);
    assert.ok((await response.text()).length > 0);
  }
});

test('HTTP control rejects invalid origin, content type, JSON, and actions', async (t) => {
  const { base } = await startApp(t);
  const control = `${base}/api/control`;

  const wrongOrigin = await fetch(control, {
    method: 'POST',
    headers: { origin: 'http://attacker.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'pause' }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.match((await wrongOrigin.json()).error, /same origin/);

  const wrongContentType = await fetch(control, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{"action":"pause"}',
  });
  assert.equal(wrongContentType.status, 415);
  assert.match((await wrongContentType.json()).error, /application\/json/);

  const malformedJson = await fetch(control, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
  assert.equal(malformedJson.status, 400);
  assert.match((await malformedJson.json()).error, /Expected a JSON control request/);

  const invalidAction = await fetch(control, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start-everything' }),
  });
  assert.equal(invalidAction.status, 400);
  assert.match((await invalidAction.json()).error, /Unknown control action/);
});

test('HTTP server does not expose repository or secret files', async (t) => {
  const { base } = await startApp(t);
  for (const path of [
    '/package.json',
    '/README.md',
    '/server.mjs',
    '/lib/planner.mjs',
    '/test/server.test.mjs',
    '/.env',
    '/.git/config',
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, `${path} must not be exposed`);
    const payload = await response.json();
    assert.deepEqual(payload, { error: 'Not found.' });
  }
});
