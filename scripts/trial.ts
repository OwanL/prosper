import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Inventory } from '../src/shared/types.ts';
import { CitizenRunner } from '../src/citizen/runner.ts';
import { RequestLedger } from '../src/citizen/budget.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';

export interface TrialOptions {
  scenario?: string;
  seed?: number;
  ticks?: number;
}
const MAX_TICKS = 10000;

/** Fixed SCRIPTED planner, no server clock or live fallback. Mechanical evidence only. */
export async function runTrial(options: TrialOptions = {}) {
  const scenario = options.scenario ?? 'village';
  const seed = options.seed ?? 1;
  const ticks = options.ticks ?? 120;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Seed must be an unsigned 32-bit integer.');
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > MAX_TICKS)
    throw new Error(`Ticks must be an integer from 0 to ${MAX_TICKS}.`);
  const world = createWorld({ scenario, seed });
  const directory = mkdtempSync(join(tmpdir(), 'prosper-trial-'));
  let runner: CitizenRunner | undefined;
  try {
    // Defense in depth: even an accidental live branch cannot reserve or send a request.
    const ledger = new RequestLedger({ directory, maxRequests: 0, maxTokens: 0 });
    if (ledger.status().error) throw new Error(ledger.status().error);
    let toolErrors = 0;
    let plannerErrors = 0;
    let acceptedCommands = 0;
    const errorsByCode: Record<string, number> = {};
    runner = new CitizenRunner(
      {
        world: () => world,
        observe: (id) => observe(world, id),
        command: (id, command) => {
          const known = validateKnownCommand(world, id, command);
          const result = known.ok ? dispatch(world, id, command) : known;
          if (result.ok) acceptedCommands++;
          else {
            toolErrors++;
            errorsByCode[result.code] = (errorsByCode[result.code] ?? 0) + 1;
          }
          updateKnowledge(world);
          return result;
        },
        diagnostic: (record) => {
          if (record.status === 'error') plannerErrors++;
        },
      },
      {
        mode: 'scripted',
        ledger,
        transport: async () => {
          throw new Error('Network forbidden in SCRIPTED trials.');
        },
      },
    );
    const completedActions: Record<string, number> = {};
    let actionErrors = 0;
    let eventCursor = 0;
    const collectEvents = () => {
      for (const entry of world.events) {
        if (Number(entry.id.split('-').at(-1)) <= eventCursor) continue;
        if (entry.kind === 'completion') {
          const kind = entry.text.match(/^Completed (\w+)\.$/)?.[1] ?? 'other';
          completedActions[kind] = (completedActions[kind] ?? 0) + 1;
        }
        if (entry.kind === 'error') actionErrors++;
      }
      eventCursor = world.nextId - 1;
    };
    const review = async () => {
      // Drain each scheduled batch before advancing time, including populations
      // larger than maxConcurrent. Await actual turns, not a guessed microtask count.
      while (true) {
        runner!.tick();
        const thinking = runner!.status().thinking;
        if (!thinking.length) break;
        await Promise.all(thinking.map((id) => runner!.startTurn(id)));
      }
    };
    updateKnowledge(world);
    await review();
    collectEvents();
    for (let i = 0; i < ticks; i++) {
      tickWorld(world);
      updateKnowledge(world);
      collectEvents();
      await review();
      collectEvents();
    }
    const holdings: Inventory = {};
    const add = (inventory: Inventory) => {
      for (const [key, quantity] of Object.entries(inventory))
        holdings[key] = (holdings[key] ?? 0) + quantity;
    };
    let goldTotal = 0;
    const citizens = Object.values(world.citizens);
    for (const citizen of citizens) {
      goldTotal += citizen.gold;
      add(citizen.inventory);
      if (citizen.action) add(citizen.action.reserved);
    }
    for (const order of Object.values(world.orders)) {
      goldTotal += order.escrowGold;
      add(order.escrowItems);
    }
    for (const loot of Object.values(world.loot)) {
      goldTotal += loot.gold;
      add(loot.inventory);
    }
    const sorted = (values: Record<string, number>) =>
      Object.fromEntries(
        Object.entries(values)
          .filter(([, n]) => n !== 0)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    const stations: Record<string, number> = {};
    for (const building of Object.values(world.buildings))
      if (building.kind !== 'wall') {
        const key = `${building.kind}:${building.tier}`;
        stations[key] = (stations[key] ?? 0) + 1;
      }
    const budget = ledger.status();
    if (budget.error || budget.requests !== 0)
      throw new Error(budget.error ?? 'Unexpected provider request in SCRIPTED trial.');
    return {
      mode: 'SCRIPTED' as const,
      evidence: 'mechanical outcomes only; not emergence evidence',
      scenario,
      seed,
      simulatedTicks: world.tick,
      alive: citizens.filter((c) => c.alive).length,
      dead: citizens.filter((c) => !c.alive).length,
      completedActions: sorted(completedActions),
      acceptedCommands,
      toolErrors,
      errorsByCode: sorted(errorsByCode),
      plannerErrors,
      // World error events include rejected commands as well as failed physical work.
      worldErrorEvents: actionErrors,
      resources: sorted(
        Object.fromEntries(
          Object.entries(holdings).filter(([key]) => /^(food|wood|fibre):/.test(key)),
        ),
      ),
      tools: sorted(
        Object.fromEntries(
          Object.entries(holdings).filter(([key]) => /^(axe|scythe|knife|sword):/.test(key)),
        ),
      ),
      stations: sorted(stations),
      gold: { initial: world.initialGold, total: goldTotal, delta: goldTotal - world.initialGold },
      providerRequests: budget.requests,
    };
  } finally {
    runner?.interrupt('trial finished');
    rmSync(directory, { recursive: true, force: true });
  }
}

export function parseTrialArgs(args: string[]): TrialOptions & { output?: string } {
  const result: TrialOptions & { output?: string } = {};
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (
      !['--scenario', '--seed', '--ticks', '--output'].includes(flag) ||
      seen.has(flag) ||
      !value ||
      value.startsWith('--')
    )
      throw new Error(
        'Usage: trial [--scenario village|competition|progression] [--seed N] [--ticks N] [--output PATH]',
      );
    seen.add(flag);
    if (flag === '--scenario') result.scenario = value;
    else if (flag === '--output') result.output = value;
    else {
      if (!/^\d+$/.test(value)) throw new Error(`${flag} requires a nonnegative integer.`);
      if (flag === '--seed') result.seed = Number(value);
      else result.ticks = Number(value);
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { output, ...options } = parseTrialArgs(process.argv.slice(2));
    const summary = `${JSON.stringify(await runTrial(options))}\n`;
    // Only an explicitly requested native path retains a summary; no default artifact.
    if (output) writeFileSync(output, summary, { flag: 'wx' });
    process.stdout.write(summary);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
