import { useEffect, useRef, useState } from 'react';
import type { Citizen, Point } from '../shared/types';
import { occupantOffset, regionAt, screenPoint, type SceneModel } from './model';

export function Scene({
  model,
  selected,
  select,
  follow,
  labels,
  running,
  own,
}: {
  model: SceneModel;
  selected: string;
  select: (id: string) => void;
  follow: boolean;
  labels: boolean;
  running: boolean;
  own?: Citizen;
}) {
  const [zoom, setZoom] = useState(1);
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
  const drag = useRef<{ x: number; y: number; pan: Point } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const chosen = model.citizens.find((c) => c.value.id === selected && !c.remembered)?.value;
  const center =
    follow && chosen
      ? screenPoint(chosen, model.height)
      : { x: model.width / 2 + pan.x, y: model.height / 2 + pan.y };
  const vw = model.width / zoom,
    vh = model.height / zoom;
  const vp = `${center.x - vw / 2} ${center.y - vh / 2} ${vw} ${vh}`;
  const point = (p: Point) => {
    const s = screenPoint(p, model.height);
    return `translate(${s.x} ${s.y})`;
  };
  const sight = model.tiles && new Map(model.tiles.map((t) => [`${t.x},${t.y}`, t]));
  const occupants = tile
    ? model.citizens.filter((c) => c.value.x === tile.x && c.value.y === tile.y)
    : [];
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
    <section className="scene-shell" aria-label="World map">
      <div className="map-toolbar">
        <span>◈ {model.tiles ? 'Citizen knowledge · dated sightings' : 'Spectator truth'}</span>
        <div>
          <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.75, z / 1.3))}>
            −
          </button>
          <button
            aria-label="Reset map view"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Fit
          </button>
          <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(5, z * 1.3))}>
            +
          </button>
        </div>
      </div>
      <svg
        ref={svg}
        className={`world-scene ${running ? 'running' : 'paused'}`}
        viewBox={vp}
        role="group"
        aria-label="Top-down world; north is up, origin is bottom-left"
        data-testid="world-scene"
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-entity-id]')) return;
          drag.current = { x: e.clientX, y: e.clientY, pan };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || follow) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = Math.min(rect.width / vw, rect.height / vh);
          setPan({
            x: drag.current.pan.x - (e.clientX - drag.current.x) / scale,
            y: drag.current.pan.y - (e.clientY - drag.current.y) / scale,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <pattern id="grass" width="1" height="1" patternUnits="userSpaceOnUse">
            <path
              d="M.1 .8l.05-.1m.5-.3l.04-.08"
              stroke="#6e8963"
              strokeWidth=".025"
              opacity=".5"
            />
          </pattern>
        </defs>
        <rect width={model.width} height={model.height} fill="#263e38" />
        {Array.from({ length: model.width * model.height }, (_, i) => {
          const x = i % model.width,
            y = Math.floor(i / model.width);
          const known = sight?.get(`${x},${y}`);
          const unseen = sight && !known;
          return (
            <rect
              key={i}
              x={x}
              y={model.height - y - 1}
              width="1"
              height="1"
              fill={
                unseen
                  ? '#263e38'
                  : known?.remembered
                    ? '#697367'
                    : regionAt(x, y, model.width, model.height) === 'center'
                      ? '#b7b384'
                      : regionAt(x, y, model.width, model.height) === 'ring1'
                        ? '#9ca97a'
                        : '#83966b'
              }
              stroke="#4e6959"
              strokeWidth=".025"
              onClick={() => setTile({ x, y })}
            >
              <title>{`(${x}, ${y}) · ${unseen ? 'unseen' : known?.remembered ? `remembered at tick ${known.seenTick}` : regionAt(x, y, model.width, model.height)}`}</title>
            </rect>
          );
        })}
        <rect width={model.width} height={model.height} fill="url(#grass)" pointerEvents="none" />
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
        {model.loot.map(({ value: l, remembered }) => (
          <g
            key={l.id}
            transform={point(l)}
            className={remembered ? 'remembered' : ''}
            data-entity-id={l.id}
          >
            <title>Body / loot: {l.citizenName}</title>
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
              <title>In-progress {c.construction!.kind} site · not completed</title>
            </g>
          ))}
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
              onClick={() => {
                select(c.id);
                setTile({ x: c.x, y: c.y });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(c.id);
                }
              }}
            >
              <title>
                {c.name} · ({c.x}, {c.y}) · {remembered ? `last seen tick ${seenTick}` : c.activity}
              </title>
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
                    fill={c.color || '#c3985d'}
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
      <div className="map-footer">
        <span>↑ North · (0, 0) bottom-left · drag to pan</span>
        <span>Center / inner ring / outer ring</span>
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
        </div>
      )}
    </section>
  );
}
