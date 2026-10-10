# Runtime and API

`npm.cmd run dev` starts Vite (127.0.0.1:5173), a stable HTTP API/reload proxy (4310), and an IPC backend child (4312). UI edits update directly. Backend edits debounce, pause/interrupt inference, atomically checkpoint, restart and restore. Committed actions and partial work survive; running state resumes on a fresh clock interval. Failed saves/startup/restore retain state and expose errors. Another backend save retries. Stop the supervisor with Ctrl+C; tests own and clean up their processes.

`npm.cmd run build` then `npm.cmd start` serves `dist/` and the API on 127.0.0.1:4310. `PROSPER_PORT` overrides it. Existing checkpoints restore by default. `PROSPER_RESTORE=0` explicitly creates a fresh paused Local AI world; `1` requires valid restore. `PROSPER_DATA_DIR` overrides `.prosper-v2`; paths under old `.prosper` are refused. Tests must use isolated temporary directories.

Fresh worlds enable continuous citizen autonomy, independent of model mode. `PROSPER_POPULATION` selects 1–250 founders; default named scenarios retain their conventional populations. Restored worlds are not silently converted. `PROSPER_MODEL` selects the exact optional Live model; default compact model is local `qwen3.5:9b`. Neither normal startup nor Local AI makes model calls.

## API

- `GET /api/motion`: spectator-only server-sent events with lightweight committed tick poses, move-edge progress, run/stream identity and pause status. The browser plays a short ordered frame buffer instead of drawing a straight line across several polled steps. Citizen-knowledge view never subscribes. The feed contains no notebooks or inference transcripts, and closes slow consumers above 256KB queued data.

- `GET /api/state`: spectator `AppSnapshot`, status, bounded turns and durable request/token budget. `projectSpectatorWorld` omits per-citizen notebooks and telemetry **before cloning**; this transport is not a checkpoint. It merges bounded consequential history into recent events so high routine throughput does not erase stories. Private action/strategy/state is available to the spectator only.
- `GET /api/history/global`: bounded spectator economy frames with run/tick/start/cadence/limit metadata; citizen samples are omitted.
- `GET /api/citizens/:id/history`: selected citizen's bounded cash, escrow and vital samples; unknown IDs return 404. Both history endpoints are read-only projections, not citizen knowledge. History is sampled every 20 ticks and retains at most 256 frames; intervals report actual fills/units/turnover, quotes and stock, not lifetime totals. Legacy saves begin at their actual restore tick; no earlier history is invented.
- `GET /api/citizens/:id/observation`: selected citizen's actual private knowledge projection, with current sightings, dated notebook, own alerts/messages and explicit public claims/alliances. It never borrows spectator truth.
- `GET /api/health`, `GET /api/reload`: readiness and run/tick/error.
- `POST /api/control`: strict `{type,...}` with play, pause, step (`ticks:1..10000`), speed (`0.1..100`), scenario, mode, checkpoint, reset. Scenario requires `village|competition|progression`, optionally `population:1..250`; it replaces the displayed world paused in Local AI. Reset archives the current world, then starts the same scenario/new seed paused, optionally with another population. Reset keeps live/local mode and founding population when omitted; recorded returns to local. Both preserve accounting. Population is valid only with scenario/reset.
- `POST /api/budget`: strict `{maxRequests,maxTokens}`, both nonnegative safe integer lifetime caps. Explicit edits persist without modifying history or playing a paused world. Zero suspends calls. A cap edit is not a dollar-budget guarantee.
- `POST /api/command`: `{citizenId,command}` spectator debugging; exact schema then synchronous core dispatch. Runner commands also pass the knowledge gate. Player interaction is outside this iteration.
- `GET /api/scenarios`: scenario names.
- `POST /api/fixtures`: explicit `{turns:[{citizenId,responses}]}` or `{configured:true}` for `PROSPER_FIXTURE_PATH`. Import pauses and chooses recorded mode; remaining fixtures are checkpointed. Never live fallback.
- `POST /api/reload`: dev proxy `{action:'restart'}`; backend `{action:'prepare'}` checkpoints and stays unavailable for external restart. IPC supervisor handoff requires successful prepare acknowledgement.

Example 100-citizen local creation through dev:

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/control -Method Post -ContentType 'application/json' -Body '{"type":"scenario","scenario":"competition","population":100}'
```

## Time, privacy and persistence

Each fresh interval is 250ms/speed plus actual synchronous tick processing. Runtime advances authoritative physics, updates knowledge, then calls runner.tick without awaiting inference. Acceleration is bounded by CPU/browser/transport cost; speed 100 does not promise 100× measured throughput. Pausing/stepping/reload interrupts model authority, not physical reservations. No outage catchup occurs on restore.

Checkpoints retain the **full world**, including notebooks, RNG/IDs, claims/alliance/social signals, policy revisions, physical progress/reservations and inheritance state. Shape and accounting/life/path/joint-action invariants reject incompatible state visibly. Polling projection does not alter persistence. Optional telemetry persists its bounded frames, actual start tick, pending mid-interval flows and last fill prices; strict shape, item, citizen-reference and time checks reject broken analytics rather than silently resetting it. Consequential events have a separate bounded ring (256 total, at most 64 per kind); personal observers still receive only explicitly addressed events. Local witnesses are recorded at occurrence, not inferred from later proximity.

Diagnostics append private per-run records and command application order to JSONL. Browser histories are bounded; full details remain outside the citizen's information boundary. Independent durable ledger/settings survive checkpoint restore, scenario/reset and model change. Wall-time send reservations prevent reload-based rate bypass. Aborted pending calls are not refunded and late receipts cannot execute old commands. See [citizen integration](../citizen/README.md) and [overnight evidence](../../docs/spike-2/OVERNIGHT.md).
