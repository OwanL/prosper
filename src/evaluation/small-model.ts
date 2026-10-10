import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat, readFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { GRANITE_RUN_ENVELOPE, type TaskOwnedOllamaService } from './local-service.ts';

export const GRANITE_ARTIFACT = Object.freeze({
  repository: 'ibm-granite/granite-4.0-h-1b-GGUF', revision: 'c2cb1972f511add21f3bae244990b8ff3a3ffb23',
  file: 'granite-4.0-h-1b-Q8_0.gguf', bytes: 1558926560,
  sha256: 'f29248184ca766350e56e6d161c2a637ad302a6d595e15d4a62cd58327a0ac0e',
  url: 'https://huggingface.co/ibm-granite/granite-4.0-h-1b-GGUF/resolve/c2cb1972f511add21f3bae244990b8ff3a3ffb23/granite-4.0-h-1b-Q8_0.gguf',
  publisherRevision: 'd18cca4c121edb87d022116d281ce212c9136f57',
  publisherTemplateSha256: '9524df67b77a7b25a2dfee898f75b316a157eb9d855b51e32aeac79d7c8a83ce',
});
export const GRANITE_MODEL = 'prosper-granite-4.0-h-1b-q8:latest' as const;
// Exact no-tools, no-documents, string system/user subset of the pinned native
// publisher template. No added default system prompt or strategy. Literal LF.
export const GRANITE_TEMPLATE = '{{ range .Messages }}<|start_of_role|>{{ .Role }}<|end_of_role|>{{ .Content }}<|end_of_text|>\n{{ end }}<|start_of_role|>assistant<|end_of_role|>';
export const GRANITE_TEMPLATE_SHA256 = createHash('sha256').update(GRANITE_TEMPLATE).digest('hex');
export interface GraniteMetadata {
  readonly artifactSha256: string; readonly embeddedTemplateSha256: string;
  readonly tokenizerPre: string; readonly modelInfo: Readonly<Record<string, string | number | boolean>>;
}
const verified = new WeakSet<object>();
export function isVerifiedGraniteMetadata(value: unknown): value is GraniteMetadata {
  return typeof value === 'object' && value !== null && verified.has(value);
}
function aborted(signal: AbortSignal): void { signal.throwIfAborted(); }
function ownedPath(directory: string, file: string): string {
  const root = resolve(directory); const rel = relative(resolve(tmpdir()), root);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Unique OS-temp directory required');
  return join(root, file);
}
/** Stream weights to a new private file while hashing; never buffer weights.
 * Only the exact pinned HTTPS origin path may redirect to HF's artifact CDN.
 * No credentials, resume, retry, mutable alias or cloud model operation. */
export async function acquireGranite(directory: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string> {
  aborted(signal);
  const destination = ownedPath(directory, GRANITE_ARTIFACT.file);
  const partial = destination + '.partial';
  const file = await open(partial, 'wx', 0o600);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchImpl(GRANITE_ARTIFACT.url, { signal, redirect: 'follow', credentials: 'omit' });
    if (!response.ok || !response.body || (response.url && new URL(response.url).protocol !== 'https:')) throw new Error('Pinned artifact acquisition failed');
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) !== GRANITE_ARTIFACT.bytes) throw new Error('Artifact declared size mismatch');
    reader = response.body.getReader();
    const hash = createHash('sha256'); let bytes = 0;
    for (;;) {
      aborted(signal); const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > GRANITE_ARTIFACT.bytes) throw new Error('Artifact exceeds pinned byte size');
      hash.update(chunk.value);
      let offset = 0;
      while (offset < chunk.value.byteLength) { const result = await file.write(chunk.value, offset, chunk.value.byteLength - offset); if (!result.bytesWritten) throw new Error('Short artifact write'); offset += result.bytesWritten; }
    }
    if (bytes !== GRANITE_ARTIFACT.bytes || hash.digest('hex') !== GRANITE_ARTIFACT.sha256) throw new Error('Artifact SHA256/bytes mismatch');
    aborted(signal); await file.sync(); await file.close();
    // Refuse replacing even another task-created complete artifact.
    try { await stat(destination); throw new Error('Artifact destination already exists'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await rename(partial, destination); return destination;
  } catch (error) { await file.close().catch(() => {}); await rm(partial, { force: true }); throw error; }
  finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
}
export async function verifyGraniteFile(path: string, signal: AbortSignal): Promise<void> {
  if ((await stat(path)).size !== GRANITE_ARTIFACT.bytes) throw new Error('Pinned artifact size mismatch');
  const hash = createHash('sha256'); let bytes = 0;
  const stream = createReadStream(path, { highWaterMark: 256 * 1024, signal });
  for await (const chunk of stream) { aborted(signal); bytes += chunk.length; hash.update(chunk); }
  if (bytes !== GRANITE_ARTIFACT.bytes || hash.digest('hex') !== GRANITE_ARTIFACT.sha256) throw new Error('Pinned artifact digest mismatch');
}
/** Bounded GGUF-v3 metadata reader. Never reads tensor data. Hash verification
 * comes first; unsupported tokenizer/template/architecture always fails closed. */
export async function inspectGranite(path: string, signal: AbortSignal): Promise<GraniteMetadata> {
  await verifyGraniteFile(path, signal);
  const file = await open(path, 'r'); let position = 0;
  const maxMetadataBytes = 64 * 1024 ** 2;
  const bytes = async (n: number) => {
    aborted(signal);
    if (!Number.isSafeInteger(n) || n < 0 || position + n > maxMetadataBytes) throw new Error('GGUF metadata byte ceiling');
    const buffer = Buffer.alloc(n); let offset = 0;
    while (offset < n) { const r = await file.read(buffer, offset, n - offset, position + offset); if (!r.bytesRead) throw new Error('Truncated GGUF metadata'); offset += r.bytesRead; }
    position += n; return buffer;
  };
  const u32 = async () => (await bytes(4)).readUInt32LE();
  const u64 = async () => { const n = (await bytes(8)).readBigUInt64LE(); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF integer ceiling'); return Number(n); };
  const text = async () => { const n = await u64(); if (n > 1024 * 1024) throw new Error('GGUF string ceiling'); return new TextDecoder('utf-8', { fatal: true }).decode(await bytes(n)); };
  const scalar = async (type: number): Promise<string | number | boolean> => {
    switch (type) {
      case 0: return (await bytes(1)).readUInt8(); case 1: return (await bytes(1)).readInt8();
      case 2: return (await bytes(2)).readUInt16LE(); case 3: return (await bytes(2)).readInt16LE();
      case 4: return u32(); case 5: return (await bytes(4)).readInt32LE(); case 6: return (await bytes(4)).readFloatLE();
      case 7: { const value = (await bytes(1)).readUInt8(); if (value > 1) throw new Error('Invalid GGUF bool'); return value === 1; }
      case 8: return text(); case 10: return u64(); case 11: return Number((await bytes(8)).readBigInt64LE()); case 12: return (await bytes(8)).readDoubleLE();
      default: throw new Error('Unsupported GGUF metadata type');
    }
  };
  try {
    if ((await bytes(4)).toString('ascii') !== 'GGUF' || await u32() !== 3) throw new Error('GGUF v3 required');
    await u64(); const count = await u64(); if (count > 10000) throw new Error('GGUF key ceiling');
    const info: Record<string, string | number | boolean> = {}; const keys = new Set<string>(); const byteTokens = new Set<string>();
    for (let i = 0; i < count; i++) {
      const key = await text(); if (keys.has(key)) throw new Error('Duplicate GGUF key'); keys.add(key);
      const type = await u32();
      if (type === 9) {
        const element = await u32(); const length = await u64(); if (length > 1000000 || element === 9) throw new Error('GGUF array ceiling/type');
        for (let j = 0; j < length; j++) { const value = await scalar(element); if (key === 'tokenizer.ggml.tokens' && typeof value === 'string' && [...value].length === 1) byteTokens.add(value); }
      } else info[key] = await scalar(type);
    }
    if (info['general.architecture'] !== 'granitehybrid' || info['general.file_type'] !== 7 ||
        info['granitehybrid.context_length'] !== 131072 || info['granitehybrid.block_count'] !== 40 ||
        info['granitehybrid.embedding_length'] !== 1536 || info['tokenizer.ggml.model'] !== 'gpt2') throw new Error('Granite hybrid Q8 identity mismatch');
    // Supported BPE pretokenizers split the UTF8 byte sequence, never expand it.
    // Require every GPT2 byte-alphabet base token, no automatic BOS, and no
    // cleanup/prefix transformation. This is an upper bound, NOT exact tokens.
    const pre = info['tokenizer.ggml.pre'];
    if (typeof pre !== 'string' || !['gpt2', 'llama-bpe', 'dbrx', 'gpt-4o'].includes(pre) ||
        info['tokenizer.ggml.add_bos_token'] !== false ||
        (info['tokenizer.ggml.add_space_prefix'] !== undefined && info['tokenizer.ggml.add_space_prefix'] !== false)) throw new Error('Unsupported byte-bound tokenizer');
    const direct = new Set<number>(); for (let n = 33; n <= 126; n++) direct.add(n); for (let n = 161; n <= 172; n++) direct.add(n); for (let n = 174; n <= 255; n++) direct.add(n);
    let extra = 0;
    for (let n = 0; n < 256; n++) { const cp = direct.has(n) ? n : 256 + extra++; if (!byteTokens.has(String.fromCodePoint(cp))) throw new Error('Missing byte fallback token'); }
    const embedded = info['tokenizer.chat_template'];
    if (typeof embedded !== 'string' || createHash('sha256').update(embedded).digest('hex') !== GRANITE_ARTIFACT.publisherTemplateSha256) throw new Error('Embedded native template differs from pinned publisher template; no generation');
    const modelInfo = Object.fromEntries(Object.entries(info).filter(([key]) => key.startsWith('granitehybrid.') || ['general.architecture', 'general.file_type', 'tokenizer.ggml.model', 'tokenizer.ggml.pre', 'tokenizer.ggml.add_bos_token', 'tokenizer.ggml.add_space_prefix'].includes(key)));
    const metadata: GraniteMetadata = Object.freeze({ artifactSha256: GRANITE_ARTIFACT.sha256, embeddedTemplateSha256: GRANITE_ARTIFACT.publisherTemplateSha256, tokenizerPre: pre, modelInfo: Object.freeze(modelInfo) });
    verified.add(metadata); return metadata;
  } finally { await file.close(); }
}
/** Small bounded loopback envelopes only. Never use this to read weights. */
export async function ownedJson(endpoint: string, path: string, body: unknown | undefined, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(endpoint)) throw new Error('Task-owned loopback required');
  const response = await fetchImpl(endpoint + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok || response.redirected || !response.body) throw new Error('Owned import HTTP failure');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { aborted(signal); const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 1024 * 1024) throw new Error('Import metadata byte ceiling'); chunks.push(chunk.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid import metadata');
  return parsed as Record<string, unknown>;
}
/** Import only a verified local GGUF into the explicit task-owned store. No pull
 * endpoint or CLI fallback. API incompatibility is a blocker, not a retry. */
export async function importGranite(service: TaskOwnedOllamaService, modelsPath: string, artifactPath: string, metadata: GraniteMetadata, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<{ digest: string; size: number }> {
  if (!isVerifiedGraniteMetadata(metadata)) throw new Error('Verified Granite artifact metadata required');
  if (service.envelope !== GRANITE_RUN_ENVELOPE || !service.modelsPath || resolve(modelsPath) !== resolve(service.modelsPath))
    throw new Error('Granite import requires its exact task-owned store and fixed resource envelope');
  await service.requireAdmission(); aborted(signal);
  const version = await ownedJson(service.endpoint, '/api/version', undefined, signal, fetchImpl);
  if (version.version !== '0.35.1') throw new Error('Only audited Ollama 0.35.1 import supported');
  await verifyGraniteFile(artifactPath, signal);
  const stream = createReadStream(artifactPath, { highWaterMark: 256 * 1024, signal });
  try {
    const response = await fetchImpl(service.endpoint + '/api/blobs/sha256:' + GRANITE_ARTIFACT.sha256, {
      method: 'POST', body: stream as unknown as BodyInit, duplex: 'half', redirect: 'error', credentials: 'omit', signal,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(GRANITE_ARTIFACT.bytes) },
    } as RequestInit);
    if (!response.ok || response.redirected) throw new Error('Exact GGUF blob import failed');
    await response.body?.cancel();
  } finally { stream.destroy(); }
  await service.requireAdmission(); aborted(signal);
  const imported = await ownedJson(service.endpoint, '/api/create', { model: GRANITE_MODEL,
    files: { [GRANITE_ARTIFACT.file]: 'sha256:' + GRANITE_ARTIFACT.sha256 }, template: GRANITE_TEMPLATE,
    parameters: { num_ctx: 131072, stop: ['<|end_of_text|>'] }, stream: false,
  }, signal, fetchImpl);
  if (imported.status !== 'success') throw new Error('Granite create not successful');
  const manifestPath = join(modelsPath, 'manifests', 'registry.ollama.ai', 'library', 'prosper-granite-4.0-h-1b-q8', 'latest');
  if ((await stat(manifestPath)).size > 65536) throw new Error('Manifest byte ceiling');
  const raw = await readFile(manifestPath); const manifest = JSON.parse(raw.toString('utf8')) as { layers?: { mediaType: string; digest: string; size: number }[] };
  const layers = manifest.layers; if (!Array.isArray(layers)) throw new Error('Missing imported layers');
  const weights = layers.filter(layer => layer.mediaType === 'application/vnd.ollama.image.model');
  const safeLayers = new Set(['application/vnd.ollama.image.model', 'application/vnd.ollama.image.template', 'application/vnd.ollama.image.params', 'application/vnd.ollama.image.license']);
  if (weights.length !== 1 || weights[0]!.digest !== 'sha256:' + GRANITE_ARTIFACT.sha256 || weights[0]!.size !== GRANITE_ARTIFACT.bytes || layers.some(layer => !safeLayers.has(layer.mediaType))) throw new Error('Imported artifact layers mismatch/unsupported');
  const digest = createHash('sha256').update(raw).digest('hex');
  const tags = await ownedJson(service.endpoint, '/api/tags', undefined, signal, fetchImpl);
  if (!Array.isArray(tags.models)) throw new Error('Missing imported tags');
  const matches = tags.models.filter((entry: { name?: string }) => entry.name === GRANITE_MODEL) as { digest: string; size: number }[];
  if (matches.length !== 1 || matches[0]!.digest !== digest || !Number.isSafeInteger(matches[0]!.size) || matches[0]!.size < GRANITE_ARTIFACT.bytes) throw new Error('Imported manifest/catalog mismatch');
  return { digest, size: matches[0]!.size };
}
