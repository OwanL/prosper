import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { Runtime } from '../src/server/runtime.ts';
import { createApiServer } from '../src/server/http.ts';
import { saveCheckpoint, validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { createWorld, tickWorld } from '../src/world/core.ts';
import { ensureTelemetry } from '../src/world/telemetry.ts';
import { HISTORY_LIMIT } from '../src/shared/telemetry-types.ts';

function checkpoint(): Checkpoint {
  const world = createWorld({ seed: 7, population: 2 });
  ensureTelemetry(world);
  return {
    version: 1, savedAt: new Date().toISOString(), world,
    runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
  };
}

describe('spectator historical API and persistence', () => {
  it('serves bounded global/citizen projections without mutating state, and returns 404 for unknown citizens', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-history-api-'));
    const runtime = new Runtime({ directory, autoClock: false, world: checkpoint().world });
    const server = createApiServer({ runtime });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const id = Object.keys(runtime.world.citizens)[0];
      const before = JSON.stringify(runtime.world);
      const global = await (await fetch(`${base}/api/history/global`)).json();
      expect(global.runId).toBe(runtime.world.runId);
      expect(global.startedTick).toBe(0);
      expect(global.frames).toHaveLength(1);
      expect(global.frames[0]).not.toHaveProperty('citizens');
      const citizen = await (await fetch(`${base}/api/citizens/${id}/history`)).json();
      expect(citizen.citizenId).toBe(id);
      expect(citizen.points).toHaveLength(1);
      expect(citizen.points[0].tick).toBe(0);
      expect((await fetch(`${base}/api/citizens/unknown/history`)).status).toBe(404);
      expect((await fetch(`${base}/api/citizens/__proto__/history`)).status).toBe(404);
      const state = await (await fetch(`${base}/api/state`)).json();
      expect(state.world).not.toHaveProperty('telemetry');
      expect(JSON.stringify(runtime.world)).toBe(before);
      runtime.globalHistory().frames.length = 0;
      runtime.citizenHistory(id).points[0].cash = 999;
      expect(JSON.stringify(runtime.world)).toBe(before);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('roundtrips pending mid-interval flows and last prices without resampling on restore', () => {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-history-roundtrip-'));
    const cp = checkpoint();
    tickWorld(cp.world, 7);
    cp.world.telemetry!.pending['food:1'] = { units: 2, turnover: 6, fills: 1 };
    cp.world.telemetry!.last['food:1'] = { price: 3, tick: 7 };
    saveCheckpoint(join(directory, 'checkpoint.json'), cp);
    const runtime = new Runtime({ directory, autoClock: false, restore: true });
    try {
      expect(runtime.world.telemetry).toEqual(cp.world.telemetry);
      expect(runtime.world.tick).toBe(7);
      expect(runtime.world.initialGold).toBe(cp.world.initialGold);
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restores legacy worlds with one baseline at the actual tick, not fabricated earlier history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-history-legacy-'));
    const cp = checkpoint();
    tickWorld(cp.world, 7);
    delete cp.world.telemetry;
    expect(validateCheckpoint(cp).world.telemetry).toBeUndefined();
    saveCheckpoint(join(directory, 'checkpoint.json'), cp);
    const runtime = new Runtime({ directory, autoClock: false, restore: true });
    try {
      expect(runtime.globalHistory().startedTick).toBe(7);
      expect(runtime.globalHistory().frames.map((f) => f.tick)).toEqual([7]);
      expect(runtime.world.initialGold).toBe(cp.world.initialGold);
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects corrupt, unknown, future and unbounded telemetry without rejecting legitimate historical life states', () => {
    const valid = checkpoint();
    const id = Object.keys(valid.world.citizens)[0];
    valid.world.telemetry!.frames[0].citizens[id].alive = false;
    expect(() => validateCheckpoint(valid)).not.toThrow();
    const mutations: ((cp: Checkpoint) => void)[] = [
      (cp) => { cp.world.telemetry!.startedTick = 1; },
      (cp) => { cp.world.telemetry!.frames[0].tick = 1; },
      (cp) => { cp.world.telemetry!.frames.push(structuredClone(cp.world.telemetry!.frames[0])); },
      (cp) => { cp.world.telemetry!.frames = Array.from({ length: HISTORY_LIMIT + 1 }, () => structuredClone(cp.world.telemetry!.frames[0])); },
      (cp) => { cp.world.telemetry!.frames[0].citizens.unknown = cp.world.telemetry!.frames[0].citizens[id]; },
      (cp) => { cp.world.telemetry!.frames[0].citizens[id].cash = -1; },
      // Fractional cash/units are legitimate after the fractional economy; corruption is non-finite values.
      (cp) => { cp.world.telemetry!.frames[0].citizens[id].escrow = Number.NaN; },
      (cp) => { cp.world.telemetry!.pending['building:station'] = { units: 1, turnover: 1, fills: 1 }; },
      (cp) => { cp.world.telemetry!.pending['food:1'] = { units: -1, turnover: 1, fills: 1 }; },
      (cp) => { cp.world.telemetry!.pending['food:1'] = { units: 1, turnover: 1, fills: 0.5 }; },
      (cp) => { cp.world.telemetry!.frames[0].markets['food:1'].units = Number.POSITIVE_INFINITY; },
      (cp) => { cp.world.telemetry!.frames[0].markets['food:1'].lastPrice = 1; },
      (cp) => {
        const market = cp.world.telemetry!.frames[0].markets['food:1'];
        market.lastPrice = 1;
        market.lastTick = 1;
      },
      (cp) => { cp.world.telemetry!.last['food:1'] = { price: 0, tick: 0 }; },
      (cp) => { cp.world.telemetry!.last['food:1'] = { price: 1, tick: 1 }; },
      (cp) => { (cp.world.telemetry as unknown as Record<string, unknown>).extra = true; },
    ];
    for (const mutate of mutations) {
      const broken = structuredClone(valid);
      mutate(broken);
      expect(() => validateCheckpoint(broken)).toThrow(/Invalid checkpoint/);
    }
  });
});
