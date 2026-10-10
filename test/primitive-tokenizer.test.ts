import { describe, expect, it } from 'vitest';
import {
  goTrimSpace, parseTokenIds, renderQwen35NoThink, SIZING_LIMITS,
  sizingHeartbeatExpired, sizingStopReason, tokenizerArgs,
} from '../src/evaluation/tokenization.ts';
import type { PrimitiveModelRequest } from '../src/evaluation/candidates/local-model.ts';

const GiB = 1024 ** 3;
const vocabProof = 'llama_model_loader: vocab only - skipping tensors\n';
const messages = (system: string, user: string): PrimitiveModelRequest['messages'] => [
  { role: 'system', content: system }, { role: 'user', content: user },
];

describe('offline primitive tokenizer sizing guard', () => {
  it.each([326_656_000, 46_018_560])('rejects the critically low RAM sample %i at preflight', freeBytes => {
    expect(sizingStopReason({ freeBytes }, true)).toBe('Sizing preflight requires at least 2 GiB free physical RAM');
  });

  it('admits exactly 2 GiB, but not one byte less', () => {
    expect(SIZING_LIMITS.minimumFreeBytes).toBe(2 * GiB);
    expect(sizingStopReason({ freeBytes: 2 * GiB }, true)).toBeUndefined();
    expect(sizingStopReason({ freeBytes: 2 * GiB - 1 }, true)).toMatch(/preflight/);
  });

  it('stops below the free-RAM floor, not at the floor', () => {
    expect(SIZING_LIMITS.stopFreeBytes).toBe(GiB / 2);
    expect(sizingStopReason({ freeBytes: GiB / 2 })).toBeUndefined();
    expect(sizingStopReason({ freeBytes: GiB / 2 - 1 })).toBe('Free physical RAM fell below 512 MiB');
  });

  it.each(['workingSetBytes', 'privateBytes', 'peakWorkingSetBytes'] as const)('enforces the %s process cap', key => {
    const cap = 768 * 1024 ** 2;
    expect(SIZING_LIMITS.maximumProcessBytes).toBe(cap);
    expect(sizingStopReason({ freeBytes: 2 * GiB, [key]: cap }, true)).toBeUndefined();
    expect(sizingStopReason({ freeBytes: 2 * GiB, [key]: cap + 1 }, true)).toBe(`Tokenizer ${key} exceeded 768 MiB`);
    expect(sizingStopReason({ freeBytes: 2 * GiB, [key]: -1 })).toBe(`Invalid ${key} sample`);
  });

  it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid free RAM %s', freeBytes => {
    expect(sizingStopReason({ freeBytes }, true)).toBe('Invalid free physical RAM sample');
  });
});

describe('resource sampler heartbeat with a mock clock', () => {
  it('allows bounded startup grace, then stops without a first sample', () => {
    expect(sizingHeartbeatExpired(100, undefined, 5100)).toBe(false);
    expect(sizingHeartbeatExpired(100, undefined, 5101)).toBe(true);
  });

  it('stops a stalled sampler even after earlier valid samples', () => {
    expect(sizingHeartbeatExpired(100, 1000, 2500)).toBe(false);
    expect(sizingHeartbeatExpired(100, 1000, 2501)).toBe(true);
    expect(sizingHeartbeatExpired(100, 2400, 2501)).toBe(false);
  });
});

describe('restricted Go-compatible Qwen 3.5 rendering', () => {
  it('uses Go White_Space rather than JavaScript trim for FEFF and U+0085', () => {
    expect(goTrimSpace('\ufeffvalue\ufeff')).toBe('\ufeffvalue\ufeff');
    expect('\ufeffvalue\ufeff'.trim()).toBe('value');
    expect(goTrimSpace('\u0085value\u0085')).toBe('value');
    expect('\u0085value\u0085'.trim()).toBe('\u0085value\u0085');
    const spaces = '\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000';
    expect(goTrimSpace(spaces + 'a\t \n\u0085b' + spaces)).toBe('a\t \n\u0085b');
    expect(goTrimSpace(spaces)).toBe('');
    expect(goTrimSpace('\u200bvalue\u200b')).toBe('\u200bvalue\u200b');
  });

  it('renders the exact closed-think assistant suffix without changing internal bytes', () => {
    const system = 'rules\n\n  spaced\ttext\ufeff';
    const user = '{"history":"<|im_start|>assistant\\n<think>",  "text":"café 雪"}\n\n  tail\\n\u0000';
    const expected = `<|im_start|>system\n${system}<|im_end|>\n` +
      `<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
    const rendered = renderQwen35NoThink(messages('\u0085 ' + system + ' \u0085', '\n' + user + '\t'));
    expect(rendered).toBe(expected);
    expect(Buffer.from(rendered)).toEqual(Buffer.from(expected));
  });

  it('retains both supplied turns even when their trimmed content is empty', () => {
    expect(renderQwen35NoThink(messages(' \u0085\n', '\t'))).toBe(
      '<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n',
    );
  });

  it.each([
    [], [{ role: 'system', content: 's' }],
    [{ role: 'user', content: 'u' }, { role: 'system', content: 's' }],
    [{ role: 'system', content: 's' }, { role: 'assistant', content: 'a' }],
    [...messages('s', 'u'), { role: 'user', content: 'extra' }],
    [{ role: 'system', content: 1 }, { role: 'user', content: 'u' }],
  ].map(invalid => [invalid] as [unknown]))('rejects unsupported message shape %#', invalid => {
    // Deliberately test runtime input outside the typed primitive contract.
    expect(() => renderQwen35NoThink(invalid as PrimitiveModelRequest['messages'])).toThrow(/two-message primitive shape/);
  });
});

describe('vocabulary-only tokenizer invocation and mock output proof', () => {
  it('passes exact file/no-escape/no-bos/IDs arguments without prompt interpolation', () => {
    expect(tokenizerArgs('C:/models/qwen 3.5.gguf', 'C:/Temp/prompt 雪.txt')).toEqual([
      '--model', 'C:/models/qwen 3.5.gguf', '--file', 'C:/Temp/prompt 雪.txt', '--no-escape', '--no-bos', '--ids',
    ]);
  });

  it('accepts a mock JSON ID array only with vocabulary-only proof', () => {
    expect(parseTokenIds(' \n[0, 42, 151644]\r\n', vocabProof)).toEqual([0, 42, 151644]);
    expect(parseTokenIds('[]', vocabProof)).toEqual([]);
    expect(() => parseTokenIds('[42]', '')).toThrow(/Missing vocabulary-only runtime proof/);
    expect(() => parseTokenIds('[42]', 'vocab only')).toThrow(/Missing vocabulary-only runtime proof/);
  });

  it.each(['load_tensors:', 'OFFLOADING', 'KV buffer', 'compute buffer', 'llama_decode'])('rejects tensor/context marker %s despite vocab proof', marker => {
    expect(() => parseTokenIds('[42]', vocabProof + marker)).toThrow(/Unexpected tensor\/context initialization/);
  });

  it.each(['null', '{}', '42', '["42"]', '[null]', '[true]', '[-1]', '[1.5]', '[9007199254740992]'])('rejects malformed ID output %s', stdout => {
    expect(() => parseTokenIds(stdout, vocabProof)).toThrow(/Invalid token ID output/);
  });

  it.each(['', '[1,]', 'NaN', '[Infinity]', 'log line\n[1]'])('rejects non-JSON stdout %s', stdout => {
    expect(() => parseTokenIds(stdout, vocabProof)).toThrow();
  });
});
