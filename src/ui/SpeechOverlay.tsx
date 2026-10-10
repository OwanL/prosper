import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../shared/types';
import type { SceneModel } from './model';
import { Tooltip } from './Tooltip';

export const SPEECH_LIFETIME = 5000;
export const SPEECH_EXIT = 250;
export interface SpeechEntry { message: Message; expires: number }
export interface SpeechQueue { seen: Set<string>; tick: number | null; entries: SpeechEntry[] }
export function createSpeechQueue(): SpeechQueue {
  return { seen: new Set(), tick: null, entries: [] };
}

/** Initial recent history is intentional; subsequent polls never replay old messages. */
export function updateSpeech(queue: SpeechQueue, messages: Message[], model: SceneModel, now: number): SpeechEntry[] {
  const live = new Set(model.citizens.filter(c => !c.remembered && c.value.alive && c.seenTick === model.tick).map(c => c.value.id));
  const eligible = (message: Message) => live.has(message.from) && message.tick <= model.tick && model.tick - message.tick <= 180 && (!model.tiles || !message.to);
  // A rollback or knowledge-view change cannot resurrect retained speech.
  const initial = queue.tick === null;
  const available = new Set(messages.map(message => message.id));
  for (const message of [...messages].sort((a, b) => a.tick - b.tick)) {
    if (queue.seen.has(message.id)) continue;
    queue.seen.add(message.id);
    if (eligible(message) && (initial || message.tick >= queue.tick!)) {
      queue.entries = queue.entries.filter(entry => entry.message.from !== message.from);
      queue.entries.push({ message, expires: now + SPEECH_LIFETIME });
    }
  }
  queue.tick = model.tick;
  queue.entries = queue.entries.filter(entry => available.has(entry.message.id) && eligible(entry.message) && now < entry.expires + SPEECH_EXIT);
  return queue.entries;
}

export interface SpeechRect { x: number; y: number; width: number; height: number }
/** Pack around occupied edges/corners; omit lower-priority speech if no free slot fits. */
export function placeSpeech(anchor: { x: number; y: number }, size: { width: number; height: number }, bounds: SpeechRect, occupied: SpeechRect[]): SpeechRect | null {
  const margin = 8;
  const clampX = (x: number) => Math.max(bounds.x + margin, Math.min(x, bounds.x + bounds.width - size.width - margin));
  const clampY = (y: number) => Math.max(bounds.y + margin, Math.min(y, bounds.y + bounds.height - size.height - margin));
  // Computed CSS sizes are decimal-rounded; tolerate subpixel serialization
  // error at the inset, not actual overflow (the outer margin remains intact).
  const epsilon = 0.01;
  if (size.width <= 0 || size.height <= 0 || size.width > bounds.width - margin * 2 + epsilon || size.height > bounds.height - margin * 2 + epsilon) return null;
  const xs = [anchor.x - size.width / 2, anchor.x + 18, anchor.x - size.width - 18, bounds.x + margin, bounds.x + bounds.width - size.width - margin];
  const ys = [anchor.y - size.height - 22, anchor.y + 22, bounds.y + margin, bounds.y + bounds.height - size.height - margin];
  for (const other of occupied) {
    xs.push(other.x - size.width - margin, other.x + other.width + margin);
    ys.push(other.y - size.height - margin, other.y + other.height + margin);
  }
  const candidates = [...new Set(ys.map(clampY))].flatMap(y => [...new Set(xs.map(clampX))].map(x => ({ x, y, ...size })));
  const free = candidates.filter(rect => occupied.every(other => rect.x + rect.width + margin <= other.x || other.x + other.width + margin <= rect.x || rect.y + rect.height + margin <= other.y || other.y + other.height + margin <= rect.y));
  return free.sort((a, b) => Math.hypot(a.x + a.width / 2 - anchor.x, a.y + a.height - anchor.y) - Math.hypot(b.x + b.width / 2 - anchor.x, b.y + b.height - anchor.y))[0] ?? null;
}

export function SpeechOverlay({ svg, model, messages, selected }: { svg: RefObject<SVGSVGElement | null>; model: SceneModel; messages: Message[]; selected: string }) {
  const queue = useRef(createSpeechQueue());
  const [entries, setEntries] = useState<SpeechEntry[]>([]);
  const layer = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const now = performance.now();
    setEntries([...updateSpeech(queue.current, messages, model, now)]);
    const deadlines = queue.current.entries.flatMap(entry => [entry.expires, entry.expires + SPEECH_EXIT]).filter(time => time > now);
    if (!deadlines.length) return;
    const timer = setTimeout(() => setClock(value => value + 1), Math.min(...deadlines) - now + 1);
    return () => clearTimeout(timer);
  }, [model, messages, clock]);
  // Filter during render too: switching audiences must not show one stale frame.
  const available = new Set(messages.map(message => message.id));
  const live = new Set(model.citizens.filter(c => !c.remembered && c.value.alive && c.seenTick === model.tick).map(c => c.value.id));
  const visible = entries.filter(entry => available.has(entry.message.id) && live.has(entry.message.from) && (!model.tiles || !entry.message.to) && entry.message.tick <= model.tick && model.tick - entry.message.tick <= 180)
    .sort((a, b) => Number(b.message.from === selected) - Number(a.message.from === selected) || b.message.tick - a.message.tick).slice(0, 3);
  useLayoutEffect(() => {
    const node = svg.current;
    const overlay = layer.current;
    if (!node || !overlay) return;
    const setStyle = (bubble: HTMLDivElement, property: string, value: string) => {
      if (bubble.style.getPropertyValue(property) !== value) bubble.style.setProperty(property, value);
    };
    const setHidden = (bubble: HTMLDivElement, hidden: boolean) => {
      if (bubble.hidden !== hidden) bubble.hidden = hidden;
    };
    const place = () => {
      const box = node.getBoundingClientRect();
      const left = Math.max(0, box.left), top = Math.max(0, box.top);
      const bounds = { x: left, y: top, width: Math.max(0, Math.min(innerWidth, box.right) - left), height: Math.max(0, Math.min(innerHeight, box.bottom) - top) };
      const occupied: SpeechRect[] = [];
      const citizens = [...node.querySelectorAll<SVGGElement>('.citizen')];
      for (const bubble of overlay.querySelectorAll<HTMLDivElement>('.speech-overlay-entry')) {
        const citizen = citizens.find(c => c.dataset.entityId === bubble.dataset.speaker);
        const matrix = citizen?.getScreenCTM();
        const anchor = matrix && new DOMPoint(0, 0).matrixTransform(matrix);
        // A display:none map has a zero box and may still return a (0,0) CTM.
        // Do not collapse observed bubbles to 1px constraints in that case.
        const onMap = bounds.width > 16 && bounds.height > 16 && anchor && anchor.x >= bounds.x && anchor.x <= bounds.x + bounds.width && anchor.y >= bounds.y && anchor.y <= bounds.y + bounds.height;
        if (!onMap) { setHidden(bubble, true); continue; }
        setStyle(bubble, '--speech-width', `${bounds.width - 16}px`);
        setStyle(bubble, '--speech-height', `${bounds.height - 16}px`);
        // Hidden bubbles retain their measurable box (visibility:hidden), avoiding
        // ResizeObserver feedback from repeatedly toggling zero/nonzero dimensions.
        // Computed border-box sizes ignore the arrival transform, retaining fractions.
        const measured = getComputedStyle(bubble);
        const rect = placeSpeech(anchor, { width: parseFloat(measured.width), height: parseFloat(measured.height) }, bounds, occupied);
        setHidden(bubble, !rect);
        if (!rect) continue;
        setStyle(bubble, 'left', `${rect.x}px`);
        setStyle(bubble, 'top', `${rect.y}px`);
        occupied.push(rect);
      }
    };
    // Constraints can resize the very bubbles we observe. Apply geometry in the
    // next animation frame, outside ResizeObserver delivery, and skip stable writes.
    // Coalesce camera/sprite mutations so placement uses their complete frame.
    let frame = 0;
    const schedulePlace = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); });
    };
    const motion = new MutationObserver(schedulePlace);
    motion.observe(node, { subtree: true, attributes: true, attributeFilter: ['style', 'viewBox'] });
    const resize = new ResizeObserver(schedulePlace);
    resize.observe(node);
    resize.observe(overlay);
    for (const bubble of overlay.children) resize.observe(bubble);
    window.addEventListener('resize', schedulePlace);
    window.addEventListener('scroll', schedulePlace, true);
    place();
    return () => { cancelAnimationFrame(frame); motion.disconnect(); resize.disconnect(); window.removeEventListener('resize', schedulePlace); window.removeEventListener('scroll', schedulePlace, true); };
  }, [svg, entries, selected]);
  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={layer} className="speech-overlay" aria-label="Recent map speech">
    {visible.map(({ message, expires }) => {
      const speaker = model.citizens.find(c => c.value.id === message.from)?.value.name;
      const recipient = model.citizens.find(c => c.value.id === message.to)?.value.name;
      const audience = message.to ? `Private${recipient ? ` to ${recipient}` : ''}` : 'Public';
      const label = `${speaker} · ${audience}: ${message.text}`;
      return <div key={message.id} data-speaker={message.from} className={`speech-overlay-entry${performance.now() >= expires ? ' speech-exiting' : ''}`}>
        <Tooltip content={label}><button type="button" className="map-speech-button" aria-label={label}>
          <span className="map-speech-heading">{speaker} · {audience}</span>
          <span className="map-speech-preview">{message.text}</span>
        </button></Tooltip>
      </div>;
    })}
  </div>, document.body);
}
