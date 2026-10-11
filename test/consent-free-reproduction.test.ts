import { describe, expect, it } from 'vitest';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { consentCommand, settleDeath } from '../src/world/life.ts';
import { BALANCE } from '../src/world/config.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';

function fixture() {
  const world = createWorld({ seed: 42, scenario: 'progression', autonomy: false });
  const [a, b, c] = Object.values(world.citizens);
  for (const citizen of [a, b, c]) {
    citizen.x = 1; citizen.y = 1;
    citizen.inventory = { [`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood };
  }
  const consent = (accept: boolean) => dispatch(world, a.id, { type: 'consent', partnerId: b.id, accept });
  const invitations = (id: string) => observe(world, id).alerts.filter((e) => e.familyInvitation);
  return { world, a, b, c, consent, invitations };
}

describe('ignored legacy family invitation compatibility', () => {
  it('gracefully rejects deprecated consent without recording new invitations',()=>{
    const {a,b,consent,invitations}=fixture();
    expect(consent(true).code).toBe('unsupported-command');expect(invitations(b.id)).toEqual([]);expect(a.consent).toEqual({});
  });
  it('ignores expired historical consent for reproduction',()=>{
    const {world,a,b}=fixture();a.consent[b.id]=1;b.consent[a.id]=1;world.tick=2;
    expect(dispatch(world,a.id,{type:'reproduce',partnerId:b.id}).ok).toBe(true);
  });
  it('refunds the living parent exactly once when a joint parent dies',()=>{
    const {world,a,b}=fixture();
    expect(dispatch(world,a.id,{type:'reproduce',partnerId:b.id}).ok).toBe(true);
    settleDeath(world,a.id);expect(b.inventory['food:1']).toBe(1);expect(b.action).toBeNull();
    settleDeath(world,a.id);expect(b.inventory['food:1']).toBe(1);
  });
  it('persists optional strict payloads and accepts historical events without them', () => {
    const { world, a, b } = fixture();
    // Construct a genuine historical payload using the retained legacy adapter.
    consentCommand(world,a,{type:'consent',partnerId:b.id,accept:true});
    const checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
    expect(validateCheckpoint(checkpoint).world.events.some((e) => e.familyInvitation)).toBe(true);
    const entry = world.events.find((e) => e.familyInvitation)!;
    const payload = entry.familyInvitation!;
    Object.assign(payload, { privateFood: 3 });
    expect(() => validateCheckpoint(checkpoint)).toThrow('Invalid checkpoint shape');
    delete (payload as unknown as Record<string, unknown>).privateFood;
    payload.expiresTick = -1;
    expect(() => validateCheckpoint(checkpoint)).toThrow('Invalid checkpoint shape');
    delete entry.familyInvitation;
    expect(() => validateCheckpoint(checkpoint)).not.toThrow();
  });
});
