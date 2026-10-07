import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createBudget, createRuntimeBudget, replaceLedgerFile, acquireLedgerLock } from '../lib/budget.mjs';
import { Worker } from 'node:worker_threads';

test('ledger acquisition waits briefly for contention without removing another owner lock', () => {
  let opens = 0;
  const waits = [];
  const fd = acquireLedgerLock('held.lock', { open: () => {
    if (++opens < 3) throw Object.assign(new Error('held'), { code: 'EEXIST' });
    return 123;
  }, wait: ms => waits.push(ms) });
  assert.equal(fd, 123);
  assert.deepEqual(waits, [5, 10]);
  assert.throws(() => acquireLedgerLock('held.lock', {
    open: () => { throw Object.assign(new Error('held'), { code: 'EEXIST' }); }, wait: () => {},
  }), error => error.code === 'PROSPER_BUDGET_LOCKED');
});

test('Windows lock creation retries handle-closing denial while permanent access failures remain closed', () => {
  let attempts = 0;
  const waits = [];
  assert.equal(acquireLedgerLock('closing.lock', { platform: 'win32', open: () => {
    if (++attempts < 3) throw Object.assign(new Error('handle closing'), { code: 'EPERM' });
    return 123;
  }, wait: ms => waits.push(ms) }), 123);
  assert.deepEqual(waits, [5, 10]);
  assert.throws(() => acquireLedgerLock('denied.lock', { platform: 'win32',
    open: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, wait: () => {},
  }), /Cannot acquire.*denied/);
});

test('independent concurrent ledger writers preserve every reservation and settlement', async t => {
  const filePath = ledgerPath(t), budget = createBudget({ filePath });
  const source = `const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{ const {createBudget}=await import(workerData.moduleURL);
      const budget=createBudget({filePath:workerData.filePath});
      for(let i=0;i<20;i++){const id=budget.reserve(100,100); budget.settle(id,{inputTokens:20,outputTokens:50});}
    })().then(()=>parentPort.postMessage('done')).catch(e=>{throw e;});`;
  await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { filePath, moduleURL: new URL('../lib/budget.mjs', import.meta.url).href } });
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code) reject(new Error(`Writer exited ${code}`)); });
  })));
  const snapshot = budget.snapshot();
  assert.equal(snapshot.requests, 60);
  assert.equal(snapshot.settledRequests, 60);
  assert.equal(snapshot.uncertainRequests, 0);
  assert.equal(snapshot.inputTokens, 1200);
  assert.equal(snapshot.outputTokens, 3000);
  assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')).pending, []);
});

test('Windows atomic replacement retries transient denial with identical paths', () => {
  const calls = [], waits = [];
  replaceLedgerFile('temporary-ledger', 'existing-ledger', { platform: 'win32', wait: ms => waits.push(ms), rename: (source, destination) => {
    calls.push([source, destination]);
    if (calls.length < 3) throw Object.assign(new Error('temporary denial'), { code: 'EPERM' });
  } });
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ['temporary-ledger', 'existing-ledger']));
  assert.deepEqual(waits, [10, 20]);
});

test('atomic replacement fails closed after bounded retries or a nontransient error', () => {
  for (const code of ['EPERM', 'ENOSPC']) {
    let attempts = 0;
    const waits = [];
    assert.throws(() => replaceLedgerFile('temporary', 'existing', { platform: 'win32', wait: ms => waits.push(ms), rename: () => {
      attempts++; throw Object.assign(new Error(code), { code });
    } }), { message: code });
    assert.equal(attempts, code === 'EPERM' ? 6 : 1);
    assert.equal(waits.reduce((sum, ms) => sum + ms, 0), code === 'EPERM' ? 310 : 0);
  }
});

for (const previousLimit of [3, 10]) test(`authorized ${previousLimit}-to-20 runtime cap migration preserves all charges`, t => {
  const filePath = ledgerPath(t);
  const old = createBudget({ filePath, limitUsd: previousLimit });
  const settled = old.reserve(100, 100); old.settle(settled, { inputTokens: 80, outputTokens: 60 });
  const uncertain = old.reserve(200, 200); old.settle(uncertain, null);
  const pending = old.reserve(300, 300);
  const before = JSON.parse(readFileSync(filePath, 'utf8'));
  const migrated = createRuntimeBudget({ filePath });
  assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), { ...before, limitUsd: 20 });
  assert.equal(migrated.snapshot().chargedUsd, before.chargedUsd);
  migrated.settle(pending, { inputTokens: 1, outputTokens: 1 });
  assert.equal(createRuntimeBudget({ filePath }).snapshot().limitUsd, 20);
});

function ledgerPath(t) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-budget-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, '.prosper', 'budget.json');
}

test('reserves upper bounds before calls, then replaces them with actual catalog usage across restarts', (t) => {
  const filePath = ledgerPath(t);
  const budget = createBudget({ filePath });
  assert.deepEqual(budget.snapshot(), {
    limitUsd: 3,
    chargedUsd: 0.1,
    remainingUsd: 2.9,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    settledRequests: 0,
    uncertainRequests: 0,
    initialReserveUsd: 0.1,
    inputPerMillion: 0.15,
    outputPerMillion: 0.5,
  });

  const id = budget.reserve(1_000_000, 1_000_000);
  assert.equal(budget.snapshot().chargedUsd, 0.75);
  assert.equal(budget.snapshot().requests, 1);
  assert.throws(() => budget.reserve(0, 6_000_000), /Cannot reserve model request.*remaining/);
  assert.equal(budget.snapshot().requests, 1, 'a rejected reservation is not counted');

  const restarted = createBudget({ filePath });
  assert.equal(restarted.snapshot().chargedUsd, 0.75, 'pending upper bounds survive a restart');
  restarted.settle(id, { inputTokens: 100, outputTokens: 20 });
  assert.deepEqual(restarted.snapshot(), {
    limitUsd: 3,
    chargedUsd: 0.100025,
    remainingUsd: 2.899975,
    inputTokens: 100,
    outputTokens: 20,
    requests: 1,
    settledRequests: 1,
    uncertainRequests: 0,
    initialReserveUsd: 0.1,
    inputPerMillion: 0.15,
    outputPerMillion: 0.5,
  });

  const settledAgain = createBudget({ filePath });
  assert.deepEqual(settledAgain.snapshot(), restarted.snapshot());
  assert.throws(() => settledAgain.settle(id, { inputTokens: 1, outputTokens: 1 }), /Unknown or already settled/);
});

test('null or invalid usage keeps its upper-bound charge as uncertain across restarts', (t) => {
  const filePath = ledgerPath(t);
  const budget = createBudget({ filePath, limitUsd: 1, initialReserveUsd: 0.05 });
  const firstId = budget.reserve(10_000, 20_000);
  budget.settle(firstId, null);
  assert.equal(budget.snapshot().chargedUsd, 0.0615);
  assert.equal(budget.snapshot().uncertainRequests, 1);

  const restarted = createBudget({ filePath, limitUsd: 1, initialReserveUsd: 0.05 });
  const secondId = restarted.reserve(30_000, 40_000);
  restarted.settle(secondId, { inputTokens: -1, outputTokens: 1 });
  const uncertainSnapshot = restarted.snapshot();
  assert.equal(uncertainSnapshot.limitUsd, 1);
  assert.ok(Math.abs(uncertainSnapshot.chargedUsd - 0.086) < 1e-12);
  assert.ok(Math.abs(uncertainSnapshot.remainingUsd - 0.914) < 1e-12);
  assert.deepEqual({
    inputTokens: uncertainSnapshot.inputTokens,
    outputTokens: uncertainSnapshot.outputTokens,
    requests: uncertainSnapshot.requests,
    settledRequests: uncertainSnapshot.settledRequests,
    uncertainRequests: uncertainSnapshot.uncertainRequests,
    initialReserveUsd: uncertainSnapshot.initialReserveUsd,
    inputPerMillion: uncertainSnapshot.inputPerMillion,
    outputPerMillion: uncertainSnapshot.outputPerMillion,
  }, {
    inputTokens: 0,
    outputTokens: 0,
    requests: 2,
    settledRequests: 0,
    uncertainRequests: 2,
    initialReserveUsd: 0.05,
    inputPerMillion: 0.15,
    outputPerMillion: 0.5,
  });

  assert.deepEqual(createBudget({ filePath, limitUsd: 1, initialReserveUsd: 0.05 }).snapshot(), uncertainSnapshot);
});

test('independent instances serialize reservations and settlements against the latest ledger', (t) => {
  const filePath = ledgerPath(t);
  const first = createBudget({ filePath, limitUsd: 0.3, initialReserveUsd: 0 });
  const second = createBudget({ filePath, limitUsd: 0.3, initialReserveUsd: 0 });

  const firstId = first.reserve(1_000_000, 0);
  const secondId = second.reserve(0, 200_000);
  assert.equal(first.snapshot().chargedUsd, 0.25, 'snapshots reload reservations written by another instance');
  assert.equal(first.snapshot().requests, 2);
  assert.throws(() => first.reserve(0, 200_000), /Cannot reserve model request.*remaining/);

  second.settle(secondId, { inputTokens: 0, outputTokens: 100_000 });
  first.settle(firstId, { inputTokens: 100_000, outputTokens: 0 });
  assert.deepEqual(first.snapshot(), {
    limitUsd: 0.3,
    chargedUsd: 0.065,
    remainingUsd: 0.235,
    inputTokens: 100_000,
    outputTokens: 100_000,
    requests: 2,
    settledRequests: 2,
    uncertainRequests: 0,
    initialReserveUsd: 0,
    inputPerMillion: 0.15,
    outputPerMillion: 0.5,
  });
});

test('an existing lock fails closed for mutations and initial ledger creation', (t) => {
  const filePath = ledgerPath(t);
  const budget = createBudget({ filePath });
  const originalLedger = readFileSync(filePath, 'utf8');
  const lockPath = `${filePath}.lock`;
  writeFileSync(lockPath, 'held by another process', 'utf8');

  assert.throws(() => budget.reserve(1, 0), /ledger is locked.*processes.*never removed automatically/);
  assert.equal(readFileSync(filePath, 'utf8'), originalLedger, 'a denied mutation leaves the ledger unchanged');
  assert.equal(readFileSync(lockPath, 'utf8'), 'held by another process', 'an existing lock is not removed');

  const initializationPath = ledgerPath(t);
  mkdirSync(dirname(initializationPath), { recursive: true });
  writeFileSync(`${initializationPath}.lock`, 'held during initialization', 'utf8');
  assert.throws(() => createBudget({ filePath: initializationPath }), /ledger is locked/);
  assert.equal(existsSync(initializationPath), false, 'initial creation is guarded by the lock');
  assert.equal(existsSync(`${initializationPath}.lock`), true, 'unknown locks are preserved');
});

test('mutation locks are released when validation fails', (t) => {
  const filePath = ledgerPath(t);
  const budget = createBudget({ filePath, limitUsd: 0.1, initialReserveUsd: 0 });
  const lockPath = `${filePath}.lock`;

  assert.throws(() => budget.reserve(-1, 0), /inputTokenUpperBound must be/);
  assert.equal(existsSync(lockPath), false);
  assert.throws(() => budget.reserve(1_000_000, 0), /Cannot reserve model request/);
  assert.equal(existsSync(lockPath), false);
  assert.throws(() => budget.settle('missing', { inputTokens: 1, outputTokens: 1 }), /Unknown or already settled/);
  assert.equal(existsSync(lockPath), false);

  budget.reserve(100_000, 0);
  assert.equal(budget.snapshot().requests, 1, 'the lock remains usable after failed validations');
});

test('rejects invalid bounds and fails closed on corrupt or incompatible ledgers', (t) => {
  const filePath = ledgerPath(t);
  const budget = createBudget({ filePath });
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.throws(() => budget.reserve(value, 0), /inputTokenUpperBound must be a nonnegative safe integer/);
    assert.throws(() => budget.reserve(0, value), /outputTokenUpperBound must be a nonnegative safe integer/);
  }
  assert.equal(budget.snapshot().requests, 0);

  assert.throws(() => createBudget({ filePath, limitUsd: 4 }), /corrupt or incompatible/);
  assert.throws(() => createBudget({ filePath, initialReserveUsd: 4 }), /initialReserveUsd/);

  const original = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, '{broken ledger', 'utf8');
  assert.throws(() => createBudget({ filePath }), /corrupt or unreadable; refusing to reset/);
  assert.equal(readFileSync(filePath, 'utf8'), '{broken ledger', 'corrupt data is not overwritten with a fresh budget');
  assert.notEqual(original, readFileSync(filePath, 'utf8'));
});
