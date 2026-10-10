import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Citizen, World } from '../src/shared/types';
import { Inspector } from '../src/ui/App';
import { Scene } from '../src/ui/Scene';
import { projectWorld } from '../src/ui/model';

function fixture() {
  const citizen = {
    id: 'citizen-ui',
    name: 'UI Citizen',
    x: 0,
    y: 0,
    alive: true,
    health: 100,
    fullness: 80,
    gold: 100,
    inventory: {},
    queue: [],
    memories: [],
    goals: [],
    personality: 'Patient',
    color: '#abcdef',
  } as unknown as Citizen;
  const world = {
    width: 10,
    height: 10,
    tick: 5,
    citizens: { [citizen.id]: citizen },
    deposits: {},
    buildings: {},
    loot: {},
  } as unknown as World;
  citizen.strategy = {
    id: 'strategy-ui',
    approvedTick: 1,
    reviewTick: 100,
    index: 0,
    status: 'active',
    progress: 2,
    lastProgressTick: 4,
    attempted: [],
    directives: [
      {
        type: 'gather',
        resource: 'wood',
        tier: 1,
        quantity: 5,
        areas: [
          [1, 2, 3, 4],
          [5, 0, 5, 0],
        ],
      },
    ],
  };
  return { world, citizen };
}

describe('directive UI', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));
  afterEach(() => vi.unstubAllGlobals());
  it('renders inclusive bottom-left rectangles without intercepting the map', () => {
    const { world, citizen } = fixture();
    const html = renderToStaticMarkup(
      createElement(Scene, {
        model: projectWorld(world),
        selected: citizen.id,
        select: () => {},
        follow: false,
        labels: true,
        running: false,
        own: citizen,
      }),
    );
    expect(html).toContain('pointer-events="none" aria-label="Selected citizen work areas');
    expect(html).toContain(`x="1" y="${world.height - 5}" width="3" height="3"`);
    expect(html).toContain(`x="5" y="${world.height - 1}" width="1" height="1"`);
    expect(html).toContain('Work area, not ownership; transit unrestricted');
  });
  it('shows an advisory when ongoing work keeps later directives waiting', () => {
    const { citizen } = fixture();
    const directive = citizen.strategy!.directives[0];
    if (directive.type === 'gather') delete directive.quantity;
    citizen.strategy!.directives.push({ type: 'explore', areas: [[1, 2, 3, 4]] });
    const html = renderToStaticMarkup(
      createElement(Inspector, { citizen, unavailable: false, cancel: () => {}, result: '' }),
    );
    expect(html).toContain('data-testid="directive-sequencing-warning"');
    expect(html).toContain('later directives wait');
    expect(citizen.strategy?.index).toBe(0);
  });
  it('does not show private areas when another citizen is selected', () => {
    const { world, citizen } = fixture();
    const html = renderToStaticMarkup(
      createElement(Scene, {
        model: { ...projectWorld(world), tiles: [] },
        selected: 'another',
        select: () => {},
        follow: false,
        labels: true,
        running: false,
        own: citizen,
      }),
    );
    expect(html).not.toContain('data-testid="work-area-1"');
    expect(html).not.toContain('Work area legend');
  });
  it('shows blocked strategy, bounded results, and emergency paused work', () => {
    const { citizen } = fixture();
    citizen.strategy!.status = 'blocked';
    citizen.strategy!.blockedReason = 'No known wood';
    citizen.emergency = {
      startedTick: 5,
      depositId: 'food-ui',
      outsideAreas: true,
      stage: 'gather',
    };
    citizen.directiveReceipts = Array.from({ length: 9 }, (_, i) => ({
      tick: i,
      strategyId: 'strategy-ui',
      index: 0,
      outcome: 'blocked' as const,
      message: `receipt-${i}`,
    }));
    const html = renderToStaticMarkup(
      createElement(Inspector, {
        citizen,
        unavailable: false,
        cancel: () => {},
        result: '',
      }),
    );
    expect(html).toContain('Blocked: No known wood');
    expect(html).toContain('Progress: 2 / 5 units');
    expect(html).toContain('Emergency feeding · active');
    expect(html).toContain('food-ui');
    expect(html).toContain('Paused directive: Gather wood T1');
    expect(html).toContain('Outside work areas: emergency exception only');
    expect(html).not.toContain('receipt-2');
    expect(html).toContain('receipt-3');
    expect(html).toContain('receipt-8');
    expect(html).not.toContain('disabled=""');
  });
});
