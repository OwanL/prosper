import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/server/runtime.ts';
import { loadCheckpoint, saveCheckpoint } from '../src/server/checkpoint.ts';
import { createWorld } from '../src/world/core.ts';

const roots: string[] = [];
const runtimes: Runtime[] = [];
function setup(options: ConstructorParameters<typeof Runtime>[0] = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-reset-'));
  roots.push(directory);
  const runtime = new Runtime({ ...options, directory, autoClock: false });
  runtimes.push(runtime);
  return { runtime, directory };
}
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('explicit world reset', () => {
  it('archives the old run and durably creates a new paused seed without resetting spending', async () => {
    const { runtime, directory } = setup({
      world: createWorld({ scenario: 'competition', seed: 11 }),
      runner: {
        transport: async () => ({ content: 'done', usage: { inputTokens: 3, outputTokens: 2 } }),
      },
    });
    const id = Object.keys(runtime.world.citizens)[0];
    runtime.control({ type: 'mode', mode: 'live' });
    await runtime.runner.startTurn(id);
    runtime.command(id, { type: 'remember', text: 'old-world memory' });
    runtime.command(id, { type: 'message', text: 'old-world message' });
    runtime.world.tick = 7;
    runtime.updateBudget({ maxRequests: 30, maxTokens: 200_000 });
    runtime.control({ type: 'play' });
    runtime.observation(Object.keys(runtime.world.citizens)[0]);
    const beforeFullWorld = structuredClone(runtime.world);
    const before = runtime.snapshot();
    const ledger = readFileSync(join(directory, 'request-ledger.jsonl'), 'utf8');
    const reset = runtime.control({ type: 'reset' });
    // Fresh reset worlds are composed Local AI, so an explicit legacy live session returns to scripted.
    expect(reset.status).toMatchObject({ running: false, mode: 'scripted', state: 'ready' });
    expect(reset.world.runId).not.toBe(before.world.runId);
    expect(reset.world.seed).not.toBe(before.world.seed);
    expect(reset.world.tick).toBe(0);
    expect(Object.keys(reset.world.citizens)).toHaveLength(9);
    expect(reset.world.messages).toEqual([]);
    expect(reset.world.orders).toEqual({});
    expect(Object.values(reset.world.citizens).every((c) => c.memories.length === 0)).toBe(true);
    expect(reset.turns).toEqual([]);
    expect(reset.budget).toMatchObject({
      requests: 1,
      pending: 0,
      tokens: 5,
      limit: 30,
      maxTokens: 200_000,
    });
    expect(readFileSync(join(directory, 'request-ledger.jsonl'), 'utf8')).toBe(ledger);
    const archives = readdirSync(join(directory, 'checkpoints'));
    expect(archives).toHaveLength(1);
    const archived = loadCheckpoint(join(directory, 'checkpoints', archives[0]));
    expect(archived.world).toEqual(beforeFullWorld);
    expect(archived.runtime.running).toBe(false);
    const active = loadCheckpoint(runtime.checkpointPath);
    expect(active.world.runId).toBe(reset.world.runId);
    expect(active.runtime.running).toBe(false);
    runtime.close();
    const restored = new Runtime({ directory, restore: true, autoClock: false });
    runtimes.push(restored);
    expect(restored.snapshot().world).toEqual(reset.world);
    expect(Object.keys(restored.control({ type: 'reset' }).world.citizens)).toHaveLength(9);
  });

  it('archives physical work and pending charges, and rejects late commands after reset', async () => {
    let finish!: (value: any) => void;
    const response = new Promise<any>((resolve) => {
      finish = resolve;
    });
    const { runtime, directory } = setup({ legacy: true, runner: { mode: 'live', transport: () => response } });
    const citizen = Object.values(runtime.world.citizens)[0];
    const deposit = Object.values(runtime.world.deposits).find(
      (d) => d.x === citizen.x && d.y === citizen.y,
    )!;
    runtime.command(citizen.id, { type: 'harvest', depositId: deposit.id });
    const oldAction = structuredClone(citizen.action);
    const oldTurn = runtime.runner.startTurn(citizen.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.snapshot().budget.pending).toBe(1);
    const after = runtime.control({ type: 'reset' });
    await oldTurn;
    expect(after.budget.pending).toBe(1);
    // Procedural deposit allocation can change founder IDs under the new seed.
    expect(Object.values(after.world.citizens).every((citizen) => citizen.action === null)).toBe(
      true,
    );
    const archive = readdirSync(join(directory, 'checkpoints'))[0];
    expect(
      loadCheckpoint(join(directory, 'checkpoints', archive)).world.citizens[citizen.id].action,
    ).toEqual(oldAction);
    finish({
      usage: { inputTokens: 3, outputTokens: 2 },
      toolCalls: [
        {
          id: 'late',
          name: 'command',
          arguments: JSON.stringify({ type: 'remember', text: 'must not enter the reset world' }),
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      Object.values(runtime.world.citizens).every((citizen) => citizen.memories.length === 0),
    ).toBe(true);
    expect(runtime.snapshot().budget).toMatchObject({ requests: 1, pending: 0, tokens: 5 });
  });

  it('retains the original world paused when saving fails', () => {
    for (const failOn of [1, 2]) {
      let writes = 0;
      const { runtime } = setup({
        checkpointWriter: (path, checkpoint) => {
          if (++writes === failOn) throw new Error('simulated disk failure');
          saveCheckpoint(path, checkpoint);
        },
      });
      const before = runtime.snapshot().world;
      runtime.control({ type: 'play' });
      expect(() => runtime.control({ type: 'reset' })).toThrow(/disk failure/);
      expect(runtime.snapshot().world).toEqual(before);
      expect(runtime.snapshot().status.running).toBe(false);
    }
  });

  it('infers older worlds without scenario metadata from conserved initial gold', () => {
    const world = createWorld({ scenario: 'progression' });
    delete (world as unknown as Record<string, unknown>).scenario;
    world.citizens.extra = {
      ...structuredClone(Object.values(world.citizens)[0]),
      id: 'extra',
      gold: 0,
    };
    const { runtime } = setup({ world });
    // Population is no longer a trustworthy indicator after births/deaths.
    expect(Object.keys(runtime.control({ type: 'reset' }).world.citizens)).toHaveLength(3);
  });
});
