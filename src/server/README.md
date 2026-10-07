# Runtime / reload

`npm run dev` starts independent Vite (127.0.0.1:5173), a stable native HTTP proxy/status side channel (4310), and an IPC backend child (4312). Only server/world/citizen/shared TS/JSON edits trigger a 150ms debounce; UI edits and runtime data never restart the backend. The supervisor requires a successful atomic checkpoint acknowledgment before stopping the child. Saves during a restart coalesce into one subsequent handoff. Failed checkpoint leaves the old child paused; failed startup/restore retains the checkpoint and exposes error status/last browser snapshot. Another backend save or explicit restart retries.

`npm run server` / `npm start` serves HTTP on 127.0.0.1:4310 and `dist/` if built. Existing checkpoints restore by default. `PROSPER_RESTORE=0` explicitly starts a new paused scripted world; `PROSPER_RESTORE=1` requires successful restore. `PROSPER_DATA_DIR` overrides `.prosper-v2` (including in tests); any path under `.prosper` is refused. `PROSPER_PORT` overrides the standalone/child port. Never point tests at experiment data.

## APIs

- `GET /api/state`: `AppSnapshot` (world, status, bounded turns, independent durable request/token budget).
- `GET /api/health`, `GET /api/reload`: readiness, reload/error status, run/tick when available.
- `POST /api/control`: shared `Control`: play, pause, step (`ticks`, 1..10000), speed (`speed`, 0.1..100), scenario (`village|competition|progression`), mode (`scripted|recorded|live`), checkpoint. Scenario resets pause and return to scripted; accounting is never reset. Live requires an explicit mode request or restoration of a previously opted-in live run; no fixture/provider failure falls back to live.
- `POST /api/command`: `{citizenId,command}`; strict citizen/tools schema, then synchronous core dispatch. Citizen-runner commands additionally pass the knowledge gate. Browser commands are explicit spectator debugging commands.
- `GET /api/citizens/:id/observation`: citizen-only knowledge projection, not spectator truth.
- `GET /api/scenarios`: named scenario list; load via scenario control.
- `POST /api/fixtures`: explicit `{turns: RecordedTurn[]}` or `{configured:true}` to import from `PROSPER_FIXTURE_PATH`. Import pauses and selects recorded mode. The remaining fixture queue is checkpointed, including consumption of interrupted turns. Fixture mode does not establish exact historical command timing replay.
- `POST /api/reload`: dev supervisor `{action:"restart"}` (202); standalone backend `{action:"prepare"}` checkpoints and stays unavailable pending external restart. Internal IPC: `prepare` with request ID → `prepared` / `prepare-failed`; `stop`; startup → `ready` / `failed`.

Time is one tick per fresh 250ms/speed interval; each interval calls synchronous tickWorld, updateKnowledge, then runner.tick without awaiting remote work. Pausing/stepping/reload interrupts reasoning, never physical actions. Restored running state schedules one full interval, with no outage catchup. Reload checkpoints persist the whole world (RNG, IDs, progress, reservations, knowledge, goals, scheduling), running/mode/speed, command sequence and remaining fixtures. Runtime resources and unfinished transcripts are recreated, never serialized. Checkpoints use shape validation plus identity, life, map/path, paired-reproduction, escrow and gold invariants; incompatible state visibly refuses restoration rather than migrating/resetting it.

Diagnostics append per-run JSONL under `diagnostics/` with command application order/tick, run/citizen/command identity, complete private runner records and a runtime code version. Browser turns are capped at 100 and observations at 24K chars with an explicit omission marker; full detail is in JSONL. The ledger is separate from checkpoints/diagnostic retention. Interrupting a remote request never refunds its reservation and does not prove billing stopped. Budget units are requests/tokens, not dollars.

Verification: `npm test -- test/server.test.ts test/reload.test.ts`, `npm run typecheck`, `npm run build`. All provider tests are mocked and all data is in OS-temp directories; no live service/provider validation or emergence claim.
