import { useEffect, useRef, useState } from 'react';
import type { Citizen, Message, Point, Territory, WorldEvent } from '../shared/types';
import { Tooltip } from './Tooltip';
import { claimAlliance, contestedOverlaps } from './Conflict';
import { CitizenMotivation } from './Spectator';
import { eventPoint, recentStories, storyKinds } from './story';
import { useDirector } from './useDirector';
import { useSceneMotion } from './useSceneMotion';
import { SpeechOverlay } from './SpeechOverlay';
import './speech.css';
import './navigation.css';
import { clampZoom, panViewport, zoomViewport, type Viewport } from './navigation';
import {
  cameraPoint,
  citizenColor,
  territoryColor,
  territoryLabel,
  markedTerritories,
  membershipIn,
  occupantOffset,
  regionAt,
  screenPoint,
  terrainRegions,
  terrainColor,
  type SceneModel,
} from './model';

export function Scene({
  model,
  selected,
  select,
  follow,
  labels,
  running,
  own,
  messages = [],
  events = [],
  focusEvent,
  director = false,
  territories = true,
  resources = false,
  watch = false,
  manualCamera = () => {},
  navigateCamera,
  focusCitizen,
  compact = false,
}: {
  model: SceneModel;
  selected: string;
  select: (id: string) => void;
  follow: boolean;
  labels: boolean;
  running: boolean;
  own?: Citizen;
  messages?: Message[];
  events?: WorldEvent[];
  focusEvent?: WorldEvent;
  director?: boolean;
  territories?: boolean;
  resources?: boolean;
  watch?: boolean;
  manualCamera?: () => void;
  navigateCamera?: () => void;
  focusCitizen?: (id: string) => void;
  compact?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [attacks, setAttacks] = useState(true);
  const [allClaims, setAllClaims] = useState(false);
  const alliances = model.alliances ?? [];
  const overlaps = contestedOverlaps(model.claims ?? [], alliances);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tile, setTile] = useState<Point | null>(null);
  const previousHealth = useRef(new Map<string, number>());
  const [hits, setHits] = useState<string[]>([]);
  useEffect(() => {
    const next = new Map<string, number>();
    const damaged: string[] = [];
    if (!model.tiles)
      for (const { value: c } of model.citizens) {
        const before = previousHealth.current.get(c.id);
        if (before !== undefined && c.health < before) damaged.push(c.id);
        next.set(c.id, c.health);
      }
    previousHealth.current = next;
    setHits(damaged);
    const timer = setTimeout(() => setHits([]), 400);
    return () => clearTimeout(timer);
  }, [model]);
  const [manual, setManual] = useState(false);
  const [cameraRatio, setCameraRatio] = useState<number | null>(null);
  useEffect(() => {
    if (follow) setManual(false);
  }, [follow, selected]);
  useEffect(() => {
    if (focusEvent || director) setManual(false);
  }, [focusEvent, director]);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    view: Viewport;
    inverse: DOMMatrix;
  } | null>(null);
  const dragged = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const resize = new ResizeObserver(() => {
      const box = node.getBoundingClientRect();
      if (box.width && box.height) setAspect(box.height / box.width);
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, []);
  const chosen = model.citizens.find((c) => c.value.id === selected && !c.remembered)?.value;
  const shot = useDirector(
    events,
    model.tick,
    model.width,
    model.height,
    director && !model.tiles && !follow && !manual,
  );
  const focused = manual ? undefined : (focusEvent ?? shot);
  const location =
    focused && !model.tiles ? eventPoint(focused, model.width, model.height) : undefined;
  const desiredCenter =
    follow && !manual && chosen
      ? screenPoint(chosen, model.height)
      : location
        ? screenPoint(location, model.height)
        : { x: model.width / 2 + pan.x, y: model.height / 2 + pan.y };
  const cinematic = watch && !model.tiles && !!(location || (follow && !manual && chosen));
  const effectiveZoom = location
    ? Math.max(zoom, 1.8)
    : follow && !manual && chosen?.attackTargetId
      ? Math.max(zoom, 4)
      : zoom;
  const vw = model.width / effectiveZoom,
    vh =
      manual && cameraRatio !== null
        ? Math.min(model.height, vw * cameraRatio)
        : cinematic
          ? Math.min(model.height / effectiveZoom, vw * aspect)
          : model.height / effectiveZoom;
  const center = cameraPoint(desiredCenter, vw, vh, model.width, model.height);
  // Render the complete knowledge-filtered model; SVG/container clipping owns
  // the viewport, including object and label extents across camera edges.
  const vp = `${center.x - vw / 2} ${center.y - vh / 2} ${vw} ${vh}`;
  useSceneMotion(
    svg,
    model,
    running,
    follow && !manual && chosen ? chosen.id : undefined,
    center,
    vw,
    vh,
  );
  const presentation = (): Viewport => {
    const box = svg.current?.viewBox.baseVal;
    return box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : { x: center.x - vw / 2, y: center.y - vh / 2, width: vw, height: vh };
  };
  const release = () => {
    setManual(true);
    (navigateCamera ?? manualCamera)();
  };
  const applyView = (view: Viewport, nextZoom: number) => {
    release();
    setZoom(clampZoom(nextZoom));
    setCameraRatio(view.height / view.width);
    setPan({
      x: view.x + view.width / 2 - model.width / 2,
      y: view.y + view.height / 2 - model.height / 2,
    });
  };
  const changeZoom = (factor: number, anchor?: Point) => {
    const view = presentation();
    const nextZoom = clampZoom((model.width / view.width) * factor);
    applyView(
      zoomViewport(
        view,
        anchor ?? { x: view.x + view.width / 2, y: view.y + view.height / 2 },
        nextZoom,
        model.width,
        model.height,
      ),
      nextZoom,
    );
  };
  const fit = () => {
    release();
    setZoom(1);
    setCameraRatio(model.height / model.width);
    setPan({ x: 0, y: 0 });
  };
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = (event) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return;
    event.preventDefault();
    const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.current!.clientHeight : 1);
    changeZoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.003), anchor);
  };
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => wheelHandler.current(event);
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  // Messages never supply positions or identities: only fresh, living scene sightings do.
  const live = new Map(
    model.citizens
      .filter((c) => !c.remembered && c.value.alive && c.seenTick === model.tick)
      .map((c) => [c.value.id, c.value]),
  );
  const consequential = !model.tiles ? recentStories(events, model.tick, 8) : [];
  const combat = model.citizens.filter(
    ({ value, remembered }) => !remembered && value.attackTargetId,
  );
  const allyMembership = new Map(
    (model.alliances ?? []).flatMap((alliance) =>
      alliance.members.map((id) => [id, alliance] as const),
    ),
  );
  const labelRows = new Map<string, number>();
  const claimLabelRows = new Map(
    (model.claims ?? []).map((claim) => {
      const key = `${Math.floor(claim.areas[0] / 3)},${claim.areas[3]}`;
      const row = labelRows.get(key) ?? 0;
      labelRows.set(key, row + 1);
      return [claim.id, row];
    }),
  );
  const point = (p: Point) => {
    const s = screenPoint(p, model.height);
    return `translate(${s.x} ${s.y})`;
  };
  // Composed marked-tile territories: color and emphasis come from sign-backed
  // membership, never from legacy announcement claims.
  const marked = markedTerritories(model);
  const citizenName = (id: string) =>
    model.citizens.find((citizen) => citizen.value.id === id)?.value.name ?? id;
  const ownerColor = territoryColor;
  const labelTerritory = (territory: Territory) => territoryLabel(territory,
    Object.fromEntries(model.citizens.map(({ value }) => [value.id, value])));
  const tintRect = (territory: Territory, x: number, y: number) => {
    const membership = membershipIn(territory, selected);
    const members = Object.keys(territory.members ?? {});
    const color = ownerColor(territory);
    return (
      <rect
        x={x + 0.04}
        y={model.height - y - 0.96}
        width={0.92}
        height={0.92}
        fill={color}
        fillOpacity={membership === 'none' ? 0.26 : 0.48}
        stroke={color}
        strokeWidth={membership === 'none' ? 0.035 : 0.06}
        strokeDasharray={membership === 'none' ? '0.12 0.1' : undefined}
      >
        <title>{`Marked territory of ${labelTerritory(territory)}${
          members.length ? ` · ${members.length} member${members.length === 1 ? '' : 's'}` : ''
        } · selected: ${membership}${
          membership === 'none'
            ? ' (outside membership; dashed border)'
            : ' · solid border'
        }`}</title>
      </rect>
    );
  };
  const signTerritory = (territoryId: string): Territory | undefined =>
    (model.territories ?? []).find((territory) => territory.id === territoryId);
  const houseOwnerColor = (ownerId: string | null) =>
    (ownerId && model.citizens.find((citizen) => citizen.value.id === ownerId)?.value.color) ||
    '#b98d5c';
  // Private work permissions belong only to the selected dossier, never other sightings.
  const strategy =
    own?.id === selected && own.strategy && ['active', 'blocked'].includes(own.strategy.status)
      ? own.strategy
      : undefined;
  const directive = strategy?.directives[strategy.index];
  const areas = directive && 'areas' in directive ? directive.areas : [];
  const sight = model.tiles && new Map(model.tiles.map((t) => [`${t.x},${t.y}`, t]));
  const occupants = tile
    ? model.citizens.filter((c) => c.value.x === tile.x && c.value.y === tile.y)
    : [];
  const tileTerritory = tile ? marked.get(`${tile.x},${tile.y}`) : undefined;
  const selectable = (p: Point, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: () => setTile({ x: p.x, y: p.y }),
    onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setTile({ x: p.x, y: p.y });
      }
    },
  });
  return (
    <section className={`scene-shell ${watch ? 'watch-scene' : ''}`} aria-label="World map">
      <div className="map-toolbar">
        <span>
          ◈{' '}
          {model.tiles
            ? 'Citizen knowledge · dated sightings'
            : director
              ? 'Director · committed events'
              : compact
                ? 'World view'
                : 'Spectator truth'}
        </span>
        <div>
          {!model.tiles && !compact && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={attacks}
                  onChange={(e) => setAttacks(e.target.checked)}
                />
                Attack arrows
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allClaims}
                  onChange={(e) => setAllClaims(e.target.checked)}
                />
                All claim labels
              </label>
            </>
          )}
          {compact && (
            <details>
              <summary>Map guide</summary>
              <section className="game-map-guide">
                {!model.tiles && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={attacks}
                        onChange={(event) => setAttacks(event.target.checked)}
                      />
                      Attack arrows
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={allClaims}
                        onChange={(event) => setAllClaims(event.target.checked)}
                      />
                      All claim labels
                    </label>
                    <p>
                      Territory borders are announced demands, not walls. Hatching marks rival
                      overlap, not confirmed combat.
                    </p>
                    <p>
                      Red arrows show active attack or pursuit. Event rings mark recent recorded
                      outcomes.
                    </p>
                  </>
                )}
                <p>
                  Drag to pan. Scroll to zoom. Select a citizen to inspect them; double-click to
                  follow.
                </p>
                <p>
                  Focus the map for arrows/WASD, +/− zoom, F/Home fit and Escape to release Follow.
                </p>
              </section>
            </details>
          )}
          <Tooltip
            content={`Show more of the map without changing world state.${effectiveZoom <= 1 ? ' Disabled: minimum zoom reached.' : ''}`}
          >
            <button
              aria-label="Zoom out"
              disabled={effectiveZoom <= 1}
              onClick={() => setZoom(clampZoom(effectiveZoom / 1.3))}
            >
              −
            </button>
          </Tooltip>
          <Tooltip content="Fit the whole map and release Follow. Shortcut: F or Home when the map is focused.">
            <button aria-label="Reset map view" onClick={fit}>
              Fit
            </button>
          </Tooltip>
          <Tooltip
            content={`Enlarge sprites and tiles; drag or scroll the map to navigate.${effectiveZoom >= 5 ? ' Disabled: maximum zoom reached.' : ''}`}
          >
            <button
              aria-label="Zoom in"
              disabled={effectiveZoom >= 5}
              onClick={() => setZoom(clampZoom(effectiveZoom * 1.3))}
            >
              +
            </button>
          </Tooltip>
        </div>
      </div>
      <svg
        ref={svg}
        className={`world-scene ${running ? 'running' : 'paused'}`}
        viewBox={vp}
        role="group"
        tabIndex={0}
        aria-label="Top-down world; north is up, origin is bottom-left"
        aria-describedby="map-navigation-help"
        onClickCapture={(e) => {
          if (dragged.current) {
            e.stopPropagation();
            e.preventDefault();
            dragged.current = false;
          }
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
          const key = e.key.toLowerCase();
          const directions: Record<string, Point> = {
            arrowleft: { x: -1, y: 0 },
            a: { x: -1, y: 0 },
            arrowright: { x: 1, y: 0 },
            d: { x: 1, y: 0 },
            arrowup: { x: 0, y: -1 },
            w: { x: 0, y: -1 },
            arrowdown: { x: 0, y: 1 },
            s: { x: 0, y: 1 },
          };
          if (['+', '=', '-', '_', 'f', 'home', 'escape'].includes(key) || directions[key])
            e.preventDefault();
          else return;
          if (key === 'f' || key === 'home') fit();
          else if (key === '+' || key === '=') changeZoom(1.3);
          else if (key === '-' || key === '_') changeZoom(1 / 1.3);
          else {
            const view = presentation();
            const direction = directions[key] ?? { x: 0, y: 0 };
            const distance = e.shiftKey ? 0.3 : 0.08;
            applyView(
              panViewport(
                view,
                { x: direction.x * view.width * distance, y: direction.y * view.height * distance },
                model.width,
                model.height,
              ),
              model.width / view.width,
            );
          }
        }}
        data-testid="world-scene"
        onPointerDown={(e) => {
          if (!drag.current) dragged.current = false;
          if (e.button !== 0 || drag.current || (e.target as Element).closest('[data-entity-id]'))
            return;
          const matrix = e.currentTarget.getScreenCTM();
          if (!matrix) return;
          e.currentTarget.focus({ preventScroll: true });
          dragged.current = false;
          const view = presentation();
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            view,
            inverse: matrix.inverse(),
          };
          applyView(view, model.width / view.width);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start || start.id !== e.pointerId) return;
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) dragged.current = true;
          const a = new DOMPoint(start.x, start.y).matrixTransform(start.inverse);
          const b = new DOMPoint(e.clientX, e.clientY).matrixTransform(start.inverse);
          applyView(
            panViewport(start.view, { x: a.x - b.x, y: a.y - b.y }, model.width, model.height),
            model.width / start.view.width,
          );
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          dragged.current = false;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <defs>
          <marker
            id="attack-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" fill="#a52f24" />
          </marker>
          <pattern id="contested" width=".4" height=".4" patternUnits="userSpaceOnUse">
            <path d="M0 .4L.4 0" stroke="#a35320" strokeWidth=".08" />
          </pattern>
          <pattern id="grass" width="1" height="1" patternUnits="userSpaceOnUse">
            <path
              d="M.1 .8l.05-.1m.5-.3l.04-.08"
              stroke="#6e8963"
              strokeWidth=".025"
              opacity=".5"
            />
            <path d="M0 0H1M0 0V1" stroke="#4e6959" strokeWidth=".025" />
          </pattern>
        </defs>
        <rect
          width={model.width}
          height={model.height}
          fill="#263e38"
          onClick={(event) => {
            const matrix = svg.current?.getScreenCTM();
            if (!matrix) return;
            const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(
              matrix.inverse(),
            );
            setTile({ x: Math.floor(position.x), y: model.height - Math.floor(position.y) - 1 });
          }}
        />
        {!model.tiles && (
          <g
            data-testid="spectator-terrain"
            onClick={(event) => {
              const matrix = svg.current?.getScreenCTM();
              if (!matrix) return;
              const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(
                matrix.inverse(),
              );
              setTile({ x: Math.floor(position.x), y: model.height - Math.floor(position.y) - 1 });
            }}
          >
            {terrainRegions(model.width, model.height, model.ringCount).map((area) => (
              <rect
                key={area.region}
                x={area.x}
                y={area.y}
                width={area.width}
                height={area.height}
                fill={terrainColor(area.region, model.ringCount)}
              >
                <title>{area.region}</title>
              </rect>
            ))}
          </g>
        )}
        {(model.tiles ?? []).map(({ x, y }) => {
          const known = sight?.get(`${x},${y}`);
          const unseen = sight && !known;
          const region = regionAt(x, y, model.width, model.height, model.ringCount);
          // Known-tile territory tints use only signs this observer already knows.
          const tinted = territories && known && !unseen ? marked.get(`${x},${y}`) : undefined;
          return (
            <g key={`${x},${y}`}>
              <rect
                x={x}
                y={model.height - y - 1}
                width="1"
                height="1"
                fill={
                  unseen
                    ? '#263e38'
                    : known?.remembered
                      ? '#697367'
                      : terrainColor(region, model.ringCount)
                }
                stroke="#4e6959"
                strokeWidth=".025"
                onClick={() => setTile({ x, y })}
              >
                <title>{`(${x}, ${y}) · ${unseen ? 'unseen' : known?.remembered ? `remembered at tick ${known.seenTick}` : region}`}</title>
              </rect>
              {tinted && (
                <g className="territory-tint" pointerEvents="none">
                  {tintRect(tinted, x, y)}
                </g>
              )}
            </g>
          );
        })}
        <rect width={model.width} height={model.height} fill="url(#grass)" pointerEvents="none" />
        {territories && !model.tiles && (
          <g
            className="territory-overlays"
            pointerEvents="none"
            aria-label="Public territorial claims, enforced by citizens"
          >
            {(model.claims ?? []).map((claim) => {
              const [x0, y0, x1, y1] = claim.areas;
              const owner = model.citizens.find(
                (citizen) => citizen.value.id === claim.ownerId,
              )?.value;
              return (
                <g
                  key={claim.id}
                  data-testid={`claim-${claim.id}`}
                  style={{ color: owner?.color || '#ead085' }}
                >
                  <title>{`${
                    claimAlliance(claim, alliances)
                      ? `Alliance ${claimAlliance(claim, alliances)!.name} (${claimAlliance(
                          claim,
                          alliances,
                        )!
                          .members.map(
                            (id) => model.citizens.find((c) => c.value.id === id)?.value.name ?? id,
                          )
                          .join(', ')})`
                      : owner?.name || claim.ownerId
                  }: ${claim.stance} ${claim.resource} claim${claim.accessPrice ? `, ${claim.accessPrice} gold access demand` : ''}. Announced demand; citizens can trespass. Expires tick ${claim.expiresTick}.`}</title>
                  <rect
                    x={x0 + 0.06}
                    y={model.height - y1 - 0.94}
                    width={x1 - x0 + 0.88}
                    height={y1 - y0 + 0.88}
                  />
                </g>
              );
            })}
          </g>
        )}
        {territories && !model.tiles && (
          <g pointerEvents="none" aria-label="Contested rival claim overlaps">
            {overlaps.map(({ a, b, area: [x0, y0, x1, y1] }) => (
              <rect
                key={`${a.id}-${b.id}`}
                data-testid="contested-overlap"
                x={x0}
                y={model.height - y1 - 1}
                width={x1 - x0 + 1}
                height={y1 - y0 + 1}
                fill="url(#contested)"
              >
                <title>
                  Contested rival claims: {a.ownerId} ↔ {b.ownerId}; not confirmed combat
                </title>
              </rect>
            ))}
          </g>
        )}
        {resources && (
          <g className="resource-overlay" pointerEvents="none" aria-label="Known resource stock">
            {model.deposits.map(({ value: deposit, remembered }) => (
              <g key={deposit.id} transform={point(deposit)} opacity={remembered ? 0.35 : 1}>
                <circle
                  r=".44"
                  fill={
                    deposit.resource === 'food'
                      ? '#f4cd7b'
                      : deposit.resource === 'wood'
                        ? '#65c8a6'
                        : '#b7a8ed'
                  }
                  fillOpacity={deposit.stock ? 0.2 : 0.05}
                  stroke={deposit.stock ? '#fff1c2' : '#725a49'}
                  strokeWidth=".035"
                />
              </g>
            ))}
          </g>
        )}
        {territories && !model.tiles && !!marked.size && (
          <g
            className="territory-overlays territory-tiles"
            pointerEvents="none"
            aria-label="Marked territory tiles colored by owner membership"
          >
            {[...marked.entries()].map(([key, territory]) => (
              <g key={key} data-testid={`territory-tile-${key}`}>
                {tintRect(territory, Number(key.split(',')[0]), Number(key.split(',')[1]))}
              </g>
            ))}
          </g>
        )}
        <g
          className="work-areas"
          pointerEvents="none"
          aria-label="Selected citizen work areas, not ownership"
        >
          {areas.map(([x0, y0, x1, y1], index) => (
            <g key={index} data-testid={`work-area-${index + 1}`}>
              <title>{`Work area ${index + 1}: (${x0}, ${y0})–(${x1}, ${y1}). Work area, not ownership; transit unrestricted`}</title>
              <rect x={x0} y={model.height - y1 - 1} width={x1 - x0 + 1} height={y1 - y0 + 1} />
              <text x={x0 + 0.12} y={model.height - y1 - 0.7}>
                #{index + 1}
              </text>
            </g>
          ))}
        </g>
        {own?.action && !model.tiles && (
          <g
            className="route"
            fill="none"
            stroke="#f9e7a2"
            strokeWidth=".07"
            strokeDasharray=".13 .12"
          >
            <polyline
              points={[own, ...own.action.path]
                .map((p) => {
                  const s = screenPoint(p, model.height);
                  return `${s.x},${s.y}`;
                })
                .join(' ')}
            />
            <circle transform={point(own.action.target)} r=".43" />
            <title>Intended route, not completed movement</title>
          </g>
        )}
        {model.deposits.map(({ value: d, remembered, seenTick }) => (
          <g
            key={d.id}
            transform={point(d)}
            data-entity-id={d.id}
            className={remembered ? 'remembered' : ''}
            {...selectable(d, `Inspect ${d.resource} deposit ${d.id}`)}
          >
            <title>{`${d.resource} T${d.tier} · stock ${d.stock}${remembered ? ` · last seen tick ${seenTick}` : ''}`}</title>
            <ellipse cy=".28" rx=".35" ry=".1" fill="#243a2e" opacity=".25" />
            {d.resource === 'wood' ? (
              <>
                <path d="M-.05 .3v-.55" stroke="#775139" strokeWidth=".13" />
                <path
                  d="M0-.55L-.36 .02H.36ZM0-.3l-.3 .45h.6Z"
                  fill={d.stock ? '#315b40' : '#818877'}
                  stroke="#254537"
                  strokeWidth=".04"
                />
              </>
            ) : d.resource === 'food' ? (
              <>
                <path
                  d="M-.34 .17Q-.4-.26-.1-.14Q.12-.4.32-.1L.35 .2Z"
                  fill={d.stock ? '#527946' : '#858b6d'}
                />
                <g fill={d.stock ? '#bb644d' : '#6e755c'}>
                  <circle cx="-.18" cy=".03" r=".08" />
                  <circle cx=".1" cy="-.05" r=".09" />
                  <circle cx=".25" cy=".12" r=".07" />
                </g>
              </>
            ) : (
              <>
                <path
                  d="M-.22 .27l.06-.55M0 .27v-.66M.2 .27l-.04-.6"
                  stroke="#5e7450"
                  strokeWidth=".06"
                />
                <g fill={d.stock ? '#ede0b3' : '#8d967c'}>
                  <ellipse cx="-.16" cy="-.27" rx=".09" ry=".15" />
                  <ellipse cy="-.39" rx=".09" ry=".15" />
                  <ellipse cx=".16" cy="-.3" rx=".09" ry=".15" />
                </g>
              </>
            )}
            <text x=".24" y=".34" className="tier">
              {d.tier}
            </text>
          </g>
        ))}
        {model.buildings.map(({ value: b, remembered, seenTick }) => (
          <g
            key={b.id}
            transform={point(b)}
            data-entity-id={b.id}
            className={`${remembered ? 'remembered' : ''} ${b.ownerId === selected ? 'owned' : ''}`}
            {...selectable(b, `Inspect ${b.kind} ${b.id}`)}
          >
            <title>{`${b.kind} T${b.tier} · ${b.health}/${b.maxHealth} health${remembered ? ` · last seen tick ${seenTick}` : ''}`}</title>
            {b.kind === 'wall' ? (
              <>
                <rect
                  x="-.43"
                  y="-.32"
                  width=".86"
                  height=".64"
                  rx=".04"
                  fill="#8b9187"
                  stroke="#485d52"
                  strokeWidth=".06"
                />
                <path d="M-.4 0h.8M0-.3v.3M-.2 0v.3M.23 0v.3" stroke="#536659" strokeWidth=".04" />
              </>
            ) : (
              <>
                <rect
                  x="-.37"
                  y="-.22"
                  width=".74"
                  height=".55"
                  fill="#a57951"
                  stroke="#584c39"
                  strokeWidth=".05"
                />
                <path d="M-.45-.2L0-.48l.45 .28Z" fill="#65544a" />
                {b.kind === 'spinning-wheel' ? (
                  <g stroke="#efe0b5" strokeWidth=".045">
                    <circle cy=".08" r=".19" fill="none" />
                    <path d="M-.19 .08h.38M0-.11v.38M-.14-.06l.28 .28M-.14 .22l.28-.28" />
                  </g>
                ) : b.kind === 'lumbermill' ? (
                  <>
                    <path d="M-.25 .17h.5" stroke="#e0ba75" strokeWidth=".15" />
                    <path
                      d="M-.15-.03l.04 .08 .06-.08 .06 .08 .06-.08"
                      stroke="#e8dfc2"
                      fill="none"
                      strokeWidth=".04"
                    />
                  </>
                ) : (
                  <>
                    <path d="M-.18 .1h.38v-.16h-.28Z" fill="#ddd8bc" />
                    <path d="M-.18 .1v.15" stroke="#594636" strokeWidth=".07" />
                  </>
                )}
              </>
            )}
            <text x=".25" y=".32" className="tier">
              {b.tier}
            </text>
          </g>
        ))}
        {(model.houses ?? []).length > 0 &&
          (model.houses ?? []).map(({ value: h, remembered, seenTick }) => (
            <g
              key={h.id}
              transform={point(h)}
              data-entity-id={h.id}
              className={`scene-house ${remembered ? 'remembered' : ''} ${h.ownerId === selected ? 'owned' : ''}`}
              {...selectable(h, `Inspect house ${h.id}`)}
            >
              <title>{`House of ${citizenName(h.ownerId ?? 'none')} · T${h.tier} · ${h.health}/${h.maxHealth} health${remembered ? ` · last seen tick ${seenTick}` : ''}`}</title>
              <rect
                x="-.34"
                y="-.24"
                width=".68"
                height=".54"
                fill="#9d7b52"
                stroke="#54463a"
                strokeWidth=".05"
              />
              <path d="M-.42-.24L0-.5l.42 .26Z" fill={houseOwnerColor(h.ownerId)} stroke="#54463a" strokeWidth=".04" />
              <path d="M-.13 .3v-.2h.26v.2" fill="#4b382a" />
            </g>
          ))}
        {(model.signs ?? []).length > 0 &&
          (model.signs ?? []).map(({ value: s, remembered, seenTick }) => {
            const territory = signTerritory(s.territoryId);
            const owner = territory ? labelTerritory(territory) : s.territoryId;
            return (
              <g
                key={s.id}
                transform={point(s)}
                data-entity-id={s.id}
                className={`territory-sign ${remembered ? 'remembered' : ''}`}
                {...selectable(s, `Inspect territory sign ${s.id}`)}
              >
                <title>{`Territory sign of ${owner} · marked tile, membership authoritative in signs · T${s.woodTier} wood · ${s.health}/${s.maxHealth} health${remembered ? ` · last seen tick ${seenTick}` : ''}`}</title>
                <path d="M0 .32v-.44" stroke="#775139" strokeWidth=".09" />
                <rect
                  x="-.17"
                  y="-.44"
                  width=".34"
                  height=".25"
                  rx=".04"
                  fill={territory ? ownerColor(territory) : '#ead085'}
                  stroke="#3f4a3a"
                  strokeWidth=".045"
                />
              </g>
            );
          })}
        {model.loot.map(({ value: l, remembered }) => (
          <g
            key={l.id}
            transform={point(l)}
            className={remembered ? 'remembered' : ''}
            data-entity-id={l.id}
          >
            <title>{`Body / loot: ${l.citizenName}`}</title>
            <ellipse rx=".28" ry=".13" fill="#746351" />
            <path d="M-.18 0h.36M0-.1v.2" stroke="#ddd3b0" strokeWidth=".05" />
          </g>
        ))}
        {model.citizens
          .filter((c) => !c.remembered && c.value.construction)
          .map(({ value: c }) => (
            <g
              key={`construction-${c.id}`}
              transform={point(c.construction!)}
              className="construction"
            >
              <rect
                x="-.43"
                y="-.43"
                width=".86"
                height=".86"
                fill="#e8d5a4"
                fillOpacity=".3"
                stroke="#f4ddb0"
                strokeWidth=".06"
                strokeDasharray=".12 .1"
              />
              <path d="M-.3 .25l.6-.5M-.3-.25l.6 .5" stroke="#916e42" strokeWidth=".07" />
              <title>{`In-progress ${c.construction!.kind} site · not completed`}</title>
            </g>
          ))}
        {territories && !model.tiles && (
          <g className="territory-labels" pointerEvents="none">
            {(model.claims ?? [])
              .filter(
                (claim) =>
                  allClaims ||
                  claim.ownerId === selected ||
                  claimAlliance(claim, alliances)?.members.includes(selected),
              )
              .map((claim) => {
                const owner = model.citizens.find(
                  (citizen) => citizen.value.id === claim.ownerId,
                )?.value;
                return (
                  <text
                    key={claim.id}
                    x={claim.areas[0] + 0.2}
                    y={
                      model.height -
                      claim.areas[3] -
                      0.65 +
                      (claimLabelRows.get(claim.id) ?? 0) * 0.23
                    }
                  >
                    {claimAlliance(claim, alliances)
                      ? `Alliance ${claimAlliance(claim, alliances)!.name}`
                      : owner?.name || claim.ownerId}{' '}
                    · {claim.stance === 'toll' ? `${claim.accessPrice}g` : claim.stance}
                  </text>
                );
              })}
          </g>
        )}
        <g
          className="interaction-links"
          pointerEvents="none"
          aria-label="Current combat and reproduction actions"
        >
          {attacks &&
            combat.map(({ value: citizen }) => {
              const target =
                live.get(citizen.attackTargetId!) ??
                model.buildings.find(
                  (building) =>
                    !building.remembered && building.value.id === citizen.attackTargetId,
                )?.value;
              if (!target) return null;
              const a = screenPoint(citizen, model.height),
                b = screenPoint(target, model.height);
              return (
                <g key={citizen.id} className="combat-link" data-testid={`combat-${citizen.id}`}>
                  <title>{`${citizen.name} is ${citizen.activity === 'walking' ? 'pursuing' : 'attacking'} ${'name' in target ? target.name : target.id}. Current confirmed positions.`}</title>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    markerEnd="url(#attack-arrow)"
                    strokeDasharray={citizen.activity === 'walking' ? '.15 .1' : undefined}
                  />
                  <text x={(a.x + b.x) / 2 + 0.16} y={(a.y + b.y) / 2 - 0.2}>
                    ⚔
                  </text>
                </g>
              );
            })}
          {model.citizens
            .filter(({ value, remembered }) => !remembered && value.partnerId)
            .map(({ value: citizen }) => {
              const partner = live.get(citizen.partnerId!);
              if (!partner || citizen.id.localeCompare(partner.id) > 0) return null;
              const a = screenPoint(citizen, model.height),
                b = screenPoint(partner, model.height);
              return (
                <g key={`family-${citizen.id}`} className="family-link">
                  <title>{`${citizen.name} and ${partner.name}: reproduction in progress`}</title>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 0.65}>
                    ♡
                  </text>
                </g>
              );
            })}
        </g>
        {!model.tiles && (
          <g className="event-markers" pointerEvents="none" aria-label="Recorded event locations">
            {consequential
              .filter((event) => eventPoint(event, model.width, model.height))
              .slice(0, 5)
              .map((event) => (
                <g
                  key={event.id}
                  className={`event-marker event-${event.kind}`}
                  transform={point(eventPoint(event, model.width, model.height)!)}
                  data-testid={`event-marker-${event.id}`}
                >
                  <title>{`${storyKinds[event.kind]!.label} at tick ${event.tick}: ${event.text}. Recorded location.`}</title>
                  <circle r=".63" />
                  <text y="-.65">{storyKinds[event.kind]!.icon}</text>
                </g>
              ))}
            {consequential
              .filter((event) => event.kind === 'trade')
              .slice(0, 2)
              .flatMap((event) =>
                [event.citizenId, event.targetId].map((id) => {
                  const citizen = id && live.get(id);
                  return citizen ? (
                    <g
                      key={`${event.id}-${id}`}
                      transform={point(citizen)}
                      className="trade-marker"
                    >
                      <title>{`Remote trade at tick ${event.tick}; ${citizen.name}'s current position, not a meeting or shipment.`}</title>
                      <text y="-.85">⇄</text>
                    </g>
                  ) : null;
                }),
              )}
          </g>
        )}
        {model.citizens.map(({ value: c, remembered, seenTick }) => {
          const offset = occupantOffset(
            c.id,
            model.citizens
              .filter((v) => v.value.x === c.x && v.value.y === c.y)
              .map((v) => v.value),
          );
          const pos = screenPoint(c, model.height);
          return (
            <g
              key={c.id}
              className={`citizen ${remembered ? 'remembered' : ''} ${hits.includes(c.id) ? 'damaged' : ''}`}
              style={{ transform: `translate(${pos.x + offset.x}px, ${pos.y + offset.y}px)` }}
              data-entity-id={c.id}
              data-testid={`citizen-${c.id}`}
              role="button"
              tabIndex={0}
              aria-label={`Select ${c.name}${remembered ? `, remembered tick ${seenTick}` : `, ${c.activity}`}`}
              onDoubleClick={() => {
                if (!remembered && focusCitizen) {
                  setManual(false);
                  focusCitizen(c.id);
                }
              }}
              onClick={() => {
                manualCamera();
                select(c.id);
                setTile({ x: c.x, y: c.y });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  manualCamera();
                  select(c.id);
                }
              }}
            >
              <title>{`${c.name} · (${c.x}, ${c.y}) · ${remembered ? `last seen tick ${seenTick}` : c.activity}`}</title>
              <ellipse
                className="focus-ring"
                cy="-.04"
                rx=".36"
                ry=".45"
                stroke="#fff2ba"
                fill="none"
                strokeWidth=".055"
              />
              <ellipse cy=".31" rx=".22" ry=".075" fill="#1d332b" opacity=".35" />
              {!remembered && territories && allyMembership.has(c.id) && (
                <circle
                  r=".39"
                  fill="none"
                  stroke={
                    model.citizens.find(
                      (citizen) => citizen.value.id === allyMembership.get(c.id)!.members[0],
                    )?.value.color || '#aed6e4'
                  }
                  strokeWidth=".045"
                  strokeDasharray=".08 .08"
                >
                  <title>{allyMembership.get(c.id)!.name}</title>
                </circle>
              )}
              {c.id === selected && (
                <ellipse
                  cy=".28"
                  rx=".32"
                  ry=".13"
                  stroke="#fff2ba"
                  fill="none"
                  strokeWidth=".055"
                />
              )}
              <g transform={`scale(${c.facing || 1} 1)`}>
                <g
                  className={!remembered && c.alive ? `sprite activity-${c.activity}` : 'sprite'}
                  opacity={c.alive ? 1 : 0.5}
                >
                  <path
                    className="legs"
                    d="M-.075 .1l-.06 .2M.075 .1l.06 .2"
                    stroke="#34463f"
                    strokeWidth=".09"
                    strokeLinecap="round"
                  />
                  <path
                    d="M-.16-.06Q0-.15.16-.06L.13 .15h-.26Z"
                    fill={citizenColor(c)}
                    stroke="#334b41"
                    strokeWidth=".03"
                  />
                  <path
                    className="arm"
                    d="M.13-.02l.14 .08"
                    stroke="#e4ba8a"
                    strokeWidth=".07"
                    strokeLinecap="round"
                  />
                  <g className="tool" stroke="#684e35" strokeWidth=".045">
                    <path d="M.25 .1l.06-.33" />
                    <path d="M.29-.2l.13 .035-.06 .09-.08-.02Z" fill="#ddd9bc" />
                  </g>
                  <circle cy="-.22" r=".125" fill="#e2b88b" />
                  <path d="M-.12-.23Q-.13-.4.12-.25L.1-.2Q0-.32-.12-.23" fill="#4d4031" />
                  <circle cx=".055" cy="-.21" r=".014" fill="#343c32" />
                </g>
              </g>
              {!remembered && (
                <>
                  <rect x="-.22" y="-.49" width=".44" height=".045" fill="#4d5546" />
                  <rect
                    x="-.22"
                    y="-.49"
                    width={(Math.max(0, Math.min(100, c.health)) / 100) * 0.44}
                    height=".045"
                    fill="#d8eda0"
                  />
                  {c.progress !== undefined && (
                    <>
                      <rect x="-.22" y=".39" width=".44" height=".04" fill="#455744" />
                      <rect
                        x="-.22"
                        y=".39"
                        width={c.progress * 0.44}
                        height=".04"
                        fill="#ffdb80"
                      />
                    </>
                  )}
                  {c.thinking && (
                    <text y="-.59" className="thought">
                      ···
                    </text>
                  )}
                  {c.fullness !== undefined && c.fullness < 20 && (
                    <text x=".35" y="-.4" className="hunger-marker">
                      <title>Low fullness: under 20 / 100</title>!
                    </text>
                  )}
                </>
              )}
              {labels && (
                <text y=".61" className="nameplate">
                  {c.name}
                  {remembered ? ' ◷' : ''}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <SpeechOverlay svg={svg} model={model} messages={messages} selected={selected} />
      {watch && own && own.id === selected && !model.tiles && (
        <CitizenMotivation citizen={own} thinking={!!chosen?.thinking} />
      )}
      {focused && location && (
        <div className={`camera-caption story-${focused.kind}`} data-testid="camera-caption">
          <b>{storyKinds[focused.kind]?.label ?? focused.kind}</b> · tick {focused.tick} · recorded
          ({location.x}, {location.y})
        </div>
      )}
      {cinematic && (
        <Tooltip content="Return to the full world overview. The inset shows confirmed current citizen positions and the camera frame; it never advances the world.">
          <button className="scene-overview" aria-label="Show world overview" onClick={fit}>
            <svg
              viewBox={`0 0 ${model.width} ${model.height}`}
              role="img"
              aria-label="World overview and current camera frame"
            >
              <rect width={model.width} height={model.height} fill="#4f6d50" />
              {model.citizens.map(({ value: citizen }) => (
                <circle
                  key={citizen.id}
                  cx={citizen.x + 0.5}
                  cy={model.height - citizen.y - 0.5}
                  r={citizen.id === selected ? 0.5 : 0.3}
                  fill={citizenColor(citizen)}
                />
              ))}
              <rect
                x={center.x - vw / 2}
                y={center.y - vh / 2}
                width={vw}
                height={vh}
                fill="#fff2a5"
                fillOpacity=".12"
                stroke="#fff2a5"
                strokeWidth=".25"
              />
            </svg>
            <span>Overview</span>
          </button>
        </Tooltip>
      )}
      {!!areas.length && (
        <div className="work-area-legend" aria-label="Work area legend">
          <span>Selected work areas · union, not claims</span>
          {areas.map(([x0, y0, x1, y1], index) => (
            <Tooltip
              key={index}
              content={`Work area ${index + 1}: (${x0}, ${y0})–(${x1}, ${y1}), inclusive. Work area, not ownership; transit unrestricted`}
            >
              <span tabIndex={0}>#{index + 1}</span>
            </Tooltip>
          ))}
        </div>
      )}
      {!model.tiles && !compact && (
        <div className="map-layer-legend">
          {!!marked.size && <span>▩ Marked tiles and member clothing share territory colors · unaffiliated neutral grey</span>}
          <span>□ Claims: demands, not walls</span>
          <span>▨ Hatched: rival overlap</span>
          <span>→ Red arrows: active attack / pursuit</span>
          <span>⚔ Event rings: recent, not active</span>
          <span>
            {allClaims ? 'All claim labels' : 'Claim labels: selected citizen / alliance only'}
          </span>
        </div>
      )}
      {model.citizens.find(({ value }) => value.id === selected)?.value.territory && (
        <div className="map-layer-legend" aria-label="Selected territory membership">
          {(() => {
            const member = model.citizens.find(({ value }) => value.id === selected)!.value;
            return <span><span style={{ color: citizenColor(member) }}>●</span> {member.name}: {member.territory!.label} · {member.territory!.role}</span>;
          })()}
        </div>
      )}
      <div className="map-footer">
        <span id="map-navigation-help" className="map-navigation-help">
          {compact
            ? 'Drag to explore · scroll to zoom · select a citizen to see what they’re doing'
            : 'Drag / scroll · focus map: +/− zoom · F/Home fit · arrows/WASD pan · Shift faster · Esc stop Follow'}
        </span>
        <span>
          {territories && !model.tiles
            ? `Claims are demands; borders can be crossed${marked.size ? ' · marked tiles form territories of their members' : ''}`
            : 'Center / inner ring / outer ring'}
        </span>
      </div>
      {tile && (
        <div className="tile-inspector" data-testid="tile-inspector">
          <strong>
            Tile ({tile.x}, {tile.y})
          </strong>
          {occupants.length ? (
            occupants.map((c) => (
              <button key={c.value.id} onClick={() => select(c.value.id)}>
                {c.value.name}
                {c.remembered ? ` · tick ${c.seenTick}` : ''}
              </button>
            ))
          ) : (
            <span>No known occupants</span>
          )}
          {model.deposits
            .filter((d) => d.value.x === tile.x && d.value.y === tile.y)
            .map(({ value: d, remembered, seenTick }) => (
              <span key={d.id}>
                {d.resource} T{d.tier} · stock {d.stock} / {d.capacity}
                {remembered ? ` · last seen tick ${seenTick}` : d.stock === 0 ? ' · depleted' : ''}
              </span>
            ))}
          {model.buildings
            .filter((b) => b.value.x === tile.x && b.value.y === tile.y)
            .map(({ value: b, remembered, seenTick }) => (
              <span key={b.id}>
                {b.kind} T{b.tier} · {b.health}/{b.maxHealth} health · owner {b.ownerId || 'none'}
                {remembered ? ` · last seen tick ${seenTick}` : ''}
              </span>
            ))}
          {model.houses
            ?.filter((h) => h.value.x === tile.x && h.value.y === tile.y)
            .map(({ value: h, remembered, seenTick }) => (
              <span key={h.id}>
                House T{h.tier} · {h.health}/{h.maxHealth} health · owner {citizenName(h.ownerId ?? 'none')}
                {remembered ? ` · last seen tick ${seenTick}` : ''}
              </span>
            ))}
          {model.signs
            ?.filter((s) => s.value.x === tile.x && s.value.y === tile.y)
            .map(({ value: s, remembered, seenTick }) => (
              <span key={s.id}>
                Territory sign T{s.woodTier} wood · {s.health}/{s.maxHealth} health
                {remembered ? ` · last seen tick ${seenTick}` : ''}
              </span>
            ))}
          {tileTerritory && (
            <span data-testid="tile-territory">
              Marked territory of {labelTerritory(tileTerritory)} · selected is{' '}
              {membershipIn(tileTerritory, selected)} member
            </span>
          )}
        </div>
      )}
    </section>
  );
}
