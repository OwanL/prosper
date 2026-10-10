import type { Point } from '../shared/types';
import type { MotionSnapshot } from '../shared/motion-types';

export type CitizenMotionPacket = MotionSnapshot;

interface Frame {
  tick: number;
  at: number;
  citizens: Map<string, Point>;
}

/** A short playback buffer follows each confirmed grid step, including corners. */
export class CitizenMotionBuffer {
  private frames: Frame[] = [];
  private runId?: string;
  private streamId?: string;
  private clockOffset = 0;
  private cursor = -Infinity;
  private delay = 120;
  running = false;

  get ready(): boolean {
    return this.frames.length > 0;
  }

  append(packet: CitizenMotionPacket, receivedAt: number): void {
    const incoming = packet.frames;
    if (!incoming.length) return;
    const last = incoming.at(-1)!;
    const previous = this.frames.at(-1);
    if (
      this.runId !== packet.runId ||
      this.streamId !== packet.streamId ||
      (previous && last.tick < previous.tick)
    ) {
      this.frames = [];
      this.cursor = -Infinity;
    }
    this.runId = packet.runId;
    this.streamId = packet.streamId;
    this.running = packet.running;
    this.delay = Math.max(120, Math.min(1500, (packet.tickMs ?? 100) * 1.15));
    // Date.now on the server and performance.now in the browser have different origins.
    this.clockOffset = receivedAt - last.at;
    for (const frame of incoming) {
      const latest = this.frames.at(-1);
      if (latest && (frame.tick < latest.tick || frame.at <= latest.at)) continue;
      this.frames.push({
        ...frame,
        citizens: new Map(
          frame.citizens.filter((c) => c.alive).map((c) => [c.id, { x: c.x, y: c.y }]),
        ),
      });
    }
    this.frames = this.frames.slice(-128);
  }

  sample(now: number, animate = true): Map<string, Point> {
    const latest = this.frames.at(-1);
    if (!latest) return new Map();
    if (!animate || !this.running) return latest.citizens;
    // Never rewind on network jitter and never extrapolate past a committed tick.
    const at = Math.min(latest.at, Math.max(this.cursor, now - this.clockOffset - this.delay));
    this.cursor = at;
    let nextIndex = this.frames.findIndex((frame) => frame.at >= at);
    if (nextIndex < 0) nextIndex = this.frames.length - 1;
    const next = this.frames[nextIndex];
    const previous = this.frames[Math.max(0, nextIndex - 1)];
    const t =
      next.at <= previous.at
        ? 1
        : Math.max(0, Math.min(1, (at - previous.at) / (next.at - previous.at)));
    const positions = new Map<string, Point>();
    for (const [id, end] of next.citizens) {
      // The latest membership suppresses dead citizens even inside the short buffer.
      if (!latest.citizens.has(id)) continue;
      const start = previous.citizens.get(id) ?? end;
      positions.set(id, { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    }
    return positions;
  }
}
