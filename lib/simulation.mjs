import { randomUUID } from 'node:crypto';
import { recordAudit } from './audit.mjs';
import { createWorld, tickWorld, applyPlan, planningContext, recordEvent, interruptForMessage } from './world.mjs';
import { PlannerError, PlanResponseError } from './planner.mjs';
import { createCitizenToolSession } from './citizen-tools.mjs';
import { survivalDeteriorated, immediateFoodWork, hasNoMeal } from './survival.mjs';
import { mailAffectsPlan } from './decision-relevance.mjs';

const incidentFingerprint = (incident) => JSON.stringify([incident.tick, incident.attackerId, incident.targetId, incident.kind]);

export function createSimulation(client, { now = Date.now, worldFactory = createWorld } = {}) {
  const lastRequests = new Map();
  const rejectedUntil = new Map();
  const lastReviewVitals = new Map();
  const lastProgressReview = new Map();
  const eligibleSince = new Map();
  let urgentStreak = 0;
  let lastGlobalRequest = -Infinity;
  let generation = 0;
  let controller = new AbortController();
  const active = new Map();
  const maxConcurrentTurns = client.asynchronousWork ? client.maxConcurrentTurns ?? 2 : 1;
  const minStartIntervalMs = client.minStartIntervalMs ?? 5000;
  const reviewInterval = seconds => client.asynchronousWork ? Math.max(5, seconds / state.speed) : seconds;
  let checking = null;
  let fraction = 0;
  const newPlannerState = () => {
    const metricsAtStart = structuredClone(client.metrics ?? {});
    return ({
    harness: client.harness ?? 'json-plan',
    reasoningHistory: client.preserveReasoning === true ? 'within-turn' : 'none',
    maxConcurrentTurns,
    errorHistory: [],
    get activeErrors() { return state.planner.errorHistory.filter(e => e.resolvedAt === null && state.world.citizens.some(c => c.id === e.citizenId && c.alive)); },
    completedTurnMs: 0, measuredTurns: 0, lastTurnMs: null, maxTurnMs: 0,
    get meanTurnMs() { return this.measuredTurns ? Math.round(this.completedTurnMs / this.measuredTurns) : null; },
    get activeCitizenIds() { return [...active.values()]; },
    get toolHarness() { return client.metrics ? Object.fromEntries(Object.entries(client.metrics).map(([key, value]) => [key,
      typeof value === 'number' ? value - (metricsAtStart[key] ?? 0)
        : Object.fromEntries(Object.entries(value).map(([part, bytes]) => [part, bytes - (metricsAtStart[key]?.[part] ?? 0)]))])) : null; },
    model: client.model, provider: client.providerName ?? 'Ollama', endpoint: client.endpoint, reasoningEffort: client.reasoningEffort ?? null, maxOutputTokens: client.maxOutputTokens ?? null, strategyReview: client.strategyReview === true, projectContinuity: client.projectContinuity === true, connection: 'unchecked', lastError: null, providerFailure: null,
    activeCitizenId: null, requests: 0, completed: 0, failed: 0, discarded: 0, totalTokens: 0, enabled: true,
    get minCitizenIntervalSeconds() { return reviewInterval(60); },
    get eventReviewIntervalSeconds() { return reviewInterval(15); },
    minGlobalIntervalSeconds: minStartIntervalMs / 1000, privateMessageReviewsImmediate: true,
    queuePromotionSeconds: 30,
    get distressReviewIntervalSeconds() { return client.asynchronousWork ? 15 / state.speed : 15; },
    get citizens() { return state.world.citizens.map(c => ({ id: c.id, ...readiness(c) })); },
    get nextCallInMs() { return Math.max(0, minStartIntervalMs - (now() - lastGlobalRequest)); },
    get budget() { return client.budget?.snapshot() ?? null; },
    get audit() { return client.audit?.snapshot?.() ?? null; },
    });
  };
  const auditedWorld = () => {
    const world = worldFactory();
    const runId = randomUUID();
    // Diagnostic hooks must not reach the spectator API or model context.
    Object.defineProperty(world, 'audit', { value: { record: (event) => recordAudit(client.audit, { runId, ...event }) } });
    recordAudit(world.audit, { type: 'run_started', tick: world.tick });
    return world;
  };
  const state = { world: auditedWorld(), running: false, speed: 1, planner: newPlannerState(),
    get effectiveSpeed() { return state.speed; },
    get speedLimitReason() { return null; },
  };

  function fail(message, citizen) {
    state.running = false;
    state.planner.connection = 'error';
    state.planner.lastError = message;
    if (citizen?.alive) { citizen.status = 'error'; citizen.lastError = message; citizen.planning = false; }
    recordEvent(state.world, message, citizen?.id);
  }

  async function check() {
    if (checking) return checking;
    const epoch = generation;
    checking = (async () => {
      try {
        await client.check(controller.signal);
        if (epoch !== generation) return;
        state.planner.connection = 'ready';
        state.planner.lastError = null;
        state.planner.providerFailure = null;
      } catch (error) {
        if (epoch !== generation) return;
        fail(error instanceof PlannerError ? error.message : 'Could not check the model connection. Check the provider and Retry.');
      } finally {
        if (epoch === generation) checking = null;
      }
    })();
    return checking;
  }

  function readiness(citizen) {
    const urgent = Boolean(citizen.pendingMessageId && citizen.pendingMessageId !== citizen.lastMessageReviewId);
    const initial = citizen.planCount === 0;
    const previousVitals = lastReviewVitals.get(citizen.id);
    const distressDue = client.asynchronousWork ? survivalDeteriorated(previousVitals, citizen)
      : citizen.hunger >= 90 || citizen.health < 50;
    const inventoryStalled = client.asynchronousWork && citizen.order?.task.type === 'acquire'
      && state.world.tick - Math.max(citizen.order.lastInventoryIncreaseAt ?? citizen.order.startedAt,
        lastProgressReview.get(citizen.id) ?? citizen.order.startedAt) >= 120;
    const foodCollectionStalled = client.asynchronousWork && hasNoMeal(citizen) && citizen.hunger >= 60
      && citizen.order?.task.type === 'gather' && citizen.order.task.resource === 'food'
      && state.world.tick - Math.max(citizen.order.lastProgressAt ?? citizen.order.startedAt,
        lastProgressReview.get(citizen.id) ?? citizen.order.startedAt) >= 120;
    const stalled = inventoryStalled || foodCollectionStalled;
    const propertyAttacked = (citizen.buildingAlerts ?? []).some(a => a.tick > (citizen.lastPlanTick ?? -Infinity));
    const critical = client.asynchronousWork && (distressDue || foodCollectionStalled || propertyAttacked);
    // Expected progress already has a chosen continuation. Keep completion
    // evidence for real decisions, but do not ask the model to approve each
    // planned step while a queue/policy is still doing useful work. Mail,
    // failures, distress and the citizen's chosen review horizon still wake it.
    const hasContinuation = Boolean(citizen.order || citizen.tasks.length || citizen.work);
    const expectedProgress = client.asynchronousWork && hasContinuation
      && ['milestone completed', 'planned steps complete'].includes(citizen.replanReason);
    const event = Boolean(citizen.replanReason && !expectedProgress && citizen.replanReason !== 'resource setback'
      && (!client.asynchronousWork || citizen.replanReason !== 'starvation'))
      || (!citizen.order && !citizen.tasks.length && !citizen.work)
      || distressDue || stalled || propertyAttacked;
    const due = initial || urgent || event || state.world.tick >= citizen.reviewAt;
    const interval = urgent ? 0 : critical ? 15000 / state.speed : reviewInterval(initial || event ? 15 : 60) * 1000;
    const tickInterval = urgent || initial || critical ? 0 : event ? 24 : 180;
    const realWait = Math.max(0, (lastRequests.get(citizen.id) ?? -Infinity) + interval - now(),
      (rejectedUntil.get(citizen.id) ?? -Infinity) - now());
    const tickWait = Math.max(0, (citizen.lastPlanTick ?? -Infinity) + tickInterval - state.world.tick,
      due ? 0 : citizen.reviewAt - state.world.tick);
    const reason = distressDue && client.asynchronousWork ? 'personal distress' : propertyAttacked ? 'property attacked' : foodCollectionStalled ? 'food collection stalled'
      : urgent ? 'private message' : initial ? 'initial decision' : stalled ? 'inventory progress stalled' : event ? citizen.replanReason || 'work exhausted or distress' : 'scheduled review';
    const priority = critical ? 'distress' : urgent ? 'mail' : 'ordinary';
    const eligible = citizen.alive && citizen.adult && !citizen.planning && citizen.status !== 'error' && due && realWait === 0 && tickWait === 0;
    return { reason, urgent, priority, eligible,
      queueWaitMs: eligible ? Math.max(0, now() - (eligibleSince.get(citizen.id) ?? now())) : 0,
      waitMs: Math.max(realWait, tickWait * 1000 / state.effectiveSpeed), lastRequestAt: lastRequests.get(citizen.id) ?? null,
      retryInMs: Math.max(0, (rejectedUntil.get(citizen.id) ?? 0) - now()),
      calls: citizen.reviewCalls ?? 0, rejected: citizen.rejectedPlans ?? 0 };
  }

  function pump() {
    if (!state.running || state.planner.connection !== 'ready') return;
    for (const c of state.world.citizens) c.asyncReview = client.asynchronousWork === true;
    const candidates = state.world.citizens.flatMap((citizen, index) => {
      const ready = readiness(citizen);
      if (!ready.eligible) { eligibleSince.delete(citizen.id); return []; }
      if (!eligibleSince.has(citizen.id)) eligibleSince.set(citizen.id, now());
      return [{ citizen, index, priority: ready.priority, since: eligibleSince.get(citizen.id) }];
    }).sort((a, b) => a.since - b.since
      || (lastRequests.get(a.citizen.id) ?? -Infinity) - (lastRequests.get(b.citizen.id) ?? -Infinity)
      || a.index - b.index);
    // Track eligibility even with occupied slots. Class changes never reset age.
    // Distress stays first; old requests outrank fresh mail. Within a class,
    // oldest eligibility wins, so another class cannot move a shared cursor.
    if (active.size >= maxConcurrentTurns || now() - lastGlobalRequest < minStartIntervalMs) return;
    const chosen = candidates.find(c => c.priority === 'distress')
      ?? candidates.find(c => now() - c.since >= state.planner.queuePromotionSeconds * 1000)
      ?? candidates.find(c => c.priority === (urgentStreak >= 2 ? 'ordinary' : 'mail'))
      ?? candidates[0];
    const citizen = chosen?.citizen;
    if (!citizen) return;
    const epoch = generation;
    const request = Symbol('plan');
    const startedMs = now();
    const planId = randomUUID();
    const world = state.world;
    const ready = readiness(citizen);
    urgentStreak = ready.priority !== 'ordinary' ? urgentStreak + 1 : 0;
    citizen.reviewCalls = (citizen.reviewCalls ?? 0) + 1;
    recordAudit(world.audit, { type: 'plan_dispatched', planId, citizenId: citizen.id, tick: world.tick, reason: ready.reason, queueWaitMs: ready.queueWaitMs });
    eligibleSince.delete(citizen.id);
    active.set(request, citizen.id);
    citizen.planning = true;
    if (citizen.pendingMessageId) citizen.lastMessageReviewId = citizen.pendingMessageId;
    lastGlobalRequest = now();
    lastRequests.set(citizen.id, now());
    lastProgressReview.set(citizen.id, world.tick);
    lastReviewVitals.set(citizen.id, { health: citizen.health, hunger: citizen.hunger, food: citizen.food, bread: citizen.bread });
    state.planner.activeCitizenId = citizen.id;
    state.planner.requests++;
    void (async () => {
      try {
        let context = planningContext(state.world, citizen.id);
        let lastInboxId = context.inbox.at(-1)?.id;
        let capturedMessageId = citizen.pendingMessageId;
        let familyRevision = citizen.familyRevision ?? 0;
        let capturedIncidents = new Set((citizen.incidents ?? []).slice(-4).map(incidentFingerprint));
        const toolSession = client.harness === 'semantic-tools' ? createCitizenToolSession({
          getWorld: () => { if (epoch !== generation) throw new Error('World changed.'); return state.world; },
          citizenId: citizen.id, planId, signal: controller.signal,
        }) : undefined;
        const result = await client.plan(context, controller.signal, { planId, toolSession });
        if (result.reviewContext) {
          context = result.reviewContext;
          lastInboxId = context.inbox.at(-1)?.id;
          capturedMessageId = lastInboxId;
          familyRevision = context.citizen.familyRevision ?? familyRevision;
          capturedIncidents = new Set(context.incidents.map(incidentFingerprint));
        }
        if (epoch !== generation) {
          recordAudit(world.audit, { type: 'plan_discarded', planId, citizenId: citizen.id, reason: 'World reset or closed' });
          return;
        }
        state.planner.totalTokens += result.tokens;
        if (!citizen.alive || !state.world.citizens.includes(citizen)) {
          state.planner.discarded++;
          recordAudit(world.audit, { type: 'plan_discarded', planId, citizenId: citizen.id, reason: 'Citizen no longer alive' });
          return; // Paid-for response is accounted for, but cannot resurrect a dead citizen.
        }
        const latestMessage = state.world.messages.findLast((message) => message.recipientId === citizen.id);
        const newMessage = (latestMessage && latestMessage.id !== lastInboxId)
          || (citizen.pendingMessageId && citizen.pendingMessageId !== capturedMessageId);
        const deferredMail = newMessage && client.harness === 'semantic-tools' && client.asynchronousWork
          && !mailAffectsPlan(result.plan, citizen, context, planningContext(state.world, citizen.id));
        if (newMessage && !deferredMail) {
          interruptForMessage(citizen, latestMessage?.id ?? citizen.pendingMessageId);
          state.planner.discarded++;
          recordAudit(world.audit, { type: 'plan_discarded', planId, citizenId: citizen.id, tick: world.tick,
            reason: 'A newer private message requires a fresh decision' });
          return; // Account for the paid response, but never execute a message-stale strategy.
        }
        try {
          const unreviewedSurvival = client.asynchronousWork && survivalDeteriorated(context.citizen, citizen);
          if (unreviewedSurvival && !immediateFoodWork(result.plan, citizen)) {
            citizen.replanReason = 'survival changed after review';
            state.planner.discarded++;
            recordAudit(world.audit, { type: 'plan_discarded', planId, citizenId: citizen.id, tick: world.tick,
              reason: 'Survival deteriorated after the last reviewed context' });
            return;
          }
          if (client.asynchronousWork && (citizen.completedActionRevision ?? 0) !== (context.citizen.completedActionRevision ?? 0)) {
            citizen.replanReason = 'completed action requires review';
            state.planner.discarded++;
            recordAudit(world.audit, { type: 'plan_discarded', planId, citizenId: citizen.id, tick: world.tick,
              reason: 'A consequential action completed after the last reviewed context' });
            return;
          }
          if (result.plan.mode === 'continue' && citizen.planBlocked
            && citizen.planBlocked !== context.citizen.execution?.blockedBy) {
            state.planner.discarded++;
            recordAudit(world.audit, { type: 'plan_discarded', planId, citizenId: citizen.id, tick: world.tick,
              reason: 'A newly failed step requires review before continuing its remaining sequence' });
            return;
          }
          applyPlan(state.world, citizen.id, result.plan);
          if (deferredMail) {
            // Applying a plan clears its observed mailbox hold. Restore newer
            // unread correspondence for another review without halting work.
            citizen.lastMessageReviewId = capturedMessageId;
            interruptForMessage(citizen, latestMessage?.id ?? citizen.pendingMessageId);
          }
          // Tool turns may have refreshed vitals since dispatch. Do not request
          // another emergency turn for deterioration already reconsidered.
          lastReviewVitals.set(citizen.id, Object.fromEntries(['health', 'hunger', 'food', 'bread'].map(key => [key, context.citizen[key]])));
          Object.defineProperty(citizen, 'auditPlanId', { value: planId, configurable: true });
          if (result.plan.mode !== 'continue') Object.defineProperty(citizen, 'physicalAuditPlanId', { value: planId, configurable: true });
          const unreviewedChanges = [...new Set([...(result.unreviewedChanges ?? []), ...(unreviewedSurvival ? ['survival'] : []), ...(deferredMail ? ['mail'] : [])])];
          recordAudit(world.audit, { type: 'plan_applied', planId, citizenId: citizen.id, tick: world.tick,
            mode: result.plan.mode ?? 'replace', ...(unreviewedChanges.length ? { unreviewedChanges } : {}) });
          const newIncident = (citizen.incidents ?? []).slice(-4).findLast((incident) => !capturedIncidents.has(incidentFingerprint(incident)));
          if (newIncident) citizen.replanReason = 'witnessed violence';
          else if (unreviewedSurvival) citizen.replanReason = 'survival changed after review';
          else if ((citizen.familyRevision ?? 0) !== familyRevision) citizen.replanReason = 'family proposal updated';
          else if (unreviewedChanges.includes('death')) citizen.replanReason = 'citizen death requires review';
        } catch (error) {
          throw new PlanResponseError(`Strategy rejected: ${error.message} Existing orders and routines continue until the next review.`);
        }
        citizen.lastError = null;
        rejectedUntil.delete(citizen.id);
        for (const entry of state.planner.errorHistory) if (entry.citizenId === citizen.id && entry.resolvedAt === null) entry.resolvedAt = now();
        state.planner.lastError = state.planner.providerFailure?.message ?? state.planner.activeErrors.at(-1)?.message ?? null;
        state.planner.completed++;
      } catch (error) {
        if (epoch !== generation) return;
        state.planner.totalTokens += Number.isSafeInteger(error.tokens) && error.tokens > 0 ? error.tokens : 0;
        if (!citizen.alive || !state.world.citizens.includes(citizen)) {
          state.planner.discarded++;
          recordAudit(world.audit, { type: 'plan_discarded', planId, citizenId: citizen.id, tick: world.tick,
            reason: 'Citizen died during planning' });
          return;
        }
        state.planner.failed++;
        const backoff = Math.max(60000, error.retryAfterMs ?? 0);
        for (const entry of state.planner.errorHistory) if (entry.citizenId === citizen.id && entry.resolvedAt === null) entry.resolvedAt = now();
        state.planner.errorHistory = [...state.planner.errorHistory, {
          tick: world.tick, at: now(), citizenId: citizen.id, citizenName: citizen.name,
          kind: error instanceof PlanResponseError ? 'decision' : 'provider',
          httpStatus: error.httpStatus ?? null, retryable: error.retryable !== false, retryAt: error.retryable === false ? null : now() + backoff,
          message: error instanceof PlannerError ? error.message : 'Unexpected planning error', resolvedAt: null,
        }].slice(-20);
        recordAudit(world.audit, { type: 'plan_rejected', planId, citizenId: citizen.id, tick: world.tick,
          reason: error instanceof PlannerError ? error.message : 'Unexpected planning error' });
        if (error instanceof PlanResponseError) {
          citizen.rejectedPlans = (citizen.rejectedPlans ?? 0) + 1;
          rejectedUntil.set(citizen.id, now() + 60000);
          // Resume the retained strategy after a rejected reply to this batch.
          // Newer mail still holds work for a fresh decision.
          if (citizen.pendingMessageId === citizen.lastMessageReviewId) {
            delete citizen.pendingMessageId;
            citizen.replanReason = 'plan rejected';
          }
          // No immediate repair request: keep the old plan and obey the normal review cooldown.
          state.planner.lastError = error.message;
          if (citizen.alive) citizen.lastError = error.message;
          recordEvent(state.world, `${citizen.name}: ${error.message}`, citizen.id);
        } else {
          if (error.retryable === false) {
            // A retired model affects every citizen. Stop new calls without
            // interrupting physical execution or retrying the same dead model.
            state.planner.connection = 'error';
            state.planner.providerFailure = { httpStatus: error.httpStatus, message: error.message };
            state.planner.lastError = error.message;
            citizen.lastError = error.message;
            recordEvent(state.world, error.message, citizen.id);
          } else if (client.asynchronousWork && !/Budget stopped/.test(error.message)) {
            // A transient provider failure belongs to this citizen's turn. Do
            // not freeze everyone else's ongoing work or retry inside the turn.
            rejectedUntil.set(citizen.id, now() + backoff);
            citizen.lastError = error instanceof PlannerError ? error.message : 'Planning failed unexpectedly.';
            citizen.replanReason = 'planning transport failed';
            state.planner.lastError = state.planner.providerFailure?.message ?? citizen.lastError;
            recordEvent(state.world, `${citizen.name}: ${citizen.lastError} Retry after ${Math.ceil(backoff / 1000)} seconds; current work continues.`, citizen.id);
          } else fail(error instanceof PlannerError ? error.message : 'Planning failed unexpectedly. No plan was applied. Retry planning.', citizen);
        }
      } finally {
        if (active.has(request) && epoch === generation) {
          const duration = Math.max(0, now() - startedMs);
          state.planner.completedTurnMs += duration;
          state.planner.measuredTurns++;
          state.planner.lastTurnMs = duration;
          state.planner.maxTurnMs = Math.max(state.planner.maxTurnMs, duration);
          active.delete(request);
          citizen.planning = false;
          state.planner.activeCitizenId = active.values().next().value ?? null;
          pump();
        }
      }
    })();
  }

  function advance(seconds) {
    if (!state.running) return;
    for (const c of state.world.citizens) c.asyncReview = client.asynchronousWork === true;
    // Re-evaluate speed at each tick, carrying only partial tick progress.
    let remaining = Math.min(1, Math.max(0, seconds));
    while (remaining > 0) {
      const duration = (1 - fraction) / state.effectiveSpeed;
      if (remaining + 1e-9 < duration) {
        fraction += remaining * state.effectiveSpeed;
        break;
      }
      remaining = Math.max(0, remaining - duration);
      fraction = 0;
      tickWorld(state.world);
      pump();
    }
    pump();
  }

  function control(action, speed) {
    switch (action) {
      case 'play':
        if (state.planner.connection === 'error') throw new Error('Retry the model connection before playing.');
        state.running = true;
        pump();
        break;
      case 'pause': state.running = false; eligibleSince.clear(); break;
      case 'speed':
        if (![1, 3, 8].includes(speed)) throw new Error('Speed must be 1, 3, or 8.');
        state.speed = speed;
        break;
      case 'reset':
        generation++;
        controller.abort();
        controller = new AbortController();
        active.clear();
        checking = null;
        fraction = 0;
        eligibleSince.clear();
        lastRequests.clear();
        lastReviewVitals.clear();
        lastProgressReview.clear();
        rejectedUntil.clear();
        urgentStreak = 0;
        state.world = auditedWorld();
        state.running = false;
        state.speed = 1;
        state.planner = newPlannerState();
        void check();
        break;
      case 'retry':
        if (active.size) throw new Error('Wait for the current planning request before retrying.');
        state.planner.connection = 'unchecked';
        state.planner.lastError = null;
        for (const citizen of state.world.citizens) {
          if (citizen.status === 'error') { citizen.status = 'idle'; citizen.lastError = null; }
        }
        void check();
        break;
      default: throw new Error('Unknown control action.');
    }
    recordAudit(state.world.audit, { type: 'control', action, speed: state.speed, tick: state.world.tick });
    return state;
  }

  function close() {
    generation++;
    state.running = false;
    controller.abort();
  }
  return { state, check, advance, control, close };
}
