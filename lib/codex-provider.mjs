import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PlannerError } from './planner.mjs';

export const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex';
export const CODEX_MODEL = 'gpt-6-luna';

export async function readPieAuth() {
  const path = process.platform === 'win32' ? join(process.env.LOCALAPPDATA, 'pie', 'auth.json') : join(homedir(), '.config', 'pie', 'auth.json');
  let auth;
  try { auth = JSON.parse(await readFile(path, 'utf8'))['openai-codex']; }
  catch { throw new PlannerError('Cannot read Pie OpenAI authentication. Sign in to OpenAI in Pie, then Retry.'); }
  if (auth?.type !== 'oauth' || !auth.access || !auth.accountId || !Number.isFinite(auth.expires) || auth.expires <= Date.now()) {
    throw new PlannerError('Pie OpenAI authentication is missing or expired. Refresh the OpenAI sign-in in Pie, then Retry.');
  }
  return auth;
}

export function responsesRequest(body) {
  const input = body.messages.filter(m => m.role !== 'system').flatMap(message => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    if (message.role === 'assistant') {
      if (message.providerHistory) return message.providerHistory;
      return [
        ...(message.content ? [{ role: 'assistant', content: [{ type: 'output_text', text: message.content }] }] : []),
        ...(message.tool_calls ?? []).map(c => ({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments })),
      ];
    }
    return [{ role: 'user', content: [{ type: 'input_text', text: message.content }] }];
  });
  return { model: body.model, store: false, stream: true,
    instructions: body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), input,
    reasoning: { effort: body.reasoning_effort }, max_output_tokens: body.max_tokens,
    text: { verbosity: 'low' }, include: ['reasoning.encrypted_content'],
    tools: body.tools.map(t => ({ type: 'function', ...t.function, strict: false })),
    tool_choice: 'auto', parallel_tool_calls: true };
}

async function readResponse(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const items = new Map();
  let pending = '', bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new PlannerError('OpenAI response exceeded the transport limit. Existing work retained.');
      pending += decoder.decode(value, { stream: true });
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trimEnd(); pending = pending.slice(end + 1);
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === 'response.output_item.done') items.set(event.output_index, event.item);
        if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          // Codex may omit output from the terminal usage envelope. Completed
          // items, not deltas, are authoritative; do not lose executed calls.
          for (const [index, item] of (event.response.output ?? []).entries()) items.set(index, item);
          return { ...event.response, output: [...items].sort(([a], [b]) => a - b).map(([, item]) => item) };
        }
        if (event.type === 'error' || event.type === 'response.failed') throw new PlannerError('OpenAI response failed during streaming. Existing work retained.');
      }
    }
    throw new PlannerError('OpenAI stream ended without a completed response. Existing work retained.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createCodexTransport({ fetchImpl = fetch, readAuth = readPieAuth } = {}) {
  return {
    endpoint: CODEX_ENDPOINT,
    providerName: 'OpenAI Codex',
    checkConnection: async () => { await readAuth(); },
    async fetchImpl(_url, options) {
      const auth = await readAuth();
      const body = responsesRequest(JSON.parse(options.body));
      const response = await fetchImpl(`${CODEX_ENDPOINT}/responses`, {
        method: 'POST', redirect: 'error', signal: options.signal,
        headers: { Authorization: `Bearer ${auth.access}`, 'chatgpt-account-id': auth.accountId,
          originator: 'pi', 'OpenAI-Beta': 'responses=experimental', 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      });
      if (!response.ok) return response;
      const result = await readResponse(response);
      const output = result.output ?? [];
      const message = {
        role: 'assistant', content: output.filter(o => o.type === 'message').flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('\n'),
        tool_calls: output.filter(o => o.type === 'function_call').map(c => ({ id: c.call_id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
        // Encrypted reasoning is replayed only inside this turn, never audited.
        providerHistory: output,
      };
      return { ok: true, json: async () => ({ choices: [{ message, finish_reason: result.status === 'incomplete' ? 'length' : 'tool_calls' }],
        usage: { prompt_tokens: result.usage?.input_tokens, completion_tokens: result.usage?.output_tokens,
          total_tokens: result.usage?.total_tokens, completion_tokens_details: result.usage?.output_tokens_details } }) };
    },
  };
}
