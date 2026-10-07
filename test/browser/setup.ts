import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Own the dev supervisor via IPC: its stop handshake cleans up backend and Vite, even on Windows. */
export default async function setup() {
  for (const port of [5173, 4310, 4312]) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      continue;
    }
    throw new Error(
      `Browser acceptance requires free port ${port}; refusing to reuse a possibly durable run.`,
    );
  }
  const directory = mkdtempSync(join(tmpdir(), 'prosper-browser-data-'));
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/dev.ts')], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, PROSPER_DATA_DIR: directory },
  });
  let failure: Error | undefined;
  child.on('error', (error) => {
    failure = error;
  });
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((yes) => child.once('exit', () => yes()));
      if (child.connected) child.send({ type: 'stop' });
      await Promise.race([exited, delay(8000)]);
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
          });
          await new Promise<void>((yes) => {
            killer.once('exit', () => yes());
            killer.once('error', () => yes());
          });
        } else child.kill('SIGKILL');
        await Promise.race([exited, delay(3000)]);
      }
    }
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Dev supervisor exited: ${child.exitCode}`);
      try {
        const response = await fetch('http://127.0.0.1:5173/api/state', {
          signal: AbortSignal.timeout(1000),
        });
        const snapshot = await response.json();
        if (response.ok && snapshot.status.state === 'ready' && snapshot.status.mode === 'scripted')
          return cleanup;
      } catch {
        /* Starting; bounded by deadline. */
      }
      await delay(100);
    }
    throw new Error('Scripted dev server did not become ready.');
  } catch (error) {
    await cleanup();
    throw error;
  }
}
