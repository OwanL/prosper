// Resume an explicitly selected local capture. No import endpoint or automatic
// replacement of a running world's state is exposed to the browser.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { economyForNodes } from '../lib/economy.mjs';
import { createRuntimePlanner } from '../lib/runtime-planner.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { createAudit } from '../lib/audit.mjs';
import { recordAudit } from '../lib/audit.mjs';

if (!process.argv[2]) throw new Error('Usage: node scripts/resume-run.mjs <captured-state.json>');
const capture = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
if (capture.running !== false || capture.planner?.activeCitizenId || capture.planner?.activeCitizenIds?.length
  || !Number.isSafeInteger(capture.world?.tick) || !Array.isArray(capture.world?.citizens) || capture.world.citizens.some(c => c.planning)) throw new Error('Expected a paused capture with no request in flight.');
const audit = createAudit({ filePath: resolve('.prosper/audit.jsonl') });
const planner = createRuntimePlanner({
  budget: createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), audit,
});
const app = createApp({ planner });
// Preserve the new run's non-enumerable audit hook, but restore physical world,
// knowledge, pending orders and personal histories from the explicit checkpoint.
// Economy is derived from current rules, not historical checkpoint metadata.
const economy = economyForNodes(capture.world.nodes);
Object.assign(app.simulation.state.world, structuredClone(capture.world), { economy });
// A fresh default has newer geometry. Absence in the capture is meaningful:
// do not leave a new center/rings attached to an older world after Object.assign.
for (const field of ['center', 'rings']) if (!Object.hasOwn(capture.world, field)) delete app.simulation.state.world[field];
for (const citizen of app.simulation.state.world.citizens) citizen.planning = false;
app.simulation.state.speed = capture.speed;
recordAudit(app.simulation.state.world.audit, { type: 'run_restored', tick: capture.world.tick, fromCapture: resolve(process.argv[2]) });
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
app.server.once('error', error => { app.simulation.close(); app.server.close(); console.error(error.code); process.exitCode = 1; });
app.server.listen(port, '127.0.0.1', () => {
  console.log(`Prosper restored at tick ${capture.world.tick}, paused: http://127.0.0.1:${port}`);
  void app.simulation.check();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.simulation.close(); app.server.close(); });
