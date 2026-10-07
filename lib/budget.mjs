import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const VERSION = 1;
const INPUT_PER_MILLION = 0.15;
const OUTPUT_PER_MILLION = 0.5;
const TOKEN_DIVISOR = 1_000_000;
const LEDGER_KEYS = [
  'version', 'limitUsd', 'initialReserveUsd', 'settledUsd', 'uncertainUsd', 'chargedUsd',
  'inputTokens', 'outputTokens', 'requests', 'settledRequests', 'uncertainRequests', 'pending',
];
const RESERVATION_KEYS = ['id', 'inputTokens', 'outputTokens', 'reserveUsd'];

// Windows readers/scanners can briefly deny replacement. Retry the SAME atomic
// rename while holding the ledger lock; never remove the destination or reset
// accounting. Permanent failures still stop reservation before provider calls.
export function replaceLedgerFile(source, destination, { rename = renameSync,
  wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), platform = process.platform } = {}) {
  const delays = [10, 20, 40, 80, 160];
  for (let attempt = 0; ; attempt++) {
    try { rename(source, destination); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === delays.length) throw error;
      wait(delays[attempt]);
    }
  }
}

function isNonnegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function catalogCharge(inputTokens, outputTokens) {
  return (inputTokens * INPUT_PER_MILLION + outputTokens * OUTPUT_PER_MILLION) / TOKEN_DIVISOR;
}

function chargedAmount(state) {
  let total = state.initialReserveUsd + state.settledUsd;
  total += state.uncertainUsd;
  for (const reservation of state.pending) total += reservation.reserveUsd;
  return total;
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validateLedger(ledger, limitUsd, initialReserveUsd) {
  if (!hasExactKeys(ledger, LEDGER_KEYS)
      || ledger.version !== VERSION
      || ledger.limitUsd !== limitUsd
      || ledger.initialReserveUsd !== initialReserveUsd
      || !isNonnegativeFiniteNumber(ledger.settledUsd)
      || !isNonnegativeFiniteNumber(ledger.uncertainUsd)
      || !isNonnegativeFiniteNumber(ledger.chargedUsd)
      || !isTokenCount(ledger.inputTokens)
      || !isTokenCount(ledger.outputTokens)
      || !isTokenCount(ledger.requests)
      || !isTokenCount(ledger.settledRequests)
      || !isTokenCount(ledger.uncertainRequests)
      || !Array.isArray(ledger.pending)) {
    throw new Error('Budget ledger is corrupt or incompatible; refusing to reset it.');
  }

  const ids = new Set();
  for (const reservation of ledger.pending) {
    if (!hasExactKeys(reservation, RESERVATION_KEYS)
        || typeof reservation.id !== 'string' || reservation.id.length === 0
        || ids.has(reservation.id)
        || !isTokenCount(reservation.inputTokens)
        || !isTokenCount(reservation.outputTokens)
        || !isNonnegativeFiniteNumber(reservation.reserveUsd)
        || reservation.reserveUsd !== catalogCharge(reservation.inputTokens, reservation.outputTokens)) {
      throw new Error('Budget ledger is corrupt or incompatible; refusing to reset it.');
    }
    ids.add(reservation.id);
  }

  const accountedRequests = ledger.settledRequests + ledger.uncertainRequests + ledger.pending.length;
  const expectedCharge = chargedAmount(ledger);
  if (!Number.isSafeInteger(accountedRequests)
      || ledger.requests !== accountedRequests
      || ledger.chargedUsd !== expectedCharge
      || !Number.isFinite(expectedCharge)) {
    throw new Error('Budget ledger is corrupt or incompatible; refusing to reset it.');
  }
}

function writeLedger(filePath, state) {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const serialized = JSON.stringify({
    version: VERSION,
    limitUsd: state.limitUsd,
    initialReserveUsd: state.initialReserveUsd,
    settledUsd: state.settledUsd,
    uncertainUsd: state.uncertainUsd,
    chargedUsd: chargedAmount(state),
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    requests: state.requests,
    settledRequests: state.settledRequests,
    uncertainRequests: state.uncertainRequests,
    pending: state.pending,
  });
  const temporaryPath = resolve(directory, `.budget-${process.pid}-${randomUUID()}.tmp`);

  try {
    writeFileSync(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    replaceLedgerFile(temporaryPath, filePath);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write/rename error.
    }
    throw new Error(`Cannot persist model budget ledger: ${error.message}`);
  }
}

export function acquireLedgerLock(lockPath, { open = openSync,
  wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), platform = process.platform } = {}) {
  const delays = [5, 10, 20, 40, 80, 160, 320, 640, 1280];
  for (let attempt = 0; ; attempt++) {
    try { return open(lockPath, 'wx', 0o600); }
    catch (error) {
      const contention = error.code === 'EEXIST';
      // Windows can report a lock whose final handle is closing as access
      // denied rather than EEXIST. Retry creation; never delete another lock.
      const transientDenial = platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (!contention && !transientDenial) throw new Error(`Cannot acquire model budget ledger lock: ${error.message}`);
      if (attempt < delays.length) { wait(delays[attempt]); continue; }
      if (!contention) throw new Error(`Cannot acquire model budget ledger lock: ${error.message}`);
      const blocked = new Error(`Model budget ledger is locked at ${lockPath}. If this lock may be stale after a crash, first check that all processes using this budget have stopped; remove it manually only after verifying. Stale locks are never removed automatically.`);
      blocked.code = 'PROSPER_BUDGET_LOCKED';
      throw blocked;
    }
  }
}

function withLedgerLock(filePath, operation) {
  const lockPath = `${filePath}.lock`;
  mkdirSync(dirname(filePath), { recursive: true });

  const lockFd = acquireLedgerLock(lockPath);

  try {
    return operation();
  } finally {
    try {
      closeSync(lockFd);
    } finally {
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new Error(`Cannot release model budget ledger lock: ${error.message}`);
        }
      }
    }
  }
}

function loadLedger(filePath, limitUsd, initialReserveUsd) {
  if (!existsSync(filePath)) {
    return {
      version: VERSION,
      limitUsd,
      initialReserveUsd,
      settledUsd: 0,
      uncertainUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      settledRequests: 0,
      uncertainRequests: 0,
      pending: [],
    };
  }

  let ledger;
  try {
    ledger = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('Budget ledger is corrupt or unreadable; refusing to reset it.');
  }
  validateLedger(ledger, limitUsd, initialReserveUsd);
  return ledger;
}

// Explicit, locked migration: raising a cap never erases usage or reservations.
export function raiseBudgetLimit({ filePath, fromLimitUsd, limitUsd, initialReserveUsd = 0.10 }) {
  if (!isNonnegativeFiniteNumber(fromLimitUsd) || !isNonnegativeFiniteNumber(limitUsd) || limitUsd < fromLimitUsd) {
    throw new Error('A budget increase requires finite limits in ascending order.');
  }
  filePath = resolve(filePath);
  return withLedgerLock(filePath, () => {
    const state = loadLedger(filePath, fromLimitUsd, initialReserveUsd);
    writeLedger(filePath, { ...state, limitUsd });
  });
}

// This spike's explicitly authorized total cap. Old ledgers migrate once;
// incompatible or corrupt ledgers still fail closed.
export function createRuntimeBudget({ filePath }) {
  filePath = resolve(filePath);
  if (existsSync(filePath)) {
    let stored;
    try { stored = JSON.parse(readFileSync(filePath, 'utf8')); }
    catch { throw new Error('Budget ledger is corrupt or unreadable; refusing to reset it.'); }
    if ([3, 10].includes(stored.limitUsd)) raiseBudgetLimit({ filePath, fromLimitUsd: stored.limitUsd, limitUsd: 20 });
  }
  return createBudget({ filePath, limitUsd: 20 });
}

export function createBudget({ filePath, limitUsd = 3, initialReserveUsd = 0.10 } = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('A model budget ledger filePath is required.');
  }
  if (!isNonnegativeFiniteNumber(limitUsd)) {
    throw new Error('limitUsd must be a finite nonnegative number.');
  }
  if (!isNonnegativeFiniteNumber(initialReserveUsd) || initialReserveUsd > limitUsd) {
    throw new Error('initialReserveUsd must be a finite nonnegative amount no greater than limitUsd.');
  }

  filePath = resolve(filePath);
  let state;
  withLedgerLock(filePath, () => {
    state = loadLedger(filePath, limitUsd, initialReserveUsd);
    if (!existsSync(filePath)) writeLedger(filePath, state);
  });

  function commit(candidate) {
    if (!Number.isFinite(chargedAmount(candidate))) {
      throw new Error('Model budget totals exceeded the supported numeric range.');
    }
    writeLedger(filePath, candidate);
    state = candidate;
  }

  function mutate(operation) {
    return withLedgerLock(filePath, () => {
      state = loadLedger(filePath, limitUsd, initialReserveUsd);
      return operation();
    });
  }

  return {
    reserve(inputTokenUpperBound, outputTokenUpperBound) {
      return mutate(() => {
        if (!isTokenCount(inputTokenUpperBound)) {
          throw new Error('inputTokenUpperBound must be a nonnegative safe integer.');
        }
        if (!isTokenCount(outputTokenUpperBound)) {
          throw new Error('outputTokenUpperBound must be a nonnegative safe integer.');
        }
        if (state.requests === Number.MAX_SAFE_INTEGER) {
          throw new Error('Model budget request counter reached its supported limit.');
        }

        const reserveUsd = catalogCharge(inputTokenUpperBound, outputTokenUpperBound);
        const newCharge = chargedAmount(state) + reserveUsd;
        if (!Number.isFinite(newCharge) || newCharge > state.limitUsd) {
          const remaining = Math.max(0, state.limitUsd - chargedAmount(state));
          throw new Error(`Cannot reserve model request: its upper bound exceeds the remaining $${remaining.toFixed(6)} budget.`);
        }

        const id = randomUUID();
        commit({
          ...state,
          requests: state.requests + 1,
          pending: [...state.pending, {
            id,
            inputTokens: inputTokenUpperBound,
            outputTokens: outputTokenUpperBound,
            reserveUsd,
          }],
        });
        return id;
      });
    },

    settle(id, usageOrNull) {
      return mutate(() => {
        if (typeof id !== 'string' || id.length === 0) {
          throw new Error('A budget reservation id is required to settle a request.');
        }
        const index = state.pending.findIndex((reservation) => reservation.id === id);
        if (index === -1) throw new Error('Unknown or already settled model budget reservation.');

        const reservation = state.pending[index];
        const pending = state.pending.filter((_, entryIndex) => entryIndex !== index);
        const validUsage = usageOrNull !== null
          && usageOrNull !== undefined
          && typeof usageOrNull === 'object'
          && !Array.isArray(usageOrNull)
          && isTokenCount(usageOrNull.inputTokens)
          && isTokenCount(usageOrNull.outputTokens);

        if (!validUsage) {
          if (state.uncertainRequests === Number.MAX_SAFE_INTEGER) {
            throw new Error('Model budget uncertain-request counter reached its supported limit.');
          }
          commit({
            ...state,
            uncertainUsd: state.uncertainUsd + reservation.reserveUsd,
            uncertainRequests: state.uncertainRequests + 1,
            pending,
          });
          return;
        }

        const inputTokens = state.inputTokens + usageOrNull.inputTokens;
        const outputTokens = state.outputTokens + usageOrNull.outputTokens;
        if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)
            || state.settledRequests === Number.MAX_SAFE_INTEGER) {
          throw new Error('Model budget token or request totals reached their supported limit.');
        }
        commit({
          ...state,
          settledUsd: state.settledUsd + catalogCharge(usageOrNull.inputTokens, usageOrNull.outputTokens),
          inputTokens,
          outputTokens,
          settledRequests: state.settledRequests + 1,
          pending,
        });
      });
    },

    snapshot() {
      state = loadLedger(filePath, limitUsd, initialReserveUsd);
      const chargedUsd = chargedAmount(state);
      return {
        limitUsd: state.limitUsd,
        chargedUsd,
        remainingUsd: Math.max(0, state.limitUsd - chargedUsd),
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        requests: state.requests,
        settledRequests: state.settledRequests,
        uncertainRequests: state.uncertainRequests,
        initialReserveUsd: state.initialReserveUsd,
        inputPerMillion: INPUT_PER_MILLION,
        outputPerMillion: OUTPUT_PER_MILLION,
      };
    },
  };
}
