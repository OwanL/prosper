import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import type { BudgetStatus } from '../shared/types.ts';

export interface RequestReservation {
  requestId: string;
  runId: string;
  turnId: string;
  citizenId: string;
  inputTokens: number;
  maxOutputTokens: number;
}
export interface RequestUsage {
  inputTokens: number;
  outputTokens: number;
}
export interface RequestLedgerOptions {
  directory?: string;
  maxRequests?: number;
  maxTokens?: number;
}
export type RequestBudgetStatus = BudgetStatus & {
  tokens: number;
  maxTokens: number;
  error?: string;
};
type Entry = { version: 1; sequence: number } & (
  | ({ type: 'reserve' } & RequestReservation)
  | { type: 'settle'; requestId: string; usage?: RequestUsage }
);

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function identity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function total(a: number, b: number): number {
  const result = a + b;
  if (!count(result)) throw new Error('Token accounting overflow');
  return result;
}

/** Independent of checkpoints: reserve durably BEFORE sending, and never refund an abort.
 * Missing usage settles at the reserved amount. The first settlement is final.
 * A stale lock or damaged ledger requires operator intervention, never a silent reset.
 */
export class RequestLedger {
  private readonly path: string;
  private readonly lockPath: string;
  private readonly maxRequests: number;
  private readonly maxTokens: number;
  private text = '';
  private sequence = 0;
  private requests = new Map<string, { reservation: RequestReservation; settled: boolean }>();
  private tokens = 0;
  private error?: string;

  constructor({
    directory = '.prosper-v2',
    maxRequests = 100,
    maxTokens = 100_000,
  }: RequestLedgerOptions = {}) {
    if (!count(maxRequests) || !count(maxTokens))
      throw new Error('Budget limits must be nonnegative safe integers');
    this.maxRequests = maxRequests;
    this.maxTokens = maxTokens;
    const root = resolve(directory);
    this.path = resolve(root, 'request-ledger.jsonl');
    this.lockPath = `${this.path}.lock`;
    try {
      mkdirSync(root, { recursive: true });
      this.locked(() => {
        if (!existsSync(this.path)) {
          const fd = openSync(this.path, 'wx');
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        }
        this.reload();
      });
    } catch (error) {
      this.fail(error);
    }
  }

  reserve(input: Omit<RequestReservation, 'requestId'>): RequestReservation {
    this.healthy();
    if (
      !identity(input.runId) ||
      !identity(input.turnId) ||
      !identity(input.citizenId) ||
      !count(input.inputTokens) ||
      !count(input.maxOutputTokens)
    ) {
      throw new Error('Invalid request reservation');
    }
    const reservedTokens = total(input.inputTokens, input.maxOutputTokens);
    return this.locked(() => {
      this.reload();
      if (this.requests.size >= this.maxRequests || reservedTokens > this.maxTokens - this.tokens) {
        throw new Error('Request budget exhausted');
      }
      const reservation: RequestReservation = {
        requestId: randomUUID(),
        runId: input.runId,
        turnId: input.turnId,
        citizenId: input.citizenId,
        inputTokens: input.inputTokens,
        maxOutputTokens: input.maxOutputTokens,
      };
      this.append({ version: 1, sequence: this.sequence + 1, type: 'reserve', ...reservation });
      return reservation;
    });
  }

  settle(requestId: string, usage?: RequestUsage): void {
    this.healthy();
    this.locked(() => {
      this.reload();
      const request = this.requests.get(requestId);
      if (!request) throw new Error('Unknown request ID');
      if (request.settled) return;
      if (usage !== undefined && (!count(usage.inputTokens) || !count(usage.outputTokens))) {
        throw new Error('Invalid request usage');
      }
      if (usage) total(usage.inputTokens, usage.outputTokens);
      this.append({
        version: 1,
        sequence: this.sequence + 1,
        type: 'settle',
        requestId,
        ...(usage
          ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } }
          : {}),
      });
    });
  }

  status(): RequestBudgetStatus {
    if (!this.error) {
      try {
        this.locked(() => this.reload());
      } catch (error) {
        this.fail(error);
      }
    }
    return {
      requests: this.requests.size,
      pending: [...this.requests.values()].filter((request) => !request.settled).length,
      spent: this.requests.size,
      limit: this.maxRequests,
      unit: 'requests',
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private healthy(): void {
    if (this.error) throw new Error(`Request ledger unavailable: ${this.error}`);
  }
  private fail(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
  }
  private locked<T>(operation: () => T): T {
    let fd: number;
    try {
      fd = openSync(this.lockPath, 'wx');
    } catch (error) {
      this.fail(error);
      this.healthy();
      throw error;
    }
    try {
      return operation();
    } finally {
      try {
        closeSync(fd);
        unlinkSync(this.lockPath);
      } catch (error) {
        this.fail(error);
        this.healthy();
      }
    }
  }
  private append(entry: Entry): void {
    try {
      const fd = openSync(this.path, 'a');
      try {
        const bytes = Buffer.from(`${JSON.stringify(entry)}\n`);
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (!written) throw new Error('Incomplete request ledger write');
          offset += written;
        }
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.reload();
    } catch (error) {
      this.fail(error);
      this.healthy();
    }
  }
  private reload(): void {
    try {
      const text = readFileSync(this.path, 'utf8');
      if (!text.startsWith(this.text) || (text.length > 0 && !text.endsWith('\n'))) {
        throw new Error('Truncated or rewritten request ledger');
      }
      const requests = new Map<string, { reservation: RequestReservation; settled: boolean }>();
      let tokens = 0;
      let sequence = 0;
      for (const line of text === '' ? [] : text.slice(0, -1).split('\n')) {
        const entry = JSON.parse(line) as Entry;
        if (
          !entry ||
          entry.version !== 1 ||
          entry.sequence !== ++sequence ||
          !identity(entry.requestId)
        ) {
          throw new Error('Invalid ledger version, sequence or request identity');
        }
        if (entry.type === 'reserve') {
          if (
            requests.has(entry.requestId) ||
            !identity(entry.runId) ||
            !identity(entry.turnId) ||
            !identity(entry.citizenId) ||
            !count(entry.inputTokens) ||
            !count(entry.maxOutputTokens)
          ) {
            throw new Error('Invalid ledger reservation');
          }
          tokens = total(tokens, total(entry.inputTokens, entry.maxOutputTokens));
          requests.set(entry.requestId, { reservation: entry, settled: false });
        } else if (entry.type === 'settle') {
          const request = requests.get(entry.requestId);
          if (!request || request.settled) throw new Error('Invalid ledger settlement identity');
          if (entry.usage !== undefined) {
            if (
              !entry.usage ||
              !count(entry.usage.inputTokens) ||
              !count(entry.usage.outputTokens)
            ) {
              throw new Error('Invalid ledger usage');
            }
            tokens = total(
              tokens - total(request.reservation.inputTokens, request.reservation.maxOutputTokens),
              total(entry.usage.inputTokens, entry.usage.outputTokens),
            );
          }
          request.settled = true;
        } else {
          throw new Error('Unknown ledger entry type');
        }
      }
      this.requests = requests;
      this.tokens = tokens;
      this.sequence = sequence;
      this.text = text;
    } catch (error) {
      this.fail(error);
      this.healthy();
    }
  }
}
