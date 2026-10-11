import { test, expect, type Page } from '@playwright/test';
import { spectatorFixture, type AuthoritativeFixture as AppSnapshot } from './fixture';
import { createWorld } from '../../src/world/core';

function fixture(): AppSnapshot {
  const world = createWorld({ seed: 19, runId: 'offline-speech-motion', population: 5 });
  world.tick = 100;
  const citizens = Object.values(world.citizens);
  citizens.forEach(c => { c.x = Math.floor(world.width / 2); c.y = Math.floor(world.height / 2); c.action = null; });
  world.messages = citizens.map((c, i) => ({ id: `speech-${i}`, from: c.id, tick: 100, text: i === 0 ? 'Short.' : `${i}: <b>not markup</b> ${'A longer public announcement. '.repeat(18)}` }));
  return { world, status: { decisionTreeDebug: false, state: 'ready', running: false, speed: 1, mode: 'scripted', generation: 1, thinking: [] }, budget: { requests: 0, limit: 100, pending: 0, spent: 0, tokens: 0, maxTokens: 100000, unit: 'requests' }, turns: [] };
}
async function offline(page: Page, snapshot: AppSnapshot) {
  const mutations: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/state') {
      await route.fulfill({ json: spectatorFixture(snapshot) });
    } else if (request.method() === 'GET' && path === '/api/history/global') {
      await route.fulfill({ json: { runId: snapshot.world.runId, tick: snapshot.world.tick, startedTick: 0, cadence: 20, limit: 256, frames: [] } });
    } else if (request.method() === 'GET' && path === '/api/motion') {
      await route.fulfill({ status: 501, body: 'Offline motion stream unavailable' });
    } else {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.fulfill({ status: 501, body: 'Offline fixture only' });
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-run-id', snapshot.world.runId);
  // Selection must use a real citizen, not an obsolete implicit default selection.
  await page.getByTestId(`citizen-${Object.values(snapshot.world.citizens)[0].id}`).focus();
  await page.keyboard.press('Enter');
  return mutations;
}

async function assertSpeechGeometry(page: Page, snapshot: AppSnapshot) {
  const bubbles = page.locator('.speech-overlay-entry:not([hidden])');
  await expect(bubbles.first()).toBeVisible();
  const geometry = await bubbles.evaluateAll(nodes => {
    const map = document.querySelector('.world-scene')!.getBoundingClientRect();
    return nodes.map(node => {
      const box = node.getBoundingClientRect();
      const button = node.querySelector<HTMLButtonElement>('button')!;
      const pane = node.querySelector<HTMLElement>('.map-speech-preview')!;
      const style = getComputedStyle(pane);
      pane.scrollTop = pane.scrollHeight;
      const scrollable = pane.scrollHeight <= pane.clientHeight + 1 || pane.scrollTop > 0;
      pane.scrollTop = 0;
      return {
        x: box.x, y: box.y, right: box.right, bottom: box.bottom,
        fits: box.left >= Math.max(0, map.left) && box.right <= Math.min(innerWidth, map.right) && box.top >= Math.max(0, map.top) && box.bottom <= Math.min(innerHeight, map.bottom),
        buttonFits: button.getBoundingClientRect().bottom <= box.bottom + 1,
        text: pane.textContent, speaker: (node as HTMLElement).dataset.speaker,
        clamp: style.webkitLineClamp, overflow: style.overflowY, ellipsis: style.textOverflow,
        whitespace: style.whiteSpace, wraps: style.overflowWrap,
        horizontalFits: pane.scrollWidth <= pane.clientWidth + 1,
        scrollable, needsScroll: pane.scrollHeight > pane.clientHeight + 1,
        animation: getComputedStyle(node).animationName,
      };
    });
  });
  expect(geometry.length).toBeGreaterThan(0);
  expect(geometry.length).toBeLessThanOrEqual(3);
  for (const [i, rect] of geometry.entries()) {
    expect(rect.fits).toBe(true);
    expect(rect.buttonFits).toBe(true);
    expect(rect.text).toBe(snapshot.world.messages.find(message => message.from === rect.speaker)!.text);
    expect(rect.clamp).toBe('none');
    expect(rect.ellipsis).toBe('clip');
    expect(rect.overflow).toBe('auto');
    expect(rect.whitespace).toBe('pre-wrap');
    expect(rect.wraps).toBe('anywhere');
    expect(rect.horizontalFits).toBe(true);
    expect(rect.scrollable).toBe(true);
    for (const other of geometry.slice(i + 1)) {
      expect(rect.right <= other.x || other.right <= rect.x || rect.bottom <= other.y || other.bottom <= rect.y).toBe(true);
    }
  }
  return geometry;
}

test('speech fits text, stays above the scene, expires paused and never replays', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const snapshot = fixture();
  const mutations = await offline(page, snapshot);
  await expect(page.locator('.map-speech-button')).toHaveCount(3);
  const short = page.locator('.map-speech-button').filter({ hasText: 'Short.' });
  await expect(short).toHaveCount(1); // selected speaker takes priority over the crowd
  await expect(page.locator('svg .map-speech-button')).toHaveCount(0);
  await expect(page.locator('.map-speech-button b')).toHaveCount(0);
  await assertSpeechGeometry(page, snapshot);
  await page.screenshot({ path: testInfo.outputPath('desktop-speech.png') });
  const sizes = await page.locator('.speech-overlay-entry:not([hidden]) .map-speech-button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
  expect(sizes[0]).toBeLessThan(100); // short content stays natural, not forced to the height cap
  if (sizes.length > 1) expect(Math.min(...sizes)).toBeLessThan(Math.max(...sizes));
  await short.focus();
  await expect(page.getByRole('tooltip')).toContainText('Short.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.locator('.map-speech-button')).toHaveCount(0, { timeout: 7000 });
  await page.waitForTimeout(900); // more identical polls cannot resurrect messages
  await expect(page.locator('.map-speech-button')).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test('mobile reduced motion speech stays inside map bounds without blocking the toolbar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const snapshot = fixture();
  const mutations = await offline(page, snapshot);
  await expect(page.locator('.map-speech-button')).toHaveCount(3);
  // Mobile opens directly on the world rather than scrolling past a dashboard.
  const geometry = await assertSpeechGeometry(page, snapshot);
  expect(geometry.every(rect => rect.animation === 'none')).toBe(true);
  await expect(page.locator('.speech-overlay-entry:not([hidden])').filter({ hasText: 'Short.' })).toHaveCount(1);
  // A crowded map must omit lower priority speech rather than drawing a fallback overlap.
  expect(geometry.length).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath('mobile-speech.png') });
  // Repeated geometry notifications must not alternate hidden zero-size measurements.
  const visibleCount = geometry.length;
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize')); });
  await expect(page.locator('.speech-overlay-entry:not([hidden])')).toHaveCount(visibleCount);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Workspace view' });
  await nav.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(page.getByTestId('world-scene')).toBeHidden();
  await expect(page.locator('.speech-overlay-entry:not([hidden])')).toHaveCount(0);
  // Hidden map intersections must not pin speech over drawer controls.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(page.locator('.speech-overlay-entry:not([hidden])')).toHaveCount(0);
  expect(mutations).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
test(`a prioritized long message has complete escaped scrollable text within the ${viewport.width}px map`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const snapshot = fixture();
  snapshot.world.messages[0].text = `<b>escaped</b>\n${'UnbrokenAnnouncement'.repeat(40)}\n${snapshot.world.messages[1].text}`;
  const mutations = await offline(page, snapshot);
  await page.locator('.world-scene').scrollIntoViewIfNeeded();
  const geometry = await assertSpeechGeometry(page, snapshot);
  expect(geometry.some(rect => rect.needsScroll)).toBe(true);
  await expect(page.locator('.map-speech-button b')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('long-speech.png') });
  expect(mutations).toEqual([]);
});
}

test('slow confirmed movement keeps follow camera and sprite on the same RAF frame', async ({ page }) => {
  const snapshot = fixture();
  snapshot.status.running = true;
  snapshot.world.messages = [];
  const mutations = await offline(page, snapshot);
  const citizen = Object.values(snapshot.world.citizens)[0];
  await page.getByText('View', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Follow selected', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Follow selected', exact: true })).toBeChecked();
  await page.locator('details').filter({ has: page.getByText('View', { exact: true }) }).evaluateAll(nodes => nodes.forEach(node => node.removeAttribute('open')));
  const sprite = page.getByTestId(`citizen-${citizen.id}`);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  // Hold the next state reply past the old hook's 2-second hard-snap cutoff.
  let moved = false;
  await page.route('**/api/state', async route => {
    if (!moved) {
      moved = true;
      await new Promise(resolve => setTimeout(resolve, 2300));
      citizen.x += 1;
      snapshot.world.tick++;
    }
    await route.fulfill({ json: spectatorFixture(snapshot) });
  });
  await expect(sprite).toHaveAttribute('data-moving', 'true', { timeout: 6000 });
  const samples = await sprite.evaluate(async element => {
    const group = element as SVGGElement;
    const svg = group.ownerSVGElement!;
    const result: { x: number; delta: number }[] = [];
    // Span subsequent identical polls as well as animation frames: a React
    // snapshot commit must not reset the presentation camera to the grid target.
    for (let i = 0; i < 60; i++) {
      await new Promise(requestAnimationFrame);
      const point = new DOMPoint(0, 0).matrixTransform(group.getScreenCTM()!);
      const camera = svg.viewBox.baseVal;
      const center = new DOMPoint(camera.x + camera.width / 2, camera.y + camera.height / 2).matrixTransform(svg.getScreenCTM()!);
      result.push({ x: new DOMMatrix(getComputedStyle(element).transform).e, delta: Math.abs(point.x - center.x) });
    }
    return result;
  });
  expect(samples.at(-1)!.x).toBeGreaterThan(samples[0].x);
  expect(Math.max(...samples.map(sample => sample.delta))).toBeLessThan(1);
  expect(mutations).toEqual([]);
});
