// Read-only browser inspection using an existing Playwright installation.
// Example: node scripts/capture-ui.mjs --playwright-module=C:\dev\repos\pie\node_modules\playwright-core\index.mjs --state=<checkpoint.json>
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  return [arg.slice(2, index < 0 ? undefined : index), index < 0 ? true : arg.slice(index + 1)];
}));
if (!options['playwright-module']) throw new Error('Provide --playwright-module=<existing playwright-core index.mjs>. No install is performed.');
const { chromium } = await import(pathToFileURL(resolve(options['playwright-module'])).href);
const base = options.url || 'http://127.0.0.1:4173';
const state = options.state ? JSON.parse(await readFile(resolve(options.state), 'utf8')) : await fetch(`${base}/api/state`).then(r => r.json());
const directory = resolve('.prosper', 'experiments', `browser-check-${randomUUID()}`);
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'state.json'), JSON.stringify(state));
const browser = await chromium.launchPersistentContext(join(directory, 'profile'), {
  executablePath: options.browser || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true, viewport: { width: 1440, height: 1000 },
});
const errors = [], samples = [];
let blockedControls = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/control', route => { blockedControls++; return route.fulfill({ status: 403, body: 'Read-only inspection' }); });
  if (!options.live) await page.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
  await page.goto(base);
  await page.locator('.citizen-row').first().click();
  await page.screenshot({ path: join(directory, 'overview.png') });
  const summary = page.locator('.family-children summary').first();
  const familySummary = await summary.count() ? await summary.textContent() : null;
  let expandedFamilyRetained = null;
  if (familySummary) {
    await summary.click();
    await page.waitForTimeout(800);
    expandedFamilyRetained = await page.locator('.family-children').first().evaluate(node => node.open);
    assert.equal(expandedFamilyRetained, true, 'polling must preserve the expanded family');
    await summary.click();
  }
  const order = await page.locator('.order-detail').textContent();
  const numericLabels = await page.locator('.citizen-avatar[data-numbered="true"]').allTextContents();
  if (options.live) {
    await page.evaluate(() => {
      window.prosperMotionSamples = [];
      let previous = 0;
      const sample = time => {
        if (time - previous > 30) {
          previous = time;
          const board = document.querySelector('#map-board').getBoundingClientRect();
          window.prosperMotionSamples.push({ time, tick: document.querySelector('#tick-label').textContent,
            people: [...document.querySelectorAll('.citizen-marker.is-interpolated')].map(node => ({ id: node.dataset.id, label: node.getAttribute('aria-label'),
              left: node.style.left, top: node.style.top, x: node.getBoundingClientRect().x - board.x, y: node.getBoundingClientRect().y - board.y })) });
        }
        if (window.prosperMotionSamples.length < 600) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.waitForTimeout(10000);
    samples.push(...await page.evaluate(() => window.prosperMotionSamples));
    await writeFile(join(directory, 'motion.json'), JSON.stringify(samples));
    await page.screenshot({ path: join(directory, 'overview-later.png') });
  }
  await page.locator('#citizen-mode').click();
  await page.screenshot({ path: join(directory, 'citizen-view.png') });
  assert.deepEqual(errors, [], 'browser must load without JavaScript errors');
  const result = { directory, tick: state.world.tick, live: Boolean(options.live), errors, mutationsBlocked: true,
    blockedControls, familySummary, expandedFamilyRetained, order, numericLabels, motionSamples: samples.length };
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
