# Retained-person policy interface probe — 2026-10-08

## Hypothesis and bounds

A person retained in relationships/evidence and actually supplied in strategic context can be rejected by `validateAutonomyPolicy` when absent from its known-person sources.

One offline synthetic paired headless experiment: seed **7**, **two citizens**, **zero model calls**, **zero advanced ticks** (ceiling 120), no services or persistence. Each script invocation had a 30-second tool timeout. Subject `citizen-165`; actor `citizen-166`; map 37×37. Relationships and attack evidence were deliberately injected through exported seams, **not produced by simulated combat**. The comparison changes only notebook/current visibility availability on cloned starting worlds. The patch in every branch is `{rivals:[actor.id]}`.

## Results

All branches asserted the actor ID in both relationships and social evidence of the **actual `strategicContext(observe(...))` user message after byte-budget pruning**, before validating/applying the patch.

| Branch | Actor in supplied relationships/evidence | Actor in supplied contacts | Validation/application | Rivals after |
| --- | --- | --- | --- | --- |
| Absent from all validator known-person sources | Yes / yes | No | Both rejected: `unknown-policy-citizen` | `[]`, policy unchanged |
| Same world + restored notebook sighting | Yes / yes | No* | Both accepted | `["citizen-166"]` |
| Same world + current actor visibility | Yes / yes | Yes, `current:true` | Both accepted | `["citizen-166"]` |

Successful script elapsed **157.3514 ms**, including module imports (not shell/process startup). Node **v24.16.0**, existing repository tsx **4.23.15**. Assertions passed. No provider/runtime-server module was invoked, no ledger/data directory accessed.

*The restored notebook tile remains currently visible and empty in world truth. `observe` overlays that empty tile, whereas validation reads the raw notebook. This is a deliberately synthetic notebook control, not evidence that this stale notebook normally persists after committed knowledge updates.

An initial invocation completed the branch applications but failed an extra assertion incorrectly expecting a notebook contact in the projected context. Source inspection explained the fresh-visible-tile overlay; that assertion was corrected to expect zero contacts, and the **same experiment** reran successfully. There were two script invocations, not two different hypotheses or campaigns; both advanced zero ticks and made zero calls. The first failed invocation did not retain elapsed timing. No other experiment was run.

## Exact reproduction

Save the following as an OS-temp `.mjs`, outside the repository. From the checkout, run (substitute the actual temp path):

```bash
node C:/dev/repos/prosper/node_modules/tsx/dist/cli.mjs C:/Users/OWANLA~1/AppData/Local/Temp/prosper-interface-probe-20261008.mjs
```

Apply an external **30-second timeout**. The code uses native absolute file URLs for repository imports. It writes no artifacts; stdout is the result. Delete the temp script afterward. Change `root` only if the checkout moved.

```js
// One offline paired interface experiment: seed 7, two citizens, zero ticks/calls.
// Stop on any assertion failure; external execution timeout is 30 seconds.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const start = performance.now();
const root = 'C:/dev/repos/prosper';
const load = (relative) => import(pathToFileURL(`${root}/${relative}`).href);
const { createWorld } = await load('src/world/core.ts');
const { observe, updateKnowledge } = await load('src/world/observation.ts');
const { relationship, evidence, visibleCitizens } = await load('src/world/society.ts');
const { validateAutonomyPolicy, setAutonomyPolicy } = await load('src/world/autonomy.ts');
const { strategicContext } = await load('src/citizen/strategic-context.ts');
const world = createWorld({ seed: 7, population: 2, autonomy: true,
  runId: 'offline-interface-probe-20261008' });
const [subject, actor] = Object.values(world.citizens);
assert.equal(Object.keys(world.citizens).length, 2);
assert.equal(world.tick, 0);
// Synthetic fixture, not simulated harm. Shared exported seams retain identity.
subject.x = 0; subject.y = 0;
actor.x = 1; actor.y = 0;
subject.knowledge = {};
assert.deepEqual(world.messages, []);
assert.equal(Object.keys(world.orders).length, 0);
assert.equal(Object.keys(world.claims ?? {}).length, 0);
assert.equal(Object.keys(world.alliances ?? {}).length, 0);
Object.assign(relationship(subject, actor.id), { grievance: 60, harm: 10, lastTick: 0 });
evidence(subject, { tick: 0, kind: 'attack', otherId: actor.id,
  text: `Synthetic retained evidence: ${actor.id} caused harm.` });
updateKnowledge(world);
const oldTile = structuredClone(subject.knowledge['1,0']);
assert(oldTile.citizens.some((c) => c.id === actor.id));
actor.x = world.width - 1; actor.y = world.height - 1;
// An empty currently visible old tile overwrites its former occupant.
updateKnowledge(world);
assert(!Object.values(subject.knowledge).some((t) => t.citizens.some((c) => c.id === actor.id)));
assert(!visibleCitizens(world, subject).some((c) => c.id === actor.id));
const patch = { rivals: [actor.id] };
function runBranch(label, branch) {
  const citizen = branch.citizens[subject.id];
  // Parse the actual byte-budgeted context, not only strategicProjection.
  const context = strategicContext(observe(branch, citizen.id));
  const supplied = JSON.parse(context.find((m) => m.role === 'user').content);
  assert(supplied.relationships.some(([id]) => id === actor.id));
  assert(supplied.period.socialEvidence.some((e) => e.otherId === actor.id));
  const contacts = supplied.currentWorld.contacts.filter((c) => c.id === actor.id);
  const before = structuredClone(citizen.autonomy.policy);
  const validation = validateAutonomyPolicy(branch, citizen, patch);
  const application = setAutonomyPolicy(branch, citizen, patch);
  assert.equal(validation.ok, application.ok);
  if (application.ok) assert.deepEqual(citizen.autonomy.policy.rivals, [actor.id]);
  else { assert.equal(application.code, 'unknown-policy-citizen');
    assert.deepEqual(citizen.autonomy.policy, before); }
  return { label, relationshipPresent: true, evidencePresent: true,
    contacts, validation, application, rivalsAfter: citizen.autonomy.policy.rivals };
}
const notebookControl = structuredClone(world);
notebookControl.citizens[subject.id].knowledge['1,0'] = oldTile;
const visibleControl = structuredClone(world);
visibleControl.citizens[actor.id].x = 1;
visibleControl.citizens[actor.id].y = 0;
const results = [runBranch('absent-from-known-sources', structuredClone(world)),
  runBranch('retained-notebook-control', notebookControl),
  runBranch('current-visibility-control', visibleControl)];
assert.equal(results[0].validation.ok, false);
assert.equal(results[0].contacts.length, 0);
assert.equal(results[1].validation.ok, true);
// observe overlays the still-visible empty tile; validator reads raw notebook.
assert.equal(results[1].contacts.length, 0);
assert.equal(results[2].validation.ok, true);
assert.equal(results[2].contacts[0].current, true);
const elapsedMs = performance.now() - start;
assert(elapsedMs < 30000);
console.log(JSON.stringify({ seed: 7, citizens: 2, subject: subject.id, actor: actor.id,
  mapSize: [world.width, world.height], ticksAdvanced: 0, modelCalls: 0,
  elapsedMs, results }, null, 2));
```

## Source paths and interpretation limits

- `src/world/core.ts`: `createWorld`, seeded in-memory creation.
- `src/world/society.ts`: `relationship`, `evidence`, `visibleCitizens`.
- `src/world/observation.ts`: `updateKnowledge` overwrites visible empty tiles; `observe` projects fresh sightings without committing them.
- `src/citizen/strategic-context.ts`: `strategicContext`, retained relationships/social evidence and byte-bound context.
- `src/world/autonomy.ts`: `validateAutonomyPolicy` builds known IDs from notebook, visibility, messages, orders, claims and alliances—not retained relationships/evidence; `setAutonomyPolicy` revalidates before mutation.
- `src/shared/autonomy-types.ts`: relationship/evidence/policy contracts.

This confirms an **existence-level interface mismatch** in current source: an explicitly supplied retained identity can be unusable in a policy patch, with the same patch accepted once a validator source includes it. It does not establish frequency, historical rejection causes, model competence, economic usefulness or downstream behavior. No natural forgetting trajectory, concurrency, inference delay or runtime dispatcher was exercised; policy application used the exported `setAutonomyPolicy` seam. The notebook control has the projection caveat above. No production fix or architectural recommendation follows from this probe alone.

Only this report is retained in the repository; task temp script cleaned up after preserving the reproduction here. No production or main research-document edits, durable-data changes, package installation, services or model calls.
