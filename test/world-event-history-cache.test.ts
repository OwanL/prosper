import { describe, expect, it } from 'vitest';
import type { World, WorldEvent } from '../src/shared/types.ts';
import { createWorld, tickWorld } from '../src/world/core.ts';
import { event, worldEventHistory } from '../src/shared/utils.ts';

/** Baseline semantics mirror the original uncached merge: duplicate ids resolved with
 * the ordinary ring winning, then ordered by tick and numeric id suffix. */
function referenceHistory(world: Pick<World, 'events' | 'significantEvents'>): WorldEvent[] {
  return [
    ...new Map(
      [...(world.significantEvents ?? []), ...world.events].map((entry) => [entry.id, entry]),
    ).values(),
  ].sort(
    (a, b) => a.tick - b.tick || Number(a.id.split('-').at(-1)) - Number(b.id.split('-').at(-1)),
  );
}

let nextEntryId = 0;
function entry(
  tick: number,
  kind = 'attack',
  text = 'Story.',
): WorldEvent {
  return { id: `event-${++nextEntryId}`, tick, kind, text, audience: ['citizen-1'] };
}

function expectExact(world: Pick<World, 'events' | 'significantEvents'>) {
  const actual = worldEventHistory(world);
  expect(actual).toEqual(referenceHistory(world));
  // Fresh copy each call: mutating the result must not poison later reads.
  expect(actual).not.toBe(worldEventHistory(world));
}

describe('world event history cache correctness', () => {
  it('agrees with the uncached baseline after every real tick, append and trim', () => {
    const world = createWorld({ seed: 11, population: 2 });
    expectExact(world);
    for (let tick = 0; tick < 8; tick++) {
      event(world, 'attack', 'Fight broke out.');
      event(world, 'harvest', `Turn ${tick} finished.`);
      tickWorld(world, 1);
      expectExact(world);
    }
    // Ordinary ring trim: history retains significant stories beyond the 500 bound.
    for (let i = 0; i < 620; i++) event(world, i % 7 === 0 ? 'trade' : 'harvest', `Filler ${i}.`);
    expect(world.events.length).toBeLessThanOrEqual(500);
    expectExact(world);
    event(world, 'death', 'Someone died.');
    expectExact(world);
  });

  it('orders same-tick events by numeric id suffix', () => {
    const world: Pick<World, 'events' | 'significantEvents'> = {
      events: [entry(4), entry(4), entry(3), entry(4)],
      significantEvents: undefined,
    };
    expectExact(world);
    worldEventHistory(world);
    world.events.push(entry(4));
    expectExact(world);
  });

  it('merges dual rings, survives same-tick ties, and keeps ordinary precedence by id', () => {
    const stale = entry(2);
    stale.id = 'story-9';
    const sharedId = entry(3); // ordinary ring wins duplicate id resolution
    const latest = entry(6);
    const oldest = entry(1);
    const world: Pick<World, 'events' | 'significantEvents'> = {
      events: [latest, sharedId],
      significantEvents: [stale, { ...sharedId, text: 'Significant twin.' }, oldest],
    };
    const merged = worldEventHistory(world);
    expect(merged).toEqual([oldest, stale, sharedId, latest]);
    expect(merged[2]).toBe(sharedId); // and identity comes from the ordinary ring
    expectExact(world);
    // Warm cache with the same rings still exact.
    expectExact(world);
  });

  it('detects in-place ring mutations through a warm cache', () => {
    const a = entry(1), b = entry(2), c = entry(3);
    const world: Pick<World, 'events' | 'significantEvents'> = { events: [a, b, c], significantEvents: undefined };
    expectExact(world);
    world.events = [c, a]; // whole array replacement, removal, reorder
    expectExact(world);
    world.events.reverse();
    expectExact(world);
    world.events.push(b);
    expectExact(world);
    b.tick = 0; // in-place tick edit can move the merged order
    expectExact(world);
    b.tick = 99;
    expectExact(world);
    b.text = 'Rewritten.'; // payload edits ride along on shared references
    expectExact(world);
    expect(worldEventHistory(world).find((e) => e.id === b.id)!.text).toBe('Rewritten.');
  });

  it('detects significant ring replacement, growth and undefined→defined transitions', () => {
    const world: Pick<World, 'events' | 'significantEvents'> = {
      events: [entry(5)],
      significantEvents: undefined,
    };
    expectExact(world);
    const old = entry(0);
    world.significantEvents = [old];
    expectExact(world);
    world.significantEvents!.unshift(entry(-1));
    expectExact(world);
    world.significantEvents = [];
    expectExact(world);
    delete (world as { significantEvents?: WorldEvent[] }).significantEvents;
    expectExact(world);
  });

  it('returned array mutations cannot poison the cache', () => {
    const world: Pick<World, 'events' | 'significantEvents'> = {
      events: [entry(1), entry(2), entry(3)],
      significantEvents: [entry(0)],
    };
    expectExact(world);
    const stolen = worldEventHistory(world);
    stolen.reverse();
    stolen.length = 1;
    expect(worldEventHistory(world)).toEqual(referenceHistory(world));
  });

  it('restored and cloned worlds get independent fresh caches', () => {
    const source: Pick<World, 'events' | 'significantEvents'> = {
      events: [entry(1), entry(2)],
      significantEvents: [entry(0)],
    };
    expectExact(source);
    const restored = structuredClone(source);
    restored.events.push(entry(3));
    expectExact(restored); // clone shares contents but never shares cache entries
    expectExact(source);
    const sibling: Pick<World, 'events' | 'significantEvents'> = {
      events: [entry(1), entry(2)],
      significantEvents: [entry(0)],
    };
    expectExact(sibling);
    sibling.events.push(entry(4));
    expectExact(sibling);
    const cloneOfSibling = structuredClone(sibling);
    cloneOfSibling.events.shift();
    expectExact(cloneOfSibling);
    expectExact(sibling);
  });

  it('keeps an exact baseline when events are appended between cached calls', () => {
    const world: Pick<World, 'events' | 'significantEvents'> = { events: [], significantEvents: undefined };
    let sequence = 0;
    const push = () => world.events.push({ id: `event-${++sequence}`, tick: sequence, kind: 'harvest', text: 'Tick work.' });
    for (let i = 0; i < 40; i++) {
      push();
      if (i % 3 === 0) expectExact(world);
      if (i % 5 === 0) world.significantEvents = [world.events[i]];
    }
    expectExact(world);
  });
});

describe('world event history cache benefit', () => {
  it('avoids rebuild work on stable rings and reports the measured tradeoff', () => {
    const history = 800;
    const ordinary = Array.from({ length: history }, (_, i) => ({ id: `event-${i}`, tick: i, kind: 'harvest', text: 'Routine turn work.' }));
    const significant = Array.from({ length: 100 }, (_, i) => ({ id: `trade-${i}`, tick: i * 2, kind: 'trade', text: 'A trade happened.' }));
    const world: Pick<World, 'events' | 'significantEvents'> = {
      events: ordinary,
      significantEvents: significant,
    };
    const repeatCalls = 100;
    // Warm the cache so repeat calls exercise the validation path only.
    worldEventHistory(world);
    let steadyNanos = 0n;
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < repeatCalls; i++) worldEventHistory(world);
      const elapsed = process.hrtime.bigint() - start;
      if (!steadyNanos || elapsed < steadyNanos) steadyNanos = elapsed;
    }
    let referenceNanos = 0n;
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < repeatCalls; i++) referenceHistory(world);
      const elapsed = process.hrtime.bigint() - start;
      if (!referenceNanos || elapsed < referenceNanos) referenceNanos = elapsed;
    }
    // Interleaved writes: every call must rebuild, so benefit collapses to the
    // validation scan plus one rebuild per call.
    const start = process.hrtime.bigint();
    for (let i = 0; i < repeatCalls; i++) {
      world.events.push({ id: `event-${history + i}`, tick: history + i, kind: 'harvest', text: 'One more event.' });
      worldEventHistory(world);
    }
    const invalidatedNanos = process.hrtime.bigint() - start;
    // After interleaved growth the rings no longer match, so confirm exactness.
    expectExact(world);
    const steadyMillis = Number(steadyNanos) / 1e6;
    const referenceMillis = Number(referenceNanos) / 1e6;
    const invalidatedMillis = Number(invalidatedNanos) / 1e6;
    console.log(
      `[worldEventHistory cache] ${history}+100 entries, ${repeatCalls} calls each:\n` +
        `  steady repeat (cached): ${steadyMillis.toFixed(2)}ms -> ${(steadyMillis / repeatCalls).toFixed(4)}ms/call\n` +
        `  steady repeat (uncached baseline): ${referenceMillis.toFixed(2)}ms -> ${(referenceMillis / repeatCalls).toFixed(4)}ms/call\n` +
        `  speedup on stable rings: ${(referenceMillis / Math.max(steadyMillis, 0.01)).toFixed(1)}x\n` +
        `  one append between calls: ${invalidatedMillis.toFixed(2)}ms -> ${(invalidatedMillis / repeatCalls).toFixed(4)}ms/call (100% rebuild, one validation + one build each)`,
    );
    expect(steadyNanos).toBeLessThan(referenceNanos);
    expect(steadyNanos).toBeLessThan(invalidatedNanos);
  });
});