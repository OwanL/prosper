import { describe, expect, it } from 'vitest';
import { startingCharacter } from '../src/world/characters.ts';
import { BALANCE } from '../src/world/config.ts';

const characters = () => Array.from({ length: 9 }, (_, index) => startingCharacter(index));

describe('initial character dispositions', () => {
  it('provides nine distinct, nonempty, bounded profiles and goal sets', () => {
    const profiles = characters();
    expect(new Set(profiles.map((profile) => profile.personality)).size).toBe(9);
    expect(new Set(profiles.map((profile) => JSON.stringify(profile.goals))).size).toBe(9);
    for (const profile of profiles) {
      expect(profile.personality.trim().length).toBeGreaterThan(100);
      expect(profile.personality.length).toBeLessThanOrEqual(800);
      expect(profile.goals.length).toBeGreaterThan(0);
      expect(profile.goals.length).toBeLessThanOrEqual(BALANCE.goalLimit);
      for (const goal of profile.goals) {
        expect(goal.trim().length).toBeGreaterThan(0);
        expect(goal.length).toBeLessThanOrEqual(BALANCE.goalLength);
      }
    }
  });

  it('maps Ada through Ivo deterministically and returns independently mutable copies', () => {
    const expectedDirections = [
      'Practical, protective',
      'Ambitious, status-conscious',
      'Curious, independent',
      'Bold, proud',
      'Sociable, persuasive',
      'Warm, resolute',
      'Patient, exacting',
      'Watchful, frugal',
      'Restless, generous',
    ];
    expectedDirections.forEach((direction, index) => {
      const first = startingCharacter(index);
      const second = startingCharacter(index);
      expect(first).toEqual(second);
      expect(first.personality.startsWith(direction)).toBe(true);
      expect(first).not.toBe(second);
      expect(first.goals).not.toBe(second.goals);
      first.personality = 'changed';
      first.goals.splice(0, first.goals.length, 'changed');
      expect(startingCharacter(index)).toEqual(second);
    });
  });

  it('includes varied survival, social, competitive and family aspirations, not action quotas', () => {
    const goals = characters().flatMap((profile) => profile.goals);
    expect(new Set(goals).size).toBe(goals.length);
    expect(goals.some((goal) => /food reserve/.test(goal))).toBe(true);
    expect(goals.some((goal) => /Explore useful work sites/.test(goal))).toBe(true);
    expect(goals.some((goal) => /negotiate prices/.test(goal))).toBe(true);
    expect(goals.some((goal) => /challenge actual intimidation/i.test(goal))).toBe(true);
    expect(goals.some((goal) => /reproduction/.test(goal))).toBe(true);
    expect(goals.some((goal) => /Exchange discoveries/.test(goal))).toBe(true);
    for (const goal of goals) expect(goal).not.toMatch(/\d|\bmust\b|\bquota\b/i);
  });

  it('explicitly rejects existing ties, invented disputes and assumed reproductive consent', () => {
    for (const profile of characters()) {
      expect(profile.personality).toContain(
        'no established friends, rivals, partner or family ties',
      );
      expect(profile.personality).toContain('judge disputes from observed evidence');
      expect(profile.personality).toContain('Desiring a family is not consent from either person');
      const text = `${profile.personality} ${profile.goals.join(' ')}`;
      expect(text).not.toMatch(/\b(Ada|Bram|Cora|Dara|Eli|Faye|Galen|Hana|Ivo)\b/);
      expect(text).not.toMatch(/\b(your|my) (wife|husband|child|rival|enemy|territory)\b/i);
    }
  });

  it('rejects unsupported indexes instead of silently assigning a different identity', () => {
    for (const index of [-1, 9, 0.5, NaN, Infinity]) {
      expect(() => startingCharacter(index)).toThrow(RangeError);
    }
  });
});
