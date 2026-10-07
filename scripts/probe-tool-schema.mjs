// Inspect the local provider's rendered tool schema, with accounting even if an
// older server ignores the render-only flag and performs a bounded inference.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MODEL_TOOLS, CITIZEN_TOOLS } from '../lib/citizen-tools.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';

const model = process.env.PROSPER_MODEL || 'glm-5.3-flash:cloud';
const endpoint = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/v1\/?$/, '');
const cells = [
  { name: 'references', tool: MODEL_TOOLS.find(t => t.function.name === 'commit_strategy') },
  { name: 'expanded', tool: CITIZEN_TOOLS.find(t => t.function.name === 'commit_strategy') },
];
if (!process.argv.includes('--live')) {
  console.log(JSON.stringify({ dryRun: true, model, endpoint, cells: cells.map(c => ({ name: c.name, bytes: JSON.stringify(c.tool).length })) }));
  process.exit(0);
}
const directory = resolve('.prosper/experiments', `schema-render-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const budget = createRuntimeBudget({ filePath: resolve('.prosper/usage.json') });
for (const cell of cells) {
  const body = { model, stream: false, think: false, _debug_render_only: true,
    options: { num_predict: 64 }, tools: [cell.tool],
    messages: [{ role: 'user', content: 'Inspect the tool schema. Do not call tools.' }] };
  const reservation = budget.reserve(Buffer.byteLength(JSON.stringify(body)) + 1024, 64);
  let settled = false;
  try {
    const response = await fetch(`${endpoint}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const payload = await response.json();
    const template = payload._debug_info?.rendered_template;
    const usage = typeof template === 'string' ? { inputTokens: 0, outputTokens: 0 }
      : { inputTokens: payload.prompt_eval_count, outputTokens: payload.eval_count };
    budget.settle(reservation, usage); settled = true;
    const result = { name: cell.name, status: response.status, renderOnly: typeof template === 'string',
      template, content: payload.message?.content, error: payload.error, usage };
    await writeFile(join(directory, `${cell.name}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ directory, name: cell.name, status: response.status, renderOnly: result.renderOnly,
      templateBytes: template?.length, error: payload.error }));
    if (!response.ok || !result.renderOnly) break;
  } finally { if (!settled) budget.settle(reservation, null); }
}
