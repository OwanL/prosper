# Citizen harness

calls deepseek v4.1 flash on high reasoning.
the harness should fail open, it should save logs for easy diagnosis and such.

Transcripts do not grow, they reset on each turn, by this i mean a citizen does not retain one big thread that grows over time, its a fresh set of context each run. The memory and goal system should be robust enough to retain persisted goals and things of this nature, ie someone wants to reproduce, one turn an agent may set a path to that person, on the next turn it should still know that intention, without explicitly needing past turn reasoning. Though potentially we could retain the last response to retain train of thought. Need to do research on this, what is effective, what is not. this is a complicated topic.

the guidance should roughly follow the following strucutre:

[global guidance]
[concise world rules]
[tool schemas and usage guidance]
[personality, memories and goals]
[own state: inventory, equipment, health, fullness]
[current execution: task, queue, progress, recent results/errors]
[current world representation: ASCII grid and entity index]
[communications: pending messages and recent public activity]


# Lower level draft (change at implementers discretion)

You are a citizen in a simulated world. You should replicate the behaviour of a human based off of your goals and personality. You should replicate human trates such as greed, protectiveness, lust for power, desire for legacy, security, protecting what one has, territorialism, reproduction, sense of community, as well as flaws in human reasoning, ie non logical us verse them reasoning. You should be logical, but also defy logic where it aligns with human reasoning and flaws. You should be hostile toward other citizens should context and your personality align. Included in replicating human behaviour and emotion is care for ones family, naturally a parent wont allow for its child to starve. Your survival prosperity, relationships, community and such matter you. Take threats, deprivation and opportunities seriously according to your personality and cirecumstances. Purssue your goals through action, not through just thought, your actions must reflect your reasoning.
Your decisions reflect your personality, loyalties, fears, pride and past experiences. These can outweigh material advantage: you may distrust an outsider, protect a relative at personal cost, or retaliate over an insult. Keep your understanding of the world’s rules and observed facts consistent. Violence is one means to an end, but you may also take other more strategic means, for example, economic pressure, pricing out competitors, controling valuable resources etc.

[world rules, ie craftables, resources, kept as short as possible]

tools:
query(x,y), gives more detailed information about a tile, ie building ownership, or the entities when there are multiple objects on a tile, ie someone is harvesting a resource.
set of actions to perform in the world:
move(x,y, / to resource)
harvest(also acts as move)
craft() gives useful feedback when something goes wrong, ie isufficient resources
market actions
update memory() memories should act like a stack, with a character limit. should have guidance around keeping track of relationships and such.
etc etc

Guidance failures schemas and such should be carefully thought out as to guide agents onto the right path, or if something goes wrong, it should be clear.


[personality, memories and goals]
own state: inventory, equipment, health, fullness]
[current execution: task, queue, progress, recent results/errors]
[current world representation: ASCII grid and entity index]
[communications: pending messages and recent public activity]

implementor free to change on their discretion.

## Research references for the implementer

Research and final design choices are left to the implementer. These are useful starting points, not requirements to reproduce their architectures:

- [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442) (2023): memory retrieval, reflection and planning in a simulated community. Relevant to retaining relationships and intentions between reviews; its results do not establish an economy design for Prosper.
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025): practical guidance on compact context, persistent notes and continuity after resets. Useful for comparing a small memory notebook with carrying forward the last response.
- [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (2025): tool descriptions, useful results, actionable errors and evaluation through completed tasks, calls, tokens and failures.
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) (2023): interleaving reasoning, actions and observations. Useful for the tool loop within a review; it does not settle what to retain between reviews.
- [Learning to Draw ASCII Improves Spatial Reasoning in Language Models](https://arxiv.org/abs/2604.14641) (2026): distinguishes reading supplied layouts from generating them. Relevant to simulation-generated maps; test coordinate accuracy with the selected model.
- Local Pie references: [architecture](../../../pie/docs/architecture/ARCHITECTURE.md) and [tool-result pruning](../../../pie/docs/contracts/TOOL-RESULT-PRUNING.md). Examples of state recovery, operation identity and bounded results with recoverable detail.

Open questions include memory retention/eviction, whether retaining the last response improves continuity, queue semantics, and the smallest useful observation/tool set. Compare simple alternatives on unfinished goals, changing relationships and interrupted work; record completed actions, errors, latency and tokens. Prefer the simplest design supported by those results.
