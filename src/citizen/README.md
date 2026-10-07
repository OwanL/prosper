# Citizen runtime integration

```ts
import { CitizenRunner } from './citizen/index.ts';
import { observe } from './world/observation.ts';
import { dispatch, tickWorld } from './world/core.ts';

const runner = new CitizenRunner(
  {
    world: () => world, // closure must point at the current restored world
    observe: (id) => observe(world, id),
    command: (id, command) => dispatch(world, id, command), // synchronous serialized boundary
    diagnostic: (record) => diagnostics.write(record), // private structured logs, not citizen knowledge
  },
  { ledgerOptions: { directory: '.prosper-v2', maxRequests: 100, maxTokens: 100_000 } },
);

// Runtime owns play/pause/time. Never await reasoning in the world tick loop.
tickWorld(world);
runner.tick();

// Stop ticks first; invalidate synchronously BEFORE saving/replacing the world.
runner.interrupt('backend reload');
await saveCheckpoint(world); // includes nextReviewTick, physical work, goals/memories
// Recreate runner after restore. Unfinished transcripts are not resumed.

// Explicit opt-in, not a fallback:
runner.setMode('live');
const turns = runner.records();
const { mode, generation, thinking, error } = runner.status();
const budget = runner.budget();
```

`startTurn(id, reason?)` is an explicit review override returning a completion promise; concurrent calls for the same citizen return the same promise. `tick()` schedules due living citizens using persisted `nextReviewTick` (default interval 12 ticks, max concurrency 4). Interrupt/mode change invalidates generations, aborts active transports, clears thinking immediately and makes interrupted citizens due for fresh review. It does not cancel physical work or wait for provider cooperation. `setMode('scripted')` is the default mechanical survival/harvest/tool progression demo, explicitly not an emergence/personality evaluation.

Recorded mode requires an explicitly imported `recorded: RecordedTurn[]` with `{citizenId, responses: ProviderResponse[]}` per turn. Responses contain optional `content`, `toolCalls: [{id,name,arguments}]`, and `usage: {inputTokens,outputTokens}`. Fixtures are consumed in citizen order; exhaustion is a visible planner failure, never a live fallback. Reproduction of exact historical timing remains the runtime's responsibility: records carry run/turn/request/command identity and application ticks, but fixture mode alone does not replay a whole world.

Live requests have a bounded local deadline: `requestTimeoutMs` or `PROSPER_REQUEST_TIMEOUT_MS`, default 120,000ms and maximum 600,000ms. A timed-out request releases the citizen's thinking slot without stopping physical work or refunding uncertain usage. Late receipts may settle accounting, never execute commands.

Live defaults: local Ollama OpenAI-compatible `http://127.0.0.1:11434/v1/chat/completions`, model `deepseek-v4.1-flash:cloud`, `reasoning_effort: high`, nonstreaming, maximum output 1024 tokens. Context is fresh each turn, retained only within its bounded tool loop (4 requests, 12 tool calls by default). Tools validate exact command shapes before the core validates gameplay; query_tile uses current/dated observation only. Repeated tool call IDs cannot commit twice within a turn. Core commands retain goals and compact notes; no old assistant response is carried forward. No complex memory research or continuity effectiveness claim is made.

Private inspector records include exact initial observation, projected request payloads, explicit response content, calls/results, identities, acceptance errors and durations. Hidden provider reasoning, HTTP headers and raw provider failure bodies are omitted. Records retain the latest 100 finished turns plus current active turns; diagnostics receive copies at relevant transitions, so the runtime can durably store them outside world state. Diagnostic exceptions do not stop physical time. Do not expose inspector data as citizen knowledge.

## Accounting and live-verification limitations

The isolated `.prosper-v2/request-ledger.jsonl` ledger reserves synchronously and fsyncs **before** send. It is independent of checkpoints and inspector retention; never delete/reset it as part of scenario/mode changes. Accounting units are request count and tokens, **not dollars**. Input reservation is the entire request's UTF-8 byte count used as a conservative token estimate (not an exact tokenizer); output reservation is max_tokens, including any reasoning counted by the provider in completion usage. Actual valid receipts replace estimates once; absent usage charges the reserved amount. Interrupted unresolved calls remain pending/charged; eventual receipts may settle accounting but cannot execute commands. Failed requests conservatively consume their reservation. Usage above the cap prevents further reservations. Damaged/truncated accounting or a stale lock fails closed; investigate/reconcile manually rather than resetting potentially charged requests. No code touches old `.prosper` data.

All verification used mocked delayed/failed/completed transports, explicit fixtures, and OS-temp ledger directories. **No actual Ollama/provider calls were made.** Local model availability, cloud authentication, schema/tool-calling compatibility, high-reasoning support, actual tokenizer/usage semantics, provider pricing and ASCII spatial competence remain unverified. No dollar cap or emergence claim is made. If the endpoint does not supply usage, conservative reservations remain the only accounting evidence; cancellation does not establish that billing stopped.
