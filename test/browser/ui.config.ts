import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Frontend acceptance runs with every /api route mocked; no backend or durable data is opened.
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 5187;
export default defineConfig({
  testDir: '.',
  testMatch: [
    'game-workspace.spec.ts',
    'history-charts.spec.ts',
    'navigation.spec.ts',
    'continuous-motion.spec.ts',
    'real-scene.spec.ts',
  ],
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  outputDir: mkdtempSync(join(tmpdir(), 'prosper-ui-results-')),
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    cwd: resolve('.'),
    command: `"${process.execPath}" "${resolve('node_modules/vite/bin/vite.js')}" --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
