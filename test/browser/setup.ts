import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Own the dev supervisor via IPC: its stop handshake cleans up backend and Vite, even on Windows. */
export default async function setup() {
  for (const port of [5193, 5190, 5192]) {
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
    env: {
      ...process.env,
      PROSPER_DATA_DIR: directory,
      PROSPER_UI_PORT: '5193',
      PROSPER_API_PORT: '5190',
      PROSPER_BACKEND_PORT: '5192',
    },
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
    // Cold dependency optimization and Windows file scanning can exceed a warm start.
    const deadline = Date.now() + 60000;
    let lastStatus = 'No response received';
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Dev supervisor exited: ${child.exitCode}`);
      try {
        const response = await fetch('http://127.0.0.1:5193/api/state', {
          signal: AbortSignal.timeout(3000),
        });
        const snapshot = await response.json();
        lastStatus = JSON.stringify({
          http: response.status,
          status: snapshot.status,
          error: snapshot.error,
        });
        if (
          response.ok &&
          snapshot.status?.state === 'ready' &&
          snapshot.status.mode === 'scripted'
        )
          return cleanup;
      } catch (error) {
        lastStatus = error instanceof Error ? error.message : String(error);
      }
      await delay(200);
    }
    throw new Error(`Scripted dev server did not become ready: ${lastStatus}`);
  } catch (error) {
    await cleanup();
    throw error;
  }
}
