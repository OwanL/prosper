# Tiny-world decision contract — independent agent proposal

Status: design only, 2026-10-08. Proposed defaults, not authorization to implement, train or run inference. Independently derived from `docs/citizen-intelligence-research.md`; no sibling proposal was consulted.

## Boundary and comparison

Use one isolated headless fixture, one acting citizen and a bounded episode. A planning/search controller, RL policy, decision tree, classifier or local LLM receives the same information and commits the same primitive actions. No production controller, automatic survival, strategic rescue, job assignment or durable-world access. Deterministic mechanics execute actions; they do not choose strategies.

The contract is four calls: `reset`, `decide`, `feedback`, `close`. Candidate adapters translate representations, not invent advantageous choices. No plugin registry, generic tool framework, citizen scheduler or production integration is needed. Parallel implementation needs only a versioned fixture description and the records below.

## Records (conceptual, not shared TypeScript changes)

- **Mechanics:** version, action discriminants/parameter schemas, units, timing, public preconditions, recipes and transition rules, visibility rules, terminal conditions. This is rule knowledge, not the current hidden state, lucrative-location annotations or worked strategic solutions. A fixture can disclose deterministic rules without disclosing hidden event schedules.
- **Preferences:** explicit objective attributes/weights and any hard constraints, identical across candidates for a comparison. Include risk/time parameters only if the fixture actually defines their semantics. Do not infer utility from a profession or personality label. Evaluator scores must implement the disclosed objective; diagnostics can measure other effects separately.
- **Observation:** version, episode-local decision index, simulation time, own observable state, visible entities/offers/resources with timestamps, and declared unknowns/omissions. Include numeric zero versus unknown explicitly. Do not send world objects, evaluator labels, future randomness, expected optimal actions or the environment seed. Default: partial observations; a fully observable fixture must be explicitly labelled as such.
- **Action:** a fixture-specific tagged union of primitive commands with explicit units and observable target IDs, including `wait` for exactly one decision quantum. For example, an agreed fixture might expose `move`, `gather`, `buy`, `consume`, `wait`; these are illustrative, not authorization to add mechanics. Avoid strategic macros such as “secure food” or “choose profitable work”. Emit exactly one action, not an executable plan or free-form intent. Internal plans/search are candidate-private.
- **Decision:** `{requestId, action}`. Optional bounded diagnostics (scores, predictions or explanation) are recorded separately and never executed or used as evidence of correctness. No common requirement to produce reasoning text.
- **Outcome:** `{requestId, attemptedAction, disposition, publicReasonCode?, elapsedSimulationTime, observableEvents, nextObservation, reward?, terminal, terminalReason?}`. Disposition distinguishes executed, world-rejected and harness failure. Events include only personally observable consequences; no hidden counterfactual payoff. Reward is the disclosed preference-based signal, not an evaluator's optimal-action hint. Terminal feedback is delivered exactly once; no subsequent decision.

The fixture owner fixes actual fields/actions before implementation. Keep the first union small and parameters finite/bounded; do not adapt the full Prosper command catalogue.

## Alternatives: two separate authority tracks

**Default: generate primitive actions.** Supply the action schema and public mechanics, not a curated list of worthwhile actions. The candidate constructs target/parameter combinations. A classifier can score a mechanically enumerated finite action set inside its adapter, but that enumeration is part of the candidate and its cost/provenance is recorded. It cannot read hidden state. Trees/RL may likewise use explicit encodings; version and retain those transforms. Mapping labels to actions must not change their semantics.

**Separate assisted track: choose from supplied alternatives.** The harness provides stable IDs mapped to exact primitive actions. State whether the menu is exhaustive over the declared finite domain, visibility-filtered or pruned. Use public syntactic enumeration by default, not ranking or strategic pruning. Do not silently remove actions based on hidden affordability/availability. If an experiment supplies true legal-action masks, plans or consequences, mark that as additional assistance and apply it equally. A consequence-supplied ranking test is not evidence of forecasting or candidate discovery.

Menu order is seeded independently and retained; test reordered equivalents. Report generated-action and assisted-menu results separately. A classifier unable to construct actions is still a valid assisted comparator, not evidence that it has discovery capability. No hidden rule adapter may fill in prerequisites or replace the selected action with a better one.

## Lifecycle, randomness and private state

1. **Construct/load:** identify controller/version, fixed artifact/configuration, adapter transforms and acquisition/training provenance. Only approved local assets; no network, cloud fallback or automatic download.
2. **`reset(context)`:** create a fresh instance or demonstrably clear all episode state. Context contains mechanics, preferences, information/menu track, phase, adaptation flags, candidate RNG seed and resource ceilings. Initial observation goes to the first `decide`. The environment seed stays harness-private.
3. **`decide(input, limits, abortSignal)`:** input contains request ID, immutable observation and optional assisted menu. Exactly one in-flight request; simulated time pauses during computation. Candidate may update working memory only as permitted. No world reference, stepping tool, evaluator callback or arbitrary environment query.
4. **Execute:** validate structurally, then apply public mechanics through the authoritative fixture boundary. Advance one fixed decision quantum, delivering observable action progress if actions take longer. No implicit run-to-success. Commands while busy follow a documented public rule, not controller-specific continuation. Bounded search may simulate its own disclosed/learned model locally; it cannot clone/step the actual hidden world.
5. **`feedback(outcome)`:** deliver the same observable outcome/reward to every candidate, including failures and terminal results. Bounded memory/belief updates occur here under the flags below; feedback cannot issue actions. Its compute counts toward the episode ceiling.
6. **`close()`:** release resources and discard private episode state. Stop on terminal state, horizon, resource exhaustion or harness fault. Late replies cannot execute after close/reset.

Environment RNG and controller RNG are separate streams. Reset reproduces initial conditions and candidate randomness independently; one candidate's search draws must not consume world randomness. Prefer environment draws keyed by simulation time/event/entity where possible so extra rejected actions do not perturb unrelated shocks. Paired seeds do not guarantee identical trajectories once actions differ. Record RNG algorithm and seed mapping privately in receipts; never expose held-out seed labels or scenario names that reveal the answer. Identical seeds do not guarantee deterministic GPU inference.

Private memory is owned by one controller instance, JSON-serializable if snapshots are needed, and bounded (proposed 64 KiB). It can contain beliefs, recurrent state, plans and experience, not references to privileged world objects. No sharing between citizens/candidates or across evaluation episodes by default. Static approved artifacts are separate from memory. Cross-episode retained learning is a distinct declared experiment.

## Training, evaluation and frozen adaptation

Use explicit independent flags rather than one ambiguous `learning` boolean:

| Flag | Proposed training default | Evaluation adaptive | Evaluation frozen |
| --- | --- | --- | --- |
| `parameterUpdates` (weights/tree fitting/policy tables) | Only if explicitly authorized | false | false |
| `beliefUpdates` (learned yield/fill estimates etc.) | true | true | false |
| `skillWrites` (new/revised reusable procedures) | true | false | false |
| `episodeCarryover` (private learned state across resets) | Declared training protocol | false | false |

These training defaults describe a future protocol, not training permission. Learning methods unable to honor a requested flag must report unsupported, not silently substitute behavior.

Frozen does **not** mean amnesia: both variants can retain an identical bounded observation history, action progress and recurrent working state needed to execute a fixed policy. Frozen disables changes to identified learned predictors/value tables/skills; planning with fixed mechanics against newly observed conditions remains allowed. Declare which state is working memory versus adaptive state before running. For an LLM that learns implicitly from history, “frozen weights” alone is not a frozen-experience control: use an explicit context ablation and label its information difference, or report that matched freezing is unavailable. Do not claim adaptation causality from an unmatched control.

Lock artifacts, prompts, transforms, hyperparameters and training cut-off before held-out evaluation. Reset from the same trained artifact for each episode. Evaluation feedback remains observable experience, but held-out aggregate scores/optimal-action labels cannot tune the candidate. Separately report acquisition/training compute, episodes and supervision; inference equality does not erase training cost.

## Limits and failure semantics

Proposed initial safety ceilings (not measured performance targets): one decision request, 5 s wall deadline, 30 s episode compute, 64 KiB output/memory bound, 1,024 generated tokens for an LLM, 10,000 internal model expansions for search. Feedback/reset need bounded deadlines too (proposed 1 s each, charged to the same episode ceiling). No retries or repair calls by default. Count adapter enumeration, serialization, inference, search and feedback; report resident memory, cold load separately, warm decision p50/p95, tokens/calls and expansions. Token and expansion ceilings are method-specific guards, not claims of equivalent compute. Set episode horizon and actual device/resource envelope before an experiment; compare quality–cost curves if these provisional ceilings constrain candidates differently. No local execution is authorized here.

On timeout abort and invalidate the request generation; discard late results. Cancellation does not prove native inference stopped: if it cannot be contained, stop the episode and clean up before another starts. No services left behind.

| Class | Examples | Default handling / reporting |
| --- | --- | --- |
| Schema/output | Unparseable JSON, missing discriminant, nonfinite/out-of-schema parameter, unknown supplied menu ID | No command; record separately from judgment. |
| Transport/resource | Endpoint failure, timeout, over-limit output, process crash | No command; record availability/cost separately. |
| Semantic/mechanics | Well-formed command violates funds, busy state, target visibility or another world precondition | World rejection; visible reason, no silent correction. Distinguish foreseeable mistakes from newly changed/unknown conditions. |
| Strategic quality | Legal but dominated/unprofitable/risky choice under disclosed preferences | Execute normally; judge observable downstream outcomes, not JSON validity or explanation. |
| Harness/interface | Contradictory manual/validation, corrupted observation, execution bug | Stop and flag trial invalid; not an agent mistake. |

For output/transport failures and world rejection, advance exactly one quantum with no action effects (ordinary environmental dynamics still occur), and provide bounded non-oracular feedback. This is a disclosed costed idle, not a strategic fallback. Such failures also consume decision opportunities; a horizon prevents infinite free retries. Report valid-decision quality and end-to-end episode outcomes separately without hiding failed attempts. No error should reveal unseen entities, their inventories or future success. Error reasons must be coarse when precise reasons would leak hidden state.

## Defaults versus unresolved choices

**Proposed defaults:** four-call interface; one primitive/quantum; public mechanics, private observations and explicit preferences; generated-action main track plus separately labelled menu assistance; no hidden simulator oracle; separate RNG streams; reset private episode memory; fixed evaluation artifacts; optional explicitly bounded belief adaptation; no repair retries; costed idle on non-harness failure.

**Must settle before parallel implementation:** exact tiny fixture/actions/quantum/horizon and terminal rules; observation visibility and objective/reward timing (dense shaping must be declared assistance); finite parameter domains/menu coverage; which adaptive fields can genuinely be frozen; approved artifacts and training permission; actual hardware/compute ceilings; whether deterministic fully known mechanics or uncertain learned dynamics are being tested. This proposal does not select a candidate architecture, a fixture winner or an inference experiment.
