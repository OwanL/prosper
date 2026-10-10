# Housing and rest — recorded proposal

Date: 2026-10-09
Status: future mechanic proposal; `CanBuildHouse` / `BuildHouse` and `CanSleep` / `Sleep` responsibilities approved on 2026-10-10. Houses and rest are not implemented; this note does not authorize runtime changes.

## Approved building pair

`CanBuildHouse(requestedTier)` is a pure available-materials check against the future house recipe, not a placement guarantee. `BuildHouse` chooses a site, travels, revalidates it and confirms one completed house of that tier. The parent decides whether to invest and arranges materials. Sleeping, restoring rest and automatically demolishing an old house are outside this pair. Recipes, footprint and access remain unsettled; no typed graph or runtime code is added by responsibility approval.

## Approved sleeping pair

`CanSleep` checks for a known permitted, reachable sleeping option under the eventual house/outdoor rules. `Sleep` chooses an option, travels if necessary, sleeps and confirms the requested rest level, or reports interruption/failure. The parent decides whether to sleep now and the recovery target. Building housing, acquiring food and choosing long-term residence remain separate. Hunger and danger still apply; outdoor sleeping, house access and recovery rates are not settled.

## Direction from the discussion

Citizens should be able to build houses at different tiers. Basic houses should be reasonably cheap. Add a rest meter: depletion makes work substantially less efficient, with **50% longer action durations** as the initial example, not a settled balance value. Sleeping should be relatively short and restore rest.

The purpose is a spatial/economic trade-off, not another maintenance bill. Citizens should compare travel home, sleeping and returning to work against continuing while tired. Housing location should matter when working valuable resource patches or relocating. Housing should have its **own subtree**, separate from resource-processing buildings.

## Suggested first version, not settled mechanics

- Rest drains while awake. At depletion, productive work slows; decide explicitly whether movement also slows.
- Sleeping is a timed physical activity, with ordinary hunger continuing. Do not add special healing or automatic house wear/repair/upkeep systems as part of this proposal. Possible attack/destruction health is a separate building rule, not wear from sleeping.
- T1 housing provides useful rest. Higher-tier houses restore rest faster, with diminishing benefits rather than making basic housing ineffective.
- Nearby citizens normally benefit from resting; a citizen finishing valuable work far from home may rationally accept fatigue. Tune the sleep/awake/travel ratio before fixing meter values.
- Do **not** require destruction of an old house to relocate. Compare keeping it, building another, or demolishing it for salvage. A house is not a mobile inventory item; moving means a new construction plan unless a separate mechanic is explicitly chosen.

## Decisions still needed

1. Rest-drain rate, recovery rate, sleep duration and fatigue threshold/penalty; how fatigue affects an already-running activity.
2. Which activities drain rest or slow under fatigue, especially travel and combat. Immediate market/message commands should not accidentally acquire physical durations.
3. Whether citizens can sleep without a house, and how house ownership/guest use works. No rental/access market is assumed.
4. House recipe, tier benefits, health, footprint, walkability, estate/ownership transfer and salvage rules. Building trading is excluded from the intended world by the later coverage review. Existing station rules do not automatically settle the remaining housing rules.
5. Sleeping start/stop targets and interruptions, including starvation/danger while asleep.
6. Relocation horizon: repeated commute savings versus construction, lost future use and optional salvage. No compulsory one-house-per-citizen rule is assumed.

## Mock scenarios before balancing

- Near home, substantial work remaining: a short sleep saves more time than it costs.
- Far from home, one valuable task nearly finished: continuing tired can be better.
- Repeated work at a new resource patch: a new house eventually repays construction and saved commutes.
- Temporary visit: keep the old house and avoid rebuilding merely for one trip.
- Higher-tier house far away versus adequate T1 house nearby: quality does not automatically outweigh travel.
- Hunger or an approaching threat: sleeping is not a hidden survival exemption.

Sketch the housing-specific subtree after the [resource-building brainstorm](resource-building-brainstorm.md); reuse shared acquisition/travel concepts without merging their responsibilities. Follow the agreed diagram → black-box mocks → drill into failing subtrees approach, then verify actual mechanics only after implementation is authorized.
