import { reportLocation } from './knowledge.mjs';

export const FAMILY_TTL = 1800;
const ACTIVE = new Set(['pending', 'accepted']);
const person = (world, id) => world.citizens.find(c => c.id === id && c.alive && c.adult);
const fail = reason => ({ ok: false, reason });
const involved = (proposal, id) => proposal.makerId === id || proposal.recipientId === id;

function announce(world, proposal, text, effects = {}) {
  for (const id of [proposal.makerId, proposal.recipientId]) {
    const citizen = person(world, id);
    if (!citizen) continue;
    citizen.familyRevision = (citizen.familyRevision ?? 0) + 1;
    citizen.familyUpdatedAt = world.tick;
    citizen.replanReason = 'family proposal updated';
    effects.event?.(text, id);
  }
}

export function familyContext(world, citizenId) {
  const priority = p => p.status === 'accepted' ? 2 : p.status === 'pending' ? 1 : 0;
  return (world.familyProposals ?? []).filter(p => involved(p, citizenId))
    .filter(p => ACTIVE.has(p.status) || world.tick - (p.updatedAt ?? p.createdAt) < FAMILY_TTL)
    .sort((a, b) => priority(b) - priority(a) || (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .slice(0, 6).map(p => ({ ...p }));
}

export function acceptedFamily(world, a, b) {
  return (world.familyProposals ?? []).find(p => p.status === 'accepted' && p.expiresAt > world.tick
    && involved(p, a) && involved(p, b) && a !== b);
}

export function resolveFamily(world, citizen, task, effects = {}) {
  if (!person(world, citizen.id)) return fail('family decisions require a living adult');
  const required = task.type === 'propose_family' ? ['type', 'target'] : ['type', 'proposal'];
  const optional = ['propose_family', 'accept_family'].includes(task.type) ? ['location'] : [];
  if (!['propose_family', 'accept_family', 'decline_family', 'cancel_family'].includes(task.type)
      || required.some(key => !Object.hasOwn(task, key))
      || Object.keys(task).some(key => !required.includes(key) && !optional.includes(key))) return fail('family decision has invalid fields');
  if (task.location !== undefined && typeof task.location !== 'boolean') return fail('location must be boolean');
  const proposals = world.familyProposals ?? [];
  if (task.type === 'propose_family') {
    const recipient = person(world, task.target);
    if (!recipient || recipient.id === citizen.id) return fail('proposal requires a distinct living adult');
    if (proposals.some(p => p.status === 'accepted' && p.expiresAt > world.tick && involved(p, citizen.id))) return fail('cancel the accepted proposal before proposing another partner');
    if (!Number.isSafeInteger(world.tick + FAMILY_TTL)) return fail('proposal expiry would overflow');
    const number = world.nextFamilyId ?? 1;
    if (!Number.isSafeInteger(number) || number < 1 || number === Number.MAX_SAFE_INTEGER) return fail('proposal ID would overflow');
    const id = `family-${number}`;
    if (proposals.some(p => p.id === id)) return fail('proposal ID already exists');
    const closed = proposals.filter(p => !ACTIVE.has(p.status));
    if (proposals.length >= 32 && !closed.length) return fail('family proposal history is full');
    const prior = proposals.find(p => p.makerId === citizen.id && ACTIVE.has(p.status));
    if (prior) {
      prior.status = 'cancelled'; prior.updatedAt = world.tick;
      announce(world, prior, `Family proposal ${prior.id} was cancelled by its sender.`, effects);
    }
    if (proposals.length >= 32) proposals.splice(proposals.indexOf(closed[0]), 1);
    const proposal = { id, makerId: citizen.id, recipientId: recipient.id, status: 'pending', createdAt: world.tick, updatedAt: world.tick, expiresAt: world.tick + FAMILY_TTL };
    world.familyProposals = proposals;
    world.nextFamilyId = number + 1;
    proposals.push(proposal);
    if (task.location === true) reportLocation(world, citizen, recipient);
    announce(world, proposal, `${citizen.name} privately proposed starting a family with ${recipient.name} (${id}).`, effects);
    return { ok: true };
  }
  const proposal = proposals.find(p => p.id === task.proposal);
  if (!proposal || !ACTIVE.has(proposal.status) || proposal.expiresAt <= world.tick) return fail('family proposal is no longer active');
  const maker = person(world, proposal.makerId), recipient = person(world, proposal.recipientId);
  if (!maker || !recipient) return fail('proposal partner is no longer a living adult');
  if (task.type === 'accept_family') {
    if (proposal.recipientId !== citizen.id || proposal.status !== 'pending') return fail('only the named recipient may accept a pending proposal');
    if (proposals.some(p => p !== proposal && p.status === 'accepted' && p.expiresAt > world.tick
        && (involved(p, maker.id) || involved(p, recipient.id)))) return fail('one partner already accepted another proposal');
    proposal.status = 'accepted'; proposal.updatedAt = world.tick;
    if (task.location === true) reportLocation(world, citizen, maker);
    announce(world, proposal, `${recipient.name} accepted ${maker.name}'s family proposal ${proposal.id}; they still need to meet and qualify.`, effects);
    return { ok: true, partnerId: maker.id };
  }
  if (task.type === 'decline_family' && proposal.recipientId === citizen.id && proposal.status === 'pending') {
    proposal.status = 'declined';
  } else if (task.type === 'cancel_family' && involved(proposal, citizen.id)) {
    proposal.status = 'cancelled';
  } else return fail('only the recipient may decline; either partner may cancel');
  proposal.updatedAt = world.tick;
  announce(world, proposal, `Family proposal ${proposal.id} was ${proposal.status} by ${citizen.name}.`, effects);
  return { ok: true };
}

export function tickFamily(world, effects = {}) {
  for (const proposal of world.familyProposals ?? []) {
    if (!ACTIVE.has(proposal.status)) continue;
    const missing = !person(world, proposal.makerId) || !person(world, proposal.recipientId);
    if (!missing && proposal.expiresAt > world.tick) continue;
    proposal.status = missing ? 'cancelled' : 'expired'; proposal.updatedAt = world.tick;
    announce(world, proposal, `Family proposal ${proposal.id} ${proposal.status}.`, effects);
  }
}
