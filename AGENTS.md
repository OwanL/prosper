# Prosper spike 2

Read `docs/spike-2/world.md`, `citizen.md`, and `technical-plan.md` for this spike's authority. Do not import spike 1 mechanics. Make bounded implementation decisions, test them, and record notable learnings in your handoff for the orchestrator.

- Node 24.16.0, npm 11.13.0, TypeScript, React/Vite, Vitest, Playwright. Use `npm run typecheck`, targeted `npm test -- test/<file>.test.ts`, and `npm run build`.
- Shared JSON contracts: `src/shared/types.ts`; shared primitives: `src/shared/utils.ts`. Coordinate changes to these through the orchestrator.
- Workers own only their assigned files. Do not edit package/config/shared contracts, install packages, commit, switch branches, or run live paid model calls unless explicitly assigned.
- Never touch existing `.prosper/` durable data or its ledger. Spike 2 uses `.prosper-v2/`. Tests use OS temporary directories. No services left running after tests.
- Default reasoning is explicitly labelled scripted. Live is opt-in, DeepSeek V4.1 Flash through local Ollama with high reasoning. Mock providers for verification; do not imply scripted behavior proves emergence.
- Apply commands synchronously through the core dispatcher. Abort plus generation checks protect interrupted turns. No promises/timers in world state.
- Native Windows paths for Node, Git Bash paths for shell. No worktrees. No broad traversal of dependencies, runtime data, build output or Git internals.

Integration APIs:
- `src/world/core.ts`: `createWorld({seed?, scenario?, runId?}?)`, `dispatch(world,citizenId,command):CommandResult`, `tickWorld(world,count=1):void`.
- `src/world/observation.ts`: `observe(world,citizenId):CitizenObservation`, `updateKnowledge(world):void`.
- `src/world/market.ts`: `marketCommand(world,citizenId,command):CommandResult`, `cancelCitizenOrders(world,citizenId):void`, `cancelBuildingOrders(world,buildingId):void`.
- `src/world/life.ts`: combat/pursuit, death settlement, loot and joint reproduction; integrated by core action start/advance/cancellation. Do not bypass joint-action or death settlement boundaries.
- Browser API: GET `/api/state` -> `AppSnapshot`; POST `/api/control` -> `AppSnapshot` with `Control`; POST `/api/command` `{citizenId,command}` -> `CommandResult`; GET `/api/citizens/:id/observation` -> `CitizenObservation`. More endpoints may be added by runtime owner.
- Scene world is authoritative; health/fullness max 100. Coordinates bottom-left (SVG flips Y). Inventory `food:1`, equipment `axe:1`, and market building keys `building:<id>`.
- Runtime updates knowledge after committed ticks/commands and gates citizen tools with `validateKnownCommand`. Browser commands are explicit spectator debugging commands. All item inventories include carried equipment; equipped entries are references to ONE carried unit, not extra inventory.
