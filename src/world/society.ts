import type { Citizen, Point, World } from '../shared/types.ts';
import type { Relationship, SocialEvidence, SocialSignal, TerritorialClaim } from '../shared/autonomy-types.ts';
import type { WorkRect } from '../shared/directive-types.ts';
import { distance, event, id, worldEventHistory } from '../shared/utils.ts';
import { BALANCE } from './config.ts';

export const inside = (point: Point, area: WorkRect) =>
  point.x >= area[0] && point.y >= area[1] && point.x <= area[2] && point.y <= area[3];
export const visibleCitizens = (world: World, citizen: Citizen) =>
  Object.values(world.citizens).filter((other) => other.alive && other.id !== citizen.id && distance(other, citizen) <= BALANCE.sightRadius);
export function relationship(citizen: Citizen, otherId: string): Relationship {
  const state = citizen.autonomy!;
  return state.relationships[otherId] ??= { trust: 0, grievance: 0, respect: 0, trades: 0, trespasses: 0, harm: 0, lastTick: 0 };
}
export function evidence(citizen: Citizen, entry: SocialEvidence): void {
  if (!citizen.autonomy) return;
  const entries = citizen.autonomy.evidence;
  // Repeated production/competition observations are a digest, not a transcript.
  const previous = entries.at(-1);
  if (previous?.kind === entry.kind && previous.otherId === entry.otherId && previous.text === entry.text && entry.tick - previous.tick < 120) {
    previous.tick = entry.tick;
    return;
  }
  entries.push(entry);
  if (entries.length > 24) {
    const omitted=entries.length-24;
    entries.splice(0,omitted);
    citizen.autonomy.evidenceOmitted=(citizen.autonomy.evidenceOmitted??0)+omitted;
  }
}
/** Typed content of an actual delivered local negotiation, never a peer-state query. */
export function deliverSignal(world:World,from:Citizen,to:Citizen,signal:Omit<SocialSignal,'from'|'tick'>):void {
  if(!to.autonomy)return;
  const signals=to.autonomy.signals??=[];
  signals.push({from:from.id,tick:world.tick,...signal});
  if(signals.length>24)signals.splice(0,signals.length-24);
  const sent=from.autonomy?.sentSignals;
  if(sent)sent[`${signal.kind}:${to.id}`]=world.tick;
}
export function allied(world: World, a: Citizen, bId: string): boolean {
  return !!world.alliances && Object.values(world.alliances).some((alliance) => alliance.members.includes(a.id) && alliance.members.includes(bId));
}
/** Membership is public; no private notebook or policy territory is merged. */
export function sharedClaim(world: World, citizen: Citizen): TerritorialClaim | undefined {
  return Object.values(world.claims ?? {}).find((claim) => claim.expiresTick > world.tick && (claim.ownerId === citizen.id || allied(world, citizen, claim.ownerId)));
}
/** Public claim authorization, never another citizen's private protection notebook. */
export function claimAllows(world: World, claim: TerritorialClaim, citizen: Citizen): boolean {
  return claim.expiresTick <= world.tick || claim.stance === 'open' || claim.ownerId === citizen.id || allied(world, citizen, claim.ownerId) || (claim.accessPermits?.[citizen.id] ?? 0) > world.tick;
}
function consolidateClaims(world: World, members: string[], departing?: string): void {
  const claims = Object.values(world.claims ?? {}).filter((claim) => members.includes(claim.ownerId) && claim.expiresTick > world.tick).sort((a,b) => a.createdTick-b.createdTick || a.id.localeCompare(b.id));
  const eligible = members.filter((member) => member !== departing && world.citizens[member]?.alive && !world.citizens[member].autonomy?.claimSuppressed);
  const retained = claims.find((claim) => eligible.includes(claim.ownerId)) ?? claims[0];
  for (const claim of claims) if (claim !== retained || !eligible.length) delete world.claims![claim.id];
  if (retained && eligible.length && !eligible.includes(retained.ownerId)) retained.ownerId = eligible[0];
}
export function observeSocialEvents(world: World, citizen: Citizen): void {
  const state = citizen.autonomy!;
  const previous = state.lastEventId;
  const recent = [];
  const firstRecent=Number(world.events[0]?.id.split('-').at(-1)??0);
  // Normal body ticks already read the recent ring. Only a real gap needs the
  // retained-story merge; sorting history for every citizen every tick is waste.
  const events=previous>=firstRecent?world.events:worldEventHistory(world);
  for (let i = events.length - 1; i >= 0; i--) {
    const entry = events[i];
    const sequence = Number(entry.id.split('-').at(-1));
    if (sequence <= previous) break;
    recent.push(entry);
  }
  for (const entry of recent.reverse()) {
    state.lastEventId = Math.max(state.lastEventId, Number(entry.id.split('-').at(-1)));
    const addressed = entry.audience?.includes(citizen.id);
    const witnessed = world.tick-entry.tick<=4&&entry.x !== undefined && entry.y !== undefined && distance(citizen, { x: entry.x, y: entry.y }) <= BALANCE.sightRadius;
    if (!addressed && !witnessed) continue;
    if (entry.kind === 'attack' && entry.citizenId && entry.citizenId !== citizen.id) {
      const rel = relationship(citizen, entry.citizenId);
      const harm = entry.targetId === citizen.id ? 28 : allied(world, citizen, entry.targetId ?? '') ? 18 : 3;
      rel.grievance = Math.min(100, rel.grievance + harm);
      rel.trust = Math.max(-100, rel.trust - harm);
      rel.harm += harm;
      rel.lastTick = world.tick;
      evidence(citizen, { tick: entry.tick, kind: 'attack', otherId: entry.citizenId, text: entry.text, x: entry.x, y: entry.y });
    } else if ((entry.kind === 'trade'||entry.kind==='help') && addressed) {
      const otherId = entry.citizenId === citizen.id ? entry.targetId : entry.citizenId;
      if (!otherId) continue;
      const rel = relationship(citizen, otherId);
      if(entry.kind==='trade')rel.trades++;
      rel.trust = Math.min(100, rel.trust + (entry.kind==='help'?16:9));
      rel.grievance = Math.max(0, rel.grievance - 3);
      rel.lastTick = world.tick;
      evidence(citizen, { tick: entry.tick, kind: entry.kind==='help'?'help':'trade', otherId, text: entry.text });
    }
  }
}
/** A visible completed harvest is evidence of competition, not remote telemetry. */
export function witnessHarvest(world: World, harvester: Citizen, deposit: Point & { resource: string; tier: number }): void {
  for (const witness of visibleCitizens(world, harvester)) {
    if (!witness.autonomy || allied(world, witness, harvester.id)) continue;
    const claim = Object.values(world.claims ?? {}).find((c) => (c.ownerId === witness.id || allied(world, witness, c.ownerId)) && inside(deposit, c.areas) && c.expiresTick > world.tick);
    if (claim && claimAllows(world, claim, harvester)) continue;
    if (!claim && witness.autonomy.policy.livelihood !== deposit.resource) continue;
    const competing = witness.action?.command.type === 'harvest' && distance(witness.action.target, deposit) === 0;
    if (!claim && !competing) continue;
    const rel = relationship(witness, harvester.id);
    rel.grievance = Math.min(100, rel.grievance + (claim ? 12 : 6));
    rel.trespasses += claim ? 1 : 0;
    rel.lastTick = world.tick;
    evidence(witness, { tick: world.tick, kind: claim ? 'trespass' : 'competition', otherId: harvester.id, text: `${harvester.name} harvested contested ${deposit.resource} T${deposit.tier} at (${deposit.x},${deposit.y}).`, x: deposit.x, y: deposit.y });
  }
}
export function claimTerritory(world: World, citizen: Citizen, area: WorkRect): TerritorialClaim {
  world.claims ??= {};
  const existing = sharedClaim(world, citizen);
  // Joining a compact gives access to its existing grounds, not another personal rectangle.
  if (existing && existing.ownerId !== citizen.id) return existing;
  const policy = citizen.autonomy!.policy;
  const claim: TerritorialClaim = { id: existing?.id ?? id(world, 'claim'), ...(existing?.accessPermits ? { accessPermits: existing.accessPermits } : {}), ownerId: citizen.id, areas: [...area], createdTick: existing?.createdTick ?? world.tick, expiresTick: world.tick + 2400, accessPrice: policy.accessPrice, stance: policy.stance === 'cooperative' ? 'open' : policy.accessPrice ? 'toll' : 'exclusive', resource: policy.livelihood };
  world.claims[claim.id] = claim;
  if (!existing || existing.areas.join() !== area.join()) event(world, 'claim', `${citizen.name} claims ${policy.livelihood} grounds (${area[0]},${area[1]})–(${area[2]},${area[3]}). ${claim.stance === 'open' ? 'Allies and visitors welcome.' : claim.stance === 'toll' ? `Access costs ${claim.accessPrice} gold; trespass risks force.` : 'Leave the resources alone or face force.'}`, { citizenId: citizen.id, x: citizen.x, y: citizen.y, audience: [citizen.id] });
  return claim;
}
export function formAlliance(world: World, a: Citizen, b: Citizen): void {
  if (allied(world, a, b.id)) return;
  world.alliances ??= {};
  const aAlliance=Object.values(world.alliances).find((alliance)=>alliance.members.includes(a.id));
  const bAlliance=Object.values(world.alliances).find((alliance)=>alliance.members.includes(b.id));
  if(aAlliance&&bAlliance&&aAlliance.id!==bAlliance.id)return;
  const existing = aAlliance??bAlliance;
  if(a.autonomy?.policy.rivals.some((rival)=>rival===b.id||existing?.members.includes(rival)))return;
  if((a.autonomy?.sentSignals?.['alliance-departure']??-10000)>world.tick-500)return;
  // Small local communities preserve competing interests; no universal mega guild.
  if (existing && existing.members.length >= 3) return;
  const alliance = existing ?? { id: id(world, 'alliance'), name: `${a.name}'s compact`, members: [], createdTick: world.tick, lastActiveTick: world.tick };
  alliance.members = [...new Set([...alliance.members, a.id, b.id])];
  alliance.lastActiveTick = world.tick;
  world.alliances[alliance.id] = alliance;
  consolidateClaims(world, alliance.members);
  for (const [member, other] of [[a,b], [b,a]]) {
    if (!member.autonomy) continue;
    const rel = relationship(member, other.id);
    rel.trust = Math.min(100, rel.trust + 12);
    evidence(member, { tick: world.tick, kind: 'alliance', otherId: other.id, text: `Joined ${alliance.name} for reciprocal access and defense.` });
  }
  event(world, 'alliance', `${a.name} and ${b.name} join ${alliance.name}: reciprocal access and mutual defense.`, { citizenId: a.id, targetId: b.id, x: a.x, y: a.y, audience: [a.id,b.id] });
}
/** A new explicit rivalry can renounce one's own pact, never expel its peers. */
export function renounceConflictingAlliances(world:World,citizen:Citizen):void {
  const state=citizen.autonomy;
  if(!state)return;
  for(const [allianceId,alliance] of Object.entries(world.alliances??{})) {
    if(!alliance.members.includes(citizen.id)||!alliance.members.some((member)=>state.policy.rivals.includes(member)))continue;
    const previous=[...alliance.members];
    consolidateClaims(world, previous, citizen.id);
    alliance.members=alliance.members.filter((member)=>member!==citizen.id);
    alliance.lastActiveTick=world.tick;
    if(alliance.members.length<2)delete world.alliances![allianceId];
    // Withdrawal also revokes one's outstanding proposals. A recipient must
    // not accept an old delivered offer and silently undo the newer policy.
    for(const recipient of Object.values(world.citizens))if(recipient.autonomy?.signals)recipient.autonomy.signals=recipient.autonomy.signals.filter((signal)=>signal.from!==citizen.id||signal.kind!=='alliance-offer');
    state.signals=state.signals?.filter((signal)=>signal.kind!=='alliance-offer'||!previous.includes(signal.from));
    state.sentSignals??={};state.sentSignals['alliance-departure']=world.tick;
    evidence(citizen,{tick:world.tick,kind:'alliance',text:`Renounced ${alliance.name} after explicitly naming a member as rival; other members keep their pact.`});
    event(world,'alliance',`${citizen.name} renounces ${alliance.name} over an explicit rivalry; reciprocal access and defense end.`,{citizenId:citizen.id,x:citizen.x,y:citizen.y,audience:previous});
  }
}
export function maintainSociety(world: World): void {
  // Transfer representatives before dead members are removed.
  for (const alliance of Object.values(world.alliances ?? {})) consolidateClaims(world, alliance.members);
  for (const [claimId, claim] of Object.entries(world.claims ?? {})) {
    if (claim.accessPermits) {
      for (const [visitorId, until] of Object.entries(claim.accessPermits)) if (until <= world.tick) delete claim.accessPermits[visitorId];
    }
    const owner = world.citizens[claim.ownerId];
    if (!owner?.alive || claim.expiresTick <= world.tick) delete world.claims![claimId];
  }
  for (const [allianceId, alliance] of Object.entries(world.alliances ?? {})) {
    alliance.members = alliance.members.filter((memberId) => world.citizens[memberId]?.alive);
    if (alliance.members.length < 2) delete world.alliances![allianceId];
  }
}
