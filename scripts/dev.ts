import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import chokidar from 'chokidar';
import { dataDirectory } from '../src/server/checkpoint.ts';
import { ReloadCoordinator, type Backend } from './reload.ts';
import type { AppSnapshot } from '../src/shared/types.ts';

const directory = dataDirectory();
let state: 'ready' | 'reloading' | 'error' = 'reloading';
let error: string | undefined;
let last: AppSnapshot | undefined;
let stopping = false;
let watcher: ReturnType<typeof chokidar.watch> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
function waitMessage(
  child: ChildProcess,
  accept: (value: Record<string, unknown>) => boolean,
  timeout = 10000,
): Promise<Record<string, unknown>> {
  return new Promise((yes, no) => {
    const timer = setTimeout(
      () => finish(new Error('Backend handshake timed out; checkpoint retained.')),
      timeout,
    );
    const message = (raw: unknown) => {
      if (raw && typeof raw === 'object' && accept(raw as Record<string, unknown>))
        finish(undefined, raw as Record<string, unknown>);
    };
    const exit = () => finish(new Error('Backend exited before handshake; checkpoint retained.'));
    const failure = (e: Error) => finish(e);
    function finish(e?: Error, value?: Record<string, unknown>) {
      clearTimeout(timer);
      child.off('message', message);
      child.off('exit', exit);
      child.off('error', failure);
      if (e) no(e);
      else yes(value!);
    }
    child.on('message', message);
    child.once('exit', exit);
    child.once('error', failure);
  });
}
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.connected) child.send({ type: 'stop' });
    else child.kill('SIGTERM');
  });
}
const coordinator = new ReloadCoordinator({
  status(next, message) {
    state = next;
    error = message;
    console.log(`[backend ${next}]${message ? ` ${message}` : ''}`);
  },
  async start(restore): Promise<Backend> {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/main.ts')], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        PROSPER_PORT: '4312',
        PROSPER_DATA_DIR: directory,
        PROSPER_RESTORE: restore ? '1' : '0',
      },
    });
    try {
      const reply = await waitMessage(child, (m) => m.type === 'ready' || m.type === 'failed');
      if (reply.type === 'failed') throw new Error(String(reply.error));
    } catch (e) {
      await stopChild(child);
      throw e;
    }
    child.once('exit', () => {
      if (!stopping && state === 'ready') {
        state = 'error';
        error =
          'Backend exited unexpectedly. Save backend source to retry from the last checkpoint.';
        console.error(error);
      }
    });
    return {
      alive: () => child.exitCode === null && child.signalCode === null && child.connected,
      async prepare() {
        if (!child.connected)
          throw new Error(
            'Backend unavailable; no checkpoint acknowledgment, child not terminated.',
          );
        const id = randomUUID();
        const pending = waitMessage(
          child,
          (m) => m.id === id && (m.type === 'prepared' || m.type === 'prepare-failed'),
        );
        child.send({ type: 'prepare', id });
        const reply = await pending;
        if (reply.type === 'prepare-failed') throw new Error(String(reply.error));
      },
      stop: () => stopChild(child),
    };
  },
});

// The stable port survives child absence/broken code. Vite's existing /api proxy needs no config changes.
const proxy = createServer((incoming, outgoing) => {
  const pathname = new URL(incoming.url ?? '/', 'http://127.0.0.1').pathname;
  const reply = (status: number, value: unknown) => {
    outgoing.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    outgoing.end(JSON.stringify(value));
  };
  if (pathname === '/api/reload' && incoming.method === 'POST') {
    let text = '';
    incoming.on('data', (chunk) => {
      text += chunk;
      if (text.length > 1000) incoming.destroy();
    });
    incoming.on('end', () => {
      try {
        const command = JSON.parse(text);
        if (command.action !== 'restart' || Object.keys(command).length !== 1)
          throw new Error('Expected {action:"restart"}.');
        void coordinator.request();
        reply(202, { state: 'reloading' });
      } catch (e) {
        reply(400, { error: e instanceof Error ? e.message : String(e) });
      }
    });
    return;
  }
  if (state !== 'ready') {
    if (pathname === '/api/state' && incoming.method === 'GET' && last) {
      reply(200, {
        ...last,
        status: { ...last.status, running: false, thinking: [], state, error },
      });
      return;
    }
    if (pathname === '/api/health' || pathname === '/api/reload') {
      reply(200, { ready: false, state, error });
      return;
    }
    reply(503, { state, error: error ?? 'Backend reloading; last checkpoint retained.' });
    return;
  }
  const request = httpRequest(
    {
      hostname: '127.0.0.1',
      port: 4312,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (response) => {
      if (pathname === '/api/state' && incoming.method === 'GET') {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          try {
            const snapshot = JSON.parse(bytes.toString('utf8')) as AppSnapshot;
            if (snapshot.world && snapshot.status) last = snapshot;
          } catch {
            /* preserve last good snapshot */
          }
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          outgoing.end(bytes);
        });
      } else {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      }
    },
  );
  request.on('error', (e) => {
    state = 'error';
    error = e.message;
    reply(503, { state, error });
  });
  incoming.pipe(request);
});
proxy.listen(4310, '127.0.0.1');
proxy.on('error', (e) => {
  console.error(e);
  void shutdown();
});
const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js')], {
  stdio: 'inherit',
  env: process.env,
});
vite.on('error', (e) => {
  console.error(e);
  void shutdown();
});
vite.once('exit', () => {
  if (!stopping) void shutdown();
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('message', (message) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'stop')
    void shutdown();
});
await coordinator.initialize(existsSync(join(directory, 'checkpoint.json')));

// Only backend-owned source roots. UI/styles, ledger, checkpoints and output never trigger this watcher.
if (!stopping) {
  watcher = chokidar.watch(['src/server', 'src/world', 'src/citizen', 'src/shared'], {
    ignoreInitial: true,
    ignored: /(^|[/\\])(?:node_modules|dist|\.git|\.prosper(?:-v2)?)(?:[/\\]|$)/,
  });
  watcher.on('all', (_event, path) => {
    if (!/\.(?:ts|json)$/.test(path) || stopping) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void coordinator.request();
    }, 150);
  });
  watcher.on('error', (e) => {
    state = 'error';
    error = String(e);
    console.error(e);
  });
  process.send?.({ type: 'ready' });
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (debounce) clearTimeout(debounce);
  await watcher?.close();
  await coordinator.close();
  vite.kill('SIGTERM');
  proxy.closeAllConnections();
  proxy.close(() => {
    if (process.connected) process.disconnect?.();
  });
}
