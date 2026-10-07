// The model chooses what matters. Counters are mechanical evidence, never proof
// that the model's success criterion has been met.
export function normalizeUndertaking(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['active', 'completed', 'abandoned'].includes(value.status) ||
      typeof value.objective !== 'string' || !value.objective.trim() ||
      typeof value.success !== 'string' || !value.success.trim()) {
    throw new Error('undertaking requires objective, success and active/completed/abandoned status');
  }
  return { objective: value.objective.trim().slice(0, 160), success: value.success.trim().slice(0, 160), status: value.status };
}

export function normalizeAssessment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['startedAt', 'status', 'reason'].includes(key))
    || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0
    || !['completed', 'abandoned'].includes(value.status)
    || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 160) {
    throw new Error('assessment requires the current undertaking startedAt, completed|abandoned status and a nonempty reason of at most160characters');
  }
  return { startedAt: value.startedAt, status: value.status, reason: value.reason.trim() };
}

export function assessUndertaking(citizen, assessment, tick) {
  citizen.undertaking = { ...citizen.undertaking, status: assessment.status, updatedAt: tick,
    assessment: { at: tick, reason: assessment.reason } };
}

export function setUndertaking(citizen, value, tick, { successor = false } = {}) {
  const prior = citizen.undertaking;
  const same = !successor && prior && value && prior.objective === value.objective && prior.success === value.success;
  if (prior && !same) citizen.undertakingHistory = [...(citizen.undertakingHistory ?? []), {
    objective: prior.objective, success: prior.success, status: prior.status, endedAt: tick,
    ...(prior.assessment ? { assessment: { ...prior.assessment } } : {}),
    reason: value ? successor ? 'successor chosen' : 'objective revised' : 'objective cleared',
  }].slice(-3);
  citizen.undertaking = value ? {
    ...value, startedAt: same ? prior.startedAt : tick, updatedAt: tick,
    completedActions: same ? prior.completedActions : 0,
    failedActions: same ? prior.failedActions : 0,
    ...(same && prior.assessment && prior.status === value.status ? { assessment: { ...prior.assessment } } : {}),
  } : null;
}

export function recordUndertakingAction(citizen, failed) {
  const undertaking = citizen.undertaking;
  if (!undertaking || undertaking.status !== 'active') return;
  const key = failed ? 'failedActions' : 'completedActions';
  undertaking[key] = Math.min(Number.MAX_SAFE_INTEGER, (undertaking[key] ?? 0) + 1);
}

export const PROGRESS_GUIDANCE = `STRATEGY REVIEW
Choose an objective serving your aspirations; compare results with success. Make tasks/work implement intended actions. Maintenance is valid.
undertaking status is your assessment; counts measure actions, not achievement. Status does not stop tasks. Mechanical facts override claims.`;

export function strategyPrompt(base) {
  const example = JSON.parse(base.split('\n').at(-1));
  example.undertaking = { objective: 'Your chosen objective', success: 'Observable completion condition', status: 'active' };
  return base.replace(/^ROLE\n[^]*?\n\nEVIDENCE\n/, `${PROGRESS_GUIDANCE}\n\nEVIDENCE\n`)
    .replace('Return JSON:', 'Return JSON: undertaking {objective and success: nonempty strings <=160 each, status: active|completed|abandoned}; omission retains, null clears;')
    .replace(/\n\{[^\n]*\}$/, '\n' + JSON.stringify(example));
}
