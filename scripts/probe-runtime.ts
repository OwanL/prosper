import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { Runtime } from '../src/server/runtime.ts';
import { createApiServer } from '../src/server/http.ts';

// Real HTTP, running local controllers, real browser polling. No provider or user data.
const evidence = resolve(
  '.experiments',
  `runtime-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
);
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'prosper-runtime-scale-'));
const runtime = new Runtime({
  directory,
  population: 100,
  runner: { mode: 'scripted', ledgerOptions: { maxRequests: 0, maxTokens: 0 } },
});
const server = createApiServer({ runtime, dist: resolve('dist') });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let closing = false;
try {
  const warmup = performance.now();
  runtime.control({ type: 'step', ticks: 3000 });
  const warmupMs = performance.now() - warmup;
  await new Promise<void>((yes) => server.listen(0, '127.0.0.1', yes));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP address');
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const polls: { tick: number; bytes: number; elapsedMs: number; receivedAt: number }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', async (response) => {
    try {
      if (closing || new URL(response.url()).pathname !== '/api/state') return;
      const start = performance.now();
      const body = await response.body();
      const state = JSON.parse(body.toString());
      polls.push({
        tick: state.world.tick,
        bytes: body.byteLength,
        elapsedMs: performance.now() - start,
        receivedAt: performance.now(),
      });
    } catch (error) {
      // Closing Chrome can cancel a poll whose headers arrived before teardown.
      // Real polling failures during acceptance remain visible in the evidence.
      if (!closing) errors.push(String(error));
    }
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Watch world', exact: true }).click();
  await page.getByLabel('Director camera', { exact: true }).uncheck();
  const stages: unknown[] = [];
  for (const speed of [1, 10, 100]) {
    runtime.control({ type: 'speed', speed });
    runtime.control({ type: 'play' });
    const fromTick = runtime.world.tick,
      fromPoll = polls.length,
      from = performance.now();
    await page.waitForTimeout(7000);
    runtime.control({ type: 'pause' });
    const stagePolls = polls.slice(fromPoll);
    stages.push({
      speed,
      elapsedMs: performance.now() - from,
      fromTick,
      toTick: runtime.world.tick,
      pollCount: stagePolls.length,
      pollTicks: stagePolls.map((p) => p.tick),
      pollBytes: stagePolls.map((p) => p.bytes),
      storyCards: await page.locator('.story-card').count(),
      citizenNodes: await page.locator('.citizen').count(),
      sceneNodes: await page.locator('.world-scene *').count(),
    });
  }
  const first = Object.values(runtime.world.citizens).find((c) => c.alive)!;
  await page.getByTestId(`roster-${first.id}`).click();
  await page.getByLabel('Follow selected', { exact: true }).check();
  for (let i = 0; i < 4; i++) await page.getByLabel('Zoom in', { exact: true }).click();
  await page.screenshot({
    path: join(evidence, 'running-100-focused.png'),
    animations: 'disabled',
  });
  const observation = await fetch(`${base}/api/citizens/${first.id}/observation`).then((r) =>
    r.json(),
  );
  const summary = {
    warmupMs,
    stages,
    polls,
    errors,
    finalTick: runtime.world.tick,
    living: Object.values(runtime.world.citizens).filter((c) => c.alive).length,
    providerRequests: runtime.snapshot().budget.requests,
    selectedRememberedTiles: observation.remembered.length,
    finalSnapshotBytes: Buffer.byteLength(JSON.stringify(runtime.snapshot())),
  };
  writeFileSync(join(evidence, 'evidence.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ evidence, ...summary, polls: polls.length }, null, 2));
  if (errors.length || polls.length < 9 || summary.providerRequests !== 0)
    throw new Error('Real runtime browser acceptance failed');
} finally {
  closing = true;
  runtime.close();
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((yes) => server.close(() => yes()));
  rmSync(directory, { recursive: true, force: true });
}
