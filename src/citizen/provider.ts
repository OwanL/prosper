export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ProviderResponse {
  content?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  /** Public provider completion metadata; never includes hidden reasoning. */
  finishReason?: string;
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
export interface ProviderPayload {
  model: string;
  reasoning_effort: 'none' | 'low' | 'high';
  max_tokens: number;
  stream: false;
  messages: ChatMessage[];
  tools: unknown[];
}
export interface TransportTiming {
  /** Non-streaming header wait includes provider generation, not just queueing. */
  headerWaitMs?: number;
  /** Includes reading the response and releasing its reader. */
  bodyReadMs?: number;
  parseMs?: number;
}
export interface TransportRequest {
  requestId: string;
  runId: string;
  turnId: string;
  citizenId: string;
  generation: number;
  payload: ProviderPayload;
  signal: AbortSignal;
  /** Diagnostic only; callback failures cannot affect transport or receipts. */
  onTiming?: (timing: TransportTiming) => void;
}
export type Transport = (request: TransportRequest) => Promise<ProviderResponse>;

/** No auth secrets or raw HTTP errors are copied into diagnostic records. */
export const ollamaTransport: Transport = async (request) => {
  const timing: TransportTiming = {};
  try {
    return await ollamaResponse(request, timing);
  } finally {
    try {
      request.onTiming?.(timing);
    } catch {
      // Diagnostic consumers have no authority over request success or accounting.
    }
  }
};

/** Local small models need an explicit context window; /v1 uses the server's
 * loaded default (often 4096) and can silently truncate a policy observation. */
export const ollamaNativeTransport: Transport = async (request) => {
  const timing: TransportTiming = {};
  const started = performance.now();
  const decisionTool =
    request.payload.tools.length === 1
      ? (request.payload.tools[0] as { function?: { name?: string; parameters?: unknown } })
      : undefined;
  const policyFormat = ['set_strategy', 'set_policy'].includes(decisionTool?.function?.name ?? '')
    ? decisionTool!.function!.parameters
    : undefined;
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: request.signal,
      body: JSON.stringify({
        model: request.payload.model,
        messages: request.payload.messages,
        ...(policyFormat ? { format: policyFormat } : { tools: request.payload.tools }),
        stream: false,
        think:
          request.payload.reasoning_effort === 'none' ? false : request.payload.reasoning_effort,
        options: { num_ctx: 8192, num_predict: request.payload.max_tokens, temperature: 0.6 },
        keep_alive: '1m',
      }),
    });
    timing.headerWaitMs = performance.now() - started;
    if (!response.ok)
      throw new Error(
        `Local Ollama returned HTTP ${response.status}; reserved usage remains accounted.`,
      );
    const bodyStarted = performance.now();
    const raw = await readBoundedResponse(response);
    timing.bodyReadMs = performance.now() - bodyStarted;
    const parseStarted = performance.now();
    const data = JSON.parse(raw) as {
      message?: {
        content?: string;
        tool_calls?: { id?: string; function: { name: string; arguments: unknown } }[];
      };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    timing.parseMs = performance.now() - parseStarted;
    if (!data.message) throw new Error('Local Ollama response has no assistant message.');
    return {
      content: data.message.content,
      finishReason: data.done_reason,
      toolCalls: data.message.tool_calls?.map((call, index) => ({
        id: call.id ?? `native-${index}`,
        name: call.function?.name,
        arguments:
          typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments),
      })),
      ...(data.prompt_eval_count !== undefined && data.eval_count !== undefined
        ? {
            usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count },
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Local Ollama')) throw error;
    throw new Error(
      'Local Ollama native request failed, was aborted or returned invalid data; reserved usage remains accounted.',
    );
  } finally {
    try {
      request.onTiming?.(timing);
    } catch {
      /* Diagnostic only. */
    }
  }
};

async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Local Ollama returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1000000) throw new Error('Local Ollama response exceeds the 1MB response limit.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function ollamaResponse(
  { payload, signal }: TransportRequest,
  timing: TransportTiming,
): Promise<ProviderResponse> {
  let response: Response;
  const headerStarted = performance.now();
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
  } finally {
    timing.headerWaitMs = performance.now() - headerStarted;
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
  const bodyStarted = performance.now();
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
    timing.bodyReadMs = performance.now() - bodyStarted;
  }
  let raw: unknown;
  const parseStarted = performance.now();
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Local Ollama returned invalid JSON.');
  } finally {
    timing.parseMs = performance.now() - parseStarted;
  }
  const data = raw as {
    choices?: {
      finish_reason?: string | null;
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
    ...(typeof data.choices?.[0]?.finish_reason === 'string'
      ? { finishReason: data.choices[0].finish_reason }
      : {}),
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
}

export function validateResponse(value: ProviderResponse): ProviderResponse {
  if (
    !value ||
    typeof value !== 'object' ||
    (value.finishReason !== undefined &&
      (typeof value.finishReason !== 'string' || value.finishReason.length > 200)) ||
    (value.content !== undefined &&
      (typeof value.content !== 'string' || value.content.length > 8000)) ||
    (value.toolCalls !== undefined &&
      (!Array.isArray(value.toolCalls) ||
        value.toolCalls.length > 32 ||
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
      'Invalid provider response: maximum 32 tool calls and 8000 characters per content/arguments.',
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
