import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './workbench.css';

export const ENGINE_LAYOUT_KEY = 'prosper.ui.engine-layout.v1';
export const OLD_LAYOUT_KEY = 'prosper.ui.panel-layout.v1';
export const ENGINE_DEFAULTS = {
  left: 220,
  right: 300,
  dock: 240,
  leftClosed: false,
  rightClosed: false,
  dockClosed: false,
};
export type EngineSizes = typeof ENGINE_DEFAULTS;
export type EnginePanel = 'left' | 'right' | 'dock';
// Vertical reserve includes map layer controls/legends, leaving at least 240px of map.
export const MAP_MINIMUM = { width: 420, height: 420 };
const RAIL = 28;
const HANDLE = 6;
const MINIMUM = { left: 160, right: 220, dock: 100 };
const MAXIMUM = { left: 480, right: 600, dock: 560 };

export function readEngineLayout(storage: Pick<Storage, 'getItem'>): EngineSizes {
  const result = { ...ENGINE_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(storage.getItem(ENGINE_LAYOUT_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const key of ['left', 'right', 'dock'] as const) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value))
          result[key] = Math.max(MINIMUM[key], Math.min(MAXIMUM[key], value));
      }
      for (const key of ['leftClosed', 'rightClosed', 'dockClosed'] as const) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === 'boolean') result[key] = value;
      }
    }
  } catch {
    /* Corrupt storage or private mode: use defaults. */
  }
  return result;
}
export function saveEngineLayout(storage: Pick<Storage, 'setItem'>, sizes: EngineSizes) {
  try {
    storage.setItem(ENGINE_LAYOUT_KEY, JSON.stringify(sizes));
  } catch {
    /* Storage is optional. */
  }
}
export function resetEngineLayout(storage: Pick<Storage, 'removeItem'>): EngineSizes {
  try {
    storage.removeItem(ENGINE_LAYOUT_KEY);
    storage.removeItem(OLD_LAYOUT_KEY);
  } catch {
    /* Storage is optional. */
  }
  return { ...ENGINE_DEFAULTS };
}
/** Fit visible tracks, never sacrificing the central map to saved oversized panes. */
export function fitEngineLayout(sizes: EngineSizes, width: number, height: number) {
  let left = sizes.leftClosed ? RAIL : sizes.left;
  let right = sizes.rightClosed ? RAIL : sizes.right;
  const available = Math.max(0, width - MAP_MINIMUM.width - HANDLE * 2);
  if (left + right > available) {
    const leftFloor = sizes.leftClosed ? RAIL : MINIMUM.left;
    const rightFloor = sizes.rightClosed ? RAIL : MINIMUM.right;
    const floors = leftFloor + rightFloor;
    if (available >= floors) {
      const extras = left + right - floors;
      const factor = extras ? (available - floors) / extras : 0;
      left = leftFloor + (left - leftFloor) * factor;
      right = rightFloor + (right - rightFloor) * factor;
    } else {
      // At narrow desktop widths keep the map; CSS switches to one-view drawers on mobile.
      const factor = available / Math.max(1, left + right);
      left *= factor;
      right *= factor;
    }
  }
  const dock = Math.min(
    sizes.dockClosed ? RAIL : sizes.dock,
    Math.max(0, height - MAP_MINIMUM.height - HANDLE),
  );
  return {
    left,
    right,
    dock,
    mapWidth: Math.max(0, width - left - right - HANDLE * 2),
    mapHeight: Math.max(0, height - dock - HANDLE),
  };
}

export function EngineLayout({
  left,
  right,
  dock,
  children,
  resetToken = 0,
  focused = false,
  releaseFocus,
}: {
  left: ReactNode;
  right: ReactNode;
  dock: ReactNode;
  children: ReactNode;
  resetToken?: number;
  focused?: boolean;
  releaseFocus?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(() => {
    try {
      return readEngineLayout(localStorage);
    } catch {
      return { ...ENGINE_DEFAULTS };
    }
  });
  const [bounds, setBounds] = useState({ width: 1200, height: 740 });
  const [mobileView, setMobileView] = useState<'map' | EnginePanel>('map');
  const drag = useRef<{ panel: EnginePanel; origin: number; size: number } | null>(null);
  const firstReset = useRef(resetToken);
  useEffect(() => {
    try {
      saveEngineLayout(localStorage, sizes);
    } catch {
      /* Optional. */
    }
  }, [sizes]);
  useEffect(() => {
    if (firstReset.current === resetToken) return;
    firstReset.current = resetToken;
    try {
      setSizes(resetEngineLayout(localStorage));
    } catch {
      setSizes({ ...ENGINE_DEFAULTS });
    }
    setMobileView('map');
  }, [resetToken]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const visibleSizes = focused
    ? { ...sizes, leftClosed: true, rightClosed: true, dockClosed: true }
    : sizes;
  const fitted = fitEngineLayout(visibleSizes, bounds.width, bounds.height);
  const resize = (panel: EnginePanel, value: number) => {
    releaseFocus?.();
    setSizes((previous) => {
      const limit =
        panel === 'dock'
          ? bounds.height - MAP_MINIMUM.height - HANDLE
          : bounds.width -
            MAP_MINIMUM.width -
            HANDLE * 2 -
            fitted[panel === 'left' ? 'right' : 'left'];
      return {
        ...previous,
        [panel]: Math.max(
          0,
          Math.min(limit, Math.max(MINIMUM[panel], Math.min(MAXIMUM[panel], value))),
        ),
        [`${panel}Closed`]: false,
      };
    });
  };
  const toggle = (panel: EnginePanel) => {
    releaseFocus?.();
    setSizes((previous) => ({
      ...previous,
      [`${panel}Closed`]: focused ? false : !previous[`${panel}Closed`],
    }));
  };
  const handle = (panel: EnginePanel) => (
    <div
      className={`engine-divider engine-divider-${panel}`}
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${panel === 'left' ? 'citizens' : panel === 'right' ? 'dossier' : 'bottom dock'}`}
      aria-controls={`engine-${panel}`}
      aria-orientation={panel === 'dock' ? 'horizontal' : 'vertical'}
      aria-valuemin={Math.min(MINIMUM[panel], fitted[panel])}
      aria-valuemax={
        panel === 'dock'
          ? Math.max(
              MINIMUM.dock,
              Math.min(MAXIMUM.dock, bounds.height - MAP_MINIMUM.height - HANDLE),
            )
          : Math.max(
              MINIMUM[panel],
              Math.min(
                MAXIMUM[panel],
                bounds.width -
                  MAP_MINIMUM.width -
                  HANDLE * 2 -
                  fitted[panel === 'left' ? 'right' : 'left'],
              ),
            )
      }
      aria-valuenow={Math.round(fitted[panel])}
      aria-valuetext={
        visibleSizes[`${panel}Closed`] ? 'Collapsed' : `${Math.round(fitted[panel])} pixels`
      }
      onDoubleClick={() => toggle(panel)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const delta =
          panel === 'left'
            ? { ArrowLeft: -step, ArrowRight: step }
            : panel === 'right'
              ? { ArrowLeft: step, ArrowRight: -step }
              : { ArrowUp: step, ArrowDown: -step };
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle(panel);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          resize(panel, event.key === 'Home' ? MINIMUM[panel] : MAXIMUM[panel]);
        } else if (event.key in delta) {
          event.preventDefault();
          resize(panel, fitted[panel] + delta[event.key as keyof typeof delta]!);
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          panel,
          origin: panel === 'dock' ? event.clientY : event.clientX,
          size: fitted[panel],
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.panel !== panel) return;
        const position = panel === 'dock' ? event.clientY : event.clientX;
        resize(
          panel,
          drag.current.size + (position - drag.current.origin) * (panel === 'left' ? 1 : -1),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      title="Drag or arrow keys to resize · Shift: larger steps · Enter: collapse · Home/End: limits"
    />
  );
  const pane = (panel: EnginePanel, content: ReactNode, title: string) => (
    <section
      id={`engine-${panel}`}
      className={`engine-pane engine-${panel}${visibleSizes[`${panel}Closed`] ? ' is-collapsed' : ''}`}
      aria-label={title}
    >
      <button
        className="engine-collapse"
        aria-label={`${visibleSizes[`${panel}Closed`] ? 'Expand' : 'Collapse'} ${title}`}
        aria-expanded={!visibleSizes[`${panel}Closed`]}
        onClick={() => toggle(panel)}
        title={`${visibleSizes[`${panel}Closed`] ? 'Expand' : 'Collapse'} ${title}`}
      >
        {visibleSizes[`${panel}Closed`] ? '+' : '−'}
        <span className="collapsed-title">{title}</span>
      </button>
      <div className="engine-pane-content">{content}</div>
    </section>
  );
  return (
    <>
      <nav className="engine-mobile-nav" aria-label="Workspace view">
        {(['map', 'left', 'right', 'dock'] as const).map((view) => (
          <button key={view} aria-pressed={mobileView === view} onClick={() => setMobileView(view)}>
            {{ map: 'World', left: 'Citizens', right: 'Dossier', dock: 'Analysis' }[view]}
          </button>
        ))}
      </nav>
      <div
        ref={root}
        className={`engine-layout mobile-${mobileView}`}
        style={
          {
            '--engine-left': `${fitted.left}px`,
            '--engine-right': `${fitted.right}px`,
            '--engine-dock': `${fitted.dock}px`,
          } as CSSProperties
        }
      >
        {pane('left', left, 'Citizens')}
        {handle('left')}
        <section className="engine-map" aria-label="World workspace">
          {children}
        </section>
        {handle('right')}
        {pane('right', right, 'Citizen dossier')}
        {handle('dock')}
        {pane('dock', dock, 'Analysis dock')}
      </div>
    </>
  );
}

export function WorkbenchTabs<T extends string>({
  id,
  tabs,
  active,
  change,
}: {
  id: string;
  tabs: readonly { id: T; label: string }[];
  active: T;
  change: (value: T) => void;
}) {
  return (
    <div className="workbench-tabs" role="tablist" aria-label={id}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`${id}-tab-${tab.id}`}
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`${id}-content`}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => change(tab.id)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            change(tabs[next]!.id);
            document.getElementById(`${id}-tab-${tabs[next]!.id}`)?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
