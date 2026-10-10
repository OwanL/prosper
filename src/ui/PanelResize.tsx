import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export const PANEL_LAYOUT_KEY = 'prosper.ui.panel-layout.v1';
export const DEFAULT_LAYOUT = {
  columns: [48, 25, 27],
  dossier: [60, 40],
  feeds: [34, 33, 33],
  world: [40, 45, 15],
};
export type PanelLayout = typeof DEFAULT_LAYOUT;
export type Split = keyof PanelLayout;
const MINIMUMS: PanelLayout = {
  columns: [320, 250, 250],
  dossier: [130, 120],
  feeds: [100, 100, 100],
  world: [100, 160, 80],
};

export function clampTracks(values: number[], minimums: number[]): number[] {
  const totalMin = minimums.reduce((a, b) => a + b, 0);
  const mins = minimums.map((n) => n * Math.min(1, 95 / totalMin));
  if (
    Math.abs(values.reduce((a, b) => a + b, 0) - 100) < 0.000001 &&
    values.every((n, i) => n >= mins[i]!)
  )
    return [...values];
  const extra = values.map((n, i) => Math.max(0, n - mins[i]!));
  const sum = extra.reduce((a, b) => a + b, 0);
  const remaining = 100 - mins.reduce((a, b) => a + b, 0);
  return mins.map((n, i) => n + remaining * (sum ? extra[i]! / sum : 1 / values.length));
}
export function resizeTracks(
  values: number[],
  index: number,
  delta: number,
  minimums: number[],
): number[] {
  const next = [...values];
  const movement = Math.max(
    minimums[index]! - values[index]!,
    Math.min(delta, values[index + 1]! - minimums[index + 1]!),
  );
  next[index]! += movement;
  next[index + 1]! -= movement;
  return next;
}
export function readLayout(storage: Pick<Storage, 'getItem'>): PanelLayout {
  try {
    const saved: unknown = JSON.parse(storage.getItem(PANEL_LAYOUT_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return structuredClone(DEFAULT_LAYOUT);
    const result = structuredClone(DEFAULT_LAYOUT);
    for (const key of Object.keys(result) as Split[]) {
      const value: unknown = (saved as Record<string, unknown>)[key];
      if (
        Array.isArray(value) &&
        value.length === result[key].length &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100)
      ) {
        result[key] = clampTracks(
          value,
          value.map(() => 5),
        );
      }
    }
    return result;
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}
export function saveLayout(storage: Pick<Storage, 'setItem'>, layout: PanelLayout): void {
  try {
    storage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* Private mode and quota failures must not disable resizing. */
  }
}

export function usePanelLayout() {
  const [layout, setLayout] = useState<PanelLayout>(() => {
    try {
      return readLayout(localStorage);
    } catch {
      return structuredClone(DEFAULT_LAYOUT);
    }
  });
  const workspace = useRef<HTMLDivElement>(null);
  const feeds = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const sizes = useRef<Record<Split, number>>({
    columns: 1200,
    dossier: 600,
    feeds: 600,
    world: 600,
  });
  const minimums = (split: Split) => {
    const raw = MINIMUMS[split].map((n) => (n / Math.max(1, sizes.current[split])) * 100);
    const factor = Math.min(1, 95 / raw.reduce((a, b) => a + b, 0));
    return raw.map((n) => n * factor);
  };
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (window.innerWidth < 1100) return;
      const w = workspace.current?.getBoundingClientRect();
      const f = feeds.current?.getBoundingClientRect();
      const b = world.current?.getBoundingClientRect();
      if (w && w.width > 0) sizes.current.columns = Math.max(1, w.width - 20);
      if (w && w.height > 0) sizes.current.dossier = Math.max(1, w.height - 10);
      if (f && f.height > 0) sizes.current.feeds = Math.max(1, f.height - 20);
      if (b && b.height > 0) sizes.current.world = Math.max(1, b.height - 20);
      setLayout((old) => {
        const next = { ...old };
        for (const key of Object.keys(next) as Split[])
          next[key] = clampTracks(old[key], minimums(key));
        return (Object.keys(next) as Split[]).every((key) =>
          next[key].every((n, i) => Math.abs(n - old[key][i]!) < 0.001),
        )
          ? old
          : next;
      });
    });
    [workspace, feeds, world].forEach((ref) => {
      if (ref.current) observer.observe(ref.current);
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      saveLayout(localStorage, layout);
    } catch {
      /* Storage unavailable. */
    }
  }, [layout]);
  const resize = (split: Split, index: number, delta: number) =>
    setLayout((old) => ({
      ...old,
      [split]: resizeTracks(old[split], index, delta, minimums(split)),
    }));
  const reset = () =>
    setLayout({
      columns: clampTracks(DEFAULT_LAYOUT.columns, minimums('columns')),
      dossier: clampTracks(DEFAULT_LAYOUT.dossier, minimums('dossier')),
      feeds: clampTracks(DEFAULT_LAYOUT.feeds, minimums('feeds')),
      world: clampTracks(DEFAULT_LAYOUT.world, minimums('world')),
    });
  const style = Object.fromEntries(
    Object.entries(layout).flatMap(([key, values]) =>
      values.map((value, i) => [`--${key}-${i}`, `${value}fr`]),
    ),
  ) as CSSProperties;
  return { layout, workspace, feeds, world, style, resize, reset, minimums, sizes };
}

export function PanelResize({
  name,
  split,
  index,
  panels,
  className = '',
}: {
  name: string;
  split: Split;
  index: number;
  panels: ReturnType<typeof usePanelLayout>;
  className?: string;
}) {
  const vertical = split === 'columns';
  const drag = useRef<{ id: number; position: number; element: HTMLDivElement } | null>(null);
  const stop = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.element.hasPointerCapture(active.id))
      active.element.releasePointerCapture(active.id);
  };
  useEffect(() => {
    window.addEventListener('resize', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('resize', stop);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, []);
  return (
    <div
      className={`panel-resize ${vertical ? 'resize-columns' : 'resize-rows'} ${className}`}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={name}
      tabIndex={0}
      aria-valuemin={Math.round(panels.minimums(split)[index]!)}
      aria-valuemax={Math.round(
        panels.layout[split][index]! +
          panels.layout[split][index + 1]! -
          panels.minimums(split)[index + 1]!,
      )}
      aria-valuenow={Math.round(panels.layout[split][index]!)}
      aria-valuetext={`${Math.round(panels.layout[split][index]!)} percent; drag or use arrow keys, Home and End`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          position: vertical ? event.clientX : event.clientY,
          element: event.currentTarget,
        };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        const position = vertical ? event.clientX : event.clientY;
        panels.resize(
          split,
          index,
          ((position - active.position) / panels.sizes.current[split]) * 100,
        );
        active.position = position;
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const negative = vertical ? 'ArrowLeft' : 'ArrowUp';
        const positive = vertical ? 'ArrowRight' : 'ArrowDown';
        const delta =
          event.key === negative
            ? -(event.shiftKey ? 5 : 1)
            : event.key === positive
              ? event.shiftKey
                ? 5
                : 1
              : event.key === 'Home'
                ? -100
                : event.key === 'End'
                  ? 100
                  : null;
        if (delta !== null) {
          event.preventDefault();
          panels.resize(split, index, delta);
        }
      }}
    />
  );
}
