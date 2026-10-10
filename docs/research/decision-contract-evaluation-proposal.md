# Decision contract: evaluation and harness proposal

Status: **proposal for contract review, 2026-10-08**. No implementation, experiment, model selection or world expansion is authorized by this document. After agreement, world, harness and AI work can proceed in parallel against a frozen contract. This proposal is independent of sibling proposals; differences require explicit integration rather than silent precedence.

## 1. Claim and boundary

Test whether a citizen discovers and executes beneficial alternatives using deterministic primitive moves, then changes its choice when opportunities or preferences change. Score consequences, not a prescribed profession, action sequence, persuasive explanation or JSON validity.

Read together with `../citizen-intelligence-research.md`, `../../README.md` and `../spike-2/OVERNIGHT.md`. Existing authored autonomy is a diagnostic baseline, not evidence of discovered strategy. The primitive track disables autonomy, emergency rescue, strategic directives and approved-plan goal selection. Automatic meals, hunger, action reservations, pathfinding and settlement remain declared mechanics; the executor must not buy food, choose deposits, construct prerequisites or replan on the candidate's behalf.

This is a small decision benchmark, not a society, entertainment or general-intelligence benchmark. No housing, wages, transport charges, external buyer, new currency, new building or neural training reward is added.

## 2. Minimal episode contract (proposed defaults)

Each fixture manifest freezes:

- Contract/version and mechanics revision/hash; exact initial JSON state and hash; actor and counterpart IDs; initial knowledge; preference vector; horizon; finite allowed command alphabet; seed streams; counterpart schedule; success predicate and budget.
- Declared mechanics: recipes, durations, route rules, automatic meals, depletion/regrowth, market priority, escrow/refunds and observation/validation rules. These are shared **development mechanics**, not secret information.
- A counterpart is an ordinary funded citizen with reserved inventory and explicit orders, not an unlimited buyer. Its fixed behaviour is recorded, never inferred by the executor. No combat, reproduction, random damage or autonomous social responses in the initial suite.
- One actor decision boundary per tick: observe, select **one** allowed primitive or `idle` (harness no-op, not a new world command), synchronously validate/dispatch, advance exactly one tick, then update knowledge. Work advances during idle. Orders can coexist with physical work under existing mechanics. An accepted command is not proof of completed work or a future fill.
- Commands use ordinary citizen knowledge validation plus the authoritative dispatcher; no spectator/debug bypass. Unknown/stale target failures return ordinary feedback. Existing action queues are disabled for this track. Shared deterministic pathfinding may route a chosen destination but may not choose that destination.
- Episode ends at the manifest horizon, actor death, or infrastructure failure. Reaching an intermediate objective does not truncate hunger or remaining liabilities. Terminal active orders/actions remain accounted for; no free final cancellation, liquidation or work completion.

**Default bounds:** at most 7×7 walkable geometry, one evaluated actor and at most two fixed counterparts, T1 resources/tools only, 48 ticks, six decision-relevant targets, and 64 distinct admitted commands including idle. Maintenance off, autonomy off. If current mechanics make these bounds infeasible, report that contract mismatch before increasing them; do not quietly accelerate work or grant supplies.

The command set contains move to declared coordinates, harvest named deposits, craft named T1 tools, bounded buy/sell/cancel-order and cancel, plus idle. Tools are ordinary inventory items: citizens automatically use the highest-tier matching available tool, with no equip/unequip commands or separate equipment state. Tools in sell escrow or work reservations are unavailable for use; available tools remain tradable. Each fixture publishes integer price and quantity domains and an order-count bound. The oracle and candidate have identical action authority. Extra observations/queries do not expose hidden state or create extra action opportunities. The primitive track generates commands itself; ranking supplied plans is a separately labelled assisted track.

## 3. Four minimal fixture families

Numbers below are construction constraints, not claims that current world states already satisfy them. The world owner supplies concrete manifests and the harness proves the constraints before a fixture is admitted. No fixture passes because its author labels a particular move sensible.

| Family | Initial situation and controlled variation | Outcome acceptance, not trajectory |
| --- | --- | --- |
| A. Immediate opportunity cost | Urgent but survivable hunger; nearby wood, reachable food, funded food ask and funded wood demand. Pair affordable/available trade with unaffordable or absent trade. | Alive at horizon, health at least initial health; satisfy oracle utility/regret threshold. Both pairs must have a feasible survival sequence. Buying is not mandated: any equally valuable harvest/trade sequence passes. |
| B. Prospective investment | Known wood production opportunity; T1 axe recipe is executable from declared holdings/acquisition; finite funded demand. Pair short-lived demand/horizon with persistent demand. | Alive; threshold on terminal personal utility after all inputs and time. At least one pair must have a strict oracle advantage for investing and one for avoiding investment. Owning an axe alone earns no bonus. |
| C. Funding and reservation | Beneficial physical production/trade is possible, but actor liquidity or reserved ingredients bind. Include partial fill, cancellation refund and a non-filling order. Pair sufficient funding with insufficient funding. | Threshold on realizable outcome, no overspend or double-use. Funded success must be reachable; the unfunded case is labelled opportunity-limited when the oracle proves no beneficial sequence. Posting an order is not a sale. |
| D. Changed opportunity and commitment | Start with two feasible known production opportunities; a counterpart's bounded schedule changes demand after some work. Pair persistent with transient change; identical pre-change observations. | Threshold after the change, costs of cancelled work included. Continuing or switching may pass; sunk expenditure earns nothing. Score adaptation against a frozen continuation as an additional diagnostic, not a replacement oracle. |

Admission also requires an idle rollout, one legal feasibility witness and a strict beneficial gap of at least **1 utility point** over idle in each positive-opportunity case. Reversals must have disjoint optimal outcome regions with a gap of at least 1, not merely different arbitrary tie-broken traces. A paired condition is not counted as two independent samples. Counterpart scripts are fixture controls, not claimed AI competence.

Keep cancellation/partial-fill accounting fixtures separate from economic capability scores where no meaningful beneficial choice exists. Negative controls explicitly test that nonexistent profitable trade is not blamed on an agent.

## 4. Reward and personality without new world mechanics

Preferences are evaluation input, not inventory, money or a new world field. The candidate receives the same machine-readable definition used by the scorer; prose personality may describe it but cannot override it.

Default utility at horizon H:

`U = ΔG + ΔF/10 + ΔHP - cT * B + a * ΔG_other`.

- `G` is the actor's cash plus funded-buy escrow, counted once; no speculative mark-to-market or presumed future sales. Transfers count as cash changes; wealth acquired only through an actual settled trade counts.
- `F` is fullness; `HP` is health; deltas are relative to tick zero.
- `B` is ticks of actual actor physical movement/work during the episode, including work later cancelled. It is a declared effort preference, not a currency/time fee paid to the world.
- `G_other` is the combined cash plus buy escrow of the fixed counterparts. Report their individual changes as well. Default `a = 0`: citizens are not optimizing society-wide wealth.
- Default `cT = 1/20`; retain rational coefficients and compare exact rational utility values. Terminal goods, tools and buildings have **zero liquidation value** in this short suite; prospective service matters only through actual consequences within H. Record holdings separately. Longer horizons or terminal values require a new contract version.

Hard constraints precede utility: actor alive and terminal health at least initial health. Feasible outcomes outrank infeasible ones regardless of cash. Record infeasible utility diagnostically, never reward dying rich. Within feasible outcomes maximize U; all tied maxima are correct. Initial survival fixtures avoid unavoidable transient damage; later fixtures may declare a different explicit constraint.

Personality diagnostic uses the same state and consequences with `cT = 1/20` versus `1/2`, or `a = 0` versus `1/2`, one axis at a time. Only admit a preference-reversal pair when the exact oracle proves a different optimal outcome; dominant choices should still converge. Do not assign professions or inject unexplained randomness. Risk preference is **not tested** by deterministic outcomes; a later stochastic contract needs a declared utility over outcome distributions. Beliefs, observations, preferences and acquired memory remain separate inputs.

This utility is a transparent provisional test objective, not the final definition of a Prosper citizen's motivation. Report health, fullness, money, effort, holdings and counterpart outcomes separately so utility weights cannot hide harm.

## 5. Exact oracle and feasibility/capability separation

For these finite fixtures the oracle is exhaustive finite-horizon dynamic programming over the **same deterministic primitive transition**, not a handwritten good plan:

1. From each reachable state at tick t, try every manifest-admitted command including idle. Apply ordinary validation/dispatch, one tick and knowledge update exactly as in the episode.
2. Carry initial state, action progress, reservations, order sequence/priority, counterpart schedule, hunger, knowledge and RNG state. Include accumulated effort in the state/value. Preserve every future-relevant field when deduplicating; elapsed work, hidden knowledge or order age cannot be dropped for convenience.
3. At H or death, evaluate the exact constraints and utility. Back up the best feasible utility and retain all ties plus at least one legal witness. If none is feasible, mark `world-infeasible`; do not manufacture a optimum from invalid terminal states.
4. Retain optimum value, reachable objective ranges, idle value and replayable feasibility witness. Replaying a witness through the ordinary episode must reproduce every state hash and value. Independently hand-audit small transition/accounting examples to avoid a shared simulator bug validating itself.

The result is exact **only within the frozen command domain, horizon, counterpart schedule and information regime**. Finite price domains and short horizons are real restrictions, not approximations to an unrestricted economy. Illegal attempts count against the candidate budget; include them in oracle transition semantics when they advance time. Do not drop them if a failed attempt can reveal information. Branches may be pruned only by proved equivalence/dominance, with retained justification. A best found plan or beam search is not an exact oracle.

**Oracle construction ceiling:** 1,000,000 unique state-time nodes or 60 seconds per fixture on recorded hardware. Exceeding either means `oracle-unresolved`; exclude from exact-regret acceptance and redesign/review the fixture, not downgrade the solver while retaining an “exact” label. Oracle compute is harness construction cost, not free compute for candidates.

Report separately:

- **World feasibility:** fraction with feasible objective; gap between optimum and idle; funded demand versus physical opportunity; negative controls correctly certified; oracle coverage/unresolved count.
- **Capability on certified feasible cases:** success, exact utility, regret `U* - U`, objective completion time, invalid commands, failed work, candidate generation coverage where inspectable, and adaptation versus frozen continuation. Missing a legal profitable sequence is not the same as a world with no such sequence.
- **Assisted diagnostics:** identical observations plus supplied alternatives, then alternatives with supplied consequences. Their ranking score cannot be credited as candidate discovery or forecasting. Classification probabilities are not utilities.

## 6. Known semantics is not full observation

The initial acceptance suite is a **known-semantics, fully decision-relevant-observed** track: current initial relevant stock, routes and orders plus counterpart schedules are disclosed. The oracle's state knowledge therefore does not confer strategic foresight denied to the candidate. No omniscient lookup is available during execution beyond those disclosed conditions.

A later partially observed track keeps mechanics known but hides current remote stock, counterpart future changes or yields. Stale sightings stay dated. Full-state optimal regret is then only an **optimistic opportunity ceiling**, not fair capability acceptance. A fair exact oracle must optimize observation-history policies under the same declared prior and information; include costed exploration and feedback. Without that finite belief-policy oracle, report realized utility and paired information-matched baselines, not claims of exact rational-choice failure. Exploration may be rational even when one realized rollout loses money.

For learning, later episodes can preserve declared personal experience within one trial, paired with a frozen-memory control. Reset learning between independent trials. Improvement must trace evidence → changed prediction → changed action → outcome; accumulating text alone earns no learning score. This is outside the four-fixture initial gate.

## 7. Development/held-out discipline

Proposed split: **12 development manifests** (three per family), **24 held-out manifests** (six per family); maintain paired conditions inside the same split. Seeds are additional repeats, not a substitute for scenario holdout. Development may show exact traces/oracle values and supports debugging.

Candidates see development mechanics, schemas, action domains, preference definitions and development episodes. Held-out maps, stocks, placements, price/quantity combinations, deadlines, counterpart schedules, oracle traces and outcomes are withheld from training, prompting examples, retrieval and tuning. The generic protocol/action-domain schema is public; the actual permitted commands for an episode are supplied at execution. Seeing a test's ordinary observation at decision time is not leakage.

Freeze candidate code, prompt, weights, memory initialization, budget and selection rule before unsealing held-out manifests. Generate and escrow the held-out manifest hashes with an independent harness owner; do not place secret manifests in candidate-accessible retrieval trees. Representation tests permute names/IDs, coordinate orientation where mechanics permit and option ordering without changing opportunities. Include held-out parameter combinations, not just renamed development states.

One sealed evaluation per candidate version. Retain every attempted version and failure. If held-out outcomes inform a revision, that split becomes development and a new sealed set is required. No selecting the best test seed, oracle trace retrieval, hand-authored case recognizer or changed executor rules after seeing results. Generic semantic planners may know recipes; they may not contain fixture solutions. Shared training across citizens and personal-memory persistence must be disclosed as different assistance levels.

## 8. Budgets, defaults and failure labels

Proposed candidate episode ceiling: **48 decisions**, one local inference at most per decision, **100 ms warm p95 decision latency**, **5 seconds cumulative decision compute** and **10 seconds end-to-end episode time**, excluding separately measured cold loading and harness oracle construction. Single sequential candidate; no cloud, auto-retry, implicit fallback or model download. A generative candidate additionally caps output at 512 tokens/decision and 8,192 generated tokens/episode. Record actual prompt tokens, not just output. These are proposed comparison budgets, not measured hardware guarantees; larger-budget tracks require explicit review and separate reporting.

Executor/pathfinding and feature/prediction/search time are inside decision compute where candidate-specific. Common world ticks/observation time is measured separately. Invalid output, timeouts and retries use the same ceiling; after a failed decision the explicit harness fallback is idle, never rescue. Cancel timed-out work and stop all candidate processes on episode teardown. Cold-load memory/time, peak RAM/VRAM, acquisition size/license, training/fine-tuning cost and throughput are **feasibility metrics**, not economic capability. Report local feasibility even if quality is poor, and quality only for candidates that actually ran.

Classify failures with evidence; allow multiple contributing labels:

- `world-infeasible`: no admissible feasible outcome under exact oracle.
- `oracle-unresolved`: construction ceiling or exactness proof failed.
- `interface`: observation/schema/validation mismatch or unavailable promised action.
- `mechanics-accounting`: invalid transition, duplicate settlement or broken invariant; invalidate affected episode, do not charge agent regret.
- `candidate-generation`, `forecast`, `ranking`, `execution/commitment`, `adaptation`: supported stage diagnosis; use assisted ablations or logs, not inferred model thoughts. Otherwise `agent-undifferentiated`.
- `budget/latency`, `runtime/load`, `invalid-output`: report both feasibility and downstream idle outcome; never silently omit these episodes.
- `information-limited`: full-state opportunity not demonstrably discoverable under the observation contract.
- `leakage/reproducibility`: invalid comparison; quarantine results rather than declare a winner.

## 9. Accounting and reproducibility gates

Check after every command and tick, not only at terminal state:

- Gold equals initial gold across living/dead untransferred holdings, funded buy escrow and uncollected loot; avoid counting settled death holdings twice. No negative balances or unfunded orders.
- Every carried item, sell escrow, work reservation and loot item belongs to one pool. Tools are counted as ordinary inventory units, not separate equipment holdings. Goods already delivered cannot remain reserved.
- Record item flow reconciliation by item/tier: initial stock plus declared regrowth/harvest/output, minus meals/recipes/consumption, equals final pools. Crafting/refining are transformations, not a false claim of item conservation. Account deposit stock and reservations according to the pinned mechanics.
- Partial fills reconcile quantity, payment at the resting price and excess escrow refund. Cancellation refunds once; repeated cancellation cannot pay again. Inputs/output and completion occur once; cancellation cannot produce unfinished output.
- Death ends work/orders through ordinary settlement. No duplicate goods (including inventory tools) or gold. Rejected commands have only the documented effects, including any feedback/time advance.

Deterministic default seeds: development **101–103**, held-out **1001–1003**, each used for every applicable manifest. Separate world, candidate and perturbation seeds; preserve full RNG states and counterpart schedule. Save canonical initial state, mechanics/contract/source hashes, allowed-command domain, preferences, exact observations, responses/commands/results, tick hashes, oracle certificate, final components and timing boundaries. Nondeterministic GPU inference is explicitly labelled; repeat three candidate seeds/runs on identical world input rather than claiming byte-identical model outputs. Deterministic action replay must still be byte-identical after canonicalization that excludes only documented non-mechanical timestamps.

Use OS-temp episode storage, never existing `.prosper/` or `.prosper-v2/`. Intentional retained evidence location is agreed before implementation. No running services after teardown. Report all scheduled cases, medians/p95 plus ranges, and paired differences by manifest; correlated seeds/pairs do not increase the independent scenario count.

## 10. Acceptance and parallel handoff

**Contract readiness:** every field and utility component above is concretized; fixture hashes/split ownership frozen; ordinary validation agrees with supplied observations; every admitted development and held-out fixture has an exact certificate or explicit negative-control classification. Accounting/replay gates pass 100%; no unresolved fixtures silently enter the score denominator.

**Proposed candidate gate, not a production-quality claim:** on sealed positive-opportunity cases, at least **90% feasible-outcome success**, median regret at most **0.5 utility points**, p95 regret at most **2 points** (infeasible outcomes count as infinite regret), at least **80% paired opportunity/preference reversal success**, and the stated compute limits. Require per-family results and all failures; aggregate success cannot hide an entire failed family. Reversal success means threshold-quality outcomes in both conditions, not necessarily different commands. No gate is applied to infeasible negative controls as though survival/profit were attainable.

- **World owner:** concrete deterministic manifests, pinned mechanics and transitions, observable information, ordinary fixed counterparts and accounting boundaries; no strategic helper or new world feature.
- **Harness owner:** protocol adapter, exact enumerator/certificates, isolation, sealed split, accounting/replay checks, budgets and complete metric reporting. No candidate strategy selection.
- **AI owner:** interchangeable primitive-decision candidate with frozen setup and costed internal alternatives/predictions/memory; no fixture IDs/answers. Assisted variants labelled separately.

Review these proposed defaults before parallel implementation, especially horizon feasibility, terminal utility, full-information schedule disclosure and latency gates. A locally fast classifier is not accepted on speed alone; an oracle proving a profitable option is not evidence that a candidate discovered it. Longer uncertain and interacting worlds follow only after this small contract resolves feasibility versus capability.
