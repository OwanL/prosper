import { afterEach, expect, it, vi } from 'vitest';
import { ollamaTransport, type TransportRequest } from '../src/citizen/provider.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const request = (): TransportRequest => ({
  requestId: 'request',
  runId: 'run',
  turnId: 'turn',
  citizenId: 'citizen',
  generation: 0,
  signal: new AbortController().signal,
  payload: {
    model: 'deepseek-v4.1-flash:cloud',
    reasoning_effort: 'low',
    max_tokens: 40000,
    stream: false,
    messages: [],
    tools: [],
  },
});
it('reports only numeric transport phases without changing the validated response', async () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10));
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: 'done', reasoning_content: 'private' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          }),
        ),
    ),
  );
  const timing = vi.fn();
  const response = await ollamaTransport({ ...request(), onTiming: timing } as TransportRequest);
  expect(response).toEqual({
    content: 'done',
    toolCalls: undefined,
    finishReason: 'stop',
    usage: { inputTokens: 2, outputTokens: 3 },
  });
  expect(timing).toHaveBeenCalledOnce();
  expect(timing.mock.calls[0][0]).toEqual({ headerWaitMs: 10, bodyReadMs: 10, parseMs: 10 });
  expect(JSON.stringify(timing.mock.calls)).not.toContain('private');
});
it('timing callback failure cannot fail a successful request', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"choices":[{"message":{"content":"done"}}]}')),
  );
  const timing = vi.fn(() => {
    throw new Error('diagnostic unavailable');
  });
  await expect(
    ollamaTransport({ ...request(), onTiming: timing } as TransportRequest),
  ).resolves.toMatchObject({ content: 'done' });
  expect(timing).toHaveBeenCalledOnce();
});
it('records a failed header wait without copying raw transport errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('secret raw error');
    }),
  );
  const timing = vi.fn();
  await expect(
    ollamaTransport({ ...request(), onTiming: timing } as TransportRequest),
  ).rejects.toThrow('Local Ollama request failed');
  expect(timing).toHaveBeenCalledOnce();
  expect(timing.mock.calls[0][0]).toEqual({ headerWaitMs: expect.any(Number) });
  expect(JSON.stringify(timing.mock.calls)).not.toContain('secret');
});
