import { describe, expect, it } from 'vitest';
import { createSpeechQueue, placeSpeech, SPEECH_EXIT, SPEECH_LIFETIME, updateSpeech } from '../src/ui/SpeechOverlay';
import { projectWorld } from '../src/ui/model';
import { createWorld } from '../src/world/core';
import type { Message } from '../src/shared/types';

function fixture() {
  const world = createWorld({ seed: 1, population: 4 });
  world.tick = 123;
  const model = projectWorld(world);
  const messages = model.citizens.map((c, i) => ({ id: `m${i}`, from: c.value.id, tick: 122, text: `Text ${i}` }));
  return { model, messages };
}
describe('wall-time speech', () => {
  it('expires while paused and does not replay on repeated polling', () => {
    const { model, messages } = fixture();
    const queue = createSpeechQueue();
    expect(updateSpeech(queue, messages, model, 0)).toHaveLength(4);
    expect(updateSpeech(queue, messages, model, 4000)[0].expires).toBe(SPEECH_LIFETIME);
    expect(updateSpeech(queue, messages, model, SPEECH_LIFETIME + SPEECH_EXIT)).toHaveLength(0);
    expect(updateSpeech(queue, messages, model, 10000)).toHaveLength(0);
  });
  it('does not replay newly encountered historical messages after initial history', () => {
    const { model, messages } = fixture();
    const queue = createSpeechQueue();
    updateSpeech(queue, [], model, 0);
    expect(updateSpeech(queue, messages, model, 500)).toHaveLength(0);
    const fresh = { ...messages[0], id: 'new', tick: model.tick };
    expect(updateSpeech(queue, [fresh], model, 500)).toHaveLength(1);
  });
  it('requires a fresh living sighting and excludes private speech in knowledge', () => {
    const { model, messages } = fixture();
    model.tiles = [];
    model.citizens[0].remembered = true;
    model.citizens[1].seenTick--;
    model.citizens[2].value.alive = false;
    const privateMessage: Message = { ...messages[3], to: messages[0].from };
    expect(updateSpeech(createSpeechQueue(), [...messages.slice(0, 3), privateMessage], model, 0)).toHaveLength(0);
  });
  it('removes speech missing from the knowledge audience immediately', () => {
    const { model, messages } = fixture();
    const queue = createSpeechQueue();
    updateSpeech(queue, messages, model, 0);
    model.tiles = [];
    expect(updateSpeech(queue, [], model, 10)).toHaveLength(0);
  });
  it('retains only the newest message per speaker and rejects future or stale ticks', () => {
    const { model, messages } = fixture();
    const first = messages[0];
    const entries = updateSpeech(createSpeechQueue(), [{ ...first, id: 'newer', tick: 123 }, first, { ...messages[1], tick: 124 }, { ...messages[2], tick: -100 }], model, 0);
    expect(entries.map(e => e.message.id)).toEqual(['newer']);
  });
});
describe('speech placement', () => {
  it.each([{ width: 668, height: 165 }, { width: 372, height: 280 }])('packs occupied edges or hides lower priority on a $width × $height map', size => {
    const bounds = { x: 13, y: 282, ...size };
    const anchor = { x: bounds.x + size.width / 2, y: bounds.y + size.height / 2 };
    const occupied = [placeSpeech(anchor, { width: 87, height: 58 }, bounds, [])!];
    let hidden = 0;
    for (let i = 0; i < 2; i++) {
      const next = placeSpeech(anchor, { width: 280, height: 149 }, bounds, occupied);
      if (!next) { hidden++; continue; }
      for (const other of occupied) {
        expect(next.x + next.width <= other.x || other.x + other.width <= next.x || next.y + next.height <= other.y || other.y + other.height <= next.y).toBe(true);
      }
      occupied.push(next);
    }
    expect(occupied.length + hidden).toBe(3);
    expect(hidden).toBeGreaterThan(0);
  });
  it('accepts CSS decimal rounding at the inset without losing the outer margin', () => {
    const rect = placeSpeech({ x: 334, y: 82 }, { width: 280, height: 149.516 }, { x: 0, y: 0, width: 668, height: 165.515625 }, []);
    expect(rect).not.toBeNull();
    expect(rect!.y + rect!.height).toBeLessThan(165.515625);
  });
  it('rejects bubbles larger than the usable map', () => {
    expect(placeSpeech({ x: 20, y: 20 }, { width: 100, height: 100 }, { x: 0, y: 0, width: 80, height: 80 }, [])).toBeNull();
  });
  it('uses available map space without overlapping co-located speakers', () => {
    const bounds = { x: 0, y: 0, width: 390, height: 400 };
    const anchor = { x: 10, y: 10 };
    const a = placeSpeech(anchor, { width: 200, height: 70 }, bounds, [])!;
    const b = placeSpeech(anchor, { width: 240, height: 110 }, bounds, [a])!;
    expect(a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
    for (const rect of [a, b]) {
      expect(rect.x).toBeGreaterThanOrEqual(8);
      expect(rect.x + rect.width).toBeLessThanOrEqual(382);
      expect(rect.y + rect.height).toBeLessThanOrEqual(392);
    }
  });
});
