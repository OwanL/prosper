/** Metadata-only verification. A loopback Ollama endpoint can also proxy paid cloud models. */
export async function verifiedLocalModel(
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model) || /cloud/i.test(model)) return;
  try {
    const response = await fetcher('http://127.0.0.1:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return;
    const info = await response.json() as {
      remote_host?: string; remote_model?: string;
      details?: { format?: string; parameter_size?: string };
      model_info?: Record<string, unknown>;
    };
    if (info.remote_host || info.remote_model || info.details?.format !== 'gguf' ||
        typeof info.model_info?.['general.architecture'] !== 'string') return;
    const tags = await fetcher('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2500) });
    if (!tags.ok) return;
    const catalog = await tags.json() as { models?: Array<{ name?: string; model?: string; size?: number }> };
    const canonical = model.includes(':') ? model : `${model}:latest`;
    if (catalog.models?.some(entry => (entry.name === canonical || entry.model === canonical) &&
      typeof entry.size === 'number' && entry.size > 1_000_000)) return model;
  } catch { /* Unknown or unavailable models retain metered safeguards. */ }
}
