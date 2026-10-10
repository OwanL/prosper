import { afterEach, expect, it, vi } from 'vitest';
import {
  ollamaTransport,
  validateResponse,
  type TransportRequest,
} from '../src/citizen/provider.ts';
import { tools } from '../src/citizen/tools.ts';
afterEach(() => vi.unstubAllGlobals());
it('retains public usage and finish reason without returning hidden reasoning', async () => {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                reasoning_content: 'must never be retained',
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'command', arguments: '{"type":"cancel"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 234, completion_tokens: 86 },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const request: TransportRequest = {
    requestId: 'request',
    runId: 'run',
    turnId: 'turn',
    citizenId: 'citizen',
    generation: 0,
    signal: new AbortController().signal,
    payload: {
      model: 'deepseek-v4.1-flash:cloud',
      reasoning_effort: 'high',
      max_tokens: 1024,
      stream: false,
      messages: [],
      tools,
    },
  };
  expect(validateResponse(await ollamaTransport(request))).toEqual({
    content: undefined,
    finishReason: 'tool_calls',
    toolCalls: [{ id: 'c1', name: 'command', arguments: '{"type":"cancel"}' }],
    usage: { inputTokens: 234, outputTokens: 86 },
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
  expect(
    body.tools.find((tool: any) => tool.function.name === 'command').function.parameters.required,
  ).toEqual(['type']);
  expect(
    body.tools.find((tool: any) => tool.function.name === 'set_strategy').function.parameters
      .required,
  ).toEqual(['mode']);
});
it('accepts batched responses beyond eight calls, within the 32-call turn allowance', () => {
  const toolCalls = Array.from({ length: 32 }, (_, i) => ({
    id: `c${i}`,
    name: 'command',
    arguments: '{"type":"cancel"}',
  }));
  expect(validateResponse({ toolCalls }).toolCalls).toHaveLength(32);
  expect(() =>
    validateResponse({ toolCalls: [...toolCalls, { ...toolCalls[0], id: 'extra' }] }),
  ).toThrow('maximum 32');
});
it('rejects invalid receipt and finish reason metadata', () => {
  expect(() => validateResponse({ usage: { inputTokens: -1, outputTokens: 2 } })).toThrow(
    'Invalid provider token receipt',
  );
  expect(() => validateResponse({ finishReason: 'x'.repeat(201) })).toThrow(
    'Invalid provider response',
  );
});
