import { describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { z } from 'zod';
import { commandSchema } from '../src/citizen/tools.ts';
import { developmentFixture } from '../src/evaluation/fixtures.ts';
import { runEpisode } from '../src/evaluation/runner.ts';
import type { CandidateFeedback, DecisionInput } from '../src/evaluation/contracts.ts';
import { createLocalModelCandidate, PRIMITIVE_PROMPT, type PrimitiveModelRequest } from '../src/evaluation/candidates/local-model.ts';
import { PRIMITIVE_DECISION_JSON_SCHEMA } from '../src/evaluation/candidates/decoder.ts';
import { mechanicsContext } from '../src/evaluation/mechanics.ts';
import { OllamaTransport } from '../src/evaluation/candidates/ollama-transport.ts';

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
const jsonBytes = (value: unknown) => bytes(JSON.stringify(value));
// Contribution of a string's characters after JSON escaping, excluding quotes.
const escapedBytes = (text: string) => jsonBytes(text) - 2;
const marker = 'SOURCE-DERIVED TABLES\n';
const manual = mechanicsContext().text;
const tablesStart = manual.indexOf(marker) + marker.length;
const prose = manual.slice(0, tablesStart);
const tablesText = manual.slice(tablesStart).trimEnd();
const tables = JSON.parse(tablesText);

function fields(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const fragment = JSON.stringify({ [key]: item }).slice(1, -1);
    return [key, { raw: bytes(fragment), escaped: escapedBytes(fragment) }];
  }));
}
function measure(request: PrimitiveModelRequest) {
  const payload = JSON.parse(request.messages[1].content);
  const system = request.messages[0].content;
  const user = request.messages[1].content;
  const formatBytes = jsonBytes(request.format);
  // Null occupies four bytes; empty content already includes its quotes.
  const envelope = jsonBytes({ messages: request.messages.map(m => ({ ...m, content: '' })), format: null }) - 4;
  const total = jsonBytes({ messages: request.messages, format: request.format });
  const userFields = fields(payload);
  const userPunctuation = Object.keys(payload).length - 1 + 2;
  expect(Object.values(userFields).reduce((sum, f) => sum + f.raw, userPunctuation)).toBe(bytes(user));
  expect(Object.values(userFields).reduce((sum, f) => sum + f.escaped, userPunctuation)).toBe(escapedBytes(user));
  expect(envelope + escapedBytes(system) + escapedBytes(user) + formatBytes).toBe(total);
  const manualParts = [PRIMITIVE_PROMPT, '\n\n', prose, tablesText, '\n'];
  expect(manualParts.join('')).toBe(system);
  expect(manualParts.reduce((sum, part) => sum + escapedBytes(part), 0)).toBe(escapedBytes(system));

  const prettyTables = JSON.stringify(tables, null, 2);
  const prettyUser = JSON.stringify(payload, null, 2);
  const prettyMessages = [
    { ...request.messages[0], content: PRIMITIVE_PROMPT + '\n\n' + prose + prettyTables + '\n' },
    { ...request.messages[1], content: prettyUser },
  ];
  expect(JSON.parse(prettyTables)).toEqual(tables);
  expect(JSON.parse(prettyUser)).toEqual(payload);
  const prettyInner = jsonBytes({ messages: prettyMessages, format: request.format });
  const prettyOuter = bytes(JSON.stringify({ messages: request.messages, format: request.format }, null, 2));
  const prettyBoth = bytes(JSON.stringify({ messages: prettyMessages, format: request.format }, null, 2));

  return {
    total, envelope, system: { raw: bytes(system), escaped: escapedBytes(system) },
    primitiveInstructions: { raw: bytes(PRIMITIVE_PROMPT), escaped: escapedBytes(PRIMITIVE_PROMPT) },
    separator: { raw: 2, escaped: 4 },
    manualProse: { raw: bytes(prose), escaped: escapedBytes(prose) },
    manualTables: { raw: bytes(tablesText), escaped: escapedBytes(tablesText) },
    manualTrailingNewline: { raw: 1, escaped: 2 },
    user: { raw: bytes(user), escaped: escapedBytes(user), punctuation: userPunctuation, fields: userFields },
    formatBytes, observationFields: fields(payload.observation),
    history: payload.history.map((entry: CandidateFeedback) => ({
      total: jsonBytes(entry), commit: jsonBytes(entry.commit),
      immediateObservation: jsonBytes(entry.immediateObservation),
      observations: entry.observations.map(jsonBytes),
    })),
    pretty: { tablesRaw: bytes(prettyTables), tablesEscaped: escapedBytes(prettyTables),
      userRaw: bytes(prettyUser), userEscaped: escapedBytes(prettyUser),
      innerTotal: prettyInner, innerAdded: prettyInner - total, outerTotal: prettyOuter,
      outerAdded: prettyOuter - total, bothTotal: prettyBoth, bothAdded: prettyBoth - total },
  };
}

async function capture(history?: { maxEntries: number; maxBytes: number }) {
  const requests: PrimitiveModelRequest[] = [];
  const inputs: DecisionInput[] = [];
  const feedback: CandidateFeedback[] = [];
  const candidate = createLocalModelCandidate({
    endpoint: 'http://127.0.0.1:11434', model: 'mock-only-local',
    maxPromptBytes: 500_000, maxInputTokens: 60_000, maxOutputTokens: 256, ...(history ? { history } : {}),
  }, {
    capability: 'mock',
    async complete(request) {
      requests.push(structuredClone(request));
      // Synthetic accounting only. This is not an actual tokenizer/model receipt.
      return { text: JSON.stringify({ requestId: request.requestId, kind: 'advance' }),
        usage: { inputTokens: 100, outputTokens: 10 } };
    },
  });
  const decide = candidate.decide.bind(candidate);
  const committedFeedback = candidate.feedback.bind(candidate);
  candidate.decide = (input, signal) => { inputs.push(structuredClone(input)); return decide(input, signal); };
  candidate.feedback = (entry, signal) => { feedback.push(structuredClone(entry)); committedFeedback(entry, signal); };
  const report = await runEpisode(developmentFixture('sell-buy-meal', 7, 2), () => candidate, {
    candidateSeed: 1, limits: { maxModelCalls: 2, maxTokens: 120_512 },
  });
  try {
    expect(report.status).toBe('complete');
    expect(report.decisions).toBe(2); expect(report.ticks).toBe(2); expect(report.failures).toBe(0);
    expect(requests).toHaveLength(2); expect(inputs).toHaveLength(2); expect(feedback).toHaveLength(2);
    for (let index = 0; index < 2; index++) {
      expect(JSON.parse(requests[index].messages[1].content).observation).toEqual(inputs[index].observation);
      expect(requests[index].messages[0].content).toBe(PRIMITIVE_PROMPT + '\n\n' + manual);
      expect(requests[index].format).toEqual(PRIMITIVE_DECISION_JSON_SCHEMA);
    }
    expect(JSON.parse(requests[0].messages[1].content).history).toEqual([]);
    return { requests, inputs, feedback };
  } finally { rmSync(report.outputDirectory, { recursive: true, force: true }); }
}

describe('offline primitive context representation audit', () => {
  it('accounts for two actual adapter requests and exact committed-history duplication', async () => {
    const captured = await capture();
    const second = JSON.parse(captured.requests[1].messages[1].content);
    expect(second.history).toEqual([captured.feedback[0]]);
    expect(second.historyOmissions).toBe(0);
    // Equal in this no-command, one-tick case. Never assume this after a command.
    expect(second.history[0].immediateObservation).toEqual(captured.inputs[0].observation);
    expect(second.history[0].observations.at(-1)).toEqual(second.observation);

    const decisionSchema = PRIMITIVE_DECISION_JSON_SCHEMA as any;
    const embeddedCommand = decisionSchema.anyOf.find((branch: any) => branch.properties?.command).properties.command;
    const { $schema: dialect, ...manualCommand } = tables.commandSchema;
    expect(dialect).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(tables.commandSchema).toEqual(z.toJSONSchema(commandSchema));
    expect(embeddedCommand).toEqual(manualCommand);
    const tableFields = fields(tables);
    console.info('PRIMITIVE_CONTEXT_AUDIT', JSON.stringify({
      setup: 'sell-buy-meal / seed 7 / horizon 2 / cadence 1 / advance mock / default history',
      mechanicsSha256: mechanicsContext().sha256,
      first: measure(captured.requests[0]), second: measure(captured.requests[1]),
      tables: tableFields,
      commandSchema: { raw: jsonBytes(tables.commandSchema), embeddedRaw: jsonBytes(embeddedCommand),
        removableTableFieldRaw: tableFields.commandSchema.raw + 1,
        removableTableFieldEscaped: tableFields.commandSchema.escaped + 1 },
    }));
  });

  it('measures the native HTTP envelope through injected mock fetch only', async () => {
    const normal = await capture();
    const small = await capture({ maxEntries: 1, maxBytes: 1024 });
    const endpoint = 'http://127.0.0.1:19231';
    const model = 'qwen3.5:9b' as const;
    const digest = 'a'.repeat(64);
    const template = '{{ .Messages }}'; // Existing transport-test placeholder, NOT the real installed template.
    const calls: { path: string; body?: string }[] = [];
    const mockFetch: typeof fetch = async (url, init) => {
      const path = String(url).slice(endpoint.length);
      calls.push({ path, body: init?.body as string | undefined });
      const response = path === '/api/show'
        ? { details: { format: 'gguf' }, model_info: { 'tokenizer.ggml.model': 'gpt2' }, template }
        : path === '/api/tags'
          ? { models: [{ name: model, model, digest, size: 6600000000, details: { format: 'gguf' } }] }
          : { model, done: true, message: { role: 'assistant', content: '{"kind":"advance"}' }, prompt_eval_count: 30, eval_count: 5 };
      expect(['/api/show', '/api/tags', '/api/chat']).toContain(path);
      return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
    };
    const transport = new OllamaTransport({ endpoint, model, digest, size: 6600000000, contextTokens: 65536 },
      { endpoint, stop: async () => {} }, mockFetch);
    try {
      const transmitted = [];
      for (const original of [normal.requests[0], small.requests[1]]) {
        await transport.complete({ ...original, endpoint, model }, new AbortController().signal);
        const body = calls.at(-1)!.body!;
        const parsed = JSON.parse(body);
        expect(parsed.messages).toEqual(original.messages); expect(parsed.format).toEqual(original.format);
        const promptBytes = jsonBytes({ messages: original.messages, format: original.format });
        transmitted.push({ promptBytes, nativeChatBodyBytes: bytes(body), envelopeAdded: bytes(body) - promptBytes });
      }
      const before = calls.length;
      await expect(transport.complete({ ...normal.requests[1], endpoint, model }, new AbortController().signal))
        .rejects.toThrow('Conservative UTF8 input bound exceeds reservation');
      expect(calls).toHaveLength(before); // Bound refusal occurs before even mock preflight HTTP.
      console.info('PRIMITIVE_CONTEXT_AUDIT_NATIVE', JSON.stringify({ transmitted,
        mockTemplateLiteralBytes: bytes(template), headerBound: 4096 + 1024 * 2,
        defaultSecondConservativeBound: jsonBytes({ messages: normal.requests[1].messages, format: normal.requests[1].format }) + 6144,
        defaultSecondMaxInputTokens: normal.requests[1].maxInputTokens,
        interpretation: 'HTTP and template fixtures only; no real template expansion, model or tokenizer evidence',
      }));
    } finally { await transport.close(); }
  });

  it('exposes the installed-probe history cap as omission, not lossless compaction', async () => {
    const captured = await capture({ maxEntries: 1, maxBytes: 1024 });
    const second = JSON.parse(captured.requests[1].messages[1].content);
    expect(jsonBytes(captured.feedback[0])).toBeGreaterThan(1024);
    expect(second.history).toEqual([]); expect(second.historyOmissions).toBe(1);
    console.info('PRIMITIVE_CONTEXT_AUDIT_SMALL_HISTORY', JSON.stringify({
      first: measure(captured.requests[0]).total, second: measure(captured.requests[1]).total,
      omittedFeedbackBytes: jsonBytes(captured.feedback[0]), historyOmissions: second.historyOmissions,
    }));
  });
});
