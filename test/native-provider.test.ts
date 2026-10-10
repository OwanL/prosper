import { afterEach, expect, it, vi } from 'vitest';
import {
  ollamaNativeTransport,
  validateResponse,
  type TransportRequest,
} from '../src/citizen/provider.ts';
import { strategicTools } from '../src/citizen/strategic-tools.ts';
afterEach(() => vi.unstubAllGlobals());
function request(): TransportRequest {
  return {
    requestId: 'r',
    runId: 'world',
    turnId: 'turn',
    citizenId: 'citizen',
    generation: 0,
    signal: new AbortController().signal,
    payload: {
      model: 'qwen3.5:9b',
      reasoning_effort: 'none',
      max_tokens: 1200,
      stream: false,
      messages: [{ role: 'user', content: 'Choose a policy' }],
      tools: strategicTools,
    },
  };
}
it('uses an explicit local context and constrained JSON decision without retaining hidden reasoning', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          message: { content: '{"mode":"keep"}', thinking: 'private reasoning' },
          done_reason: 'stop',
          prompt_eval_count: 1800,
          eval_count: 30,
        }),
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const response = validateResponse(await ollamaNativeTransport(request()));
  expect(response).toMatchObject({
    content: '{"mode":"keep"}',
    usage: { inputTokens: 1800, outputTokens: 30 },
  });
  expect(JSON.stringify(response)).not.toContain('private reasoning');
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://127.0.0.1:11434/api/chat');
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({
    think: false,
    options: { num_ctx: 8192, num_predict: 1200 },
    format: { type: 'object', required: ['policy'] },
  });
  expect(body).not.toHaveProperty('tools');
});
it('supports non-policy native tools with object arguments and safe generated call IDs', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          message: {
            tool_calls: [{ function: { name: 'command', arguments: { type: 'cancel' } } }],
          },
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      ),
  );
  const req = request();
  req.payload.tools = [];
  expect(validateResponse(await ollamaNativeTransport(req)).toolCalls).toEqual([
    { id: 'native-0', name: 'command', arguments: '{"type":"cancel"}' },
  ]);
});
it('does not copy raw HTTP errors, body contents or secrets into diagnostics', async () => {
  vi.stubGlobal('fetch', async () => new Response('SECRET PRIVATE RESPONSE', { status: 400 }));
  await expect(ollamaNativeTransport(request())).rejects.toThrow('Local Ollama returned HTTP 400');
  await expect(ollamaNativeTransport(request())).rejects.not.toThrow('SECRET PRIVATE RESPONSE');
});
