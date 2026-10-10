import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CitizenRunner, type CitizenTurnRecord } from '../src/citizen/runner.ts';
import { RequestLedger } from '../src/citizen/budget.ts';
import { ollamaTransport, type Transport } from '../src/citizen/provider.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';

// Off by default. This is an isolated, staged competence probe, NOT emergence.
// Each invocation has a hard cap of 8 total provider sends; no automatic retries.
if (!process.argv.includes('--confirm-live')) {
  console.log(
    'Network disabled. Opt in: npx tsx scripts/probe-live.ts --confirm-live (at most 8 paid requests, OS-temp world/ledger only).',
  );
} else {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-live-schema-'));
  const evidencePath = join(directory, 'evidence.json');
  const maxRequests = 8;
  const world = createWorld({ seed: 29, runId: `probe-${randomUUID()}` });
  const ledger = new RequestLedger({ directory, maxRequests, maxTokens: 2_000_000 });
  const selected = Object.keys(world.citizens).slice(0, 2);
  for (const id of selected) {
    world.citizens[id].goals = [
      'Staged competence test: start one harvest of a stocked visible T1 deposit to gather materials. Use the exact ID from entityIndex, not coordinates. Then end the turn; do not replace active work or send messages/orders.',
    ];
  }
  updateKnowledge(world);
  let sends = 0;
  const requests: unknown[] = [];
  const advances: unknown[] = [];
  const records: CitizenTurnRecord[] = [];
  const evidence: Record<string, unknown> = {
    purpose: 'Real live staged command-schema competence; not evidence of emergence.',
    model: 'deepseek-v4.1-flash:cloud',
    reasoningEffort: 'high',
    maxOutputTokens: 40000,
    maxRequests,
    directory,
    runId: world.runId,
    selected,
    requests,
    advances,
    records,
  };
  function save() {
    evidence.sends = sends;
    evidence.budget = ledger.status();
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    writeFileSync(join(directory, 'world.json'), JSON.stringify(world));
  }
  const transport: Transport = async (request) => {
    assert(sends < maxRequests, 'Hard send cap reached; no network call made');
    sends++;
    const entry: Record<string, unknown> = {
      requestId: request.requestId,
      turnId: request.turnId,
      citizenId: request.citizenId,
      tick: world.tick,
      payload: request.payload,
    };
    requests.push(entry);
    save(); // Evidence of attempted send, before any network activity.
    try {
      const response = await ollamaTransport(request);
      entry.response = response; // Transport projects only content/tools/usage/finish reason.
      return response;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : 'Provider failed';
      throw error;
    } finally {
      save();
    }
  };
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => observe(world, id),
      command: (id, command) => {
        const gate = validateKnownCommand(world, id, command);
        if (!gate.ok) return gate;
        const result = dispatch(world, id, command);
        updateKnowledge(world);
        return result;
      },
      diagnostic: (record) => {
        const index = records.findIndex((entry) => entry.id === record.id);
        if (index < 0) records.push(record);
        else records[index] = record;
        save();
      },
    },
    {
      mode: 'live',
      ledger,
      transport,
      maxConcurrent: 1,
      maxRequestsPerTurn: 4,
      maxToolsPerTurn: 32,
      maxOutputTokens: 40000,
      requestTimeoutMs: 120_000,
    },
  );
  let failure: string | undefined;
  try {
    // Exactly two fresh contexts; tick(), which could schedule other citizens, is never called.
    for (const id of selected) {
      const before = structuredClone(world.citizens[id]);
      await runner.startTurn(id, 'isolated real live schema probe');
      const action = structuredClone(world.citizens[id].action);
      const eventsBefore = new Set(world.events.map((event) => event.id));
      const fromTick = world.tick;
      let advanced = 0;
      while ((world.citizens[id].action || world.citizens[id].queue.length) && advanced < 128) {
        tickWorld(world);
        updateKnowledge(world);
        advanced++;
      }
      const completions = world.events.filter(
        (event) =>
          !eventsBefore.has(event.id) && event.kind === 'completion' && event.citizenId === id,
      );
      advances.push({
        citizenId: id,
        fromTick,
        toTick: world.tick,
        advanced,
        before,
        acceptedAction: action,
        after: structuredClone(world.citizens[id]),
        completions,
      });
      save();
    }
    const lines = readFileSync(join(directory, 'request-ledger.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const reserves = lines.filter((entry) => entry.type === 'reserve');
    const settles = lines.filter((entry) => entry.type === 'settle');
    const budget = ledger.status();
    const tokens = settles.reduce((sum, entry) => {
      const reserve = reserves.find((candidate) => candidate.requestId === entry.requestId);
      return (
        sum +
        (entry.usage
          ? entry.usage.inputTokens + entry.usage.outputTokens
          : reserve.inputTokens + reserve.maxOutputTokens)
      );
    }, 0);
    const checks = {
      twoFreshTurns: records.length === 2 && records.every((record) => record.requests.length > 0),
      acceptedHarvestEachTurn:
        records.length === 2 &&
        records.every((record) =>
          record.calls.some((call) => call.command.type === 'harvest' && call.result.ok),
        ),
      completedHarvestEachTurn: selected.every((id) =>
        world.events.some(
          (event) =>
            event.kind === 'completion' &&
            event.citizenId === id &&
            event.text === 'Completed harvest.',
        ),
      ),
      sendCap: sends <= maxRequests && reserves.length === sends,
      receiptIdentity:
        settles.length === reserves.length &&
        new Set(settles.map((entry) => entry.requestId)).size === reserves.length &&
        settles.every((entry) => reserves.some((reserve) => reserve.requestId === entry.requestId)),
      settledBudget:
        !budget.error &&
        budget.pending === 0 &&
        budget.requests === sends &&
        budget.spent === sends &&
        budget.tokens === tokens,
      usageReceipts: settles.every((entry) => entry.usage !== undefined),
      conservedGold:
        Object.values(world.citizens).reduce((sum, c) => sum + c.gold, 0) +
          Object.values(world.orders).reduce((sum, order) => sum + order.escrowGold, 0) +
          Object.values(world.loot).reduce((sum, loot) => sum + loot.gold, 0) ===
        world.initialGold,
    };
    evidence.checks = checks;
    evidence.toolErrors = records.flatMap((record) =>
      record.toolEvents.filter((event) => (event.result as { ok?: boolean })?.ok === false),
    );
    assert(
      Object.values(checks).every(Boolean),
      `Probe checks failed: ${Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
        .join(', ')}`,
    );
    evidence.outcome = 'passed';
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Probe failed';
    evidence.outcome = 'failed';
    evidence.failure = failure;
    process.exitCode = 1;
  } finally {
    runner.interrupt('probe finished');
    save();
    const summaryPath = join(directory, 'summary.json');
    writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          outcome: evidence.outcome,
          failure,
          evidencePath,
          sends,
          maxRequests,
          tick: world.tick,
          model: evidence.model,
          reasoningEffort: evidence.reasoningEffort,
          maxOutputTokens: evidence.maxOutputTokens,
          budget: ledger.status(),
          checks: evidence.checks,
          // Only projected public metadata; no hidden reasoning or credentials.
          requests: requests.map((value) => {
            const entry = value as {
              requestId: string;
              citizenId: string;
              response?: { finishReason?: string; usage?: unknown; toolCalls?: unknown };
              error?: string;
            };
            return {
              requestId: entry.requestId,
              citizenId: entry.citizenId,
              finishReason: entry.response?.finishReason,
              usage: entry.response?.usage,
              toolCalls: entry.response?.toolCalls,
              error: entry.error,
            };
          }),
          turns: records.map((record) => ({
            citizenId: record.citizenId,
            status: record.status,
            stopReason: record.stopReason,
            error: record.error,
            calls: record.calls,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            toolErrors: record.toolEvents.filter(
              (event) => (event.result as { ok?: boolean })?.ok === false,
            ),
          })),
          completions: world.events.filter((event) => event.kind === 'completion'),
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        outcome: evidence.outcome,
        sends,
        tick: world.tick,
        checks: evidence.checks,
        failure,
        summaryPath,
      }),
    );
  }
}
