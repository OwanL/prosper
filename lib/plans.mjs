import { normalizeUndertaking, normalizeAssessment } from './undertaking.mjs';
import { isDeepStrictEqual } from 'node:util';
import { validArea } from './places.mjs';

export class PlannerError extends Error {}
export class PlanResponseError extends PlannerError {}

const has = (object, key) => Object.hasOwn(object, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownRecord = (value) => isRecord(value) ? value : {};
const RESOURCE_NAMES = new Set(['food', 'wood']);
const MAX_TASKS = 4;

function fail(message) {
  throw new PlanResponseError(`The model returned an invalid plan (${message}); keeping the existing strategy until the next review.`);
}

function safeInteger(value, minimum = 0) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= minimum ? value : null;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
  }
  return null;
}

function requiredString(task, key) {
  if (!has(task, key) || typeof task[key] !== 'string' || task[key].trim() === '') {
    fail(`task ${key} is required`);
  }
  return task[key].trim();
}

function requiredResource(task, key, bread = false) {
  const value = requiredString(task, key);
  if (!RESOURCE_NAMES.has(value) && !(bread && value === 'bread')) fail(`task ${key} must be food or wood${bread ? ' or bread' : ''}`);
  return value;
}

function requiredQuantity(task, key, minimum = 1) {
  if (!has(task, key)) fail(`task ${key} is required`);
  const value = safeInteger(task[key], minimum);
  if (value === null) fail(`task ${key} must be a ${minimum === 0 ? 'non-negative' : 'positive'} safe integer`);
  return value;
}

function optionalString(task, key) {
  if (!has(task, key)) return undefined;
  if (typeof task[key] !== 'string' || task[key].trim() === '') fail(`task ${key} must be a non-empty string`);
  return task[key].trim();
}

function sharedNodeIds(task, key = 'share') {
  if (!has(task, key)) return undefined;
  const ids = task[key];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 ||
      ids.some((id) => typeof id !== 'string' || id.trim() === '')) {
    fail('task share must contain 1–4 unique node IDs');
  }
  const normalized = ids.map((id) => id.trim());
  if (new Set(normalized).size !== normalized.length) fail('task share must contain 1–4 unique node IDs');
  return normalized;
}

function normalizeTask(rawTask, maxMessageChars = 200) {
  if (!isRecord(rawTask)) fail('each task must be an object');
  const type = rawTask.type;
  switch (type) {
    case 'construct': return { type, plan: requiredString(rawTask, 'plan') };
    case 'acquire': {
      const task = { type, resource: requiredResource(rawTask, 'resource'), quantity: requiredQuantity(rawTask, 'quantity') };
      if (has(rawTask, 'area')) {
        if (!validArea(rawTask.area)) fail('unknown area');
        task.area = rawTask.area;
      }
      return task;
    }
    case 'gather': {
      const camp = has(rawTask, 'camp') ? rawTask.camp : undefined;
      if (camp !== undefined && typeof camp !== 'boolean') fail('task camp must be boolean');
      const task = {
        type,
        resource: requiredResource(rawTask, 'resource'),
        amount: has(rawTask, 'amount') ? requiredQuantity(rawTask, 'amount') : 1,
      };
      const target = camp === true ? requiredString(rawTask, 'target') : optionalString(rawTask, 'target');
      if (target !== undefined) task.target = target;
      if (camp !== undefined) task.camp = camp;
      if (has(rawTask, 'maxTicks')) {
        if (!Number.isInteger(rawTask.maxTicks) || rawTask.maxTicks < 1 || rawTask.maxTicks > 600) fail('gather maxTicks must be 1..600');
        task.maxTicks = rawTask.maxTicks;
      }
      if (has(rawTask, 'area')) {
        if (!validArea(rawTask.area)) fail('unknown area');
        task.area = rawTask.area;
      }
      return task;
    }
    case 'explore': {
      const ticks = requiredQuantity(rawTask, 'ticks');
      if (ticks > 600) fail('explore ticks must be from 1 to 600');
      if (has(rawTask, 'area') && !validArea(rawTask.area)) fail('unknown area');
      return { type, ticks, ...(has(rawTask, 'area') ? { area: rawTask.area } : {}) };
    }
    case 'craft': {
      const item = requiredString(rawTask, 'item');
      if (!['tool', 'weapon', 'shoes'].includes(item)) fail('craft item must be tool, weapon, or shoes');
      if (has(rawTask, 'level') && (!Number.isInteger(rawTask.level) || rawTask.level < 1 || rawTask.level > 3)) fail('craft level must be 1..3');
      return { type, item, ...(has(rawTask, 'level') ? { level: rawTask.level } : {}) };
    }
    case 'offer': {
      const give = requiredResource(rawTask, 'give', true);
      const want = requiredResource(rawTask, 'want', true);
      const giveAmount = requiredQuantity(rawTask, 'giveAmount');
      const wantAmount = requiredQuantity(rawTask, 'wantAmount', 0);
      if (give === want && wantAmount !== 0) fail('same-resource offers are only valid as zero-price gifts');
      const task = { type, give, giveAmount, want, wantAmount };
      if (has(rawTask, 'recipient')) {
        const recipient = rawTask.recipient;
        if (recipient !== null && (typeof recipient !== 'string' || recipient.trim() === '')) {
          fail('task recipient must be a citizen ID or null');
        }
        task.recipient = recipient === null ? null : recipient.trim();
      }
      return task;
    }
    case 'trade':
      return { type, offer: requiredString(rawTask, 'offer') };
    case 'give':
      return {
        type,
        target: requiredString(rawTask, 'target'),
        resource: requiredResource(rawTask, 'resource', true),
        amount: requiredQuantity(rawTask, 'amount'),
      };
    case 'post':
    case 'broadcast': {
      const text = requiredString(rawTask, 'text').slice(0, maxMessageChars).trim();
      if (!text) fail('task text must not be empty');
      const task = { type: 'post', text };
      const share = sharedNodeIds(rawTask);
      if (share !== undefined) task.share = share;
      const buildings = sharedNodeIds(rawTask, 'shareBuildings');
      if (buildings !== undefined) task.shareBuildings = buildings;
      return task;
    }
    case 'message': {
      const text = requiredString(rawTask, 'text').slice(0, maxMessageChars).trim();
      if (!text) fail('task text must not be empty');
      const task = { type, target: requiredString(rawTask, 'target'), text };
      const share = sharedNodeIds(rawTask);
      if (share !== undefined) task.share = share;
      const buildings = sharedNodeIds(rawTask, 'shareBuildings');
      if (buildings !== undefined) task.shareBuildings = buildings;
      if (has(rawTask, 'location')) {
        if (typeof rawTask.location !== 'boolean') fail('task location must be boolean');
        task.location = rawTask.location;
      }
      return task;
    }
    case 'propose_family': {
      const task = { type, target: requiredString(rawTask, 'target') };
      if (has(rawTask, 'location')) {
        if (typeof rawTask.location !== 'boolean') fail('family proposal location must be boolean');
        task.location = rawTask.location;
      }
      return task;
    }
    case 'accept_family':
    case 'decline_family':
    case 'cancel_family': {
      if (has(rawTask, 'proposal') && has(rawTask, 'proposalId') && rawTask.proposal !== rawTask.proposalId) fail('conflicting proposal identifiers');
      const task = { type, proposal: requiredString({ ...rawTask, proposal: rawTask.proposal ?? rawTask.proposalId }, 'proposal') };
      if (type === 'accept_family' && has(rawTask, 'location')) {
        if (typeof rawTask.location !== 'boolean') fail('family acceptance location must be boolean');
        task.location = rawTask.location;
      }
      return task;
    }
    case 'reproduce':
    case 'attack':
      return { type, target: requiredString(rawTask, 'target') };
    case 'bake':
      return { type, target: requiredString(rawTask, 'target'), amount: requiredQuantity(rawTask, 'amount') };
    case 'repair':
      return { type, target: requiredString(rawTask, 'target') };
    case 'guard': {
      const ticks = requiredQuantity(rawTask, 'ticks');
      if (ticks > 600) fail('guard ticks must be from 1 to 600');
      return { type, target: requiredString(rawTask, 'target'), ticks };
    }
    case 'approach': {
      const task = { type, target: requiredString(rawTask, 'target') };
      if (has(rawTask, 'area')) {
        if (!validArea(rawTask.area)) fail('unknown area');
        task.area = rawTask.area;
      }
      return task;
    }
    case 'build':
    case 'move': {
      if (!has(rawTask, 'x') || !Number.isSafeInteger(rawTask.x) ||
          !has(rawTask, 'y') || !Number.isSafeInteger(rawTask.y)) {
        fail('move requires safe integer x and y coordinates');
      }
      if (type === 'build' && !['bakery', 'wall', 'house'].includes(rawTask.building)) fail('build building must be bakery, wall or house');
      if (type === 'move' && has(rawTask, 'range') && rawTask.range !== 1) fail('move range must be 1 when supplied');
      if (type === 'build' && rawTask.building === 'wall' && has(rawTask, 'length') && (!Number.isInteger(rawTask.length) || rawTask.length < 1 || rawTask.length > 6)) fail('wall length must be 1..6');
      if (type === 'build' && rawTask.building === 'wall' && has(rawTask, 'axis') && !['horizontal', 'vertical'].includes(rawTask.axis)) fail('wall axis must be horizontal or vertical');
      return { type, ...(type === 'build' ? { building: rawTask.building,
        ...(rawTask.building === 'wall' ? { length: rawTask.length ?? 1, axis: rawTask.axis ?? 'horizontal' } : {}) } : {}),
        ...(type === 'move' && has(rawTask, 'range') ? { range: rawTask.range } : {}), x: rawTask.x, y: rawTask.y };
    }
    case 'rest':
      return { type, ...(has(rawTask, 'target') ? { target: requiredString(rawTask, 'target') } : {}) };
    case 'wait': {
      const ticks = requiredQuantity(rawTask, 'ticks');
      if (ticks > 120) fail('wait ticks must be from 1 to 120');
      return { type, ticks };
    }
    default:
      fail(`unknown task type '${typeof type === 'string' ? type.slice(0, 40) : 'missing'}'`);
  }
}

function projectedText(value, fallback, maxLength, { empty = true } = {}) {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().slice(0, maxLength).trim();
  return text || (empty ? '' : fallback);
}

function projectedGoals(value, fallback) {
  if (Array.isArray(value)) {
    const goals = value
      .filter((goal) => typeof goal === 'string')
      .map((goal) => goal.trim().slice(0, 160).trim())
      .filter(Boolean)
      .slice(0, 3);
    if (goals.length) return goals;
  }
  return fallback;
}

function priorGoals(context) {
  const existing = ownRecord(context?.citizen).goals;
  const goals = Array.isArray(existing)
    ? existing.filter((goal) => typeof goal === 'string').map((goal) => goal.trim().slice(0, 160).trim()).filter(Boolean).slice(0, 3)
    : [];
  return goals.length ? goals : ['Maintain current goals'];
}

function normalizeRoutine(raw, context) {
  const rawRoutine = ownRecord(raw.routine);
  let family;
  if (has(rawRoutine, 'family')) {
    if (typeof rawRoutine.family !== 'boolean') fail('routine.family must be boolean');
    family = rawRoutine.family;
  } else {
    family = typeof context?.citizen?.familyReady === 'boolean' ? context.citizen.familyReady : false;
  }
  return { family };
}

function normalizeWork(value) {
  if (value === null) return null;
  if (!isRecord(value)) fail('work must be null or a policy');
  const type = value.type;
  switch (type) {
    case 'gather': {
      const policy = { type, resource: requiredResource(value, 'resource') };
      const target = value.camp === true ? requiredString(value, 'target') : optionalString(value, 'target');
      if (target !== undefined) policy.target = target;
      if (has(value, 'camp')) {
        if (typeof value.camp !== 'boolean') fail('work camp must be boolean');
        policy.camp = value.camp;
      }
      if (has(value, 'area')) {
        if (!validArea(value.area)) fail('unknown area');
        policy.area = value.area;
      }
      return policy;
    }
    case 'bake':
    case 'guard':
      return { type, target: requiredString(value, 'target') };
    case 'explore':
    case 'rest':
      return { type };
    default:
      fail('unknown work policy');
  }
}

function reviewInterval(value) {
  if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) value = parsed;
  }
  if (!Number.isFinite(value)) return 300;
  return Math.max(180, Math.min(600, Math.trunc(value)));
}

function validateBuildingTargets(tasks, work, context) {
  const known = new Set((Array.isArray(context?.knownBuildings) ? context.knownBuildings : []).map((building) => building?.id));
  for (const action of [...tasks, work].filter(Boolean)) {
    if (['bake', 'repair', 'guard'].includes(action.type) &&
        !(action.type === 'bake' && action.target === 'own') && !known.has(action.target)) {
      fail('building target must be known');
    }
    if (action.shareBuildings?.some((id) => !known.has(id))) fail('shared buildings must be known');
  }
}

/** Project model output onto the strict plan schema without inventing strategic actions. */
export function normalizePlan(raw, context = {}) {
  if (!isRecord(raw)) fail('the response must be an object');
  const mode = has(raw, 'mode') ? raw.mode : 'replace';
  if (!['continue', 'replace'].includes(mode)) fail('mode must be continue or replace');
  if (mode === 'continue') {
    if (has(raw, 'tasks')) {
      if (!Array.isArray(raw.tasks) || raw.tasks.length > MAX_TASKS) fail('continue cannot replace tasks');
      if (raw.tasks.length) {
        const echoed = raw.tasks.map(task => normalizeTask(task));
        const queued = context?.citizen?.tasks ?? [];
        const activeAndQueued = [...(context?.citizen?.order ? [context.citizen.order] : []), ...queued];
        if (!isDeepStrictEqual(echoed, queued.map(task => normalizeTask(task))) && !isDeepStrictEqual(echoed, activeAndQueued.map(task => normalizeTask(task)))) fail('continue cannot replace tasks');
      }
    }
    if (has(raw, 'work') && !isDeepStrictEqual(normalizeWork(raw.work), normalizeWork(context?.citizen?.work ?? null))) fail('continue cannot change work');
    raw = { ...raw, tasks: [], work: context?.citizen?.work ?? null };
  }
  const retainedWork = context?.citizen?.work ?? null;
  if (!Array.isArray(raw.tasks) || raw.tasks.length > MAX_TASKS ||
      (raw.tasks.length === 0 && !has(raw, 'work') && retainedWork === null)) {
    fail('tasks must contain 0–4 orders with explicit or retained work, or 1–4 without work');
  }
  if (raw.tasks.length === 0 && !has(raw, 'work')) normalizeWork(retainedWork);
  const fallbackGoals = priorGoals(context);
  const goals = projectedGoals(raw.goals, fallbackGoals);
  const reviewAfter = has(raw, 'reviewAfter') ? reviewInterval(raw.reviewAfter) : 300;
  const tasks = raw.tasks.map(task => normalizeTask(task));
  const trades = tasks.filter(task => task.type === 'trade').map(task => task.offer);
  if (new Set(trades).size !== trades.length) fail('each offer can be accepted once; duplicate trade IDs cannot execute');
  let communications;
  if (has(raw, 'communications')) {
    if (!Array.isArray(raw.communications) || raw.communications.length > 2) fail('communications must contain 0–2 messages or posts');
    communications = raw.communications.map(task => normalizeTask(task, 500));
    if (communications.some(t => !['message', 'post'].includes(t.type))) fail('communications supports message and post only');
    validateBuildingTargets(communications, null, context);
  }
  const work = has(raw, 'work') ? normalizeWork(raw.work) : retainedWork;
  validateBuildingTargets(tasks, has(raw, 'work') ? work : null, context);
  let undertaking;
  if (has(raw, 'undertaking')) {
    try { undertaking = normalizeUndertaking(raw.undertaking); }
    catch { /* Invalid optional metadata retains the prior objective, never invents one. */ }
  }
  let assessment;
  if (has(raw, 'assessment')) {
    try { assessment = normalizeAssessment(raw.assessment); }
    catch (error) { fail(error.message); }
  }
  return {
    thought: projectedText(raw.thought, '', 400),
    goals,
    memory: projectedText(raw.memory, '', 200),
    routine: normalizeRoutine(raw, context),
    work,
    reviewAfter,
    tasks,
    ...(has(raw, 'mode') ? { mode } : {}),
    ...(communications !== undefined ? { communications } : {}),
    ...(undertaking !== undefined ? { undertaking } : {}),
    ...(assessment !== undefined ? { assessment } : {}),
  };
}
