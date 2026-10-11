import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { AppSnapshot, World } from '../../src/shared/types';
import { projectSpectatorWorld } from '../../src/server/snapshot';

// Optional visual acceptance against genuine offline simulation output. This suite
// displays retained world state unchanged and never starts a simulation or provider.
const paths = (process.env.PROSPER_UI_REAL_SNAPSHOTS ?? '').split('|').filter(Boolean);
const screenshots = mkdtempSync(join(tmpdir(), 'prosper-real-offline-ui-evidence-'));

for (const source of paths)
  test(`real offline snapshot ${basename(source)}`, async ({ page }, testInfo) => {
    expect(existsSync(source)).toBe(true);
    const recorded = JSON.parse(readFileSync(source, 'utf8')) as World;
    const world = projectSpectatorWorld(recorded);
    const living = Object.values(world.citizens).filter((citizen) => citizen.alive);
    const snapshot: AppSnapshot = {
      world,
      status: {
        decisionTreeDebug: false,
        state: 'ready',
        running: false,
        speed: 1,
        mode: 'scripted',
        generation: 1,
        thinking: [],
      },
      turns: [],
      budget: {
        requests: 0,
        pending: 0,
        spent: 0,
        limit: 0,
        tokens: 0,
        maxTokens: 0,
        unit: 'requests',
      },
    };
    const unexpected: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      if (
        route.request().method() === 'GET' &&
        new URL(route.request().url()).pathname === '/api/state'
      ) {
        await route.fulfill({ json: snapshot });
        return;
      }
      unexpected.push(`${route.request().method()} ${route.request().url()}`);
      await route.fulfill({ status: 501, body: 'Read-only offline visual acceptance' });
    });
    await page.goto('/');
    await expect(page.locator('.citizen')).toHaveCount(living.length);
    await expect(page.locator('.game-world-summary')).toContainText(
      `${living.length} living citizens`,
    );
    await page.mouse.move(1430, 890);
    await page.keyboard.press('Escape');
    const overview = join(screenshots, `${basename(source, '.json')}-overview.png`);
    await page.screenshot({ path: overview, animations: 'disabled' });
    const selected =
      living.find((citizen) => citizen.action?.command.type === 'attack') ??
      living.find((citizen) => citizen.autonomy?.policy.territory) ??
      living[0]!;
    await page.getByRole('button', { name: 'Citizens', exact: true }).click();
    await page.getByLabel('Find citizens').fill(selected.name);
    await page
      .getByRole('region', { name: 'Citizen roster' })
      .getByRole('button', {
        name: new RegExp(selected.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .first()
      .click();
    await page.getByRole('button', { name: 'Follow on map', exact: true }).click();
    const zooms = world.width > 30 ? 4 : 1;
    for (let index = 0; index < zooms; index++)
      await page.getByLabel('Zoom in', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Show world overview', exact: true }),
    ).toBeVisible();
    await page.mouse.move(1430, 890);
    await page.keyboard.press('Escape');
    const focus = join(screenshots, `${basename(source, '.json')}-focused.png`);
    await page.screenshot({ path: focus, animations: 'disabled' });
    const dimensions = await page.evaluate(() => ({
      w: innerWidth,
      h: innerHeight,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      nodes: document.querySelectorAll('.world-scene *').length,
    }));
    const client = await page.context().newCDPSession(page);
    const heap = await client.send('Runtime.getHeapUsage');
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));
    const frameDelay = await page.evaluate(async () => {
      const began = performance.now();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return performance.now() - began;
    });
    expect(dimensions.sw).toBeLessThanOrEqual(dimensions.w);
    expect(dimensions.sh).toBeLessThanOrEqual(dimensions.h);
    testInfo.annotations.push({
      type: 'real-offline-world-evidence',
      description: JSON.stringify({
        source,
        overview,
        focus,
        tick: world.tick,
        living: living.length,
        svgNodes: dimensions.nodes,
        snapshotBytes,
        browserHeapUsedBytes: heap.usedSize,
        twoFramesMs: frameDelay,
      }),
    });
    console.log(
      JSON.stringify({
        source,
        overview,
        focus,
        tick: world.tick,
        living: living.length,
        svgNodes: dimensions.nodes,
        snapshotBytes,
        browserHeapUsedBytes: heap.usedSize,
        twoFramesMs: frameDelay,
      }),
    );
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
