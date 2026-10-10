import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppSnapshot } from '../../src/shared/types';

const visualDirectory = join(tmpdir(), 'prosper-browser-visual');
async function ready(page: Page) {
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-app-state', 'ready');
  await expect(page.getByTestId('planner-mode')).toContainText('Local AI');
}
async function screenshot(page: Page, name: string) {
  mkdirSync(visualDirectory, { recursive: true });
  await page.screenshot({ path: join(visualDirectory, `${name}.png`), animations: 'disabled' });
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'World settings', exact: true }).click();
}
async function back(page: Page) {
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
}
async function clickControl(page: Page, name: string) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/control') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name, exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(200);
  const snapshot = (await r.json()) as AppSnapshot;
  expect(snapshot.status.state).toBe('ready');
  expect(snapshot.status.mode).toBe('scripted');
  if (snapshot.status.running) {
    // Polling may already show a later committed tick after Play returns.
    await expect
      .poll(async () => Number(await page.getByTestId('prosper-app').getAttribute('data-tick')))
      .toBeGreaterThanOrEqual(snapshot.world.tick);
  } else {
    await expect(page.getByTestId('prosper-app')).toHaveAttribute(
      'data-tick',
      String(snapshot.world.tick),
    );
  }
  return snapshot;
}

test('population control creates a hundred autonomous citizens without changing spending', async ({
  page,
  request,
}) => {
  await request.post('/api/control', {
    data: { type: 'scenario', scenario: 'village', population: 6 },
  });
  await page.goto('/');
  await ready(page);
  const before = (await (await request.get('/api/state')).json()) as AppSnapshot;
  await settings(page);
  await page.getByLabel('Founding population', { exact: true }).fill('100');
  page.once('dialog', (dialog) => dialog.accept());
  const after = await clickControl(page, 'Reset world');
  expect(Object.keys(after.world.citizens)).toHaveLength(100);
  expect(Object.values(after.world.citizens).every((citizen) => !!citizen.autonomy)).toBe(true);
  expect(after.budget.requests).toBe(before.budget.requests);
  expect(after.budget.tokens).toBe(before.budget.tokens);
  expect(after.budget.limit).toBe(before.budget.limit);
  expect(after.budget.maxTokens).toBe(before.budget.maxTokens);
  expect(after.status.running).toBe(false);
  await back(page);
  await expect(page.getByRole('region', { name: 'World workspace', exact: true })).toContainText(
    '100 living citizens',
  );
  await request.post('/api/control', {
    data: { type: 'scenario', scenario: 'village', population: 6 },
  });
});

test('scripted world: inspector, clock controls, knowledge, camera, refresh and coordinated reconnect', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await request.post('/api/control', {
    data: { type: 'scenario', scenario: 'village', population: 6 },
  });
  await page.goto('/');
  await ready(page);
  await expect(page.getByTestId('connection-status')).toHaveText('Paused');
  const initial = (await (await request.get('/api/state')).json()) as AppSnapshot;
  expect(initial.status.running).toBe(false);
  const [citizen, other] = Object.values(initial.world.citizens);
  const app = page.getByTestId('prosper-app');
  await expect(app).toHaveAttribute('data-run-id', initial.world.runId);
  await screenshot(page, 'initial');

  await page.getByTestId(`citizen-${citizen.id}`).click();
  const inspector = page.getByTestId('citizen-inspector');
  await expect(inspector).toHaveAttribute('data-citizen-id', citizen.id);
  await expect(inspector.getByRole('heading', { name: citizen.name, exact: true })).toBeVisible();
  await expect(inspector.getByText('Physical work', { exact: true })).toBeVisible();
  // SVG focus outlines use world-space units: a 3px HTML outline obscures several tiles.
  await page.getByTestId(`citizen-${citizen.id}`).focus();
  expect(
    await page
      .getByTestId(`citizen-${citizen.id}`)
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe('none');
  await screenshot(page, 'selected');

  await settings(page);
  const stepped = await clickControl(page, 'Step one tick');
  expect(stepped.world.tick).toBe(initial.world.tick + 1);
  await expect(page.getByTestId('connection-status')).toHaveText('Paused');
  const played = await clickControl(page, '▶ Play');
  expect(played.status.running).toBe(true);
  await expect(page.getByTestId('connection-status')).toHaveText('Running');
  await expect(page.getByRole('button', { name: 'Step one tick', exact: true })).toBeDisabled();
  await expect
    .poll(async () => Number(await app.getAttribute('data-tick')))
    .toBeGreaterThan(played.world.tick);
  const paused = await clickControl(page, 'Ⅱ Pause');
  expect(paused.status.running).toBe(false);
  await expect(page.getByTestId('connection-status')).toHaveText('Paused');
  await back(page);
  await page.getByRole('button', { name: `Inspect ${citizen.name}`, exact: true }).click();
  await expect(inspector.locator('.meter-label').filter({ hasText: 'Fullness' })).not.toContainText(
    /\d\.\d{3}/,
  );
  await screenshot(page, 'activity');

  await settings(page);
  await page.getByRole('checkbox', { name: 'Citizen knowledge', exact: true }).check();
  await back(page);
  await expect(page.getByText(`Perspective · ${citizen.name}`, { exact: true })).toBeVisible();
  await expect(page.getByTestId('spectator-terrain')).toHaveCount(0);
  await page.getByRole('button', { name: 'World charts', exact: true }).click();
  await expect(
    page.getByText('Global analytics are hidden in citizen knowledge view.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveCount(0);
  await settings(page);
  await page.getByRole('button', { name: 'Open diagnostics', exact: true }).click();
  await expect(page.getByText('Diagnostics are hidden in citizen knowledge view.')).toBeVisible();
  await expect(page.getByText('Exact observation / request', { exact: true })).toHaveCount(0);
  await back(page);
  await page.getByRole('button', { name: `Inspect ${citizen.name}`, exact: true }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(
    page.getByText('Private historical graphs are hidden in citizen knowledge view.'),
  ).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Now', exact: true }).click();
  await expect(inspector).toHaveAttribute('data-citizen-id', citizen.id);
  await screenshot(page, 'knowledge');
  await settings(page);
  await page.getByRole('checkbox', { name: 'Citizen knowledge', exact: true }).uncheck();
  await back(page);
  await expect(page.getByText('6 living citizens', { exact: true })).toBeVisible();
  await expect(page.getByTestId('spectator-terrain')).toBeVisible();

  const scene = page.getByTestId('world-scene');
  const fit = await scene.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(scene).not.toHaveAttribute('viewBox', fit!);
  const zoomed = await scene.getAttribute('viewBox');
  const box = (await scene.boundingBox())!;
  // Drag from the SVG's empty letterbox, not an entity.
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(scene).not.toHaveAttribute('viewBox', zoomed!);
  await page.getByRole('button', { name: 'Reset map view', exact: true }).click();
  await expect(scene).toHaveAttribute('viewBox', fit!);
  await page.getByRole('button', { name: 'Citizens', exact: true }).click();
  await page
    .getByRole('region', { name: 'Citizen roster', exact: true })
    .getByRole('button')
    .filter({ hasText: other.name })
    .click();
  await expect(inspector).toHaveAttribute('data-citizen-id', other.id);
  await page.getByRole('button', { name: 'Follow on map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop following', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // At fit zoom the whole map remains visible; zoom to observe the clamped follow center.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(scene).not.toHaveAttribute('viewBox', fit!);
  const followState = (await (await request.get('/api/state')).json()) as AppSnapshot;
  const tracked = followState.world.citizens[other.id];
  const [viewX, viewY, viewWidth, viewHeight] = (await scene.getAttribute('viewBox'))!
    .split(/\s+/)
    .map(Number);
  const clamp = (value: number, size: number, mapSize: number) =>
    size >= mapSize ? mapSize / 2 : Math.max(size / 2, Math.min(mapSize - size / 2, value));
  expect(viewX + viewWidth / 2).toBeCloseTo(
    clamp(tracked.x + 0.5, viewWidth, followState.world.width),
    1,
  );
  expect(viewY + viewHeight / 2).toBeCloseTo(
    clamp(followState.world.height - tracked.y - 0.5, viewHeight, followState.world.height),
    1,
  );
  await page.reload();
  await ready(page);
  // Selection is remembered, but panels start closed and following is intentionally transient.
  await expect(inspector).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Citizen details', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Inspect ${other.name}`, exact: true }).click();
  await expect(inspector).toHaveAttribute('data-citizen-id', other.id);
  await expect(page.getByRole('button', { name: 'Follow on map', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(app).toHaveAttribute('data-run-id', paused.world.runId);
  await expect(app).toHaveAttribute('data-tick', String(paused.world.tick));
  await settings(page);

  // Force a brief browser transport outage (no world/API payload mocking), then recover.
  await page.route('**/api/state', (route) => route.abort('connectionrefused'));
  await expect(app).toHaveAttribute('data-app-state', 'reconnecting');
  await expect(page.getByTestId('connection-status')).toHaveText('Reconnecting');
  await expect(
    page.getByText('Connection unavailable. The last received world is retained.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Step one tick', exact: true })).toBeDisabled();
  await expect(app).toHaveAttribute('data-tick', String(paused.world.tick));
  await page.unroute('**/api/state');
  await ready(page);
  await expect(page.getByRole('button', { name: 'Step one tick', exact: true })).toBeEnabled();
  await back(page);
  await page.getByRole('button', { name: `Inspect ${other.name}`, exact: true }).click();
  const before = (await (await request.get('/api/state')).json()) as AppSnapshot;
  const restart = await request.post('/api/reload', { data: { action: 'restart' } });
  expect(restart.status()).toBe(202);
  expect(await restart.json()).toEqual({ state: 'reloading' });
  await expect
    .poll(async () => {
      const s = (await (await request.get('/api/state')).json()) as AppSnapshot;
      return s.status.state;
    })
    .toBe('ready');
  const restored = (await (await request.get('/api/state')).json()) as AppSnapshot;
  expect(restored.world).toEqual(before.world);
  expect(restored.status.running).toBe(false);
  expect(restored.budget).toEqual(before.budget);
  await ready(page);
  await expect(app).toHaveAttribute('data-run-id', before.world.runId);
  await expect(app).toHaveAttribute('data-tick', String(before.world.tick));
  await expect(inspector).toHaveAttribute('data-citizen-id', other.id);
  await expect(page.getByTestId('connection-status')).toHaveText('Paused');
  await screenshot(page, 'restored');
  expect(errors).toEqual([]);
});
