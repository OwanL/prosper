import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { CitizenRunner, type CitizenTurnRecord } from '../src/citizen/runner.ts';
import { RequestLedger } from '../src/citizen/budget.ts';
import {
  ollamaTransport,
  ollamaNativeTransport,
  type ProviderResponse,
} from '../src/citizen/provider.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';
import { strategicContext } from '../src/citizen/strategic-context.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import type { World } from '../src/shared/types.ts';

// Each process has a hard two-send ceiling and a unique retained ledger. No fallback,
// retries, background runner scheduling, existing-world writes or model downloads.
const args = process.argv.slice(2);
const modelIndex = args.indexOf('--model');
const model = modelIndex >= 0 ? args[modelIndex + 1] : undefined;
const local = args.includes('--confirm-local');
const cloud = args.includes('--confirm-cloud');
const caseIndex = args.indexOf('--case');
const selectedCase = caseIndex >= 0 ? args[caseIndex + 1] : undefined;
const argument = (key: string) => {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
};
const snapshot = argument('--snapshot'),
  subject = argument('--citizen'),
  label = argument('--label');
if (selectedCase && !['livelihood', 'contested-resources'].includes(selectedCase))
  throw new Error('Invalid selected case.');
if (!model || local === cloud || (!local && !cloud)) {
  console.log(
    'Offline. Run: npm.cmd exec -- tsx scripts/probe-policy.ts --model qwen3.5:9b --confirm-local',
  );
  console.log(
    'Cloud requires --confirm-cloud and a separate reviewed spend gate. Each invocation sends at most two requests.',
  );
} else {
  if (local && /cloud/.test(model))
    throw new Error('Local confirmation cannot authorize a cloud model.');
  if (cloud && !/cloud/.test(model))
    throw new Error('Cloud comparison must name its explicit cloud alias.');
  const catalog = (await fetch('http://127.0.0.1:11434/api/tags', {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json())) as { models: { name: string }[] };
  if (!catalog.models.some((entry) => entry.name === model))
    throw new Error('Explicit model is not in the local catalog; no pull or fallback performed.');
  const experimentId = `policy-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = resolve('.experiments', experimentId);
  mkdirSync(directory, { recursive: true });
  const ledger = new RequestLedger({ directory, maxRequests: 2, maxTokens: 80000 });
  const cases: unknown[] = [];
  let sends = 0;
  for (const stage of ['livelihood', 'contested-resources'] as const) {
    if (selectedCase && stage !== selectedCase) continue;
    const world: World = snapshot
      ? JSON.parse(readFileSync(resolve(snapshot), 'utf8'))
      : createWorld({
          seed: stage === 'livelihood' ? 42 : 2,
          scenario: 'competition',
          autonomy: true,
          runId: `${experimentId}-${stage}`,
        });
    world.runId = `${experimentId}-${stage}`;
    if (!snapshot && stage === 'contested-resources') tickWorld(world, 900);
    updateKnowledge(world);
    const living = Object.values(world.citizens).filter((c) => c.alive);
    const citizen = subject
      ? living.find((c) => c.id === subject || c.name === subject)
      : stage === 'livelihood'
        ? living[1]
        : living.sort(
            (a, b) =>
              Object.values(b.autonomy?.relationships ?? {}).reduce(
                (sum, r) => sum + r.grievance,
                0,
              ) -
              Object.values(a.autonomy?.relationships ?? {}).reduce(
                (sum, r) => sum + r.grievance,
                0,
              ),
          )[0];
    if (!citizen) throw new Error('Probe scenario has no living subject.');
    const initial = structuredClone(citizen);
    writeFileSync(join(directory, `${label ?? stage}-starting-world.json`), JSON.stringify(world));
    const observation = observe(world, citizen.id);
    const requests: unknown[] = [];
    let lastRecord: CitizenTurnRecord | undefined;
    let response: ProviderResponse | undefined;
    const compactBytes = Buffer.byteLength(JSON.stringify(strategicContext(observation)));
    const legacyBytes = Buffer.byteLength(JSON.stringify(freshContext(observation)));
    const entry: Record<string, unknown> = {
      stage: label ?? stage,
      sourceSnapshot: snapshot,
      citizenId: citizen.id,
      initial,
      compactBytes,
      legacyBytes,
      requests,
    };
    cases.push(entry);
    const save = () =>
      writeFileSync(
        join(directory, 'evidence.json'),
        JSON.stringify(
          {
            experimentId,
            directory,
            model,
            local,
            maxRequests: 2,
            maxOutputTokens: 1200,
            reasoningEffort: 'none',
            sends,
            budget: ledger.status(),
            cases,
          },
          null,
          2,
        ),
      );
    let baseline: World | undefined;
    const runner = new CitizenRunner(
      {
        world: () => world,
        observe: (id) => observe(world, id),
        command: (id, command) => {
          const gate = validateKnownCommand(world, id, command);
          const result = gate.ok ? dispatch(world, id, command) : gate;
          updateKnowledge(world);
          return result;
        },
        diagnostic: (record) => {
          lastRecord = record;
          entry.record = record;
          save();
        },
      },
      {
        mode: 'live',
        model,
        reasoningEffort: 'none',
        ledger,
        maxConcurrent: 1,
        maxRequestsPerTurn: 1,
        maxOutputTokens: 1200,
        minRequestIntervalTicks: 0,
        minRequestIntervalMs: 0,
        requestTimeoutMs: 120000,
        transport: async (request) => {
          if (++sends > 2) throw new Error('Hard process send cap exceeded.');
          const wire = { requestId: request.requestId, payload: request.payload };
          requests.push(wire);
          save();
          response = await (local ? ollamaNativeTransport : ollamaTransport)(request);
          baseline = structuredClone(world);
          entry.response = response;
          save();
          return response;
        },
      },
    );
    let clockError: string | undefined;
    const fromTick = world.tick;
    const clock = setInterval(() => {
      try {
        tickWorld(world);
        updateKnowledge(world);
      } catch (error) {
        clockError = String(error);
      }
    }, 250);
    try {
      await runner.startTurn(citizen.id, `bounded ${stage} one-shot policy probe`);
    } finally {
      clearInterval(clock);
      runner.interrupt('probe complete');
    }
    const inferenceTicks = world.tick - fromTick;
    const follow = (state: World) => {
      let sequence = state.nextId;
      const outcomes: Record<string, number> = {};
      for (let i = 0; i < 600; i++) {
        tickWorld(state);
        updateKnowledge(state);
        for (const event of state.events)
          if (Number(event.id.split('-').at(-1)) >= sequence)
            outcomes[event.kind] = (outcomes[event.kind] ?? 0) + 1;
        sequence = state.nextId;
      }
      const actor = state.citizens[citizen.id];
      return {
        outcomes,
        alive: actor.alive,
        health: actor.health,
        fullness: actor.fullness,
        gold: actor.gold,
        inventory: actor.inventory,
        intent: actor.autonomy?.intent,
        population: Object.values(state.citizens).filter((c) => c.alive).length,
      };
    };
    const downstream = follow(world);
    const continuation = baseline ? follow(baseline) : undefined;
    const accepted =
      lastRecord?.toolEvents.some(
        (event) =>
          ['set_strategy', 'set_policy'].includes(event.name) &&
          (event.result as { ok?: boolean })?.ok === true,
      ) ?? false;
    entry.summary = {
      accepted,
      policyOutcome: lastRecord?.policyOutcome,
      status: lastRecord?.status,
      stopReason: lastRecord?.stopReason,
      usage: response?.usage,
      elapsedMs: lastRecord?.elapsedMs,
      inferenceTicks,
      clockError,
      alive: citizen.alive,
      policy: citizen.autonomy?.policy,
      intent: citizen.autonomy?.intent,
      downstream,
      continuation,
    };
    entry.after = structuredClone(citizen);
    save();
    writeFileSync(join(directory, `${stage}-world.json`), JSON.stringify(world));
    console.log(
      JSON.stringify({ stage, model, compactBytes, legacyBytes, ...(entry.summary as object) }),
    );
  }
  console.log(JSON.stringify({ directory, sends, budget: ledger.status() }));
}
