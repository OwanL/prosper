import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RequestLedger } from '../src/citizen/budget.js';

const directories: string[] = [];
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'prosper-v2-budget-'));
  directories.push(path);
  return path;
}
const input = {
  runId: 'run-1',
  turnId: 'turn-1',
  citizenId: 'citizen-1',
  inputTokens: 20,
  maxOutputTokens: 30,
};
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('RequestLedger', () => {
  it('retains a global wall-time rate guard across runner replacement and concurrent ledger instances', () => {
    const root = directory();
    const first = new RequestLedger({ directory: root });
    first.reserve(input, { minIntervalMs: 30000, maxRequestsPerHour: 30 });
    const restored = new RequestLedger({ directory: root });
    expect(restored.recentReservationTimes(Date.now() - 3600000)).toHaveLength(1);
    expect(() => restored.reserve(input, { minIntervalMs: 30000, maxRequestsPerHour: 30 })).toThrow(
      'rate limit',
    );
    expect(() => restored.reserve(input, { minIntervalMs: 0, maxRequestsPerHour: 1 })).toThrow(
      'rate limit',
    );
    expect(restored.status().requests).toBe(1);
  });
  it('reports token reservation blockage below the request cap without repeat writes', () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root, maxRequests: 100, maxTokens: 60 });
    ledger.reserve(input);
    expect(() => ledger.reserve(input)).toThrow('needs 50 tokens; 10 remaining');
    expect(ledger.status().blocked).toMatchObject({
      reason: 'tokens',
      requestedTokens: 50,
      remainingTokens: 10,
    });
    const text = readFileSync(join(root, 'request-ledger.jsonl'), 'utf8');
    expect(() => ledger.reserve(input)).toThrow('needs 50 tokens; 10 remaining');
    expect(readFileSync(join(root, 'request-ledger.jsonl'), 'utf8')).toBe(text);
    expect(new RequestLedger({ directory: root }).status().blocked?.reason).toBe('tokens');
  });

  it('persists explicit cap changes without resetting old version-1 accounting', () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root, maxRequests: 1, maxTokens: 60 });
    const reservation = ledger.reserve(input);
    const original = readFileSync(join(root, 'request-ledger.jsonl'), 'utf8');
    ledger.setLimits({ maxRequests: 2, maxTokens: 120 });
    const restored = new RequestLedger({ directory: root, maxRequests: 999, maxTokens: 999 });
    expect(restored.status()).toMatchObject({
      limit: 2,
      maxTokens: 120,
      requests: 1,
      pending: 1,
      tokens: 50,
    });
    expect(readFileSync(join(root, 'request-ledger.jsonl'), 'utf8').startsWith(original)).toBe(
      true,
    );
    restored.reserve({ ...input, runId: 'new-scenario' });
    expect(restored.status().blocked).toMatchObject({ reason: 'requests', remainingTokens: 20 });
    expect(() => restored.reserve(input)).toThrow('needs 1 request; 0 remaining');
    restored.setLimits({ maxRequests: 0, maxTokens: 0 });
    expect(restored.status()).toMatchObject({
      requests: 2,
      pending: 2,
      tokens: 100,
      limit: 0,
      maxTokens: 0,
    });
    restored.settle(reservation.requestId);
    expect(restored.status().tokens).toBe(100);
  });

  it('clears a token block only when a receipt creates sufficient capacity', () => {
    const ledger = new RequestLedger({ directory: directory(), maxTokens: 60 });
    const { requestId } = ledger.reserve(input);
    expect(() => ledger.reserve(input)).toThrow('budget exhausted');
    ledger.settle(requestId, { inputTokens: 5, outputTokens: 5 });
    expect(ledger.status().blocked).toBeUndefined();
    ledger.reserve(input);
    expect(ledger.status().tokens).toBe(60);
  });
  it('rejects damaged durable settings rather than falling back to larger defaults', () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root });
    ledger.setLimits({ maxRequests: 1, maxTokens: 50 });
    ledger.reserve(input);
    const spending = readFileSync(join(root, 'request-ledger.jsonl'), 'utf8');
    writeFileSync(join(root, 'budget-settings.jsonl'), '');
    const restored = new RequestLedger({ directory: root, maxRequests: 999, maxTokens: 999 });
    expect(restored.status().error).toContain('Empty budget settings');
    expect(() => restored.reserve(input)).toThrow('unavailable');
    expect(() => restored.setLimits({ maxRequests: 999, maxTokens: 999 })).toThrow('unavailable');
    expect(readFileSync(join(root, 'request-ledger.jsonl'), 'utf8')).toBe(spending);
  });

  it('durably reserves with request and run/turn/citizen identity before returning', () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root, maxRequests: 2, maxTokens: 100 });
    const reservation = ledger.reserve(input);
    expect(reservation).toMatchObject(input);
    expect(reservation.requestId).toBeTruthy();
    expect(JSON.parse(readFileSync(join(root, 'request-ledger.jsonl'), 'utf8'))).toEqual({
      version: 1,
      sequence: 1,
      type: 'reserve',
      ...reservation,
    });
    expect(ledger.status()).toEqual({
      requests: 1,
      pending: 1,
      spent: 1,
      limit: 2,
      unit: 'requests',
      tokens: 50,
      maxTokens: 100,
    });
  });

  it('retains uncertain requests across abort/reload and run changes without a refund', () => {
    const root = directory();
    new RequestLedger({ directory: root, maxRequests: 1 }).reserve(input);
    const restored = new RequestLedger({ directory: root, maxRequests: 1 });
    expect(restored.status()).toMatchObject({ requests: 1, pending: 1, tokens: 50 });
    expect(() => restored.reserve({ ...input, runId: 'other-run' })).toThrow('budget exhausted');
    expect(restored.status().error).toBeUndefined();
  });

  it('settles actual usage once, including after recreation', () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root, maxTokens: 60 });
    const { requestId } = ledger.reserve(input);
    ledger.settle(requestId, { inputTokens: 10, outputTokens: 5 });
    ledger.settle(requestId, { inputTokens: 999, outputTokens: 999 });
    const restored = new RequestLedger({ directory: root, maxTokens: 60 });
    restored.settle(requestId);
    expect(restored.status()).toMatchObject({ requests: 1, pending: 0, tokens: 15 });
    expect(
      readFileSync(join(root, 'request-ledger.jsonl'), 'utf8').trim().split('\n'),
    ).toHaveLength(2);
    expect(() => restored.reserve(input)).toThrow('budget exhausted');
    restored.reserve({ ...input, maxOutputTokens: 25 });
    expect(restored.status().tokens).toBe(60);
  });

  it('settles absent usage conservatively and does not allow a later refund', () => {
    const ledger = new RequestLedger({ directory: directory(), maxTokens: 50 });
    const { requestId } = ledger.reserve(input);
    ledger.settle(requestId);
    ledger.settle(requestId, { inputTokens: 0, outputTokens: 0 });
    expect(ledger.status()).toMatchObject({ pending: 0, tokens: 50 });
    expect(() => ledger.reserve(input)).toThrow('budget exhausted');
  });

  it('records over-reservation actual usage and blocks even zero-token future calls', () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root, maxTokens: 60 });
    const { requestId } = ledger.reserve(input);
    ledger.settle(requestId, { inputTokens: 80, outputTokens: 40 });
    const restored = new RequestLedger({ directory: root, maxTokens: 60 });
    expect(restored.status()).toMatchObject({ tokens: 120, pending: 0 });
    expect(() => restored.reserve({ ...input, inputTokens: 0, maxOutputTokens: 0 })).toThrow(
      'budget exhausted',
    );
  });

  it('enforces independent request and token caps, including zero limits', () => {
    const ledger = new RequestLedger({ directory: directory(), maxRequests: 1, maxTokens: 49 });
    expect(() => ledger.reserve(input)).toThrow('budget exhausted');
    expect(ledger.status().requests).toBe(0);
    const reservation = ledger.reserve({ ...input, maxOutputTokens: 29 });
    ledger.settle(reservation.requestId, { inputTokens: 0, outputTokens: 0 });
    expect(() => ledger.reserve(input)).toThrow('budget exhausted');
    const zero = new RequestLedger({ directory: directory(), maxRequests: 0, maxTokens: 0 });
    expect(() => zero.reserve({ ...input, inputTokens: 0, maxOutputTokens: 0 })).toThrow(
      'budget exhausted',
    );
  });

  it('refreshes accounting between distinct instances sharing a directory', () => {
    const root = directory();
    const first = new RequestLedger({ directory: root, maxRequests: 2 });
    const second = new RequestLedger({ directory: root, maxRequests: 2 });
    const reservation = first.reserve(input);
    second.settle(reservation.requestId, { inputTokens: 1, outputTokens: 2 });
    const other = second.reserve(input);
    expect(other.requestId).not.toBe(reservation.requestId);
    expect(first.status()).toMatchObject({ requests: 2, pending: 1, tokens: 53 });
    expect(() => first.reserve(input)).toThrow('budget exhausted');
  });

  it('rejects invalid caller values without changing valid accounting', () => {
    const root = directory();
    expect(() => new RequestLedger({ directory: root, maxTokens: Infinity })).toThrow('limits');
    const ledger = new RequestLedger({ directory: root });
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => ledger.reserve({ ...input, inputTokens: value })).toThrow('Invalid request');
    }
    expect(() => ledger.reserve({ ...input, runId: '' })).toThrow('Invalid request');
    expect(() => ledger.reserve({ ...input, inputTokens: Number.MAX_SAFE_INTEGER })).toThrow(
      'overflow',
    );
    expect(() => ledger.settle('unknown')).toThrow('Unknown request');
    const { requestId } = ledger.reserve(input);
    expect(() => ledger.settle(requestId, { inputTokens: -1, outputTokens: 1 })).toThrow(
      'Invalid request usage',
    );
    expect(ledger.status()).toMatchObject({ requests: 1, pending: 1, tokens: 50 });
    expect(ledger.status().error).toBeUndefined();
  });

  it.each([
    ['malformed JSON', '{bad}\n'],
    ['partial last line', '{"version":1'],
    [
      'unsupported version',
      JSON.stringify({ version: 2, sequence: 1, type: 'reserve', requestId: 'req', ...input }) +
        '\n',
    ],
    [
      'sequence gap',
      JSON.stringify({ version: 1, sequence: 2, type: 'reserve', requestId: 'req', ...input }) +
        '\n',
    ],
    [
      'invalid tokens',
      JSON.stringify({
        version: 1,
        sequence: 1,
        type: 'reserve',
        requestId: 'req',
        ...input,
        inputTokens: -1,
      }) + '\n',
    ],
    [
      'missing identity',
      JSON.stringify({
        version: 1,
        sequence: 1,
        type: 'reserve',
        requestId: 'req',
        ...input,
        turnId: '',
      }) + '\n',
    ],
    [
      'unmatched settlement',
      JSON.stringify({ version: 1, sequence: 1, type: 'settle', requestId: 'unknown' }) + '\n',
    ],
  ])('fails closed on %s', (_name, contents) => {
    const root = directory();
    const path = join(root, 'request-ledger.jsonl');
    writeFileSync(path, contents);
    const ledger = new RequestLedger({ directory: root });
    expect(ledger.status().error).toBeTruthy();
    expect(() => ledger.reserve(input)).toThrow('ledger unavailable');
    expect(() => ledger.settle('unknown')).toThrow('ledger unavailable');
    expect(readFileSync(path, 'utf8')).toBe(contents);
  });

  it.each(['duplicate-reservation', 'duplicate-settlement', 'bad-usage'])(
    'rejects corrupt %s',
    (kind) => {
      const root = directory();
      const ledger = new RequestLedger({ directory: root });
      const reservation = ledger.reserve(input);
      ledger.settle(reservation.requestId);
      const path = join(root, 'request-ledger.jsonl');
      const original = readFileSync(path, 'utf8');
      const entry =
        kind === 'duplicate-reservation'
          ? { version: 1, sequence: 3, type: 'reserve', ...reservation }
          : {
              version: 1,
              sequence: 3,
              type: 'settle',
              requestId: reservation.requestId,
              ...(kind === 'bad-usage' ? { usage: { inputTokens: 'bad', outputTokens: 0 } } : {}),
            };
      writeFileSync(path, original + JSON.stringify(entry) + '\n');
      expect(new RequestLedger({ directory: root }).status().error).toBeTruthy();
    },
  );

  it('fails closed when a ledger is rewritten during the lifetime of an instance', () => {
    const root = directory();
    const ledger = new RequestLedger({ directory: root });
    ledger.reserve(input);
    writeFileSync(join(root, 'request-ledger.jsonl'), '');
    expect(ledger.status().error).toMatch(/Truncated/);
    expect(() => ledger.reserve(input)).toThrow('unavailable');
  });

  it('fails closed on a preexisting lock without removing it', () => {
    const root = directory();
    const lockPath = join(root, 'request-ledger.jsonl.lock');
    writeFileSync(lockPath, 'uncertain writer');
    const ledger = new RequestLedger({ directory: root });
    expect(ledger.status().error).toBeTruthy();
    expect(() => ledger.reserve(input)).toThrow('unavailable');
    expect(readFileSync(lockPath, 'utf8')).toBe('uncertain writer');
  });
});
