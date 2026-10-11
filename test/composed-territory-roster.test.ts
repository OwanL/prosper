import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWorld } from '../src/world/core';
import { observe } from '../src/world/observation';
import { citizenColor, unaffiliatedColor, projectWorld, projectObservation } from '../src/ui/model';
import { CitizenRoster, resourceSummary, sortRoster } from '../src/ui/WorldActivity';
import { Inspector } from '../src/ui/CitizenInspector';

describe('territory roster', () => {
  it('projects stable membership colors without changing personal colors, and updates on departure/death', () => {
    const world = createWorld({ population: 2 });
    const [a, b] = Object.values(world.citizens);
    const personal = b.color;
    world.territories = { t: { id: 't', ownerId: a.id, createdTick: 0, members: {
      [a.id]: { citizenId: a.id, joinedTick: 0, sequence: 0 },
      [b.id]: { citizenId: b.id, joinedTick: 0, sequence: 1 },
    }, admissions: [] } };
    const members = projectWorld(world).citizens;
    expect(citizenColor(members[0].value)).toBe(citizenColor(members[1].value));
    expect(b.color).toBe(personal);
    const color = citizenColor(members[1].value);
    a.alive = false;
    world.territories.t.ownerId = b.id;
    delete world.territories.t.members[a.id];
    const successor = projectWorld(world).citizens[0].value;
    expect(citizenColor(successor)).toBe(color);
    expect(successor.territory?.label).toContain(b.name);
    const roster = renderToStaticMarkup(createElement(CitizenRoster, {
      citizens: projectWorld(world).citizens, selectedId: b.id, onSelect: () => {},
    }));
    const inspector = renderToStaticMarkup(createElement(Inspector, {
      citizen: b, territory: successor.territory, unavailable: true, cancel: () => {}, result: '',
    }));
    expect(roster).toContain(color);
    expect(roster).toContain('1 members');
    expect(inspector).toContain(color);
    expect(inspector).toContain(successor.territory!.label);
    expect(inspector).toContain('owner');
    delete world.territories.t.members[b.id];
    const unaffiliated = projectWorld(world).citizens.find(c => c.value.id === b.id)!.value;
    expect(unaffiliated.territory).toBeUndefined();
    expect(citizenColor(unaffiliated)).toBe(unaffiliatedColor);
    const neutral = renderToStaticMarkup(createElement(Inspector, {
      citizen: b, unavailable: true, cancel: () => {}, result: '',
    }));
    expect(neutral).toContain(unaffiliatedColor);
    expect(neutral).toContain('Unaffiliated · neutral grey');
    b.alive = false;
    expect(projectWorld(world).citizens.some(c => c.value.id === b.id)).toBe(false);
  });
  it('renders exact fractional gold, resources and unknown data, retaining selection', () => {
    const model = projectWorld(createWorld({ population: 2 }));
    model.citizens[0].value.gold = 1.125;
    model.citizens[0].value.resources = { 'wood:2': 3, 'food:1': 0.5 };
    model.citizens[1].value.gold = undefined;
    model.citizens[1].value.resources = undefined;
    expect(sortRoster(model.citizens, 'gold')[0].value.gold).toBe(1.125);
    const html = renderToStaticMarkup(createElement(CitizenRoster, {
      citizens: model.citizens, selectedId: model.citizens[0].value.id, onSelect: () => {},
    }));
    expect(html).toContain('1.125');
    expect(html).toContain('3.5');
    expect(html).toContain('wood T2');
    expect(html).toContain('unknown');
    expect(html).toContain('aria-pressed="true"');
  });
  it('summarizes identities across tiers while retaining fractions and known empty inventory', () => {
    expect(resourceSummary({ 'food:1': 0.5, 'food:2': 1.125, 'wood:1': 2, 'wood:3': 4, 'fibre:1': 0 }))
      .toEqual([['food', 1.625], ['wood', 6]]);
    const model = projectWorld(createWorld({ population: 2 }));
    model.citizens[0].value.resources = {};
    model.citizens[1].value.resources = undefined;
    const html = renderToStaticMarkup(createElement(CitizenRoster, {
      citizens: model.citizens, selectedId: null, onSelect: () => {},
    }));
    expect(html).toContain('Empty inventory · 0 resources');
    expect(html).toContain('Resources unknown');
  });
  it('sorts numeric holdings and membership with unknowns last and stable name ties', () => {
    const model = projectWorld(createWorld({ population: 3 }));
    const [a, b, c] = model.citizens;
    a.value.name = 'Ada'; b.value.name = 'Bram'; c.value.name = 'Cora';
    a.value.gold = 2; b.value.gold = 30; c.value.gold = 10;
    a.value.resources = { 'wood:2': 8, 'food:1': 0.5 };
    b.value.resources = { 'food:1': 1 }; c.value.resources = { 'fibre:1': 4 };
    b.value.territory = { id: 'alpha', ownerId: c.value.id, label: 'Alpha', color: 'red', role: 'member' };
    c.value.territory = { ...b.value.territory, role: 'owner' };
    const names = (sort: Parameters<typeof sortRoster>[1]) => sortRoster(model.citizens, sort).map(c => c.value.name);
    expect(names('gold')).toEqual(['Bram', 'Cora', 'Ada']);
    expect(names('resources')).toEqual(['Ada', 'Cora', 'Bram']);
    expect(names('membership')).toEqual(['Bram', 'Cora', 'Ada']);
    b.value.resources = undefined;
    expect(names('gold')).toEqual(['Cora', 'Ada', 'Bram']);
    expect(names('resources')).toEqual(['Ada', 'Cora', 'Bram']);
    expect(model.citizens.map(c => c.value.name)).toEqual(['Ada', 'Bram', 'Cora']);
  });
  it('does not project another citizen private holdings or recover a hidden roster', () => {
    const world = createWorld({ population: 2 });
    const [a] = Object.values(world.citizens);
    const observation = observe(world, a.id);
    const model = projectObservation(observation, world);
    for (const { value } of model.citizens) {
      if (value.id === a.id) expect(value.gold).toBe(a.gold);
      else { expect(value.gold).toBeUndefined(); expect(value.resources).toBeUndefined(); }
    }
    observation.visible = []; observation.remembered = [];
    expect(projectObservation(observation, world).citizens).toEqual([]);
  });
});
