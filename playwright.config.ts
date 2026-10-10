import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './test/browser',
  // Active game-workspace acceptance. Historical workbench-only suites retain
  // their old layout fixtures; they are not assertions about this replacement UI.
  testMatch: [
    'acceptance.spec.ts',
    'accessibility.spec.ts',
    'game-workspace.spec.ts',
    'history-charts.spec.ts',
    'navigation.spec.ts',
    'continuous-motion.spec.ts',
    'real-scene.spec.ts',
  ],
  globalSetup: './test/browser/setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  outputDir: mkdtempSync(join(tmpdir(), 'prosper-browser-results-')),
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5193',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
