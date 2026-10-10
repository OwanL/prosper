# Prosper spike 2

Read `README.md` and `docs/spike-2/OVERNIGHT.md` for the current layered design. Historical spike documents remain useful context; the user's overnight redesign explicitly supersedes their restrictions on automatic survival and reusing spike 1 ideas. Make reviewable implementation decisions, test them, and record notable learnings.

- Node 24.16.0, npm 11.13.0, TypeScript, React/Vite, Vitest, Playwright. Use `npm run typecheck`, targeted `npm test -- test/<file>.test.ts`, and `npm run build`.
- Shared JSON contracts: `src/shared/types.ts`; shared primitives: `src/shared/utils.ts`. Coordinate changes to these through the orchestrator.
- Workers own only their assigned files. Do not edit package/config/shared contracts, install packages, commit, switch branches, or run live paid model calls unless explicitly assigned.
- Never touch existing `.prosper/` durable data or its ledger. Spike 2 uses `.prosper-v2/`. Tests use OS temporary directories. No services left running after tests.
- Fresh worlds run continuous Local AI (serialized mode `scripted`) with no model calls. Live is opt-in, defaults to local Qwen 3.5 9B with thinking disabled, and uses one structured policy reply. Mock providers for ordinary verification. Rule-based aggregate emergence and model intelligence are distinct claims; report retained seeded/model evidence accurately.
- Apply commands synchronously through the core dispatcher. Abort plus generation checks protect interrupted turns. No promises/timers in world state.
- Native Windows paths for Node, Git Bash paths for shell. No worktrees. No broad traversal of dependencies, runtime data, build output or Git internals.

Integration APIs:

- `src/world/core.ts`: `createWorld({seed?, scenario?, runId?, population?, autonomy?, maintenance?}?)`, `dispatch(world,citizenId,command):CommandResult`, `tickWorld(world,count=1):void`. Core autonomy is opt-in for mechanics fixtures; fresh runtime worlds explicitly enable it.
- `src/world/observation.ts`: `observe(world,citizenId):CitizenObservation`, `updateKnowledge(world):void`.
- `src/world/market.ts`: `marketCommand(world,citizenId,command):CommandResult`, `cancelCitizenOrders(world,citizenId):void`, `cancelBuildingOrders(world,buildingId):void`.
- `src/world/life.ts`: combat/pursuit, death settlement, loot and joint reproduction; integrated by core action start/advance/cancellation. Do not bypass joint-action or death settlement boundaries.
- Browser API: GET `/api/state` -> `AppSnapshot`; POST `/api/control` -> `AppSnapshot` with `Control`; POST `/api/command` `{citizenId,command}` -> `CommandResult`; GET `/api/citizens/:id/observation` -> `CitizenObservation`. More endpoints may be added by runtime owner.
- Scene world is authoritative; health/fullness max 100. Coordinates bottom-left (SVG flips Y). Inventory items `food:1` and `axe:1`, and market building keys `building:<id>`.
- Runtime updates knowledge after committed ticks/commands and gates citizen tools with `validateKnownCommand`. Browser commands are explicit spectator debugging commands. Tools are ordinary inventory items; citizens automatically use the highest-tier available matching tool. No equip/unequip commands or separate equipped state.
