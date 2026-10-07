// Further strikes in an already witnessed attack should not continually reject
// the citizen's explicitly chosen immediate defense. New attackers/targets
// still require review; this never chooses violence or creates knowledge.
export function defenseCoversNewViolence(plan, citizen, previous, current) {
  const task = plan.mode === 'continue' ? citizen.order?.task ?? citizen.tasks?.[0] ?? citizen.work : plan.tasks?.[0] ?? plan.work;
  if (!['guard', 'attack'].includes(task?.type)) return false;
  const relevant = (previous?.incidents ?? []).filter(i => ['building', 'citizen'].includes(i.kind)
    && i.attackerId !== citizen.id && (task.type === 'attack' ? i.attackerId === task.target : i.kind === 'building' && i.targetId === task.target));
  if (!relevant.length) return false;
  const identity = i => JSON.stringify([i.kind, i.attackerId, i.targetId]);
  const knownThreats = new Set(relevant.map(identity));
  const fingerprint = i => JSON.stringify([i.tick, i.kind, i.attackerId, i.targetId]);
  const prior = new Set((previous?.incidents ?? []).map(fingerprint));
  return (current.incidents ?? []).filter(i => !prior.has(fingerprint(i))).every(i => knownThreats.has(identity(i))
    || (i.kind === 'defense' && i.attackerId === citizen.id && relevant.some(threat => threat.attackerId === i.targetId)));
}

// Unrelated mail should prompt a follow-up, not continually prevent a valid
// decision from finishing. Party/ID dependencies stay conservative; missing
// correspondence never proves that a plan is independent.
export function mailAffectsPlan(plan, citizen, previous, current) {
  if (!previous || !current) return true;
  const readIds = new Set((previous.inbox ?? []).map(m => m.id));
  const unread = (current.inbox ?? []).filter(m => !readIds.has(m.id));
  const received = (current.citizen.inboxRevision ?? 0) - (previous.citizen.inboxRevision ?? 0);
  if (received < 0 || received !== unread.length || unread.length === 0) return true;
  const dependencies = new Set();
  const tasks = plan.mode === 'continue'
    ? [...(citizen.order ? [citizen.order.task] : []), ...(citizen.tasks ?? []), ...(citizen.work ? [citizen.work] : [])]
    : [...(plan.tasks ?? []), ...(plan.work ? [plan.work] : [])];
  const communications = plan.communications ?? [...(citizen.phone ? [citizen.phone.task] : []), ...(citizen.communications ?? [])];
  for (const task of [...tasks, ...communications]) {
    if (task.target) dependencies.add(task.target);
    if (task.to) dependencies.add(task.to);
    if (task.offer) {
      dependencies.add(task.offer);
      const offer = current.offers?.find(o => o.id === task.offer) ?? previous.offers?.find(o => o.id === task.offer);
      if (offer?.makerId) dependencies.add(offer.makerId);
    }
  }
  if (dependencies.has('own')) {
    for (const building of [...(previous.knownBuildings ?? []), ...(current.knownBuildings ?? [])]) {
      if (building.ownerId === citizen.id) dependencies.add(building.id);
    }
  }
  const referencedIds = text => new Set(String(text ?? '').match(/\b(?:citizen|offer|bakery|wall|crop|tree)-[a-z0-9]+\b/gi)?.map(id => id.toLowerCase()) ?? []);
  return unread.some(message => {
    const references = new Set([...referencedIds(message.text), ...(message.share ?? []), ...(message.shareBuildings ?? [])]);
    return dependencies.has(message.senderId) || [...dependencies].some(id => references.has(id.toLowerCase()));
  });
}
