# Territory, settlement, trade, and institutions

Research synthesis: 2026-10-09. Design research only. No territory redesign is selected; no mechanics, controller, training, or simulation experiments were implemented or run. Independent read-only research and code inspection inform this report. Proposed examples and tests below are not observed Prosper outcomes.

## Research question

What small set of world affordances would let individually motivated citizens develop persistent settlements, specialization, trade networks, and institutions, rather than merely obey an authored town-building policy?

Territory is one possible part of that system, not the whole explanation. Separate four outcomes:

1. **Settlement:** citizens repeatedly work and remain in an area because it continues to be useful.
2. **Agglomeration:** proximity to other citizens improves their opportunities, beyond everyone independently preferring the same resource patch.
3. **Specialization and exchange:** different opportunity costs and actual demand make trading preferable to self-supply.
4. **Institutions:** participants sustain expectations, access arrangements, contributions, and responses to disputes over time.

A cluster does not prove cooperation. Trade does not require a dense town. Territorial conflict does not by itself explain productive settlement. A named alliance does not prove a durable institution or civilization.

## Evidence and its boundaries

### Economic geography: why live near others?

Duranton and Puga distinguish **sharing, matching, and learning** as microfoundations of agglomeration. Sharing can spread the cost of an indivisible facility; matching can improve access to suitable counterparties; learning can make useful knowledge easier to acquire locally. These are mechanisms to investigate, not permission to give citizens an arbitrary population-density bonus.

Source: [Micro-Foundations of Urban Agglomeration Economies](https://www.nber.org/papers/w9931), 2003 working paper, subsequently published as a 2004 handbook chapter. The primary abstract was inspected; this synthesis does not claim an independent full-text review of every constituent model.

**Prosper implication:** ask what a neighbor supplies that a distant market seller cannot. A productive patch can attract several independent citizens without their proximity helping one another. A shared facility could create a separate proximity benefit, but only if avoided construction costs outweigh travel, contention, and access risks.

### Learned specialization: convincing evidence, supplied opportunities

The AI Economist's Gather-Trade-Build economy demonstrates agents learning to gather and sell inputs or buy inputs and build, depending on heterogeneous building returns. Occupational behavior is learned, but the productivity differences, utility, auction, and house revenue are supplied by the model. Its specialization results do not establish useful residential settlement or emergent government.

Source: [The AI Economist: Optimal Economic Policy Design via Two-level Deep Reinforcement Learning](https://arxiv.org/html/2108.02755), inspected text, particularly Figure 2, the specialization discussion, and Gather-Trade-Build methods. The earlier version and its external house-demand limitation are examined in [`../round-2-settlement-mechanisms.md`](../round-2-settlement-mechanisms.md). Do not mix numerical setups across versions.

**Prosper implication:** citizens need feasible gains from exchanging production, not assigned professions. Location, tools, owned capital, travel costs, and preferences might create differing opportunity costs. Actual buyers and affordable consumption matter. Finite gold can circulate; its finiteness alone neither proves an economy must stop nor guarantees workable liquidity.

### Economic organization from simple adaptation: institutions are not free

Howitt and Clower demonstrate a trading network and commodity money emerging through shop entry/exit, customer search, and adaptive pricing. However, specialist shops are already the only permitted exchange route. Production and desired consumption types are assigned, goods are perishable, and the population is explicitly at a single location. It is not evidence of spatial towns emerging or citizens inventing arbitrary institutions.

Sources: [published record](https://doi.org/10.1016/S0167-2681(99)00087-6); [verified archived primary preprint](https://web.archive.org/web/20041125125249/http://www.econ.brown.edu:80/fac/Peter_Howitt/publication/horg.pdf). Independent research inspected the preprint and archived simulation source. The final typeset article was not compared against the preprint.

**Prosper implication:** useful organization can arise from individual experimentation and repeated relationships, but we must identify which organization is authored into the available actions. Prosper already supplies money and global market clearing, so this is not an argument that its citizens will invent either.

### Voluntary groups: a benefit to joining and a reason to leave

Axtell's firms model assumes increasing returns to cooperation, equal output sharing, and income/leisure preferences. Agents choose effort and can join or create firms. Groups form, but free-riding makes sufficiently large groups unstable. Individual firms can disappear while aggregate firm-size patterns persist.

Source: [The Emergence of Firms in a Population of Agents](https://www.brookings.edu/articles/the-emergence-of-firms-in-a-population-of-agents-local-increasing-returns-unstable-nash-equilibria-and-power-law-size-distributions/), 1999 primary abstract inspected. Full-paper methods were not independently reviewed here.

**Prosper implication:** a group should offer a real benefit, and defection, departure, fragmentation, or failure should remain possible. Neither a universal cooperation bonus nor a fixed alliance-size cap follows from this source. Fixed capital might provide a concrete economy of sharing, but that is a Prosper hypothesis, not the paper's result.

### Commons and governance: no universal territorial recipe

Ostrom's Nobel lecture combines human field and laboratory evidence. Communication, locally appropriate rules, participation in rule changes, accountable monitoring, graduated sanctions, and inexpensive dispute resolution can support sustained cooperation. Communication sometimes helps even without externally enforced promises. Groups also fail; imposed sanctions can reduce cooperation.

Source: [2009 Nobel lecture](https://www.nobelprize.org/uploads/2018/06/ostrom_lecture.pdf), independently inspected primary text, especially printed pp. 421–425 and 429–433.

**Prosper implication:** make histories, communication, and feasible reciprocal arrangements relevant. The evidence does not select claim lifetimes, reputation-score formulas, automatic exclusion, or a software laws framework. A resource commons is also not automatically a settlement: its rules manage a specific shared opportunity or problem.

### Bottom-up societies: local rules can generate large patterns

Sugarscape combines spatial resources and survival with separately supplied rules for cultural transmission, reproduction, combat, and trade. The authors describe resource-centered tribes, migration, and a market after introducing a second resource and exchange rules.

Source: [Growing Artificial Societies](https://www.brookings.edu/books/growing-artificial-societies/), 1996 primary publisher account inspected. This is not an independent reimplementation or full-methods verification of the book.

**Prosper implication:** authored micro-rules and emergent macro-patterns are compatible. The important question is whether towns and institutions are consequences of individual actions or directly prescribed outcomes. These demonstrations do not prove learned intelligence, nor that the same rules transfer to Prosper.

## Current Prosper mechanics: what follows and what does not

Code inspected in the current working tree, which contains unrelated pending changes:

| Verified mechanic | Consequence relevant to this question |
| --- | --- |
| Market matching and commodity settlement have no distance condition: `src/world/market.ts`, `match`; remote-settlement fixture in `test/market.test.ts` | Buyer/supplier proximity has no commodity-delivery advantage. Remote trade and geographically dispersed specialization remain possible. |
| Refining requires ownership and travel to the station: `src/world/core.ts`, `requirements` and `routeFor` | Fixed capital can anchor an individual producer. Alliances do not confer station access. An owner can still process inputs and sell outputs remotely; every buyer need not own a duplicate station. |
| Station recipes scale with tier: `src/world/config.ts`, `buildingRecipe` | Avoiding duplicate investment is a potential benefit to investigate, not a proven shared-facility surplus. Refining recipes and demand may limit it. |
| Physical travel takes time and drains fullness; inventory has no weight/capacity mechanic: `src/world/config.ts`, `src/world/core.ts`, `src/shared/types.ts` | Geography matters for extraction and station work. There is no quantity-dependent carrying friction. This does not mean travel is free. |
| Claims affect social authorization and reactions to observed harvesting, not core placement/path permissions: `src/world/society.ts`, `witnessHarvest` and `claimAllows`; `src/world/core.ts`, build/route validation | A claim can imply social risk, not automatic exclusion. Walls and hard no-go policies remain separate. Building within a claim has no dedicated territorial reaction today. |
| Alliances are capped at three members and consolidate claims: `src/world/society.ts`, `formAlliance` and `consolidateClaims` | Small compacts are partly an authored constraint. Current alliance sizes cannot establish that larger institutions are economically unviable. |

The likely gap is **a benefit from useful local interdependence**, not simply stronger territorial enforcement. That is a diagnosis to test, not proof that current mechanics cannot ever produce clustering or cooperation.

## Competing territory directions

These are alternatives for discussion, not accepted designs. Each changes different incentives; none is a complete civilization system.

| Direction | Possible emergent outcome | Main failure mode / assumption |
| --- | --- | --- |
| **Claims as social demands**, keeping contested access physically possible | Bargaining, tolerated visitors, protection agreements, rivalries, and disputed boundaries | Can produce extortion and repeated conflict without improving anyone's productive opportunities. Weak explanation for towns by itself. |
| **Access around useful fixed assets**, with voluntarily granted station access as a proposed affordance | Repeated visits, local services, pooled investment, and competing centers if proximity reduces actual costs | Shared use might be uneconomic, monopolized, congested, or replaced by owner processing plus remote sales. Visits need not become residence. |
| **Participant-managed resource commons**, where groups can agree on use of limited renewable patches | Coordination over extraction, contribution/monitoring disputes, admission or exit, and multiple local institutions | A meaningful congestion problem must exist. Scripted governance can prescribe the institutions we claim to observe. Commons management need not form towns. |

Protection can complement any of these if a group can genuinely reduce losses. Conflict should not be manufactured solely to force membership. Commodity transport could create another spatial channel, but changing remote markets would be a material separate redesign, not an automatic requirement.

## Research-led next step, not an implementation plan

**Start by comparing productive opportunities before designing territorial enforcement.** The most informative candidate to explore first is shared access to existing fixed capital, because it tests a local benefit without requiring a new housing system, transport economy, or laws framework. This is a recommendation for a design comparison, not approval of station-sharing mechanics.

Use small black-box mock scenarios to clarify expectations:

1. **Self-supply versus remote specialization:** can both citizens improve consumption/survival after travel, production, input costs, and executable funded trades? Clustering is not the success criterion.
2. **Private versus shared facility:** compare building privately, purchasing the owner's outputs, commuting to a shared station, and locating work nearby. Count construction saved, travel, competing use, and access uncertainty. A mock cannot establish actual engine surplus.
3. **Institution versus unilateral claim:** add an outsider and an access dispute. Compare toleration, voluntary payment, cooperation, withdrawal, and retaliation. Keep social risk distinct from hard station permission and hard movement restrictions.
4. **Durability under change:** change demand, resource contention, owner behavior, or participant membership. Does the arrangement adapt, break, or remain useful? A stable seed alone is weak evidence.

Do not score success merely as more buildings, fewer moves, larger alliances, more violence, or citizens saying they belong to a town. Eventually measure recurring work locations, mutual gains, realized trade links, local facility use, contribution/enforcement costs, survival, and persistence through turnover. Engine fixtures or live experiments would require separate authorization; nothing was executed for this report.

## Consequence for the building subtree

`CanBuildResourceBuilding(resource, exactBuildingTier)` remains an inventory-only condition. Territory research does not change it.

The future placement action should keep three questions separate:

- **Hard feasibility:** site occupancy, reachability, known placement rules, and explicit hard policies.
- **Prospective individual value:** extraction travel, station work, alternatives to construction, possible demand, and feasible access arrangements.
- **Social expectations:** who claims or uses the area, evidence of toleration or retaliation, and confidence in those expectations.

Do not rank a claimed tile as automatically illegal, infer station permission from alliance membership, or give proximity to a global market an invented delivery benefit. An LLM choosing among candidates cannot create economic advantages absent from the world.
