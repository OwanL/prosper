import { normalizePlan } from './plans.mjs';
import { parsePlanContent, MAX_PROMPT_BYTES, MAX_OUTPUT_TOKENS } from './planner.mjs';
import { strategyPrompt } from './undertaking.mjs';

// These are decision probes, not simulations or a reward for being sociable.
export function assessDecision(raw, observation) {
  const plan = normalizePlan(raw, observation);
  const issues = [];
  const self = observation.citizen.id;
  const people = new Set((observation.neighbors ?? []).map(p => p.id));
  const buildings = new Set((observation.knownBuildings ?? []).map(b => b.id));
  const proposals = observation.familyProposals ?? [];
  const actions = [...plan.tasks, ...(plan.communications ?? []), ...(plan.work ? [plan.work] : [])];
  for (const task of actions) {
    if (['message', 'give', 'propose_family', 'reproduce'].includes(task.type) && !people.has(task.target)) issues.push('unknown-person');
    if (task.type === 'attack' && !people.has(task.target) && !buildings.has(task.target)) issues.push('unknown-target');
    if (task.type === 'gather' && task.target && !(observation.deposits ?? []).some(n => n.id === task.target && n.kind === (task.resource === 'food' ? 'crop' : 'tree'))) issues.push('unknown-or-mismatched-deposit');
    if (task.type === 'trade' && !(observation.offers ?? []).some(o => o.id === task.offer && o.makerId !== self && o.status === 'open' && o.expiresAt > observation.tick && (!o.recipient || o.recipient === self))) issues.push('unavailable-offer');
    if (task.type === 'accept_family' && !proposals.some(p => p.id === task.proposal && p.recipientId === self && p.status === 'pending' && p.expiresAt > observation.tick)) issues.push('unavailable-family-proposal');
    if (task.type === 'reproduce' && !proposals.some(p => p.status === 'accepted' && p.expiresAt > observation.tick && [p.makerId, p.recipientId].includes(self) && [p.makerId, p.recipientId].includes(task.target)) && !plan.tasks.some(t => t.type === 'accept_family' && proposals.some(p => p.id === t.proposal && p.makerId === task.target && p.recipientId === self && p.status === 'pending' && p.expiresAt > observation.tick))) issues.push('no-accepted-pairing');
  }
  return {
    plan, issues: [...new Set(issues)],
    actionTypes: actions.map(t => t.type),
    communications: actions.filter(t => ['message', 'post'].includes(t.type)).length,
    interactions: actions.filter(t => ['message', 'post', 'offer', 'trade', 'give', 'propose_family', 'accept_family', 'decline_family', 'cancel_family', 'reproduce', 'attack'].includes(t.type)).length,
  };
}

export function summarizeDecisions(results) {
  const groups = {};
  for (const result of results) {
    const group = groups[result.variant] ??= { attempts: 0, valid: 0, grounded: 0, communicationPlans: 0, interactionPlans: 0, undertakingPlans: 0, actions: {}, issues: {}, inputTokens: 0, outputTokens: 0, totalLatencyMs: 0 };
    group.attempts++;
    if (result.assessment) {
      group.valid++;
      if (!result.assessment.issues.length) group.grounded++;
      if (result.assessment.communications) group.communicationPlans++;
      if (result.assessment.interactions) group.interactionPlans++;
      if (result.assessment.plan.undertaking) group.undertakingPlans++;
      for (const type of result.assessment.actionTypes) group.actions[type] = (group.actions[type] ?? 0) + 1;
      for (const issue of result.assessment.issues) group.issues[issue] = (group.issues[issue] ?? 0) + 1;
    }
    group.inputTokens += result.usage?.inputTokens ?? 0;
    group.outputTokens += result.usage?.outputTokens ?? 0;
    group.totalLatencyMs += result.latencyMs ?? 0;
  }
  return { scope: 'Proposed decisions only. Grounded means no checked prerequisite issue, not proven correctness or goal progress. No actions executed.', groups };
}

export async function probeDecision({ sample, variant, budget, fetchImpl = fetch, endpoint, maxOutputTokens = MAX_OUTPUT_TOKENS }) {
  const messages = structuredClone(sample.request.messages);
  if (variant.strategyReview) messages[0].content = strategyPrompt(messages[0].content);
  if (variant.instruction) messages[0].content += '\n' + variant.instruction;
  const bytes = Buffer.byteLength(JSON.stringify(messages));
  if (bytes > MAX_PROMPT_BYTES) throw new Error('Probe exceeds prompt limit; no request sent.');
  const reservation = budget.reserve(bytes + 1024, maxOutputTokens);
  let settled = false;
  const started = Date.now();
  const result = { caseId: sample.id, tick: sample.observation.tick, citizenId: sample.observation.citizen.id, variant: variant.name, model: variant.model, promptBytes: bytes };
  try {
    const request = { ...sample.request, model: variant.model, messages, max_tokens: maxOutputTokens };
    result.request = request;
    const response = await fetchImpl(`${endpoint}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
    const payload = await response.json();
    result.usage = { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens };
    budget.settle(reservation, result.usage);
    settled = true;
    result.content = payload.choices?.[0]?.message?.content ?? '';
    result.finishReason = payload.choices?.[0]?.finish_reason;
    if (result.finishReason === 'length') throw new Error('Output limit reached');
    result.assessment = assessDecision(parsePlanContent(result.content), sample.observation);
  } catch (error) {
    result.error = error.message;
  } finally {
    if (!settled) budget.settle(reservation, null);
    result.latencyMs = Date.now() - started;
  }
  return result;
}

// Reserve every call against both a run ceiling and the existing durable ledger.
// The ledger's reference rates remain local accounting, not model-specific prices.
export function cappedBudget(budget, maxUsd, { scope = 'ledger' } = {}) {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('Positive run spending cap required');
  if (!['ledger', 'reservations'].includes(scope)) throw new Error('Budget cap scope must be ledger or reservations.');
  const start = budget.snapshot().chargedUsd;
  const reservations = new Map();
  let settled = 0;
  const spent = () => scope === 'ledger' ? budget.snapshot().chargedUsd - start
    : settled + [...reservations.values()].reduce((sum, value) => sum + value.upper, 0);
  return {
    reserve(input, output) {
      const state = budget.snapshot();
      const upper = (input * state.inputPerMillion + output * state.outputPerMillion) / 1e6;
      if (spent() + upper > maxUsd) throw new Error('Experiment spending cap reached');
      const id = budget.reserve(input, output);
      reservations.set(id, { upper, inputRate: state.inputPerMillion, outputRate: state.outputPerMillion });
      return id;
    },
    settle(id, usage) {
      const reservation = reservations.get(id);
      if (scope === 'reservations' && !reservation) throw new Error('Unknown experiment reservation.');
      budget.settle(id, usage);
      if (reservation) {
        const valid = usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
          && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0;
        settled += valid ? (usage.inputTokens * reservation.inputRate + usage.outputTokens * reservation.outputRate) / 1e6 : reservation.upper;
        reservations.delete(id);
      }
    },
    snapshot: () => budget.snapshot(),
    spent,
  };
}
