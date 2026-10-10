import { rmSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runEpisode, replayEpisode } from '../src/evaluation/runner.ts';
import { developmentFixture } from '../src/evaluation/fixtures.ts';
import { createLocalModelCandidate } from '../src/evaluation/candidates/local-model.ts';
import { OllamaTransport } from '../src/evaluation/candidates/ollama-transport.ts';

const endpoint = 'http://127.0.0.1:12345';
const model = 'qwen3.5:9b' as const;
const digest = 'a'.repeat(64);
const config = { endpoint, model, maxPromptBytes: 52000, maxInputTokens: 60000, maxOutputTokens: 256, history: { maxEntries: 1, maxBytes: 1024 } };
const limits = { maxModelCalls: 1, maxTokens: 60256, maxModelCallsPerDecision: 1, maxTokensPerDecision: 60256, decisionTimeoutMs: 1000, teardownTimeoutMs: 100 };
function mockedLive(chat: (body: any) => Response | Promise<Response>, stop = vi.fn(async () => {})) {
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/api/show')) return Response.json({ details: { format: 'gguf' }, model_info: { 'tokenizer.ggml.model': 'gpt2' }, template: '{{ .Prompt }}' });
    if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: model, model, digest, size: 6600000000, details: { format: 'gguf' } }] });
    return chat(JSON.parse(options!.body as string));
  }) as unknown as typeof fetch;
  const transport = new OllamaTransport({ endpoint, model, digest, size: 6600000000, contextTokens: 65536 }, { endpoint, stop }, fetcher);
  return { factory: () => createLocalModelCandidate(config, transport), stop, transport, fetcher };
}

describe('audited local admission through the actual runner (mock HTTP only)', () => {
  it('admits actual transport identity, commits one real command and replays', async () => {
    const local = mockedLive(body => {
      const input = JSON.parse(body.messages[1].content);
      return Response.json({ model, done: true, message: { role: 'assistant', content: JSON.stringify({ requestId: input.requestId,
        kind: 'command', command: { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 4 } }) }, prompt_eval_count: 12000, eval_count: 60 });
    });
    const report = await runEpisode(developmentFixture('buy-meal'), local.factory, { limits });
    try {
      expect(report.status).toBe('complete'); expect(report.success).toBe(true);
      expect(report.usage).toMatchObject({ modelCalls: 1, tokens: 12060, pendingOperations: 0, unknownUsageCalls: 0 });
      expect(replayEpisode(report.outputDirectory).boundaries).toBeGreaterThan(0);
      expect(local.stop).toHaveBeenCalledTimes(1);
    } finally { rmSync(report.outputDirectory, { recursive: true, force: true }); }
  });
  it('requires explicit nonzero live budgets before HTTP', async () => {
    const local = mockedLive(() => { throw new Error('never'); });
    await expect(runEpisode(developmentFixture('buy-meal'), local.factory)).rejects.toThrow('positive explicit');
    expect(local.fetcher).not.toHaveBeenCalled();
  });
  it('does not advance or clear uncertainty while underlying stop is pending', async () => {
    const local = mockedLive(() => new Promise<Response>(() => {}), vi.fn(() => new Promise<void>(() => {})));
    const report = await runEpisode(developmentFixture('buy-meal'), local.factory, { limits: { ...limits, decisionTimeoutMs: 20, teardownTimeoutMs: 5 } });
    try {
      expect(report.status).toBe('incomplete'); expect(report.ticks).toBe(0);
      expect(report.reason).toContain('teardown:');
      expect(report.usage).toMatchObject({ modelCalls: 1, tokens: 60256, pendingOperations: 1, unknownUsageCalls: 1 });
      expect(local.transport.pending).toBe(true);
      expect(local.stop).toHaveBeenCalledTimes(1);
    } finally { rmSync(report.outputDirectory, { recursive: true, force: true }); }
  });
});
