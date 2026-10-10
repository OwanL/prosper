import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { Runtime } from './runtime.ts';

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Request body exceeds 2MB.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createApiServer(
  options: { runtime?: Runtime; error?: string; dist?: string } = {},
) {
  const dist = resolve(options.dist ?? 'dist');
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (pathname.startsWith('/api/')) {
        const runtime = options.runtime;
        if (
          pathname === '/api/health' ||
          (pathname === '/api/reload' && request.method === 'GET')
        ) {
          const status = runtime?.snapshot().status;
          json(response, 200, {
            ready: status?.state === 'ready',
            state: status?.state ?? 'error',
            error: options.error ?? status?.error,
            runId: runtime?.world.runId,
            tick: runtime?.world.tick,
          });
          return;
        }
        if (!runtime) {
          json(response, 503, {
            state: 'error',
            error: options.error ?? 'Backend unavailable; no world was reset.',
          });
          return;
        }
        if (request.method === 'GET' && pathname === '/api/state') {
          json(response, 200, runtime.snapshot());
          return;
        }
        if (request.method === 'GET' && pathname === '/api/motion') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
          });
          response.flushHeaders();
          const unsubscribe = runtime.subscribeMotion(snapshot => {
            if (response.destroyed || response.writableLength > 256_000) {
              response.destroy();
              return;
            }
            response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
          });
          const heartbeat = setInterval(() => {
            if (!response.destroyed) response.write(': heartbeat\n\n');
          }, 15000);
          heartbeat.unref();
          response.once('close', () => { clearInterval(heartbeat); unsubscribe(); });
          return;
        }
        if (request.method === 'GET' && pathname === '/api/scenarios') {
          json(response, 200, { scenarios: ['village', 'competition', 'progression'] });
          return;
        }
        if (request.method === 'GET' && pathname === '/api/history/global') {
          json(response, 200, runtime.globalHistory());
          return;
        }
        const history = /^\/api\/citizens\/([^/]+)\/history$/.exec(pathname);
        if (request.method === 'GET' && history) {
          const id = decodeURIComponent(history[1]);
          if (!Object.hasOwn(runtime.world.citizens, id)) {
            json(response, 404, { error: 'Unknown citizen.' });
            return;
          }
          json(response, 200, runtime.citizenHistory(id));
          return;
        }
        const observation = /^\/api\/citizens\/([^/]+)\/observation$/.exec(pathname);
        if (request.method === 'GET' && observation) {
          json(response, 200, runtime.observation(decodeURIComponent(observation[1])));
          return;
        }
        if (request.method === 'POST') {
          const value = await body(request);
          if (pathname === '/api/budget') {
            json(response, 200, runtime.updateBudget(value));
            return;
          }
          if (pathname === '/api/control') {
            json(response, 200, runtime.control(value));
            return;
          }
          if (pathname === '/api/command') {
            if (
              !value ||
              typeof value !== 'object' ||
              !('citizenId' in value) ||
              typeof value.citizenId !== 'string' ||
              !('command' in value) ||
              Object.keys(value).some((k) => !['citizenId', 'command'].includes(k))
            )
              throw new Error('Expected {citizenId,command}.');
            json(response, 200, runtime.command(value.citizenId, value.command));
            return;
          }
          if (pathname === '/api/fixtures') {
            if (!value || typeof value !== 'object')
              throw new Error('Expected {turns:[...]} or {configured:true}.');
            if (
              'configured' in value &&
              value.configured === true &&
              Object.keys(value).length === 1
            )
              json(response, 200, runtime.importConfiguredFixtures());
            else if ('turns' in value && Object.keys(value).length === 1)
              json(response, 200, runtime.importFixtures(value.turns));
            else
              throw new Error(
                'Fixture import must be explicit: {turns:[...]} or {configured:true}.',
              );
            return;
          }
          if (pathname === '/api/reload') {
            if (
              !value ||
              typeof value !== 'object' ||
              !('action' in value) ||
              value.action !== 'prepare' ||
              Object.keys(value).length !== 1
            )
              throw new Error('Expected {action:"prepare"}; dev supervisor owns restart/restore.');
            runtime.checkpoint(true);
            json(response, 200, {
              checkpoint: runtime.checkpointPath,
              status: runtime.snapshot().status,
            });
            return;
          }
        }
        json(response, 404, { error: 'Unknown API route.' });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        json(response, 405, { error: 'Method not allowed.' });
        return;
      }
      let file = resolve(dist, `.${decodeURIComponent(pathname)}`);
      if (file !== dist && !file.startsWith(`${dist}${sep}`)) {
        json(response, 403, { error: 'Invalid path.' });
        return;
      }
      if (!existsSync(file) || !statSync(file).isFile()) file = resolve(dist, 'index.html');
      if (!existsSync(file)) {
        json(response, 404, { error: 'No production UI build. Use npm run dev or npm run build.' });
        return;
      }
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      });
      response.end(request.method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      json(response, options.runtime?.snapshot().status.state === 'ready' ? 400 : 503, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
