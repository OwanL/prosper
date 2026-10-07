export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ProviderResponse {
  content?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
export interface ProviderPayload {
  model: string;
  reasoning_effort: 'high';
  max_tokens: number;
  stream: false;
  messages: ChatMessage[];
  tools: unknown[];
}
export interface TransportRequest {
  requestId: string;
  runId: string;
  turnId: string;
  citizenId: string;
  generation: number;
  payload: ProviderPayload;
  signal: AbortSignal;
}
export type Transport = (request: TransportRequest) => Promise<ProviderResponse>;

/** No auth secrets or raw HTTP errors are copied into diagnostic records. */
export const ollamaTransport: Transport = async ({ payload, signal }) => {
  let response: Response;
  try {
    response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new Error(
      'Local Ollama request failed or was aborted; check Ollama availability. Reserved usage remains accounted.',
    );
  }
  if (!response.ok)
    throw new Error(
      `Local Ollama returned HTTP ${response.status}; check model access/configuration. Reserved usage remains accounted.`,
    );
  // Bound raw response size without retaining provider reasoning in diagnostics.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Local Ollama returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000)
        throw new Error('Local Ollama response exceeds the 1MB response limit.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Local Ollama returned invalid JSON.');
  }
  const data = raw as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
      };
    }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error('Local Ollama response has no assistant message.');
  return {
    content: message.content ?? undefined,
    toolCalls: message.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function?.name,
      arguments: call.function?.arguments,
    })),
    ...(data.usage
      ? {
          usage: {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          },
        }
      : {}),
  };
};

export function validateResponse(value: ProviderResponse): ProviderResponse {
  if (
    !value ||
    typeof value !== 'object' ||
    (value.content !== undefined &&
      (typeof value.content !== 'string' || value.content.length > 8000)) ||
    (value.toolCalls !== undefined &&
      (!Array.isArray(value.toolCalls) ||
        value.toolCalls.length > 8 ||
        value.toolCalls.some(
          (call) =>
            !call ||
            typeof call.id !== 'string' ||
            !call.id ||
            call.id.length > 200 ||
            typeof call.name !== 'string' ||
            typeof call.arguments !== 'string' ||
            call.arguments.length > 8000,
        )))
  ) {
    throw new Error(
      'Invalid provider response: maximum 8 tool calls and 8000 characters per content/arguments.',
    );
  }
  if (
    value.usage &&
    [value.usage.inputTokens, value.usage.outputTokens].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    )
  )
    throw new Error('Invalid provider token receipt; reserved usage remains accounted.');
  return value;
}
