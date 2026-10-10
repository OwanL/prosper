# World-first workspace and market behavior, 8 October 2026

## Workspace

The central world is the primary surface. Left tabs contain Citizens, Events and Comms; right tabs contain Dossier, Policy and selected-citizen History. The bottom dock contains Global charts, Market, Events / Comms and Reasoning. Three independent resizable/collapsible panes retain browser-local sizes. Their limits protect the map; Focus world collapses panes to rails. Mobile displays one workspace at a time. Reset layout does not reset the simulation.

World settings contains advanced simulation controls. View contains presentation/knowledge/follow toggles. Rich tooltips describe costs, semantics and limits instead of repeating large manuals. Floating explanations choose space away from adjacent controls. Tab and divider keyboard controls remain available. Active-panel headings stay fixed while their bodies scroll.

Map navigation uses pointer-anchored wheel zoom, background drag, double-click follow and focused keyboard controls: arrows/WASD, +/- zoom, F/Home fit, Escape release, Shift accelerated pan. Manual navigation begins at the rendered camera position and releases automatic tracking, avoiding a snap to the map center. Spectator speech is portalled above overlays, limited to collision-free placements, with scrollable complete long text and wall-time expiry. Empty/hidden mobile map bounds never anchor speech over another drawer. ResizeObserver geometry writes are deferred to a cancellable animation frame.

## Recorded analytics

`World.telemetry` is optional for historical saves. Initialization records actual current state; it never backfills old ticks, execution prices or balances. It samples committed state every 20 ticks and retains 256 frames. Checkpoints preserve frames, pending settlement counters and last execution prices. This is checkpoint durability, not a guarantee of saving every tick through a process crash.

Global series cover configured resource/equipment commodities, not unique building assets. They include current highest bid/lowest ask, offered/wanted remaining units, last execution price and tick, carried/held/ground stock, interval matched units, fills and gold turnover. `market.match()` records each completed matched pair once, including partial fills. Posted/cancelled orders are not trade volume. Pending counters survive a checkpoint taken between sampling boundaries.

Intervals contain settlements committed since the previous recorded frame. A command settling after a sample at the same simulation tick belongs to the next interval. Last execution prices are stale facts until another fill, not executable quotes; absent bids/asks stay null and graph lines break. Historical stock is sampled units, not a value estimate.

Citizen history records cash, funded buy-order escrow, health, fullness and alive status. Cash plus escrow is labelled **gold holdings**, not total asset wealth. Living citizens and a sampled terminal death record are captured; the UI leaves death/missing-point gaps rather than inventing a zero balance. Very short-lived citizens can have no cadence sample.

History is omitted before cloning normal spectator snapshots. Read-only `/api/history/global` and `/api/citizens/:id/history` fetch bounded projections only when relevant graphs are open; unknown citizens return 404. Selection/run changes abort requests and reject obsolete replies. These series are not exposed to citizen observations or model context. Knowledge view does not mount spectator history components.

Native graphs have named units/axes, an explicit metric selector, hover and keyboard sample inspection, legends and collapsed exact tables. Price, volume/turnover, stock and order-book graphs are separate choices so the default dock does not require scrolling past multiple tall plots. Empty history and failed requests remain visible without fabricated trends.

## Territorial greed

The old automatic controller explicitly called `rectAround(..., 0)` and only moved claims when a higher-tier resource appeared. That produced isolated points even alongside equally valuable neighbors.

Automatic claims now use radius 1–3 resource patches, influenced by ambition/caution and personally known resources. Useful equal-tier growth/relocation is possible, without unioning distant rectangles into world-spanning claims. No-go restrictions, suppression, announced access and one representative-owned alliance territory remain authoritative; paid permissions and succession remain intact.

Deliberate territory patches carry an explicit marker and retain exact borders. Missing-marker legacy singleton policies are treated as old automatic anchors only when matching the actor's current owned claim and a known T2+ livelihood deposit. That narrowly identifiable old pattern can grow on normal controller ticks; wider historical borders are preserved. This is a heuristic for the diagnosed old generator, not wholesale saved-map regeneration.

## Two-sided market behavior

Previously `manageMarket()` placed surplus sells only, while `buyAvailable()` bought against existing asks. Successful buys normally disappeared immediately, leaving little resting demand. That immediate-purchase helper remains unchanged.

New resting quotes prioritize food and actual tool/project deficits, account for existing funded bids and protect productive/family inputs. Limited inventory-making bids use a positive spread against policy/public resale targets. There are at most three active buys per citizen, up to three units per quote, a 25% escrow ceiling and a 24-gold liquid reserve. Critical hunger can reclaim speculative escrow. Normal dispatch/escrow settlement remains the only accounting path: no free goods, subsidies or credit.

A later actor can sell into a resting bid. Unprotected acquired stock can then be offered for resale; retained addressed acquisition receipts floor asks above recorded purchase prices. Receipt eviction makes old cost basis unknown, not proven lifetime profit. This is a bounded heuristic, not a guarantee that every actor profits or the market reaches an efficient equilibrium.

## Evidence and limits

Regression fixtures reproduce the old point claims and absence of resting bids, and cover funded bids, duplicate prevention, subsequent fills/resale, hunger refunds, claim growth, explicit borders and alliance preservation. An offline seed-7, 20-founder run reached 2,000 ticks with 26 resting bids, a peak of 38, 119 matched fills, 153 traded units and 674 gold turnover. Six active claim areas were 9 or 25 tiles, not points. Gold including escrow/loot remained exactly 2,000; 17 founders survived, so three deaths remain a limitation. This is deterministic local-controller evidence, not LLM intelligence or a controlled original-version efficiency ranking.

Visual checks use paused offline fixtures and intercepted APIs, including desktop and mobile history. Historical pre-overhaul screenshots are preserved, but their world state differs, so no matched-state performance claim is made. Temporary artifacts are under OS temp directories, outside the repository. Live model calls, saved-world resets and direct ledger edits are not verification steps.
