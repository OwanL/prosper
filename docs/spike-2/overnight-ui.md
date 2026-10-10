# Overnight spectator interface, October 7–8, 2026

## Intent

The simulation should be understandable while watching the map: who wants what, who is fighting, which ground is contested, who cooperates, and how trade supports livelihoods. Presentation must remain a read-only observer unless an existing explicit debug control is used. Citizen knowledge must retain its separate information boundary.

## Research and design decisions

- [Factorio: alert arrows](https://factorio.com/blog/post/fff-363) ties notifications to on-map locations and directions. Prosper now links consequential events to recorded coordinates, making conflict legible without searching raw logs. Remote market trades have no physical event marker: participants receive explicitly labelled remote-trade badges at their current locations.
- [Factorio: map improvements](https://factorio.com/blog/post/fff-180) demonstrates the usefulness of optional spatial overlays for understanding systems. Prosper exposes resource and territory layers independently, with claims described as announced demands that citizens can cross. Work rectangles remain separately labelled private execution permissions, never ownership.
- [Game Developer, November 2002: event-driven cinematic cameras](https://media.gdcvault.com/GD_Mag_Archives/GDM_November_2002.pdf) separates event selection, shot editing and camera positioning. Prosper uses consequential committed events as shot candidates, ranks combat/death above ordinary economic outcomes, and holds every shot for at least eight seconds. The director never drives simulation behavior. Manual citizen selection, event inspection, Fit or map dragging relinquishes director control.
- [Factorio: display panels](https://direct.factorio.com/blog/post/fff-419) shows short context at a glance and longer detail on hover. Prosper uses compact event cards, map speech previews and a current motivation/action card; exact receipts remain in the dashboard.

## Implemented

- One-click Watch world expands the map, event rail and compact roster. It does not play the simulation or enable paid calls.
- World pulse reports actual living population, current work, hunger under 20 fullness, active attack actions, unexpired claims and living alliances.
- The director frames committed event positions with a minimum eight-second shot duration. Explicit event clicks show tick/coordinates. Recent markers are historical, not reconstructed movement.
- Current combat/pursuit and joint reproduction use authoritative physical actions. Remote trades show a distinct exchange badge and no invented journey or meeting.
- Public claims have faint coloured bounds, owner/access labels and tooltip semantics. Alliances use distinct dotted sprite rings. Private work areas keep their existing independent semantics.
- Selected motivation, stance/livelihood, local execution and policy provenance remain visible in Watch. Model review does not replace the physical action display.
- The local mode is labelled Local AI / Local rules, no live inference. Local rules can produce emergent outcomes; the interface does not claim emergence requires an LLM. Legacy deterministic review fixtures are distinguished in the mode tooltip and session diagnostics.
- Resource overlays distinguish type, depletion and dated sightings. The market summarizes best bid/ask and aggregate supply/demand above the actual order book.
- Harness summary reports model/mode, output/concurrency/request limits and calls per 1,000 citizen ticks. Measurements are explicitly runner-session statistics; cumulative reserved/charged budget remains separate and authoritative.
- At more than 32 citizens, nameplates require zoom or selection. Citizen sprites and keyboard selection remain available. Reduced motion suppresses presentation animation.

## Information boundaries

`projectObservation` receives only observation entities and public geometry. It does not project global claims, alliances, current target actions, fullness, model thinking or spectator event positions into citizen knowledge. Global WorldPulse and StoryRail disappear in knowledge view. Existing observation-projected communication remains the sole source of speech there. Own citizen policy stays inspectable.

Claims are demands, not blocking collision geometry. A coloured claim cannot establish successful enforcement; an alliance ring cannot establish effective cooperation. Scripted policy is labelled scripted, and a model review in flight is not a new model decision. Remote trade badges use current confirmed positions and say so explicitly.

## Validation and evidence

Initial targeted UI projection/directive/story tests: 14 passed. Existing dashboard browser regression: 15 passed, including 1440×900, 1366×768, 1280×720, 390px/320px mobile, internally scrolling panels, retained disconnect/reload state, budgets, tooltips, and knowledge privacy.

Browser acceptance uses `test/browser/ui.config.ts`, an isolated frontend-only Vite on port 5187, and intercepted API routes. It never starts a backend, reads a durable run, invokes a provider or reuses existing user services on 5173/4310/4312. Screenshot directories include `mocked-evidence` in their name. These screenshots validate presentation, not emergent behavior; combat/trade/claim/alliance fixture outcomes are produced through actual mechanics, but starting placement and crowd population are deliberate test fixtures.

Dedicated spectator browser checks cover Watch read-only behavior, recorded-event coordinates, remote trade, minimum director hold/manual override, knowledge overlay suppression, 100 sprites/nameplate level of detail, reduced motion, keyboard selection, mobile containment and session harness labels. Real offline-run visual validation will be recorded after the integrated world policy run is available.

Screenshot inspection led to additional changes: focused Watch uses the screen aspect ratio for a cinematic crop, with an overview inset and cameras clamped at map edges. Repeated consequences between the same actors collapse into one counted event card. An 86×86 world now uses three exact terrain rectangles and a tiled SVG pattern instead of 7,396 separate terrain cells; exhaustive geometry checks match the authoritative region function for square and rectangular maps. Citizen knowledge renders only its supplied known tiles.

The first genuine 100-citizen acceptance uncovered a transport failure: the 1,200-tick checkpoint for seed 1 was 120,379,592 bytes. Feeding that whole checkpoint to the polling spectator endpoint closed Chromium. Investigation by the world owner found an additional root cause: pathfinding copied whole Citizen objects into points, duplicating notebooks inside paths. Fixing points and bounding notebooks reduced durable state; the server owner also added a production spectator projection that omits notebooks before cloning and preserves the full selected observation endpoint. The failed artifact documents a fixed implementation defect, not an unavoidable cost of 100 citizens.

Final integrated acceptance used the real exported `projectSpectatorWorld` from `src/server/snapshot.ts` to serve unchanged genuine offline worlds through intercepted GET `/api/state`. No backend, provider or durable run was started. The full UI browser suite passed **21 tests**: existing dashboard 15, dedicated spectator 4, genuine offline snapshot 2. Targeted UI/projection/motion tests passed **19 tests** and production typecheck/build passed. A subsequent clean six-test run recaptured genuine snapshots after the final label spacing changes.

Measured genuine worlds, all scripted local policies and zero model calls:

| Source | Tick / living | Projected snapshot | Focused SVG nodes | Browser used heap | Two animation frames |
| --- | --- | --- | --- | --- | --- |
| `world-ai-6-6-conflict-snapshot.json` | 2,619 / 9 | 143,869 bytes | 809 | ~19–30 MB | ~4.5–8.6 ms |
| `world-ai-100-4-snapshot.json` | 3,000 / 100 | 1,865,018 bytes | 3,518 | ~47–161 MB | ~1.8–7.9 ms |

Heap/frame observations vary with garbage collection and are not a throughput benchmark. Static resource/building/loot sprites are culled outside the camera frame with a margin; the full world and roster stay authoritative. The earlier uncropped 100-citizen scene had 18,894 SVG nodes. The 1.87MB projected payload is much safer than the failed artifact but remains material at 700ms polling; differential snapshots or static-map caching may be valuable later.

Screenshots were inspected for the genuine conflict scene (Dara attacks Bram, Bram defends, existing threat and trade context, seven claims, two alliances) and genuine 100-citizen world (100 alive, 12 alliances, local livelihoods, current resource stock). Evidence directories are printed by the optional real-scene browser suite; the final capture is `C:\Users\OwanLazic\AppData\Local\Temp\prosper-real-offline-ui-evidence-vKtLKA\`. Both overview and focused shots are retained. Fixture-only mobile/crowd screenshots remain explicitly labelled mocked evidence.

## Follow-up observations

- The integrated observation now supplies explicitly public claims and alliances to citizen reasoning. The knowledge-view scene still suppresses global overlays and story positions; showing those announcements there would require a deliberate projection change, never a read from spectator state.
- Existing global settlement gives remote trades no physical location. The camera intentionally selects spatially recorded conflict, birth, alliance and territory events; trades remain visible in the story rail and economy panels.
- Eight-second camera holds are wall time. Event expiry is simulation time. At extreme simulation speed the world can move far beyond a held historical shot; the caption retains its recorded tick and the director returns to overview after an expired shot when no new spatial consequence is available.
