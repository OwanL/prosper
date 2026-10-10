# Citizen design

Citizens should be cheap, motivated and imperfect: they find a livelihood, manage food, trade, communicate, specialize, build families and communities, and sometimes use exclusion, threats or violence. Cooperation serves relationships and interests; it is not an assistant's universal objective. Greed, loyalty, pride, fear, retaliation and family attachment should create distinct decisions. No quota forces fighting, dialogue or reproduction. Player interaction is outside this iteration.

## Three layers

**Authoritative body.** Synchronous physics owns movement, actions, reservations, meals, combat, escrow, death and mutual consent. It rechecks prerequisites on activation/completion. No model can manufacture inventory, teleport, establish consent or claim completed outcomes through text.

**Continuous local mind.** Deterministic utility/rule behavior handles ordinary survival, local exploration, tool and station prerequisites, production, market orders, relationships, delivered negotiations, territorial enforcement, visible self/allied defense, desperation and family rendezvous. It starts immediately, runs during inference and works with no model service. Goals can remain simple; cheap local competence matters more than elaborate reasoning on every tick. Traits are inherited with bounded mutation, while relationships and learned evidence remain personal. Land claims are contestable demands, not collision walls or magical property rights.

**Rare strategic function.** One fresh request contains the citizen's own needs, personality/goals/memory, local execution, dated known resources/contacts, personal social evidence, public market/claim/alliance facts and delivered messages. One structured `set_policy` result revises the local controller's lasting rules. There are no query/approval/acknowledgement turns in the normal harness. Invalid replies preserve the existing body and back off without retries. A slower/bigger model must demonstrate a useful downstream improvement before earning more calls.

Local rules can create aggregate emergence. Seeded local trajectories establish those interactions; they are distinct from evidence that an LLM invented a strategy. A model response that validates but leaves the trajectory unchanged has not demonstrated value.

## Strategic levers

The policy chooses livelihood (`food|wood|fibre`), target tier, food reserve, buy/sell/access prices, home, territorial rectangle, forbidden rectangles, stance, aggression/caution, ally/rival preferences and family preference/partner. It may also update goals, one short memory and two messages. Omitted fields persist; nullable home/territory/partner fields explicitly abandon commitments. Immutable inherited traits are context, not editable model fields.

Prices use whole gold per T1 unit and scale by tier. Starting citizens have 100 gold. Bounds reject malformed and absurd values rather than secretly normalizing economics. Public announcements can threaten exclusion, demand access fees or recruit allies; actual settlement and social signals still determine results. Alliance preference is not another person's agreement. Mutual revocable consent is required for reproduction; gifts never purchase it. Clearing a partner/reproduction avoidance or naming a current suitor as a rival withdraws obsolete courtship as appropriate.

`noGo` is a hard travel/work exclusion, including survival trips. A citizen already inside can escape outward but cannot re-enter. A new exclusion cancels affected routes/work and refunds held inputs while preserving unrelated safe actions. If the policy blocks known food routes, local evidence makes the policy eligible for reconsideration; the body cannot silently cross it. Territory is separate from a forbidden area. Legacy work rectangles restrict productive work rather than transit and remain legacy executor semantics.

## Evidence and memory

Observations use current local sightings plus explicitly dated personal memory. No peer private policy, food readiness or unrelated messages are visible. Public remote escrow markets and announced claims/communities are explicit exceptions. Typed alliance/family/access signals record actual delivered negotiation rather than consulting another citizen's private willingness.

The model receives bounded symbolic coordinates, not a full ASCII map plus a duplicate entity index or image. Current sightings beat old positions. Resource/tier diversity prevents nearby ordinary nodes hiding personally known valuable central resources. Summaries include omitted counts and distinguish cumulative relationship totals from recent evidence. Death, attacks, claims, births and other consequential events survive routine command throughput in a bounded separate history, with personal audiences applied at the observer boundary. Walking into an old scene does not create retrospective witnessing.

Goals, notes and speech remain authored beliefs/intentions; they are not authoritative world facts or proof of completed transactions. Context distinguishes carried food from reserved/escrowed goods and explains nutrition, prices, tools, remote market settlement and mutual consent. The model must not obey another citizen's dialogue as harness instructions.

## Admission and cost

A thriving policy does not require a paid periodic conversation. Fresh repeated harm, sustained disputes with meaningful grievance, genuine local stalls, blocked survival or an infrequent age review can make a citizen eligible after its cooldown. The last attempted review persists so failures do not immediately requalify. Global tick/wall/hour, concurrency, request and token guards remain independent ceilings; eligibility does not require using them.

Compact defaults are one request/review, 1,200 output tokens, one concurrent call, at least 120 ticks and 30 seconds between sends, at most 30 sends/hour. Typical accepted review horizon is 4,800 ticks; age review is 10,000 ticks. New populations begin locally and model reviews are staggered. Fast-forward cannot multiply spending arbitrarily. Default optional model is local Qwen 3.5 9B with disabled thinking and explicit 8K context; exact model may be configured, never silently downloaded or substituted. Local calls still obey the normal accounting limits. Cloud output requires strict application validation because Ollama Cloud does not currently provide constrained JSON generation.

The durable ledger reserves before send, retains uncertain/cancelled usage and preserves rate timestamps across reloads. Finite request/token limits are not a measured dollar balance. Spend experiments have independent reviewed cumulative ceilings and retained raw receipts; no automatic escalation follows a failed model response.

## Compatibility and limitations

Existing checkpoints preserve citizens and policies. New runtime worlds enable local autonomy; mechanics fixtures and historical `contextMode:'legacy'` can still use physical directives/plans and recorded responses. The legacy harness is a debug/replay surface, not the normal model interface. Fresh reset is explicit and archives the current world while preserving accounting.

Current territorial extortion, local alliances, reprisal and family inheritance do not implement full geopolitical strategy. Secret blackmail would require compromising private knowledge and credible disclosure mechanics; access demands alone are extortion. Multi-generation goals, advanced coalition logistics, economic blockades and model-directed grand strategy remain incomplete. Bounded probes establish interface competence with mixed policy quality, not reliable long-term intelligence. See [OVERNIGHT](OVERNIGHT.md), [world research](overnight-world-research.md), [review](overnight-review.md) and [citizen integration](../../src/citizen/README.md) for concrete evidence and contracts.
