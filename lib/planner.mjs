import { randomUUID } from 'node:crypto';
import { recordAudit } from './audit.mjs';
import { SYSTEM_PROMPT } from './guidance.mjs';
import { strategyPrompt } from './undertaking.mjs';
import { continuityPrompt } from './continuity.mjs';
import { providerHttpError } from './provider-errors.mjs';
export { SYSTEM_PROMPT } from './guidance.mjs';

export const DEFAULT_MODEL = 'deepseek-v4.1-flash:cloud';
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1';
export const DEFAULT_REASONING_EFFORT = 'low';
export const MAX_OUTPUT_TOKENS = 8192;
export const MAX_PROMPT_BYTES = 12000;

import { normalizePlan, PlannerError, PlanResponseError } from './plans.mjs';
export { PlannerError, PlanResponseError };

export function parsePlanContent(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new PlanResponseError('The model returned no plan; keeping the existing strategy until the next review.');
  }
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(json);
  } catch {
    throw new PlanResponseError('The model returned invalid JSON; keeping the existing strategy until the next review.');
  }
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function projectFields(value, fields, limits = {}) {
  if (!isRecord(value)) return {};
  const projected = {};
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) continue;
    const item = value[field];
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) {
      projected[field] = item;
    } else if (typeof item === 'string') {
      projected[field] = limits[field] ? item.slice(0, limits[field]) : item;
    }
  }
  return projected;
}

function projectStrings(value, limit, maxLength = 200) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item) => typeof item === 'string').map((item) => item.slice(0, maxLength)).slice(-limit);
}

const TASK_FIELDS = {
  gather: ['type', 'resource', 'amount', 'target', 'camp', 'maxTicks'],
  explore: ['type', 'ticks'],
  craft: ['type', 'item', 'level'],
  offer: ['type', 'give', 'giveAmount', 'want', 'wantAmount', 'recipient'],
  trade: ['type', 'offer'],
  give: ['type', 'target', 'resource', 'amount'],
  post: ['type', 'text', 'share', 'shareBuildings'],
  broadcast: ['type', 'text', 'share', 'shareBuildings'],
  message: ['type', 'target', 'text', 'share', 'shareBuildings', 'location'],
  build: ['type', 'building', 'x', 'y', 'length', 'axis'],
  construct: ['type', 'plan'],
  bake: ['type', 'target', 'amount'],
  repair: ['type', 'target'],
  guard: ['type', 'target', 'ticks'],
  reproduce: ['type', 'target'],
  propose_family: ['type', 'target', 'location'],
  accept_family: ['type', 'proposal', 'location'],
  decline_family: ['type', 'proposal'],
  cancel_family: ['type', 'proposal'],
  attack: ['type', 'target'],
  move: ['type', 'x', 'y', 'range'],
  wait: ['type', 'ticks'],
  rest: ['type', 'target'],
};

function projectTask(value) {
  if (!isRecord(value) || typeof value.type !== 'string' || !TASK_FIELDS[value.type]) return undefined;
  const fields = projectFields(value, TASK_FIELDS[value.type], { text: 200 });
  for (const key of ['share', 'shareBuildings']) {
    if (Array.isArray(value[key])) {
      const share = value[key].filter((id) => typeof id === 'string').slice(0, 4);
      if (share.length) fields[key] = share;
      else delete fields[key];
    }
  }
  return fields;
}

function projectWork(value) {
  if (!isRecord(value)) return null;
  const fields = {
    gather: ['type', 'resource', 'target', 'camp'],
    bake: ['type', 'target'], guard: ['type', 'target'],
    explore: ['type'], rest: ['type'],
  }[value.type];
  return fields ? projectFields(value, fields) : null;
}

function projectBuilding(value) {
  return projectFields(value, ['id', 'kind', 'x', 'y', 'ownerId', 'health', 'maxHealth', 'observedAt', 'source', 'reportedBy'], {
    id: 100, kind: 40, ownerId: 100, source: 40, reportedBy: 100,
  });
}

function projectCitizen(value) {
  const source = isRecord(value) ? value : {};
  const citizen = projectFields(source, [
    'id', 'name', 'x', 'y', 'food', 'wood', 'bread', 'hunger', 'energy', 'health', 'tool', 'weapon', 'shoes',
    'toolLevel', 'shoesLevel', 'weaponLevel', 'weaponDurability', 'reproduceAfter', 'personality', 'exploredTiles', 'lastPlanError',
  ], { id: 100, name: 100, personality: 300, lastPlanError: 240 });
  for (const key of ['aspirations', 'goals']) {
    const items = projectStrings(source[key], 3, 160);
    if (items !== undefined) citizen[key] = items;
  }
  const memories = projectStrings(source.memories, 3, 200);
  if (memories !== undefined) citizen.memories = memories;
  if (isRecord(source.undertaking)) citizen.undertaking = projectFields(source.undertaking,
    ['objective', 'success', 'status', 'startedAt', 'updatedAt', 'completedActions', 'failedActions'],
    { objective: 160, success: 160, status: 20 });
  citizen.work = projectWork(source.work);
  if (isRecord(source.execution)) citizen.execution = projectFields(source.execution,
    ['orderStartedAt', 'completedUnits', 'investedTicks', 'remainingTicks', 'interruptedBy', 'lastReview', 'blockedBy'], { interruptedBy: 40, lastReview: 20, blockedBy: 180 });
  if (Array.isArray(source.communications) && source.communications.length) citizen.communications = source.communications.slice(0, 2).map(projectTask).filter(Boolean);
  if (Object.hasOwn(source, 'order')) citizen.order = source.order === null ? null : projectTask(source.order);
  if (Array.isArray(source.tasks)) {
    citizen.tasks = source.tasks.slice(0, 4).map(projectTask).filter(Boolean);
  }
  if (Array.isArray(source.parents)) {
    citizen.parents = source.parents.filter((id) => typeof id === 'string').slice(0, 12);
  }
  if (Array.isArray(source.children)) {
    citizen.children = source.children.slice(0, 12).map((child) => projectFields(child, ['id', 'name', 'adult'], { id: 100, name: 100 }));
  }
  if (isRecord(source.relationships)) {
    const entries = Object.entries(source.relationships)
      .filter(([id, score]) => id && typeof score === 'number' && Number.isFinite(score))
      .slice(0, 12);
    citizen.relationships = Object.fromEntries(entries);
  }
  if (Array.isArray(source.actionResults)) {
    citizen.actionResults = source.actionResults.slice(-6).map((result) => ({
      ...projectFields(result, ['tick', 'status', 'reason'], { reason: 180 }),
      task: projectFields(result.task, (TASK_FIELDS[result.task?.type] ?? []).filter((field) => !['text', 'share', 'shareBuildings'].includes(field))),
    }));
  }
  if (Array.isArray(source.resourceHistory)) {
    citizen.resourceHistory = source.resourceHistory.slice(0, 6).map((item) => projectFields(item, [
      'nodeId', 'visits', 'emptyVisits', 'lostRaces', 'harvested', 'waitTicks', 'lastOutcomeAt',
    ], { nodeId: 100 }));
  }
  return citizen;
}

function projectNode(value) {
  return projectFields(value, [
    'id', 'kind', 'x', 'y', 'stock', 'capacity', 'yield', 'level', 'regrowTicks', 'observedAt', 'source', 'reportedBy', 'receivedAt', 'witnessedDepletionAt',
  ], { id: 100, kind: 40, source: 40, reportedBy: 100 });
}

function projectContact(value) {
  return projectFields(value, ['id', 'name', 'adult', 'x', 'y', 'observedAt', 'source', 'reportedBy'], {
    id: 100, name: 100, source: 40, reportedBy: 100,
  });
}

function projectOffer(value) {
  return projectFields(value, [
    'id', 'makerId', 'give', 'giveAmount', 'want', 'wantAmount', 'recipient', 'createdAt', 'expiresAt', 'status',
  ], { id: 100, makerId: 100, give: 20, want: 20, recipient: 100, status: 30 });
}

function projectLocation(value) {
  if (typeof value === 'boolean') return value;
  if (!isRecord(value)) return undefined;
  const point = projectFields(value, ['x', 'y']);
  return Object.keys(point).length === 2 ? point : undefined;
}

function projectMessage(value) {
  const message = projectFields(value, [
    'id', 'senderId', 'recipientId', 'from', 'to', 'target', 'senderName', 'recipientName',
    'tick', 'createdAt', 'sentAt', 'text',
  ], {
    id: 100, senderId: 100, recipientId: 100, from: 100, to: 100, target: 100,
    senderName: 100, recipientName: 100, text: 200,
  });
  if (Array.isArray(value?.share)) {
    const share = value.share.filter((id) => typeof id === 'string').slice(0, 4);
    if (share.length) message.share = share;
  }
  if (Array.isArray(value?.shareBuildings)) {
    message.shareBuildings = value.shareBuildings.filter((id) => typeof id === 'string').slice(0, 4);
  }
  const location = projectLocation(value?.location);
  if (location !== undefined) message.location = location;
  return message;
}

function projectBoardPost(value) {
  const post = projectFields(value, ['id', 'tick', 'citizenId', 'name', 'text'], {
    id: 100, citizenId: 100, name: 100,
  });
  if (Array.isArray(value?.share)) {
    const share = value.share.filter((id) => typeof id === 'string').slice(0, 4);
    if (share.length) post.share = share;
  }
  if (Array.isArray(value?.shareBuildings)) {
    post.shareBuildings = value.shareBuildings.filter((id) => typeof id === 'string').slice(0, 4);
  }
  return post;
}

function projectEvents(values, citizenId) {
  if (!Array.isArray(values) || typeof citizenId !== 'string') return [];
  return values.filter((event) => isRecord(event) && event.citizenId === citizenId).slice(-4)
    .map((event) => ({ ...projectFields(event, ['tick']), ...(typeof event.text === 'string' ? { text: event.text.slice(0, 180) } : {}) }));
}

function selfMail(values, citizenId, addressField) {
  // Defense boundary: only mail explicitly addressed to or sent by the planning
  // citizen may leave the server, and only that mail counts toward the slice.
  if (!Array.isArray(values) || typeof citizenId !== 'string') return [];
  return values
    .filter((message) => isRecord(message) && message[addressField] === citizenId)
    .slice(-8)
    .map(projectMessage);
}

export function createPlanner({
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  fetchImpl = fetch,
  timeoutMs = 90000,
  budget = null,
  audit = null,
  strategyReview = false,
  projectContinuity = false,
  systemPrompt = SYSTEM_PROMPT,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
} = {}) {
  if (!['low', 'high', 'max'].includes(reasoningEffort)) throw new Error('Reasoning effort must be low, high or max.');
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('OLLAMA_BASE_URL must be an HTTP URL without credentials, query, or fragment.');
  }
  endpoint = endpoint.replace(/\/$/, '');
  let unavailableError = null;
  const assertModelAvailable = () => { if (unavailableError) throw unavailableError; };
  const markModelUnavailable = error => { if (error.retryable === false) unavailableError = error; };
  async function request(path, options = {}, signal) {
    try {
      return await fetchImpl(`${endpoint}${path}`, {
        ...options,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (signal?.aborted) throw new PlannerError('Planning cancelled.');
      throw new PlannerError('Cannot reach Ollama or the request timed out. Start Ollama, check its cloud sign-in, then Retry.');
    }
  }
  return {
    model,
    endpoint,
    strategyReview,
    projectContinuity,
    reasoningEffort,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    budget,
    audit,
    assertModelAvailable,
    markModelUnavailable,
    async check(signal) {
      assertModelAvailable();
      const response = await request('/models', {}, signal);
      if (!response.ok) throw new PlannerError(`Ollama model check failed (HTTP ${response.status}). Check its cloud sign-in, then Retry.`);
      const payload = await response.json();
      if (!payload.data?.some((entry) => entry.id === model)) {
        throw new PlannerError(`Model ${model} is not available in Ollama. Run ollama pull ${model}, then Retry.`);
      }
    },
    async plan(context, signal, { planId = randomUUID() } = {}) {
      const trace = (event) => recordAudit(audit, { planId, citizenId: context?.citizen?.id, tick: context?.tick, ...event });
      try {
      assertModelAvailable();
      // Only explicitly approved simulation observations leave the server; nested inputs are projected too.
      const currentCitizen = isRecord(context?.citizen) ? context.citizen : {};
      const observation = {};
      const dimensions = projectFields(context, ['tick', 'width', 'height']);
      Object.assign(observation, dimensions);
      observation.citizen = projectCitizen(currentCitizen);
      observation.neighbors = Array.isArray(context?.neighbors)
        ? context.neighbors.slice(0, 12).map((neighbor) => projectFields(neighbor, ['id', 'name', 'adult'], { id: 100, name: 100 }))
        : [];
      observation.contacts = Array.isArray(context?.contacts)
        ? context.contacts.slice(0, 12).map(projectContact)
        : [];
      observation.deposits = Array.isArray(context?.deposits)
        ? context.deposits.slice(0, 64).map(projectNode)
        : [];
      observation.knownBuildings = Array.isArray(context?.knownBuildings)
        ? context.knownBuildings.map(projectBuilding) : [];
      observation.incidents = Array.isArray(context?.incidents)
        ? context.incidents.slice(-4).map((incident) => projectFields(incident,
          ['tick', 'attackerId', 'targetId', 'kind', 'x', 'y'], { attackerId: 100, targetId: 100, kind: 40 })) : [];
      observation.offers = Array.isArray(context?.offers)
        ? context.offers.slice(0, 32).map(projectOffer)
        : [];
      if (Array.isArray(context?.offerHistory)) {
        observation.offerHistory = context.offerHistory.filter((offer) => offer.makerId === currentCitizen.id && ['filled', 'expired', 'cancelled'].includes(offer.status))
          .slice(-4).map(projectOffer);
      }
      if (Array.isArray(context?.familyProposals)) {
        observation.familyProposals = context.familyProposals.filter((proposal) => proposal.makerId === currentCitizen.id || proposal.recipientId === currentCitizen.id)
          .slice(-6).map((proposal) => projectFields(proposal, ['id', 'makerId', 'recipientId', 'status', 'createdAt', 'updatedAt', 'expiresAt']));
      }
      observation.inbox = selfMail(context?.inbox, currentCitizen.id, 'recipientId');
      observation.outbox = selfMail(context?.outbox, currentCitizen.id, 'senderId');
      observation.board = Array.isArray(context?.board)
        ? context.board.slice(-4).map(projectBoardPost)
        : [];
      observation.events = projectEvents(context?.events, currentCitizen.id);
      const messages = [
        { role: 'system', content: projectContinuity ? continuityPrompt(systemPrompt) : strategyReview ? strategyPrompt(systemPrompt) : systemPrompt },
        { role: 'user', content: JSON.stringify(observation) },
      ];
      const measurePrompt = () => {
        messages[1].content = JSON.stringify(observation);
        return Buffer.byteLength(JSON.stringify(messages), 'utf8');
      };
      const trimBuildings = (limit) => {
        const targets = new Set([observation.citizen.work, observation.citizen.order, ...(observation.citizen.tasks ?? [])]
          .map((task) => task?.target).filter((target) => typeof target === 'string'));
        const sorted = [...observation.knownBuildings].sort((a, b) =>
          (b.observedAt ?? -Infinity) - (a.observedAt ?? -Infinity));
        const retained = sorted.filter((building) => targets.has(building.id));
        retained.push(...sorted.filter((building) => !targets.has(building.id)).slice(0, Math.max(0, limit - retained.length)));
        observation.knownBuildings = retained;
      };
      const trimDeposits = (limit) => {
        const targetIds = new Set([observation.citizen.work, observation.citizen.order, ...(observation.citizen.tasks ?? [])]
          .filter((task) => task?.type === 'gather').map((task) => task.target).filter((id) => typeof id === 'string'));
        const ranked = observation.deposits.map((deposit, index) => ({ deposit, index }))
          .sort((a, b) => Number(targetIds.has(b.deposit.id)) - Number(targetIds.has(a.deposit.id))
            || (b.deposit.observedAt ?? -Infinity) - (a.deposit.observedAt ?? -Infinity) || b.index - a.index);
        const retained = new Set(ranked.slice(0, limit).map(({ deposit }) => deposit));
        observation.deposits = observation.deposits.filter((deposit) => retained.has(deposit));
      };
      trimBuildings(12);
      let promptBytes = measurePrompt();
      if (promptBytes > MAX_PROMPT_BYTES) {
        trimBuildings(6);
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        // Repetitive resource records yield space before social evidence and outcomes.
        if (Array.isArray(observation.citizen.resourceHistory)) observation.citizen.resourceHistory = observation.citizen.resourceHistory.slice(0, 2);
        trimDeposits(12);
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        trimDeposits(6);
        trimBuildings(3);
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        // Population can grow; discard optional narrative before rejecting an oversized call.
        observation.board = observation.board.slice(-2);
        observation.events = observation.events.slice(-2);
        observation.citizen.memories = observation.citizen.memories?.slice(-1);
        observation.citizen.thought = undefined;
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        // Deeper optional-narrative trim before rejecting: keep the most recent
        // contact snapshots and this citizen's latest own mail. Entries are
        // dropped as omitted, never replaced with fabricated placeholders.
        const recency = (contact) => (Number.isFinite(contact?.observedAt) ? contact.observedAt : -Infinity);
        observation.contacts = [...observation.contacts].sort((a, b) => recency(a) - recency(b)).slice(-6);
        observation.inbox = observation.inbox.slice(-2);
        observation.outbox = observation.outbox.slice(-1);
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        // Keep the core personal record intact while dropping older optional
        // social/history observations and surplus offers.
        observation.board = observation.board.slice(-1);
        observation.events = observation.events.slice(-1);
        observation.outbox = [];
        if (Array.isArray(observation.citizen.resourceHistory)) {
          observation.citizen.resourceHistory = observation.citizen.resourceHistory.slice(0, 2);
        }
        const offersWithIndex = observation.offers.map((offer, index) => ({ offer, index }));
        const offerRecency = (offer) => Number.isFinite(offer.createdAt) ? offer.createdAt : -Infinity;
        const latestOfferFirst = (a, b) => offerRecency(b.offer) - offerRecency(a.offer) || b.index - a.index;
        const ownOffer = offersWithIndex
          .filter(({ offer }) => typeof observation.citizen.id === 'string' && offer.makerId === observation.citizen.id)
          .sort(latestOfferFirst)[0]?.offer;
        const otherOffers = offersWithIndex
          .filter(({ offer }) => offer !== ownOffer)
          .sort(latestOfferFirst)
          .slice(0, ownOffer ? 3 : 4)
          .map(({ offer }) => offer);
        observation.offers = ownOffer ? [ownOffer, ...otherOffers] : otherOffers;
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        trimDeposits(3);
        observation.contacts = observation.contacts.slice(-3);
        if (Array.isArray(observation.citizen.resourceHistory)) observation.citizen.resourceHistory = [];
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        // Current intentions, pending sends and rejection feedback take priority
        // over redundant narrative. Mechanical action results remain intact.
        observation.citizen.memories = [];
        observation.events = [];
        // Earlier ranking puts the citizen's own escrow first, then newest others.
        observation.offers = observation.offers.slice(0, 2);
        const peopleTargets = new Set([observation.citizen.order, ...(observation.citizen.tasks ?? []), ...(observation.citizen.communications ?? [])]
          .map(task => task?.target).filter(Boolean));
        observation.contacts = [...observation.contacts].sort((a, b) => Number(peopleTargets.has(b.id)) - Number(peopleTargets.has(a.id))
          || (b.observedAt ?? 0) - (a.observedAt ?? 0)).slice(0, 2);
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) {
        // Keep current execution and its outcomes before older correspondence.
        observation.inbox = observation.inbox.slice(-1);
        trimBuildings(1);
        trimDeposits(2);
        promptBytes = measurePrompt();
      }
      if (promptBytes > MAX_PROMPT_BYTES) throw new PlannerError(`The planning context exceeded the small-request limit (${promptBytes} bytes). No request was sent.`);
      let reservation;
      try {
        // UTF-8 bytes plus framing is deliberately more conservative than a tokenizer estimate.
        reservation = budget?.reserve(promptBytes + 1024, MAX_OUTPUT_TOKENS);
      } catch (error) {
        throw new PlannerError(`Budget stopped planning: ${error.message}`);
      }
      let settled = false;
      try {
        const body = {
          model, stream: false, temperature: 0.7, reasoning_effort: reasoningEffort,
          max_tokens: MAX_OUTPUT_TOKENS, response_format: { type: 'json_object' }, messages,
        };
        trace({ type: 'plan_request', promptBytes, request: body });
        const response = await request('/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, signal);
        if (!response.ok) {
          const error = providerHttpError(response, { model });
          markModelUnavailable(error);
          throw error;
        }
        const payload = await response.json();
        const inputTokens = payload.usage?.prompt_tokens;
        const outputTokens = payload.usage?.completion_tokens;
        budget?.settle(reservation, { inputTokens, outputTokens });
        settled = true;
        const choice = payload.choices?.[0];
        const reasoningFields = ['reasoning', 'reasoning_content', 'thinking'].filter(key => typeof choice?.message?.[key] === 'string');
        const reasoningTokens = payload.usage?.completion_tokens_details?.reasoning_tokens;
        trace({ type: 'plan_response', content: choice?.message?.content, finishReason: choice?.finish_reason,
          reasoning: { requestedEffort: reasoningEffort, fields: reasoningFields,
            characters: reasoningFields.reduce((sum, key) => sum + choice.message[key].length, 0),
            tokens: Number.isSafeInteger(reasoningTokens) && reasoningTokens >= 0 ? reasoningTokens : null },
          usage: { inputTokens, outputTokens } });
        if (choice?.finish_reason === 'length') throw new PlanResponseError('The model reached its response limit; keeping the existing strategy until the next review.');
        const tokens = payload.usage?.total_tokens;
        const rawPlan = parsePlanContent(choice?.message?.content);
        const plan = normalizePlan(rawPlan, context);
        trace({ type: 'plan_normalized', plan });
        return { plan, tokens: Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : 0 };
      } finally {
        // A cancelled/failed request may still be billable. Retain its full reservation.
        if (!settled) budget?.settle(reservation, null);
      }
      } catch (error) {
        trace({ type: 'plan_error', reason: error instanceof PlannerError ? error.message : 'Unexpected planning error' });
        throw error;
      }
    },
  };
}
