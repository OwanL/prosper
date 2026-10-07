import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAgentPlanner } from './lib/agent-planner.mjs';
import { createRuntimePlanner } from './lib/runtime-planner.mjs';
import { createSimulation } from './lib/simulation.mjs';
import { createRuntimeBudget } from './lib/budget.mjs';
import { createAudit } from './lib/audit.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) throw new Error('Request is too large.');
    body += chunk;
  }
  try { return JSON.parse(body); } catch { throw new Error('Expected a JSON control request.'); }
}

export function createApp({ planner = createAgentPlanner(), autoTick = true } = {}) {
  const simulation = createSimulation(planner);
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, simulation.state);
    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true });
    if (req.method === 'POST' && pathname === '/api/control') {
      // Browser controls are same-origin. No cookies or credentials are needed by this loopback-only app.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        return json(res, 403, { error: 'Controls require the same origin.' });
      }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
        return json(res, 415, { error: 'Use application/json.' });
      }
      try {
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a control object.');
        return json(res, 200, simulation.control(body.action, body.speed));
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }
    const asset = assets.get(pathname);
    if (req.method === 'GET' && asset) {
      try {
        const content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
        return res.end(content);
      } catch {
        return json(res, 500, { error: 'Could not load the interface.' });
      }
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    return json(res, 404, { error: 'Not found.' });
  });
  let last = performance.now();
  const timer = autoTick ? setInterval(() => {
    const now = performance.now();
    simulation.advance((now - last) / 1000);
    last = now;
  }, 200) : null;
  server.on('close', () => { clearInterval(timer); simulation.close(); });
  return { server, simulation };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535.');
  const planner = createRuntimePlanner({
    budget: createRuntimeBudget({ filePath: fileURLToPath(new URL('./.prosper/usage.json', import.meta.url)) }),
    audit: createAudit({ filePath: fileURLToPath(new URL('./.prosper/audit.jsonl', import.meta.url)) }),
  });
  const { server, simulation } = createApp({ planner });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set PORT to another local port.` : 'Could not start the local server.');
    simulation.close();
    server.close();
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Prosper citizen spike: http://127.0.0.1:${port}`);
    console.log(`Model: ${planner.model} (${planner.providerName ?? 'Ollama'}). Starts paused.`);
    void simulation.check();
  });
  const shutdown = () => { simulation.close(); server.close(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
