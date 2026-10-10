# Citizen runtime integration

The normal model boundary is one structured **policy function**, not an agent dialogue. `CitizenRunner` defaults to compact context and a single `set_policy` response. The continuous controller in `src/world/autonomy.ts` handles ordinary survival, routing, production, markets, local disputes, alliances and family preparation. It keeps working while inference is pending, rejected, unavailable or budget-blocked.

```ts
const runner = new CitizenRunner(
  {
    world: () => world,
    observe: (id) => observe(world, id),
    command: (id, command) => dispatch(world, id, command),
    diagnostic: (record) => diagnostics.write(record),
  },
  { ledgerOptions: { directory: '.prosper-v2', maxRequests: 100, maxTokens: 100_000 } },
);

tickWorld(world);
updateKnowledge(world);
runner.tick(); // never await from the physical clock
runner.setMode('live'); // explicit opt-in; default is local/scripted
runner.interrupt('reload'); // invalidate before saving/replacing the world
```

Fresh worlds enable autonomy; mechanics-only `createWorld()` remains opt-in so old saved worlds and explicit fixtures preserve their behavior. Scripted autonomous citizens open no model turns. Local rules can yield aggregate emergence; this does not establish model intelligence.

## Policy contract

`set_policy` accepts required partial `policy`, optional `reviewAfter` (600–10,000 ticks; default 4,800), `memory` (600 characters), at most six goals and two `{text,to?}` communications. Omit `to` for public speech. There are no physical directives or `mode` fields in this surface. Empty policy deliberately continues current rules. Policy fields select livelihood/tier, prices, food reserve, home/territory/no-go areas, stance/aggression/caution, ally/rival preferences and family preference/partner. Prices are bounded and units are documented in context. Omitted fields persist; `home`, `territory` and `partnerId` accept `null` to explicitly clear a commitment. Stored policy never contains null.

Application validates shape, map bounds and known identities before changing state. A preference cannot create another citizen's consent or invent a bilateral alliance. Physical state is rechecked by the body. Work and attacks use the highest matching positive-count tool tier in carried inventory automatically; there are no equip/unequip commands or separate equipment references. Local changes during inference are expected; a newer explicit policy revision supersedes an older response. Rejected/malformed output preserves local behavior and causes no correction call. Accepted decisions record `policyOutcome: changed|continued`; structural acceptance is not a measure of strategic value.

Compact context includes own needs/personality/goals/policy, bounded personally observed relationships/evidence/delivered social signals, dated symbolic deposit/contact coordinates, public claim/alliance announcements, market summaries and recent private messages/outcomes. Current sightings beat old sightings. Omission counts distinguish bounded memory from a complete history. It never reads peer inventories, private intentions or global unseen resources. A map image/ASCII notebook is not sent. Messages plus schema are capped at 18,000 bytes, with a small request-envelope overhead; personally relevant actors and witnessed harm precede routine trade. Oversized historical core state fails closed. The outer transport additionally has a 128KB hard admission bound.

## Scheduling and providers

All profiles use one request/review, 1,200 output tokens, concurrency one and a 120-second timeout. The local-model revision supersedes the earlier rare-review recommendation **only for verified local inference**. The runtime must verify exact installed local weights and pass `verifiedLocalModel` equal to the selected model; cloud aliases, mismatches and the OpenAI transport retain the metered profile.

Verified local inference uses a one-second minimum global send interval, no additional simulation-tick spacing and a 600-send rolling-hour ceiling. Existing citizens and newborns join an initial queue staggered over at most 120 ticks. Successful citizens become eligible for periodic policy reviews every 600 ticks; a reply's longer `reviewAfter` cannot postpone this refresh. The queue prioritizes the oldest actual review attempt, so a repeatedly hungry or threatened actor cannot monopolize it. Single inference throughput means a large population waits longer than 600 ticks for its turn. On the observed machine, approximately seven-second replies naturally limit throughput to roughly 400–500 per hour before other costs. Rejected/unavailable replies wait 600 ticks before reconsideration; there is no correction conversation or retry burst. Local reviews still reserve, record and obey all durable request/token budget caps.

Cloud and unverified providers retain 120 simulation ticks and 30 wall seconds between sends, 30 sends per rolling hour, and sparse eligibility: ordinarily a 4,800-tick check that thriving citizens skip, with a 10,000-tick age fallback. New repeated harm, substantial disputes, failed critical food search, blocked no-go survival or stalled local progress can qualify. Errors back off for at least 4,800 ticks. `startTurn(id)` obeys the same global live guards as scheduled reviews. Fast-forward cannot bypass wall-time or hourly limits in either profile. The continuous controller keeps acting during all inference and backoff periods.

`PROSPER_MODEL` or `options.model` selects an exact model. Compact default is local `qwen3.5:9b`; native `/api/chat` uses `think:false`, `num_ctx:8192`, `num_predict:1200` and constrained JSON. Cloud aliases use `/v1/chat/completions` with reasoning disabled. Ollama Cloud currently does not support JSON-schema constrained generation; application-side validation remains authoritative. A valid plain JSON object is accepted as the same one-pass decision without an extra wrapper call. No automatic downloads or fallback model calls occur.

Options expose model/provider/reasoning settings, review/output/concurrency caps and global tick/wall/hour ceilings for controlled experiments. The UI shows current limits and runner-session token/request counters. Report actual provider usage separately from conservative reservations; requests per citizen-tick are session measurements, not account billing.

## Durable accounting and interruption

The append-only request ledger reserves and fsyncs **before** send. It is independent of checkpoint state, resets and model choice. Reservation timestamps preserve wall/hour guards across backend replacement; locked reservation rechecks rate limits atomically. Defaults are finite lifetime caps of 100 requests and 100,000 tokens. Only explicit operator cap edits change the separate durable settings journal.

Input reservation uses full UTF-8 request bytes as a conservative token estimate, plus maximum output (including provider-counted reasoning). Valid usage settles once; absent usage retains reservation. Interrupted calls remain charged and may later settle without gaining command authority. Provider timeout/cancellation does not prove billing stopped. Damaged/truncated accounting or stale locks fail closed. Never delete a ledger to regain capacity. These are request/token limits, not a dollar cap.

Generation/run checks revoke stale command authority synchronously. Physical work, goals and compact memories remain in the world. Hidden reasoning, credentials, headers and raw error bodies are not copied to diagnostics. Private observations/requests/results are retained in per-run JSONL and must never become citizen knowledge. Browser turn histories are bounded.

## Legacy and recorded compatibility

`contextMode:'legacy'` retains historical `set_strategy`, optional `legacyPlanningTools:true`, primitive commands and correction/query loops for old experiments and regression fixtures. Its prior limits/model are separate from the compact default. `set_strategy` supports keep/append/replace area-based physical directives, with current prerequisites checked during execution and stale discrete-output protections. See implementation/history for exact mechanical contracts.

Recorded mode requires explicit `{citizenId,responses}` fixtures. It never falls back to live; exhaustion is visible. Fixtures establish reproducible responses, not exact historical clock replay or model competence. Ordinary tests use mocked transports/OS-temp ledgers. Real bounded comparison receipts and failures are summarized in [OVERNIGHT](../../docs/spike-2/OVERNIGHT.md).
