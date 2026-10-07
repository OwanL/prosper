# Prosper: spike 2

A small game-like world for experimenting with citizen reasoning, specialization and conflict. This branch starts afresh from `main`; the first spike is preserved on `spike/citizen-sandbox`.

## Run

Node **24.16.0**, npm **11.13.0** (the repository pins both).

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The world starts paused in **SCRIPTED** mode. Select a character, press Play or Step, and use the dossier to see its physical work, inventory, goals and reasoning/tool receipts. Zoom or use the roster to identify characters; switch to citizen knowledge to distinguish current sightings from dated memories.

The default planner demonstrates mechanics. It is not an evaluation of the model or evidence of emergent citizen behavior. The world implements harvesting/tool progression, crafting, stations, walls, escrow markets, combat/death/loot, hunger and mutually consented reproduction. The scripted planner intentionally exercises only a subset; other mechanics can be exercised through tools, fixtures or the debug command API.

### Iteration

- UI/CSS edits update through Vite without restarting the world.
- Backend edits pause, interrupt unfinished reasoning, checkpoint, restart and restore the same run. Committed effects and partial physical work survive. Previously running worlds continue; paused worlds stay paused.
- Restart failures leave a visible error and the checkpoint intact. Fix the backend source and save again to retry. Never reset the world as a repair for unknown accounting or restore failures.
- `npm run build` creates a production UI; `npm start` serves it and the API on **http://127.0.0.1:4310**.

Dev uses ports **5173**, **4310** (stable API/reload proxy) and **4312** (backend child). Close the dev command with Ctrl+C. Browser tests use these ports and must run without a dev instance already using them.

### Fast, headless mechanical trials

```sh
npm run trial -- --scenario progression --seed 1 --ticks 360
```

This runs a repeatable scripted case without model access or persistent experiment data, then prints a JSON summary: action completions/errors, survival, holdings, equipment and gold conservation. Scenarios: `village`, `competition`, `progression`. They share world rules but differ in starting population. Use `--output <path>` to retain a summary; it will not overwrite an existing file.

### Live model mode

A local, authenticated Ollama service must expose **`deepseek-v4.1-flash:cloud`** at `http://127.0.0.1:11434`. In the browser, explicitly choose **Live** and press Play. Requests use high reasoning, fresh contexts, persistent goals/notes and bounded tool calls. No provider fallback occurs.

Live requests default to a **120-second deadline**, four concurrent citizen turns, and a durable **100-request / 100,000-token** budget. `PROSPER_REQUEST_TIMEOUT_MS` changes the request deadline (maximum 600,000ms). Budgets include pending/uncertain calls; cancellation does not guarantee the provider stops processing or charging. These are request/token limits, **not a dollar cap** or verified billing prices. Missing usage is charged conservatively from request bytes and the output limit. Configure larger budgets through `RuntimeOptions.runner.ledgerOptions` only deliberately; never delete the ledger to recover capacity.

The local Ollama catalog was reachable and listed the model during implementation. Actual cloud inference, tool compatibility and live citizen behavior have **not** been verified. All implementation tests used scripted, recorded or mocked responses and made no paid inference requests.

Recorded mode requires explicit fixture import through `/api/fixtures`; it never silently switches to live. See [citizen integration](src/citizen/README.md) and [runtime/API documentation](src/server/README.md).

## State and diagnostics

Spike 2 writes to **`.prosper-v2/`**, separate from the old spike's **`.prosper/`**. Existing old worlds and spending records are untouched. Do not delete either directory to troubleshoot.

- `checkpoint.json`: versioned world and runtime intent, atomically saved for reload or explicit checkpoint.
- `request-ledger.jsonl`: independent durable accounting; not rewound by checkpoint restore or scenario changes.
- `diagnostics/<run-id>.jsonl`: private observations, requests, outcomes and command application ordering. Browser histories are bounded; complete retained details are here.

`PROSPER_DATA_DIR` selects another directory. Tests use temporary directories. `PROSPER_RESTORE=1` requires a valid checkpoint; `PROSPER_RESTORE=0` explicitly starts a new paused scripted run without deleting accounting. By default, an existing checkpoint restores. Checkpoints are not crash-proof autosaves of every tick: graceful reload/save is the persistence boundary. Preserve a checkpoint before intentionally stopping an experiment.

Observer diagnostics may contain private citizen messages, but they are never fed back as citizen knowledge. The citizen view uses only current local sightings, dated memories and the explicit public/owner-alert exceptions.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

Browser tests launch headless Chrome if installed at the standard Windows location, otherwise Playwright Chromium must be available (`npx playwright install chromium`). Their temporary data is isolated and their processes are cleaned up. No visible desktop interaction is required.

## Design and learnings

- [World rules](docs/spike-2/world.md)
- [Citizen direction](docs/spike-2/citizen.md)
- [Technical plan](docs/spike-2/technical-plan.md)
- [Implementation decisions and learnings](docs/spike-2/LEARNINGS.md)

The mechanics tests establish implementation behavior. Scripted/recorded runs are useful for reproducibility, not evidence that live citizens spontaneously trade, specialize, reproduce or fight.
