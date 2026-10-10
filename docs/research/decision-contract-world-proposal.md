# Proposed minimal decision world contract

**Status: proposal, not authorization or implementation.** Isolated headless research world; does not wrap or modify Prosper's runtime, controllers, shared contracts or durable data. Follows the [current research direction](../citizen-intelligence-research.md): mechanics may define consequences, but execution must not supply strategic answers. Defaults below require agreement before parallel implementation.

## Scope and simplified assumptions

Version `decision-world-v1` has one deciding citizen, items `food` and `wood`, a remote market, and finite **external fixture orders**, not simulated trading agents. All information is exact and public; no uncertainty, fees, transport, equipment, health, regeneration, automatic survival, production or learning machinery. Fullness is the sole survival variable. These are deliberately reduced mechanics, not claims about Prosper's economy or endogenous specialization.

Only `buy`, `sell`, `eat`, and `wait` exist. There are no `secure_food`, `earn_money`, macro actions or supplied plans. The world neither schedules the next action nor ranks alternatives. The two sequences in this document demonstrate execution, not strategies built into the API. Fixtures should eventually vary affordability, availability and deadlines; success in these examples alone proves little.

## Boundary for independent implementers

Proposed pure synchronous API (plain JSON inputs/outputs):

- `create(config) -> state`: validate configuration; fail visibly without creating an episode if invalid.
- `observe(state) -> observation`: no mutation or elapsed time.
- `step(state, action) -> {state, result, observation}`: one attempted primitive, then one simulation tick. Never call a candidate from the world.

World owner implements these semantics and conservation receipts. Harness owner owns candidate invocation, wall/compute limits, trajectory retention and comparison. Candidate owner consumes observations and returns **one primitive action**, with any private memory outside world state. No shared production files are required. Interfaces must be agreed verbatim before coding; these names are proposed, not existing APIs.

`config` contains `version`, `episodeId`, `horizon`, `rules`, initial `citizen`, external `accounts`, and `orders`. Rules: `fullnessMax`, `foodNutrition`, `fullnessDecay`. Citizen: `id`, `gold`, `inventory`, `fullness`. Accounts: unique `id`, `gold`, `inventory`. Orders: unique `id`, `ownerId`, `side: bid|ask`, `item`, `unitPrice`, `quantity`. No seed/randomness is needed in v1: identical configuration and action stream give identical results. Harness records a canonical configuration hash and candidate version separately.

**Numeric semantics:** gold is integer credits; prices are integer credits **per unit**, not totals or tier multipliers. Inventories and quantities are whole item units. All numbers must be finite safe integers; balances nonnegative; submitted quantities and prices positive. Products and resulting sums must remain safe integers. Inventory has explicit `food` and `wood` entries, including zero. No fractional units, debt or rounding. Horizon is a positive integer; rules are positive integers with nutrition/decay at most fullnessMax; initial fullness is `1..fullnessMax`.

**Proposed defaults:** maximum fullness 100, nutrition 30 per food, decay 10 per attempted action, horizon 6. Starting holdings/fullness and order prices/volumes are explicitly fixture-specific; no implicit free gold, food or guaranteed profitable opportunity.

## Funded orders, not agent decisions

At creation, reserve each ask's quantity from its owner's inventory and each bid's `quantity × unitPrice` from its owner's gold. Reject the whole configuration if any owner cannot fund all orders cumulatively. Initial account balances are **before** reservation; state reports free and reserved holdings separately. Orders cannot belong to the citizen. Owner/ordering IDs are stable; sort public order arrays by ID, not desirability.

Orders retain fixed prices and side throughout the episode. Fills reduce remaining quantity; remove exhausted orders from observations. No replenishment, expiration, cancellation, repricing, automatic matching or external actor turns. A citizen explicitly targets one order. A bid expresses externally supplied funded demand; it is not discovered willingness-to-pay or a promise of infinite income. Fixture owners can hold both sides but cannot reuse reserved assets until a transfer actually releases them.

- Buy: citizen free gold -> ask owner's free gold; ask item escrow -> citizen inventory.
- Sell: citizen inventory -> bid owner's free inventory; bid gold escrow -> citizen free gold.

All fills execute at the selected order's unit price. There are no citizen resting orders, price proposals, multi-order routing or partial fills in v1. No hidden cheapest-offer selection.

## Observation and actions

Observation is exactly `{version, episodeId, tick, horizon, rules, self, orders, lastResult, terminal}`. Tick starts at 0. `self` contains `id`, `gold` (free), full inventory, `fullness`, `alive`. Public orders expose `id`, `ownerId`, `side`, `item`, `unitPrice`, `remainingQuantity`; these are funded executable quotes, not inferred market values. `lastResult` is null initially. `terminal` is null or `{reason: starvation|horizon, tick}`. Do not expose external free balances, simulator snapshots, hindsight, best actions, derived feasible plans or goal-specific hints.

Exact action union; unknown fields rejected:

| Action | Preconditions and atomic effect |
| --- | --- |
| `{type: buy, orderId, quantity}` | Existing ask; sufficient remaining quantity and citizen gold. Transfer exactly quantity and `quantity × unitPrice`. |
| `{type: sell, orderId, quantity}` | Existing bid; sufficient remaining quantity and carried item. Transfer exactly quantity and `quantity × unitPrice`. |
| `{type: eat, quantity}` | Sufficient carried food. Consume exactly quantity; add `quantity × foodNutrition`, capped at fullnessMax. Excess nutrition is wasted; no refund. |
| `{type: wait}` | No transaction or nutrition effect. |

`result` contains `{tickBefore, tickAfter, action, ok, error, trade, consumption, fullnessBefore, fullnessAfterAction, fullnessAfterTick}`. `trade` is null or `{orderId, ownerId, side, item, quantity, unitPrice, totalPrice}`; `consumption` is zero or food quantity. Actions are retained exactly as submitted (JSON only). `error` is null on success or one of `invalid-action`, `unknown-order`, `wrong-side`, `insufficient-order`, `insufficient-gold`, `insufficient-item`. Validation precedence is that order; item check applies to sell/eat and gold check to buy. A syntactically valid request for a missing order is `unknown-order`, including exhausted orders.

## Time, failure and starvation

For an active episode, each step is: (1) validate and either commit **all** primitive effects or none; (2) subtract decay, flooring fullness at zero; (3) increment tick; (4) if fullness is zero mark dead and terminate; otherwise terminate if tick equals horizon; (5) observe. Consumption occurs **before** decay, so eating on the last survivable tick can save the citizen. Buying does not eat, selling does not buy. No action has an implicit continuation.

Invalid and infeasible attempts consume the same tick and decay as successful ones. Failure leaves transaction balances, inventory and order volumes unchanged, but is not a rollback of time. No retries, quantity reduction or rescue substitution. JSON malformed/missing candidate output is normalized by the harness to one `wait` and separately logged as a candidate/interface failure, not a valid decision. Candidate wall-time never advances simulation time; an authorized harness deadline also maps to one wait. Deadline settings are comparison metadata, not world rules.

Calling step after termination is an API misuse: reject with `episode-ended`, with no mutation/tick/receipt. Observe remains available. No timers, asynchronous work, partially completed actions or promises enter world state.

## Termination and accounting

No early termination on buying/eating or a claimed goal. Stop only at starvation or horizon (starvation wins ties). Harness abort/compute-budget exhaustion is **incomplete**, not horizon success; retain the last state and reason without synthetic remaining actions.

Report final alive/fullness, ticks survived, free gold/inventory, trades/turnover, food consumed, wasted nutrition and failed attempts, plus the full action/result trajectory. A utility function, personality representation and success threshold belong to the separately agreed evaluation, not to mechanics. Neither trade count nor gold alone is intelligence.

At every committed tick, total gold across citizen + external free balances + bid escrow equals initial total gold. For each item, citizen + external free inventory + ask escrow + cumulative consumption equals initial total items (wood consumption is zero). Fullness is not an item balance. On termination leave all holdings and unfilled escrow in place for audit: no loot, liquidation, reset or implicit refund. World receipts report transfers; harness distinguishes fixture-funded gains from endogenous economy evidence.

## Two worked execution traces

Both use defaults except horizon **3**. Values below are after tick decay; no hidden steps. External account `F` initially has 20 gold, 2 food, 0 wood. Ask `A`: F sells 2 food at 4/unit. Bid `B`: F buys 2 wood at 2/unit. After setup F has 16 free gold, 4 bid escrow, 0 free food, 2 ask escrow. Orders are independently funded.

**1. Buy -> eat.** Citizen initially: 4 gold, no items, fullness 25.

| Tick / submitted action | Citizen gold / food / wood | Fullness | Settlement |
| --- | --- | --- | --- |
| 1: buy A, quantity 1 | 0 / 1 / 0 | 15 | Pay F 4; A remaining 1. |
| 2: eat quantity 1 | 0 / 0 / 0 | 35 | Consume 1; 15 + 30 - 10. |
| 3: wait | 0 / 0 / 0 | 25 | Horizon, alive. |

Final F: free gold 20 + bid escrow 4 = 24; total gold remains 24. Food: 1 remaining ask + 1 consumed = initial 2. Starting fullness **15** instead would mean buying leaves 5, then eating leaves 25; starting **10** makes buying fatal before a later eat. Availability alone does not imply a feasible sequence.

**2. Sell -> buy -> eat.** Fresh identical fixture; citizen initially: 0 gold, 0 food, 2 wood, fullness 35.

| Tick / submitted action | Citizen gold / food / wood | Fullness | Settlement |
| --- | --- | --- | --- |
| 1: sell B, quantity 2 | 4 / 0 / 0 | 25 | Bid escrow pays 4; F receives 2 wood; B exhausted. |
| 2: buy A, quantity 1 | 0 / 1 / 0 | 15 | Pay F 4; A remaining 1. |
| 3: eat quantity 1 | 0 / 0 / 0 | 35 | Consume 1; horizon, alive. |

Final F has 20 free gold, no bid escrow; total gold remains 20. Wood remains 2 at F; food is 1 escrow + 1 consumed. Buying first fails for insufficient gold and spends a tick; no fallback sells wood. These traces are fixtures to explain semantics, not outcomes the harness should force.

## Open choices and extension seam

User choices still unknown: survival versus richer utility/preferences; whether quotes should instead be uncertain/competitive; single citizen versus interacting agents; intended hunger realism/action durations; allowed assistance (legal-action enumeration, supplied consequences, search simulator); candidate budgets and held-out evaluation. **Minimal proposed default:** accept this transparent single-agent primitive-only diagnostic first, with identical observations and no supplied alternatives/forecasts. None of these defaults selects a controller architecture. Agreement on scope/timing/funding is the blocker before implementation; metrics and assistance must be settled before capability comparisons.

Later gather/move/craft should add explicit resource stock, position, recipes and duration/cost observations, with a version bump and conservation deltas for extraction/transformation. Do not add methods that directly achieve a strategic goal. Multi-tick work would require a separately agreed start/advance/cancel/starvation contract; do not fake it by inserting automatic work into v1. This seam preserves generic action composition without prematurely designing production or geography.
