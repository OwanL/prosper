import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Point } from '../shared/types';
import { cameraPoint, occupantOffset, screenPoint, type SceneModel } from './model';
import { motionPoint, retargetMotion, snapshotDuration, type Motion } from './motion';
import { CitizenMotionBuffer, type CitizenMotionPacket } from './bufferedMotion';

/** Animate SVG transforms directly: no React/grid rerender on every animation frame. */
export function useSceneMotion(
  svg: RefObject<SVGSVGElement | null>,
  model: SceneModel,
  running: boolean,
  followId: string | undefined,
  center: Point,
  width: number,
  height: number,
) {
  const tracks = useRef(new Map<string, Motion>());
  const sample = useRef<{ model: SceneModel; time: number; duration: number } | null>(null);
  const stream = useRef({ buffer: new CitizenMotionBuffer(), connected: false });
  const currentModel = useRef(model);
  currentModel.current = model;
  const spectator = model.tiles === null;
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    // Never subscribe to spectator positions in a citizen's private knowledge view.
    if (!spectator || !running || typeof EventSource === 'undefined') return;
    const state = { buffer: new CitizenMotionBuffer(), connected: false };
    stream.current = state;
    const source = new EventSource('/api/motion');
    source.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data) as CitizenMotionPacket;
        const last = packet.frames?.at(-1);
        const displayedRunId = svg.current?.closest('[data-run-id]')?.getAttribute('data-run-id');
        if (
          !last ||
          !Array.isArray(last.citizens) ||
          !Number.isFinite(last.at) ||
          (displayedRunId && packet.runId !== displayedRunId) ||
          last.tick < currentModel.current.tick
        )
          return;
        state.buffer.append(packet, performance.now());
        state.connected = true;
      } catch {
        // Legacy/offline servers keep the existing snapshot presentation fallback.
      }
    };
    source.onerror = () => {
      state.connected = false;
    };
    return () => {
      source.close();
      state.connected = false;
    };
  }, [svg, spectator, running]);
  useLayoutEffect(() => {
    const node = svg.current;
    if (!node) return;
    const now = performance.now();
    const previous = sample.current;
    const fresh = previous?.model !== model;
    const gap = previous ? now - previous.time : 700;
    // Polls include network + projection time, not just the nominal 700ms timer.
    // A delayed poll is not a teleport: continue from the last painted position.
    const duration = fresh ? snapshotDuration(gap) : previous!.duration;
    const discontinuity = previous && model.tick < previous.model.tick;
    const animate = running && !reduced && !model.tiles && !discontinuity;
    if (fresh) sample.current = { model, time: now, duration };
    const next = new Map<string, Motion>();
    for (const { value: citizen, remembered } of model.citizens) {
      const offset = occupantOffset(
        citizen.id,
        model.citizens
          .filter((c) => c.value.x === citizen.x && c.value.y === citizen.y)
          .map((c) => c.value),
      );
      const position = screenPoint(citizen, model.height);
      const target = { x: position.x + offset.x, y: position.y + offset.y };
      next.set(
        citizen.id,
        retargetMotion(
          tracks.current.get(citizen.id),
          target,
          now,
          animate && !remembered ? duration : 0,
        ),
      );
    }
    tracks.current = next;
    const elements = [...node.querySelectorAll<SVGGElement>('.citizen')];
    let frame = 0;
    const paint = (time: number) => {
      let moving = false;
      const live = stream.current;
      const buffered = spectator && running && live.connected && live.buffer.ready;
      const streamed = buffered ? live.buffer.sample(time, !reduced) : null;
      const positions = new Map<string, Point>();
      if (streamed) {
        const occupants = new Map<string, { id: string }[]>();
        for (const [id, position] of streamed) {
          const key = `${position.x},${position.y}`;
          const group = occupants.get(key) ?? [];
          group.push({ id });
          occupants.set(key, group);
        }
        for (const [id, position] of streamed) {
          const point = screenPoint(position, model.height);
          const offset = occupantOffset(id, occupants.get(`${position.x},${position.y}`)!);
          positions.set(id, { x: point.x + offset.x, y: point.y + offset.y });
        }
      }
      for (const element of elements) {
        const track = next.get(element.dataset.entityId!);
        if (!track) continue;
        const streamedPosition = positions.get(element.dataset.entityId!);
        element.style.visibility = streamed && !streamedPosition ? 'hidden' : '';
        const position = streamedPosition ?? motionPoint(track, time);
        const prior = element.style.transform;
        element.style.transform = `translate(${position.x}px, ${position.y}px)`;
        const inMotion = streamed
          ? !!streamedPosition && prior !== element.style.transform
          : position.x !== track.to.x || position.y !== track.to.y;
        element.dataset.moving = String(inMotion);
        moving ||= inMotion;
      }
      // Camera and followed sprite use exactly the same presentation position.
      const followed = followId && next.get(followId);
      const camera = cameraPoint(
        (followId && positions.get(followId)) || (followed ? motionPoint(followed, time) : center),
        width,
        height,
        model.width,
        model.height,
      );
      node.setAttribute(
        'viewBox',
        `${camera.x - width / 2} ${camera.y - height / 2} ${width} ${height}`,
      );
      // The compact tick stream updates refs without rerendering the terrain or React tree.
      if ((moving && animate) || (spectator && running && typeof EventSource !== 'undefined'))
        frame = requestAnimationFrame(paint);
    };
    paint(now);
    return () => cancelAnimationFrame(frame);
  }, [svg, model, running, reduced, spectator, followId, center.x, center.y, width, height]);
}
