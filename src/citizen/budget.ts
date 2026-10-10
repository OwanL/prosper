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
import type { BudgetBlock, BudgetLimits, BudgetStatus } from '../shared/types.ts';

export interface RequestReservation {
  requestId: string;
  runId: string;
  turnId: string;
  citizenId: string;
  inputTokens: number;
  maxOutputTokens: number;
  /** Absent on older receipts; newly reserved sends retain wall-time rate safety across reloads. */
  reservedAt?: number;
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

type SettingsEntry = { version: 1; sequence: number } & (
  ({ type: 'limits' } & BudgetLimits) | { type: 'blocked'; requestedTokens?: number }
);
export class BudgetExhausted extends Error {
  constructor(readonly blocked: BudgetBlock) {
    super(blocked.message);
  }
}

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
  private readonly settingsPath: string;
  private maxRequests: number;
  private maxTokens: number;
  private settingsText = '';
  private settingsSequence = 0;
  private blockedRequestedTokens?: number;
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
    this.settingsPath = resolve(root, 'budget-settings.jsonl');
    try {
      mkdirSync(root, { recursive: true });
      this.locked(() => {
        if (!existsSync(this.path)) {
          if (existsSync(this.settingsPath))
            throw new Error('Missing request ledger; budget settings retained');
          const fd = openSync(this.path, 'wx');
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        }
        this.reload();
        if (!existsSync(this.settingsPath)) {
          const fd = openSync(this.settingsPath, 'wx');
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          this.appendSettings({
            version: 1,
            sequence: 1,
            type: 'limits',
            maxRequests,
            maxTokens,
          });
        }
      });
    } catch (error) {
      this.fail(error);
    }
  }

  reserve(
    input: Omit<RequestReservation, 'requestId' | 'reservedAt'>,
    rate?: { minIntervalMs: number; maxRequestsPerHour: number },
  ): RequestReservation {
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
      const now = Date.now();
      if (rate) {
        if (!count(rate.minIntervalMs) || !count(rate.maxRequestsPerHour))
          throw new Error('Invalid request rate limits');
        const starts = this.reservationTimes(now - 3600000);
        if (
          starts.length >= rate.maxRequestsPerHour ||
          starts.some((time) => now - time < rate.minIntervalMs)
        )
          throw new Error('Global request rate limit reached; no request reserved or sent.');
      }
      const blocked = this.capacityBlock(reservedTokens);
      if (blocked) {
        this.rememberBlock(reservedTokens);
        throw new BudgetExhausted(blocked);
      }
      const reservation: RequestReservation = {
        requestId: randomUUID(),
        runId: input.runId,
        turnId: input.turnId,
        citizenId: input.citizenId,
        inputTokens: input.inputTokens,
        maxOutputTokens: input.maxOutputTokens,
        reservedAt: now,
      };
      this.append({ version: 1, sequence: this.sequence + 1, type: 'reserve', ...reservation });
      this.clearSatisfiedBlock();
      return reservation;
    });
  }

  /** Includes reservations from prior runner instances; unknown old dates cannot establish a rate. */
  recentReservationTimes(since: number): number[] {
    this.healthy();
    return this.locked(() => {
      this.reload();
      return this.reservationTimes(since);
    });
  }
  private reservationTimes(since: number): number[] {
    return [...this.requests.values()].flatMap(({ reservation }) =>
      reservation.reservedAt !== undefined && reservation.reservedAt > since
        ? [reservation.reservedAt]
        : [],
    );
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
      this.clearSatisfiedBlock();
    });
  }

  /** Explicit operator edits only. Existing receipts/reservations are never rewritten. */
  setLimits(limits: BudgetLimits): void {
    this.healthy();
    if (!count(limits.maxRequests) || !count(limits.maxTokens))
      throw new Error('Budget limits must be nonnegative safe integers');
    this.locked(() => {
      this.reload();
      this.appendSettings({
        version: 1,
        sequence: this.settingsSequence + 1,
        type: 'limits',
        maxRequests: limits.maxRequests,
        maxTokens: limits.maxTokens,
      });
    });
  }

  /** Preflight without a paid reservation or a diagnostic turn. Remember a failed size once. */
  checkCapacity(requestedTokens: number, remember = true): BudgetBlock | undefined {
    this.healthy();
    if (!count(requestedTokens)) throw new Error('Invalid requested tokens');
    return this.locked(() => {
      this.reload();
      const blocked = this.capacityBlock(requestedTokens);
      if (blocked && remember) {
        // Keep one diagnostic size while capacity is still insufficient: changing
        // ticks/context must not generate a settings write on every skipped review.
        if (
          this.blockedRequestedTokens === undefined ||
          !this.capacityBlock(this.blockedRequestedTokens)
        )
          this.rememberBlock(requestedTokens);
      } else if (!blocked && remember && this.blockedRequestedTokens !== undefined) {
        // A fresh bounded turn can be smaller than the failed continuation.
        this.appendSettings({ version: 1, sequence: this.settingsSequence + 1, type: 'blocked' });
      }
      return blocked;
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
    const blocked = this.capacityBlock(this.blockedRequestedTokens ?? 0);
    return {
      requests: this.requests.size,
      pending: [...this.requests.values()].filter((request) => !request.settled).length,
      spent: this.requests.size,
      limit: this.maxRequests,
      unit: 'requests',
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      ...(!this.error && blocked ? { blocked } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private capacityBlock(requestedTokens: number): BudgetBlock | undefined {
    const remainingTokens = Math.max(0, this.maxTokens - this.tokens);
    if (this.requests.size >= this.maxRequests) {
      return {
        reason: 'requests',
        requestedTokens,
        remainingTokens,
        message: `Request budget exhausted: needs 1 request; 0 remaining (${this.requests.size}/${this.maxRequests} used). Reservation needs ${requestedTokens} tokens; ${remainingTokens} remaining.`,
      };
    }
    if (requestedTokens > this.maxTokens - this.tokens || this.tokens >= this.maxTokens) {
      return {
        reason: 'tokens',
        requestedTokens,
        remainingTokens,
        message: `Token budget exhausted: reservation needs ${requestedTokens} tokens; ${remainingTokens} remaining (${this.tokens}/${this.maxTokens} used).`,
      };
    }
  }
  private rememberBlock(requestedTokens: number): void {
    if (this.blockedRequestedTokens === requestedTokens) return;
    this.appendSettings({
      version: 1,
      sequence: this.settingsSequence + 1,
      type: 'blocked',
      requestedTokens,
    });
  }
  private clearSatisfiedBlock(): void {
    if (
      this.blockedRequestedTokens !== undefined &&
      !this.capacityBlock(this.blockedRequestedTokens)
    )
      this.appendSettings({ version: 1, sequence: this.settingsSequence + 1, type: 'blocked' });
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
    this.writeEntry(this.path, entry);
  }
  private appendSettings(entry: SettingsEntry): void {
    this.writeEntry(this.settingsPath, entry);
  }
  private writeEntry(path: string, entry: Entry | SettingsEntry): void {
    try {
      const fd = openSync(path, 'a');
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
  private reloadSettings(): void {
    if (!existsSync(this.settingsPath)) {
      if (this.settingsText) throw new Error('Missing budget settings journal');
      return;
    }
    const text = readFileSync(this.settingsPath, 'utf8');
    if (!text) throw new Error('Empty budget settings journal');
    if (!text.startsWith(this.settingsText) || (text.length > 0 && !text.endsWith('\n')))
      throw new Error('Truncated or rewritten budget settings journal');
    let sequence = 0;
    let requestedTokens: number | undefined;
    for (const line of text === '' ? [] : text.slice(0, -1).split('\n')) {
      const entry = JSON.parse(line) as SettingsEntry;
      if (!entry || entry.version !== 1 || entry.sequence !== ++sequence)
        throw new Error('Invalid budget settings version or sequence');
      if (entry.type === 'limits') {
        if (!count(entry.maxRequests) || !count(entry.maxTokens))
          throw new Error('Invalid budget settings limits');
        this.maxRequests = entry.maxRequests;
        this.maxTokens = entry.maxTokens;
        requestedTokens = undefined;
      } else if (entry.type === 'blocked' && sequence > 1) {
        if (entry.requestedTokens !== undefined && !count(entry.requestedTokens))
          throw new Error('Invalid budget block size');
        requestedTokens = entry.requestedTokens;
      } else {
        throw new Error('Unknown budget settings entry type');
      }
    }
    this.blockedRequestedTokens = requestedTokens;
    this.settingsSequence = sequence;
    this.settingsText = text;
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
            !count(entry.maxOutputTokens) ||
            (entry.reservedAt !== undefined && !count(entry.reservedAt))
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
      this.reloadSettings();
    } catch (error) {
      this.fail(error);
      this.healthy();
    }
  }
}
