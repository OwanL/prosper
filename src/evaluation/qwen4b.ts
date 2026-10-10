import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat, realpath, mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir, freemem } from 'node:os';

export const QWEN4B_MODEL = 'prosper-qwen3.5-4b-text-q4:latest' as const;
export const QWEN4B_TEMPLATE = '{{ .Prompt }}';
export const QWEN4B_CONFIG = '{"model_format":"gguf","model_family":"qwen35","model_families":["qwen35"],"model_type":"4.2B","file_type":"Q4_K_M","renderer":"qwen3.5","parser":"qwen3.5","requires":"0.30.0"}\n';
export const QWEN4B_PARAMS = '{"presence_penalty":1.5,"temperature":1,"top_k":20,"top_p":0.95}\n';
export const QWEN4B_BLOBS = Object.freeze([
  { kind: 'config', sha256: '788a4d94bc3f431ac0cd067005be4b838a09330427962952420b05d10ecf84db', bytes: 177 },
  { kind: 'model', sha256: 'a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50', bytes: 2648593216 },
  { kind: 'template', sha256: 'b507b9c2f6ca642bffcd06665ea7c91f235fd32daeefdf875a0f938db05fb315', bytes: 13 },
  { kind: 'license', sha256: '50cbab8a892c5f2993b8c7351a99182507472def3b1374558308605d99b86b32', bytes: 11343 },
  { kind: 'params', sha256: '9371364b27a52acac9d87f88bd93c9db1174d8d6ec57f6888925cdc1788871ff', bytes: 65 },
].map(blob => Object.freeze(blob)));
const descriptor = (blob: typeof QWEN4B_BLOBS[number]) => ({ mediaType: blob.kind === 'config' ? 'application/vnd.docker.container.image.v1+json' : 'application/vnd.ollama.image.' + blob.kind, digest: 'sha256:' + blob.sha256, size: blob.bytes });
// Derived text-only manifest: projector deliberately excluded; no mutable manifest fetch.
export const QWEN4B_MANIFEST = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: descriptor(QWEN4B_BLOBS[0]!), layers: QWEN4B_BLOBS.slice(1).map(descriptor) });
export const QWEN4B_DIGEST = createHash('sha256').update(QWEN4B_MANIFEST).digest('hex');
// Ollama /api/tags includes the config descriptor as well as layer bytes.
export const QWEN4B_SIZE = QWEN4B_BLOBS.reduce((sum, blob) => sum + blob.bytes, 0);
export const QWEN4B_PREPARATION = Object.freeze({ minRamBytes: 2 * 1024 ** 3, stopRamBytes: 512 * 1024 ** 2, deadlineMs: 30 * 60 * 1000, chunkBytes: 256 * 1024, sampleMs: 1000, stallMs: 10000 });
const receipt = JSON.stringify({ kind: 'prosper-qwen4b-text-store-v1', model: QWEN4B_MODEL, manifestSha256: QWEN4B_DIGEST, blobs: QWEN4B_BLOBS, renderer: 'qwen3.5', ollamaVersion: '0.35.1' });
const manifestRelative = join('models', 'manifests', 'registry.ollama.ai', 'library', 'prosper-qwen3.5-4b-text-q4', 'latest');
function inside(parent: string, child: string): boolean { const rel = relative(parent, child); return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'); }
export async function canonicalQwen4bStore(directory: string): Promise<string> {
  const root = await realpath(directory); const temp = await realpath(tmpdir());
  if (!inside(temp, root) || !relative(temp, root).startsWith('prosper-qwen4b-artifacts-') || relative(temp, root).includes('/') || relative(temp, root).includes('\\')) throw new Error('Task-owned canonical OS-temp artifact root required');
  const models = join(root, 'models');
  if (await realpath(models) !== models || !(await stat(models)).isDirectory()) throw new Error('Private canonical model store required');
  return root;
}
async function canonicalFile(root: string, path: string): Promise<void> {
  if (await realpath(path) !== path || !inside(root, path) || !(await stat(path)).isFile()) throw new Error('Noncanonical artifact file');
}
async function verifyBlob(root: string, blob: typeof QWEN4B_BLOBS[number], signal: AbortSignal): Promise<string> {
  const path = join(root, 'models', 'blobs', 'sha256-' + blob.sha256); await canonicalFile(root, path);
  if ((await stat(path)).size !== blob.bytes) throw new Error('Pinned blob length mismatch');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: QWEN4B_PREPARATION.chunkBytes, signal })) { signal.throwIfAborted(); size += chunk.length; hash.update(chunk); }
  if (size !== blob.bytes || hash.digest('hex') !== blob.sha256) throw new Error('Pinned blob checksum mismatch');
  return path;
}
/** Streaming-only preparation: no tensors/service/GPU; 2 GiB admission and
 * 512 MiB stop floor leave host headroom despite only 256 KiB working chunks.
 * Completed caches are rehashed, never resume a partial or retry a download. */
export async function prepareQwen4b(directory?: string, fetchImpl: typeof fetch = fetch, sampleRam: () => number = freemem): Promise<{ directory: string; receiptPath: string }> {
  const check = (floor: number) => { const free = sampleRam(); if (!Number.isSafeInteger(free) || free < floor) throw new Error('Preparation RAM headroom unavailable'); };
  check(QWEN4B_PREPARATION.minRamBytes);
  const controller = new AbortController(); const signal = controller.signal;
  const deadline = setTimeout(() => controller.abort(new Error('Preparation deadline')), QWEN4B_PREPARATION.deadlineMs);
  let root: string | undefined;
  let lastSample = performance.now();
  const monitor = setInterval(() => { try { if (performance.now() - lastSample > QWEN4B_PREPARATION.stallMs) throw new Error('Preparation monitor stalled'); check(QWEN4B_PREPARATION.stopRamBytes); lastSample = performance.now(); } catch (error) { controller.abort(error); } }, QWEN4B_PREPARATION.sampleMs);
  const heartbeat = () => { signal.throwIfAborted(); if (performance.now() - lastSample > QWEN4B_PREPARATION.stallMs) throw new Error('Preparation monitor stalled'); };
  try {
    const created = directory === undefined;
    root = created ? await mkdtemp(join(await realpath(tmpdir()), 'prosper-qwen4b-artifacts-')) : await realpath(directory!);
    if (created) { await mkdir(join(root, 'models', 'blobs'), { recursive: true }); await writeFile(join(root, 'ownership.json'), receipt, { flag: 'wx', mode: 0o600 }); }
    await canonicalQwen4bStore(root); await canonicalFile(root, join(root, 'ownership.json'));
    if ((await readFile(join(root, 'ownership.json'), 'utf8')) !== receipt) throw new Error('Artifact ownership receipt mismatch');
    for (const blob of QWEN4B_BLOBS) {
      heartbeat(); const destination = join(root, 'models', 'blobs', 'sha256-' + blob.sha256);
      try { await stat(destination); if (blob.kind !== 'model') await verifyBlob(root, blob, signal); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const partial = destination + '.partial'; const file = await open(partial, 'wx', 0o600); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetchImpl('https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:' + blob.sha256, { signal, redirect: 'follow', credentials: 'omit' });
        if (!response.ok || !response.body || (response.url && new URL(response.url).protocol !== 'https:') || (response.headers.has('content-length') && response.headers.get('content-length') !== String(blob.bytes))) throw new Error('Pinned download failed/length mismatch');
        reader = response.body.getReader(); const hash = createHash('sha256'); let size = 0;
        for (;;) { heartbeat(); const chunk = await reader.read(); if (chunk.done) break; heartbeat(); if (chunk.value.length > QWEN4B_PREPARATION.chunkBytes) throw new Error('Streaming chunk ceiling'); size += chunk.value.length; if (size > blob.bytes) throw new Error('Blob length exceeded'); hash.update(chunk.value);
          let offset = 0; while (offset < chunk.value.length) { const result = await file.write(chunk.value, offset, chunk.value.length - offset); if (!result.bytesWritten) throw new Error('Short write'); offset += result.bytesWritten; }
        }
        if (size !== blob.bytes || hash.digest('hex') !== blob.sha256) throw new Error('Pinned download SHA/length mismatch');
        heartbeat(); await file.sync(); await file.close(); await rename(partial, destination);
      } catch (error) { await file.close().catch(() => {}); await rm(partial, { force: true }); throw error; }
      finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    }
    const manifest = join(root, manifestRelative); await mkdir(join(manifest, '..'), { recursive: true });
    try { await stat(manifest); if (await readFile(manifest, 'utf8') !== QWEN4B_MANIFEST) throw new Error('Existing manifest mismatch'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeFile(manifest + '.partial', QWEN4B_MANIFEST, { flag: 'wx', mode: 0o600 }); await rename(manifest + '.partial', manifest); }
    await verifyQwen4bStore(root, signal);
    const receiptPath = join(root, 'prepared.json'); await writeFile(receiptPath, receipt, { mode: 0o600 }); return { directory: root, receiptPath };
  } catch (error) {
    throw new Qwen4bPreparationFailure(String(error), root);
  } finally { clearInterval(monitor); clearTimeout(deadline); }
}
export class Qwen4bPreparationFailure extends Error {
  constructor(message: string, readonly directory?: string) { super(`${message}${directory ? `; artifact directory: ${directory}` : ''}`); }
}
export interface Qwen4bMetadata { readonly directory: string; readonly modelsPath: string; readonly digest: string; readonly size: number; readonly modelInfo: Readonly<Record<string, string | number | boolean>> }
const verified = new WeakSet<object>();
export function isVerifiedQwen4bMetadata(value: unknown): value is Qwen4bMetadata { return !!value && typeof value === 'object' && verified.has(value); }
export async function verifyQwen4bStore(directory: string, signal: AbortSignal): Promise<Qwen4bMetadata> {
  const root = await canonicalQwen4bStore(directory);
  await canonicalFile(root, join(root, 'ownership.json'));
  if (await readFile(join(root, 'ownership.json'), 'utf8') !== receipt) throw new Error('Ownership receipt mismatch');
  for (const blob of QWEN4B_BLOBS) await verifyBlob(root, blob, signal);
  for (const [kind, expected] of [['config', QWEN4B_CONFIG], ['template', QWEN4B_TEMPLATE], ['params', QWEN4B_PARAMS]] as const) {
    const blob = QWEN4B_BLOBS.find(b => b.kind === kind)!;
    if (await readFile(join(root, 'models', 'blobs', 'sha256-' + blob.sha256), 'utf8') !== expected) throw new Error('Renderer/template/params mismatch');
  }
  const manifest = join(root, manifestRelative); await canonicalFile(root, manifest);
  if (await readFile(manifest, 'utf8') !== QWEN4B_MANIFEST) throw new Error('Text-only manifest mismatch');
  const modelInfo = await inspectQwen4b(join(root, 'models', 'blobs', 'sha256-' + QWEN4B_BLOBS[1]!.sha256), signal);
  const metadata = Object.freeze({ directory: root, modelsPath: join(root, 'models'), digest: QWEN4B_DIGEST, size: QWEN4B_SIZE, modelInfo: Object.freeze(modelInfo) });
  verified.add(metadata); return metadata;
}
/** Bounded GGUF v3 metadata only; callers mint proof only after whole-store hashes. */
async function inspectQwen4b(path: string, signal: AbortSignal): Promise<Record<string, string | number | boolean>> {
  const file = await open(path, 'r'); let position = 0;
  const bytes = async (n: number) => { signal.throwIfAborted(); if (!Number.isSafeInteger(n) || n < 0 || position + n > 64 * 1024 ** 2) throw new Error('GGUF metadata ceiling'); const buffer = Buffer.alloc(n); let offset = 0; while (offset < n) { const r = await file.read(buffer, offset, n - offset, position + offset); if (!r.bytesRead) throw new Error('Truncated GGUF'); offset += r.bytesRead; } position += n; return buffer; };
  const u32 = async () => (await bytes(4)).readUInt32LE();
  const u64 = async () => { const n = (await bytes(8)).readBigUInt64LE(); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF integer ceiling'); return Number(n); };
  const text = async () => { const n = await u64(); if (n > 1024 * 1024) throw new Error('GGUF string ceiling'); return new TextDecoder('utf8', { fatal: true }).decode(await bytes(n)); };
  const scalar = async (type: number): Promise<string | number | boolean> => {
    switch (type) {
      case 0: return (await bytes(1)).readUInt8(); case 1: return (await bytes(1)).readInt8(); case 2: return (await bytes(2)).readUInt16LE(); case 3: return (await bytes(2)).readInt16LE();
      case 4: return u32(); case 5: return (await bytes(4)).readInt32LE(); case 6: return (await bytes(4)).readFloatLE();
      case 7: { const n = (await bytes(1)).readUInt8(); if (n > 1) throw new Error('GGUF boolean'); return n === 1; }
      case 8: return text(); case 10: return u64(); case 11: return Number((await bytes(8)).readBigInt64LE()); case 12: return (await bytes(8)).readDoubleLE(); default: throw new Error('GGUF unknown scalar');
    }
  };
  try {
    if ((await bytes(4)).toString('ascii') !== 'GGUF' || await u32() !== 3) throw new Error('GGUF v3 required'); await u64(); const count = await u64(); if (count > 10000) throw new Error('GGUF key ceiling');
    const info: Record<string, string | number | boolean> = {}; const keys = new Set<string>(); const byteTokens = new Set<string>();
    for (let i = 0; i < count; i++) { const key = await text(); if (keys.has(key)) throw new Error('Duplicate GGUF key'); keys.add(key); const type = await u32();
      if (type === 9) { const element = await u32(); const length = await u64(); if (length > 1000000 || element === 9) throw new Error('GGUF array ceiling'); for (let j = 0; j < length; j++) { const value = await scalar(element); if (key === 'tokenizer.ggml.tokens' && typeof value === 'string' && [...value].length === 1) byteTokens.add(value); } }
      else { const value = await scalar(type); if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('Unsupported GGUF number'); info[key] = value; }
    }
    if (info['general.architecture'] !== 'qwen35' || info['general.file_type'] !== 15 || info['qwen35.context_length'] !== 262144 || info['qwen35.block_count'] !== 32 || info['qwen35.embedding_length'] !== 2560 || info['tokenizer.ggml.model'] !== 'gpt2' || !['qwen2', 'qwen35'].includes(String(info['tokenizer.ggml.pre'])) || info['tokenizer.ggml.add_bos_token'] !== false || (info['tokenizer.ggml.add_eos_token'] !== undefined && info['tokenizer.ggml.add_eos_token'] !== false) || (info['tokenizer.ggml.add_space_prefix'] !== undefined && info['tokenizer.ggml.add_space_prefix'] !== false)) throw new Error('Unsupported Qwen35 Q4_K_M byte tokenizer/architecture');
    const direct = new Set<number>(); for (let n = 33; n <= 126; n++) direct.add(n); for (let n = 161; n <= 172; n++) direct.add(n); for (let n = 174; n <= 255; n++) direct.add(n); let extra = 0;
    for (let n = 0; n < 256; n++) if (!byteTokens.has(String.fromCodePoint(direct.has(n) ? n : 256 + extra++))) throw new Error('Missing GPT2 byte token');
    return Object.fromEntries(Object.entries(info).filter(([key]) => key.startsWith('qwen35.') || ['general.architecture', 'general.file_type', 'tokenizer.ggml.model', 'tokenizer.ggml.pre', 'tokenizer.ggml.add_bos_token', 'tokenizer.ggml.add_eos_token', 'tokenizer.ggml.add_space_prefix'].includes(key)));
  } finally { await file.close(); }
}
