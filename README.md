# Prosper

A watchable society simulation: citizens work, trade, form families and alliances, claim resources, threaten trespassers and sometimes fight. Fresh worlds use a composed, stochastic local controller for ordinary life, with no required model calls. Restored legacy worlds retain their optional structured policy-model path. The first spike remains on `spike/citizen-sandbox`; this checkout develops the richer spike 2 economy.

## Run

Node **24.16.0**, npm **11.13.0** (repository pins both).

```powershell
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. New village worlds start with **20 citizens**, paused in **Local AI**, with no model calls. The world fills the workspace by default. A compact activity strip shows recent consequential events; select one to inspect its actor or recorded location. The top bar keeps Play/Pause, speed and connection state visible. Opening panels never starts inference.

**Citizens** provides searchable names and current activity. Selecting a citizen on the map or in the list opens their **Now**, **Motivation** and **History** panel; **Follow on map** tracks a sighted selection. **Messages** keeps conversation out of the map. **Settings** holds reasoning mode, map layers, optional speech bubbles, knowledge view, confirmed reset/scenario controls, budget settings and diagnostics. **Back to world** or Escape closes the current panel. Mobile shows one intentional panel at a time rather than stacking feeds; each panel scrolls independently. Tabs support arrow-key navigation.

Navigate with drag and pointer-anchored wheel zoom. Double-click a sighted citizen to follow. Focus the map for arrows/WASD pan, +/- zoom, F/Home fit and Escape release; manual navigation releases Follow and director control. Follow uses the same animation frame as the sprite. **Map guide** explains territory, combat marks and keyboard navigation. Speech bubbles are off by default to leave the game visible; enable them in Settings. Reduced-motion preferences are respected.

**Charts** opens an on-demand drawer: **Overview** shows current population/wellbeing/action summaries and recorded population or average wellbeing; **Markets** compares selected commodity bid/ask histories and offers price, actual traded volume and gold-turnover views; **Resources** distinguishes carried, held and ground stock from open sell offers and buy demand. In Markets, expand **Commodities** to toggle item/tier checkboxes on one shared gold-per-unit graph. Colors remain stable; bids are solid and asks dashed. **Select all** and **Clear all** do not change the world.

Select a citizen, then **History**, for cash, funded-buy escrow and vitals; gold holdings are not estimated inventory net worth. Recording starts at the actual current tick, samples every 20 ticks and retains 256 frames in checkpoints. No earlier history is reconstructed. Missing quotes remain gaps, not zero prices; old execution prices retain their execution-tick label. Hover the graph or use its sample cursor for exact values; **Exact samples** and **About these samples** provide audit details without obscuring the graph. Knowledge view hides spectator history and diagnostics. The activity strip contains retained events, not lifetime totals; historical trade windows count settlements directly. Hatching marks competing claims, not confirmed fighting.

New maps concentrate all food deposits in the food third of three equal 120° wood/food/fibre sectors (shifted atan2 sectors 0–120°/120–240°/240–360°). Former outskirts/founder forage is relocated within its original band, preserving seeded deposit counts, tier capacities and regrowth; wood/fibre deposits and founder positions are unchanged. Founders retain their finite starting food, not guaranteed nearby forage: travel and regional trade now matter. Existing saved maps are not migrated.

Fresh maps have **six concentric bands**, with T1 at the outskirts and tiers increasing inward. Each band rarely yields the next tier, including T7 at the center. Change **`RING_COUNT` in `src/shared/tiers.ts`** to add bands and tiers together; recipes, mechanics, schemas and display derive from that setting. Citizens automatically use the highest-tier matching tool or sword in their available inventory. Tools never wear out or need servicing; use does not consume wood/fibre supplies. Tools can be sold or gifted without equip/unequip steps and transfer intact on death. Each recipe uses its exact tier, with costs doubling per tier (T6 costs 32× T1, T7 costs 64×). Owned mills, spinning wheels and butcheries convert 3 lower-tier units into 1 of the next tier, or 1 higher-tier unit into 2 of the previous tier. A station must reach the lower of the two tiers. Citizens can choose down-conversion when preparing lower-tier ingredients. In restored legacy worlds, alliances share one representative-owned territory, defend its resources and honor its paid access; automatic claims seek bounded resource patches (radius 1–3), with ambition influencing their size. Composed citizens adapt funded bids to personal known prices across food tiers and fractional nutrition, with spending paced against a half-budget allowance per cadence. They may also offer surplus in the background, protecting their own survival runway, recipe inputs and tools; urgent food funding can override those protections. Food acquisition can explicitly serve a committed family goal, but reproduction still costs one T1 food per parent. Deliberate disputes remain possible; these rules do not guarantee profitable trading or an efficient equilibrium.

At **0.05 fullness per tick**, a full bar lasts **2,000 ticks** without food before starvation begins. Territories favor compact, buildable land with member-owned buildings; nearby resources are a secondary consideration. Compact layouts gain a strong **12-tick travel bonus**, while marking keeps its existing cost of **2 wood per tile**. Membership offers a bounded, diminishing power bonus based only on the public member count; owner relations and travel can outweigh it, and it never motivates leaving. Expansion priority rises when known usable marked land falls below **two tiles per member**; this preference changes neither the **2-wood-per-tile** claim cost nor claim quantities. Public `memberCount` reveals only a count, not the private roster. Members consider leaving only when their own directed reputation is negative toward a strict majority of the other members; neutral views count in that majority, and no such rule applies to a singleton. Citizen shirt colors are stable by ID, unaffiliated citizens use grey badges, and Overview shows territory leadership. Expansion still depends on known, eligible connected land and available wood, so success is not guaranteed.

Reproduction needs an adjacent living, idle, healthy partner, both parents off cooldown, and **one T1 food each**. It requires no consent or rendezvous negotiation. Joint work reserves both costs, creates exactly one adult-capable citizen on completion, and refunds unused inputs on interruption. Ordinary meals can consume a fractional portion when that portion supplies enough nutrition; citizens need not wait for a full food unit. Historical in-flight 3-T2-per-parent commitments retain their original settlement/refunds after restore.

Founders and newborns use a bundled first-name/surname database rather than numeric name suffixes. Allocation avoids names already held by living or dead citizens; existing saved names are not rewritten.

Existing saves retain their population, map and policies. Use **Reset world** to archive and start a new procedural-ring map with 20 founders, leaving **Founding population** empty. The small competition/progression mechanics scenarios retain their specialized defaults.

Visible citizens expose their current carried inventory and gold; remembered sightings retain dated holdings rather than tracking unseen changes. Plans and internal motivations remain private. Optional predation values potential loot against combat risk, while immediate defense remains independent; neither profitable attacks nor peaceful outcomes are guaranteed.

The new default composed Local AI uses ten persistent dispositions, personal evidence and prepared alternatives for stochastic goal/task selection, with immediate prerequisite delegation but no long-term planner. Houses/rest, marked territories, directed reputation and estate settlement are implemented mechanics; useful advanced progression is not yet established. An optional disposition director was discussed but is not implemented. See the [implementation checkpoint](docs/research/decision-tree/composed-implementation.md) and [bounded evaluation and gaps](docs/research/decision-tree/composed-evaluation.md). The earlier local mind uses inherited traits, personal evidence and explicit social signals over utility/rule decisions in legacy worlds. Aggregate behavior can emerge from those rules without a model. Seeded runs establish what those controllers do; they do not establish spontaneous LLM intelligence. Existing saved worlds retain their old citizens and policies. **Reset world** archives the current world and creates a fresh run with new controllers; it keeps spending and budget limits. Incompatible checkpoints fail visibly instead of silently resetting.

To create 100 citizens, enter **100** in **Settings → Founding population**, then choose **Reset world** (archives the current run) or **Load scenario**. Leave the input empty to use the default population. The same operation is available through the ordinary API:

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/control -Method Post -ContentType 'application/json' -Body '{"type":"scenario","scenario":"competition","population":100}'
```

This explicitly replaces the displayed world, paused in Local AI. Population accepts 1–250. To archive before replacement, send `{"type":"reset","population":100}` instead. Alternatively set `$env:PROSPER_POPULATION='100'` before creating a fresh run. For a separate experiment, set a uniquely named `$env:PROSPER_DATA_DIR` and `$env:PROSPER_RESTORE='0'`; existing durable directories remain intact.

### Iteration and persistence

UI/CSS edits update through Vite. Backend edits pause, interrupt unfinished inference, checkpoint, restart and restore the same run, including partial physical work. Previously running worlds resume; paused worlds remain paused. Failed reloads retain the checkpoint and expose an error. Never reset or delete accounting as a repair.

Dev uses ports **5173**, **4310** (stable API proxy) and **4312** (backend child). Stop with Ctrl+C. `npm.cmd run build` creates the production UI; `npm.cmd start` serves it and the API at **http://127.0.0.1:4310**.

State lives in **`.prosper-v2/`**, separate from old **`.prosper/`**. Neither should be deleted to troubleshoot. `checkpoint.json` is an atomic reload/save boundary, not an autosave of every tick. `request-ledger.jsonl` reserves before sending and is independent of checkpoints. `budget-settings.jsonl` retains explicit cap edits. Private `diagnostics/<run-id>.jsonl` records model requests and outcomes. `PROSPER_DATA_DIR` overrides the directory; tests use OS-temp data. Existing checkpoints restore by default; `PROSPER_RESTORE=1` requires valid restore and `0` explicitly creates a fresh paused world without resetting accounting.

### Optional model policies (legacy worlds)

Fresh composed worlds are Local AI only: Live/recorded inference is rejected, not silently enabled. The following describes the preserved legacy policy path, not an implemented composed disposition director.

Ollama at `http://127.0.0.1:11434` must provide the exact selected model. **Live** defaults to **`qwen3.5:9b`**, using local constrained JSON, thinking disabled and an explicit 8K context. No automatic model download or cloud fallback occurs. Choose another model before startup:

```powershell
$env:PROSPER_MODEL='qwen3.5:9b' # local
# Explicit cloud alternatives, when available to your account:
# $env:PROSPER_MODEL='gemma4:31b-cloud'
# $env:PROSPER_MODEL='deepseek-v4.1-flash:cloud'
npm.cmd run dev
```

Choose **Live** and press Play. The single `set_policy` response revises livelihood, reserve, prices, territory, boundaries, aggression, ally/rival preferences, family preference, goals, memory and up to two messages. Bodies handle routing, survival, production, commerce and immediate social reactions while inference runs. Unknown people, invalid coordinates and invalid policies are rejected without correction calls. New explicit policy commits supersede older in-flight responses; ordinary local adaptation does not invalidate useful intent. Reproduction uses the same consent-free mechanical eligibility rules in legacy worlds.

Live uses **one request per review**, **1,200 output tokens**, and **one concurrent request**. Startup verifies installed local model metadata, rather than assuming a loopback endpoint cannot bill cloud usage. **Verified local models** get initial reviews staggered across 120 ticks and recurring policy reviews every **600 ticks**, with a **one-second** minimum send gap and a **600/hour** ceiling. Oldest-review priority rotates opportunities across citizens; successful model replies cannot postpone local reviews for thousands of ticks. Actual frequency depends on inference latency and population. Failures back off while physical work continues.

**Cloud and unverified models** retain the conservative **30-second / 120-tick** send gap, **30/hour** ceiling, event-driven eligibility and 10,000-tick age fallback. All profiles retain durable request/token budgets and rate guards across reloads. The default **100-request / 100,000-token** lifetime budget is shared across runs and models; previously configured limits remain intact. `PROSPER_REQUEST_TIMEOUT_MS` changes the 120-second deadline (maximum 600,000ms).

Spectator motion uses a lightweight per-tick stream with confirmed route steps and a short playback buffer, independently of the slower full-state dashboard poll. This preserves corners and follows movement continuously. Citizen-knowledge view never receives the spectator stream.

Request/token limits are **not a dollar cap** or an observed account balance. Pending/uncertain calls remain charged; cancellation does not establish that billing stopped. Missing usage retains the conservative request-byte-plus-output reservation. Explicit **Budget settings → Apply budget** changes total caps while preserving history. Never delete the ledger to regain capacity. A blocked model does not stop the world.

Bounded real probes checked local Qwen and cloud Gemma/DeepSeek, retaining failures as well as successes. Valid output alone does not establish useful policy: comparisons distinguish continuations from changes and inspect later behavior. Cloud schema support differs from local Ollama, and small models can choose poor economics or motives. See [overnight evidence](docs/spike-2/OVERNIGHT.md).

Recorded responses require explicit fixture import and never fall back to live. Historical physical directives/plans remain available through the legacy harness for debugging/replay. See [citizen integration](src/citizen/README.md) and [runtime/API documentation](src/server/README.md).

## Verify and experiment

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

The active browser suite covers the replacement game workspace and migrated API/accessibility/camera checks; older workbench-specific fixture files are retained as historical coverage, not part of this suite. Browser tests use isolated ports **5193/5190/5192**, which must be free, and headless installed Chrome or Playwright Chromium. Their temporary data and processes are cleaned up; an existing app on the ordinary dev ports is preserved. `PROSPER_UI_PORT`, `PROSPER_API_PORT` and `PROSPER_BACKEND_PORT` override development ports when explicitly needed.

`npm.cmd exec -- tsx scripts/probe-policy.ts` is offline unless an explicit model and `--confirm-local` or `--confirm-cloud` are supplied. Each invocation has a hard two-send ceiling, unique ledger and retained evidence. Cloud experiments additionally require a reviewed spend allowance; the flag is not budget authorization. `npm.cmd exec -- tsx scripts/probe-runtime.ts` checks a genuinely running 100-citizen runtime and browser through HTTP, with zero model calls (build first).

The historical mechanical trial remains `npm.cmd run trial -- --scenario progression --seed 1 --ticks 360`. It uses repeatable legacy scripted fixtures and reports conservation/outcomes; it is not the current autonomous society benchmark.

## Design and learnings

- [Composed Local AI implementation checkpoint](docs/research/decision-tree/composed-implementation.md), [current evaluation](docs/research/decision-tree/composed-evaluation.md)
- [Current layered design and overnight evidence](docs/spike-2/OVERNIGHT.md)
- [Six-tier economy, saved-run audit and hardware/model shortlist](docs/spike-2/economy-six-tiers.md)
- [Implementation history and learnings](docs/spike-2/LEARNINGS.md)
- [World mechanics](docs/spike-2/world.md), [citizen direction](docs/spike-2/citizen.md), [architecture and implementation history](docs/spike-2/technical-plan.md)

The overnight direction supersedes old restrictions on automatic survival and borrowing first-spike ideas. Mechanics tests establish invariants. Normal seeded local runs establish controller behavior. Claims about model quality require actual receipts and downstream comparisons. Player interaction remains out of scope; the command API is spectator debugging.
