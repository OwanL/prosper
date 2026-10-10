import { randomUUID } from 'node:crypto';
import type {
  World,
  CitizenObservation,
  Command,
  CommandResult,
  PlannerMode,
  TurnRecord,
} from '../shared/types.ts';
import {
  BudgetExhausted,
  RequestLedger,
  type RequestLedgerOptions,
  type RequestBudgetStatus,
} from './budget.ts';
import { freshContext, PROMPT_VERSION } from './prompt.ts';
import {
  ollamaTransport,
  ollamaNativeTransport,
  validateResponse,
  type Transport,
  type ProviderResponse,
  type ChatMessage,
  type ProviderPayload,
  type TransportTiming,
} from './provider.ts';
import { parseCommand, queryTile, tools, legacyTools } from './tools.ts';
import { parseStrategySpec } from './directive-schema.ts';
import { commitStrategy } from '../world/directives.ts';
import type { DirectiveState } from '../shared/directive-types.ts';
import { completedWorkFeedback } from './decision-freshness.ts';
import { scriptedCommands } from './scripted.ts';
import {
  foodRisk,
  foodRunwayTicks,
  reviewReason,
  reviewState,
  REVIEW_COOLDOWN_TICKS,
} from './planning.ts';
import { BALANCE } from '../world/config.ts';
import type { PlanSpec } from '../shared/plan-types.ts';
import { parsePlanSpec } from './plan-schema.ts';
import { forecastPlan } from './plan-forecast.ts';
import { approvePlan } from '../world/plans.ts';
import { cancelAction } from '../world/core.ts';
import { strategicContext, STRATEGIC_PROMPT_VERSION } from './strategic-context.ts';
import { strategicTools, strategicDecisionSchema } from './strategic-tools.ts';
import { strategicReviewReason } from './strategic-review.ts';
import type { StrategySpec } from '../shared/directive-types.ts';

export interface CitizenHost {
  world: () => World;
  observe: (id: string) => CitizenObservation;
  command: (id: string, command: Command) => CommandResult;
  diagnostic: (record: CitizenTurnRecord) => void;
}
export interface CitizenTurnRecord extends TurnRecord {
  runId: string;
  mode: PlannerMode;
  promptVersion: string;
  requests: {
    requestId: string;
    payload: ProviderPayload;
    observationTick?: number;
    /** Elapsed through response validation/accounting or cancellation. */
    elapsedMs?: number;
    transportTiming?: TransportTiming;
    finishReason?: string;
  }[];
  toolEvents: {
    id: string;
    requestId?: string;
    name: string;
    arguments: string;
    result: unknown;
    tick: number;
  }[];
  commandIdentities: { commandId: string; tick: number; requestId?: string }[];
  notes: string[];
}
export interface RecordedTurn {
  citizenId: string;
  responses: ProviderResponse[];
}
export interface CitizenRunnerOptions {
  model?: string;
  /** Exact installed model verified by the runtime as local weights, never a cloud alias. */
  verifiedLocalModel?: string;
  reasoningEffort?: 'none' | 'low' | 'high';
  provider?: 'native' | 'openai';
  /** Compatibility for retained tool-loop fixtures; normal operation is compact. */
  contextMode?: 'compact' | 'legacy';
  /** Minimum global spacing, separate from each citizen's strategic cooldown. */
  minRequestIntervalTicks?: number;
  minRequestIntervalMs?: number;
  maxRequestsPerHour?: number;
  mode?: PlannerMode;
  transport?: Transport;
  ledger?: RequestLedger;
  ledgerOptions?: RequestLedgerOptions;
  recorded?: RecordedTurn[];
  reviewInterval?: number;
  maxConcurrent?: number;
  maxRequestsPerTurn?: number;
  maxToolsPerTurn?: number;
  maxOutputTokens?: number;
  maxRecords?: number;
  /** Debug/recorded compatibility only; ordinary providers use set_strategy. */
  legacyPlanningTools?: boolean;
  /** Per live request; defaults to PROSPER_REQUEST_TIMEOUT_MS or 120 seconds. */
  requestTimeoutMs?: number;
}
interface Active {
  previousReviewSequence?: number;
  record: CitizenTurnRecord;
  controller: AbortController;
  done: Promise<void>;
  started: number;
  fixture?: RecordedTurn;
  draft?: { id: string; spec: PlanSpec };
  approved?: boolean;
  decisionKind?: 'strategy' | 'plan';
  requestStrategy?: DirectiveState;
  requestPolicyRevision?: number;
  emergencySequence?: number;
  emergencyNotes?: string[];
  emergencyState?: string;
}
class TurnYield extends Error {
  constructor(
    readonly stopReason: string,
    message: string,
  ) {
    super(message);
  }
}
const clone = <T>(value: T): T => structuredClone(value);
const interrupted = () =>
  new Error('Turn interrupted; committed commands and physical work are preserved.');

/** Runtime resources stay out of world checkpoints. Scheduling uses citizen.nextReviewTick. */
export class CitizenRunner {
  private mode: PlannerMode;
  private generation = 0;
  private runId: string;
  private active = new Map<string, Active>();
  private history: CitizenTurnRecord[] = [];
  private ledger?: RequestLedger;
  private fixtures: RecordedTurn[];
  private readonly requestTimeoutMs: number;
  private readonly model: string;
  private readonly compact: boolean;
  private readonly localCadence: boolean;
  private localScheduled = new Set<string>();
  private localAttemptTicks = new Map<string, number>();
  private readonly minRequestIntervalTicks: number;
  private readonly minRequestIntervalMs: number;
  private readonly maxRequestsPerHour: number;
  private requestStarts: number[] = [];
  private nextAdmissionTick = 0;
  private nextAdmissionMs = 0;
  private citizenTicks = 0;
  private totalRequests = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private readonly limits: Required<
    Pick<
      CitizenRunnerOptions,
      | 'reviewInterval'
      | 'maxConcurrent'
      | 'maxRequestsPerTurn'
      | 'maxToolsPerTurn'
      | 'maxOutputTokens'
      | 'maxRecords'
    >
  >;

  constructor(
    private readonly host: CitizenHost,
    private readonly options: CitizenRunnerOptions = {},
  ) {
    this.mode = options.mode ?? 'scripted';
    this.compact = options.contextMode !== 'legacy';
    this.model =
      options.model ??
      process.env.PROSPER_MODEL ??
      (this.compact ? 'qwen3.5:9b' : 'deepseek-v4.1-flash:cloud');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(this.model))
      throw new Error('Invalid model identifier.');
    this.localCadence =
      this.compact &&
      options.verifiedLocalModel === this.model &&
      !/cloud/i.test(this.model) &&
      options.provider !== 'openai';
    this.minRequestIntervalTicks =
      options.minRequestIntervalTicks ?? (this.localCadence ? 0 : this.compact ? 120 : 0);
    this.minRequestIntervalMs =
      options.minRequestIntervalMs ?? (this.localCadence ? 1000 : this.compact ? 30000 : 0);
    this.maxRequestsPerHour =
      options.maxRequestsPerHour ?? (this.localCadence ? 600 : this.compact ? 30 : 10000);
    if (
      !Number.isSafeInteger(this.maxRequestsPerHour) ||
      this.maxRequestsPerHour < 1 ||
      this.maxRequestsPerHour > 10000
    )
      throw new Error('Invalid maximum requests per hour.');
    for (const value of [this.minRequestIntervalTicks, this.minRequestIntervalMs])
      if (!Number.isSafeInteger(value) || value < 0 || value > 600000)
        throw new Error('Invalid global request spacing.');
    this.runId = host.world().runId;
    this.ledger = options.ledger;
    this.fixtures = clone(options.recorded ?? []);
    this.limits = {
      reviewInterval: this.compact ? 600 : REVIEW_COOLDOWN_TICKS,
      maxConcurrent: this.compact ? 1 : 4,
      maxRequestsPerTurn: this.compact ? 1 : 4,
      maxToolsPerTurn: 32,
      maxOutputTokens: this.compact ? 1200 : 40000,
      maxRecords: 100,
    };
    const maxima = {
      reviewInterval: 10000,
      maxConcurrent: 100,
      maxRequestsPerTurn: 8,
      maxToolsPerTurn: 32,
      maxOutputTokens: 128000,
      maxRecords: 1000,
    };
    for (const key of Object.keys(this.limits) as (keyof typeof this.limits)[]) {
      const value = options[key];
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 1 || value > maxima[key])
          throw new Error(`Invalid runner limit: ${key}`);
        this.limits[key] = value;
      }
    }
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? Number(process.env.PROSPER_REQUEST_TIMEOUT_MS ?? 120000);
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1 ||
      this.requestTimeoutMs > 600000
    )
      throw new Error('Invalid requestTimeoutMs: expected 1–600000 milliseconds.');
    this.validateMode(this.mode);
  }
  private validateMode(mode: PlannerMode): void {
    if (!['scripted', 'live', 'recorded'].includes(mode))
      throw new Error('Mode must be scripted, live or recorded.');
    if (mode === 'recorded' && this.options.recorded === undefined)
      throw new Error('Recorded mode requires explicitly imported fixtures; no live fallback.');
  }
  setMode(mode: PlannerMode): void {
    this.validateMode(mode);
    if (mode === this.mode) return;
    this.interrupt('mode change');
    this.mode = mode;
  }
  /** Fast, synchronous invalidation. Does not wait for a cooperative provider. */
  interrupt(reason = 'runtime interruption'): void {
    this.generation++;
    for (const [id, turn] of this.active) {
      turn.record.status = 'interrupted';
      turn.record.notes.push(reason);
      turn.record.elapsedMs = Date.now() - turn.started;
      const citizen = this.host.world().citizens[id];
      if (this.host.world().runId === turn.record.runId && citizen) {
        citizen.nextReviewTick = this.host.world().tick;
        delete citizen.review; // Interrupted inference needs a fresh context even with work queued.
      }
      turn.controller.abort();
      this.emit(turn.record);
    }
    this.active.clear();
  }
  /** Call after host tickWorld, without awaiting; physical time is owned by the host. */
  tick(): void {
    const world = this.host.world();
    this.citizenTicks += Object.values(world.citizens).filter((c) => c.alive).length;
    if (world.runId !== this.runId) {
      this.interrupt('run changed');
      this.runId = world.runId;
      this.localScheduled.clear();
      this.localAttemptTicks.clear();
    }
    if (this.mode === 'live') {
      // Cheap global admission first: never construct 100 observations merely to poll a budget.
      if (world.tick < this.nextAdmissionTick || Date.now() < this.nextAdmissionMs) return;
      if (!this.hasHourlyCapacity()) return;
      const budget = this.liveLedger().status();
      if (
        budget.error ||
        budget.blocked?.reason === 'requests' ||
        budget.tokens >= budget.maxTokens
      )
        return;
    }
    const idle = (citizen: World['citizens'][string]) =>
      !citizen.action &&
      !citizen.queue.length &&
      !citizen.plan &&
      citizen.strategy?.status !== 'active';
    if (this.mode === 'live' && this.localCadence) {
      for (const citizen of Object.values(world.citizens)) {
        if (this.localScheduled.has(citizen.id)) continue;
        this.localScheduled.add(citizen.id);
        // Bring both a restored rare-review backlog and newborns into the local
        // queue. One inference remains in flight; small deterministic offsets
        // spread initial admissions without making successful citizens invisible.
        const offset = (Number(citizen.id.split('-').at(-1)) || 0) % 120;
        citizen.nextReviewTick = Math.min(citizen.nextReviewTick, world.tick + offset);
      }
    }
    for (const citizen of Object.values(world.citizens).sort(
      (a, b) =>
        (this.mode === 'live' && this.localCadence
          ? Math.max(
              a.review?.strategicTick ?? -1,
              a.autonomy?.reviewedTick ?? -1,
              this.localAttemptTicks.get(a.id) ?? -1,
            ) -
              Math.max(
                b.review?.strategicTick ?? -1,
                b.autonomy?.reviewedTick ?? -1,
                this.localAttemptTicks.get(b.id) ?? -1,
              ) || a.nextReviewTick - b.nextReviewTick
          : 0) ||
        (this.mode === 'live'
          ? foodRisk(b) - foodRisk(a) ||
            (foodRisk(a) > 0
              ? foodRunwayTicks(a) +
                a.health / BALANCE.starvationDamage -
                (foodRunwayTicks(b) + b.health / BALANCE.starvationDamage)
              : 0) ||
            Number(idle(b)) - Number(idle(a))
          : 0) ||
        a.nextReviewTick - b.nextReviewTick ||
        a.id.localeCompare(b.id),
    )) {
      if (this.mode === 'scripted' && citizen.autonomy) continue;
      if (this.active.size >= this.limits.maxConcurrent) break;
      // Recovery rearms a future food warning without repeatedly waking for the same shortage.
      if (citizen.review)
        citizen.review.foodRisk = Math.min(citizen.review.foodRisk, foodRisk(citizen)) as 0 | 1 | 2;
      if (citizen.alive && citizen.nextReviewTick <= world.tick && !this.active.has(citizen.id)) {
        // Autonomous citizens already execute a full local mind. Its routine events
        // are evidence for the next strategic review, never individual paid wakeups.
        const reason =
          this.mode === 'scripted'
            ? 'scheduled review'
            : this.compact && citizen.autonomy
              ? strategicReviewReason(citizen, world.tick, this.localCadence)
              : reviewReason(world, citizen);
        if (reason) {
          void this.startTurn(citizen.id, reason);
          if (this.mode === 'live' && this.compact) break;
        } else if (this.compact && citizen.autonomy)
          citizen.nextReviewTick = world.tick + this.limits.reviewInterval;
      }
    }
  }
  /** Explicit fresh review; returns the existing promise when this citizen is already thinking. */
  startTurn(citizenId: string, reason = 'explicit review'): Promise<void> {
    const world = this.host.world();
    if (world.runId !== this.runId) {
      this.interrupt('run changed');
      this.runId = world.runId;
    }
    const existing = this.active.get(citizenId);
    if (existing) return existing.done;
    const citizen = world.citizens[citizenId];
    if (!citizen?.alive) return Promise.resolve();
    if (this.mode === 'live') {
      if (
        this.compact &&
        (this.active.size >= this.limits.maxConcurrent ||
          world.tick < this.nextAdmissionTick ||
          Date.now() < this.nextAdmissionMs ||
          !this.hasHourlyCapacity())
      )
        return Promise.resolve();
      const ledger = this.liveLedger();
      const budget = ledger.status();
      if (budget.error || budget.blocked?.reason === 'requests') return Promise.resolve();
      const bytes = Buffer.byteLength(
        JSON.stringify(this.payload(this.context(this.host.observe(citizenId)))),
      );
      // A citizen-specific failure is not global: another smaller fresh context
      // may fit. Only budget() remembers the all-citizen preflight blockage.
      if (
        bytes <= 128000 &&
        ledger.checkCapacity(bytes + this.limits.maxOutputTokens, this.compact)
      )
        return Promise.resolve();
    }
    const previousReviewSequence = citizen.review?.eventSequence ?? 0;
    if (this.localCadence) this.localAttemptTicks.set(citizenId, world.tick);
    citizen.nextReviewTick = world.tick + this.limits.reviewInterval;
    if (this.mode !== 'scripted') citizen.review = reviewState(world, citizen);
    if (this.compact && citizen.autonomy && citizen.review)
      citizen.review.strategicTick = world.tick;
    const record: CitizenTurnRecord = {
      id: randomUUID(),
      runId: world.runId,
      citizenId,
      tick: world.tick,
      generation: this.generation,
      mode: this.mode,
      promptVersion: this.compact ? STRATEGIC_PROMPT_VERSION : PROMPT_VERSION,
      status: 'thinking',
      reason,
      observation: '',
      calls: [],
      requests: [],
      toolEvents: [],
      commandIdentities: [],
      notes:
        this.mode === 'scripted'
          ? ['Scripted mechanical demonstration; not an evaluation of live reasoning or emergence.']
          : this.mode === 'recorded'
            ? ['Imported fixture responses; not a live model evaluation.']
            : [],
    };
    const turn: Active = {
      record,
      controller: new AbortController(),
      done: Promise.resolve(),
      started: Date.now(),
      previousReviewSequence,
    };
    if (this.mode === 'recorded') {
      const index = this.fixtures.findIndex((fixture) => fixture.citizenId === citizenId);
      if (index >= 0) turn.fixture = this.fixtures.splice(index, 1)[0];
    }
    this.active.set(citizenId, turn);
    if (this.mode === 'live') {
      this.nextAdmissionTick = world.tick + this.minRequestIntervalTicks;
      this.nextAdmissionMs = Date.now() + this.minRequestIntervalMs;
    }
    this.history.push(record);
    this.trimRecords();
    turn.done = Promise.resolve()
      .then(() => this.execute(turn))
      .catch(() => {});
    return turn.done;
  }
  records(): CitizenTurnRecord[] {
    return clone(this.history);
  }
  status(): { mode: PlannerMode; generation: number; thinking: string[]; error?: string } {
    const error = this.ledger?.status().error;
    return {
      mode: this.mode,
      generation: this.generation,
      thinking: [...this.active.keys()],
      ...(error ? { error } : {}),
    };
  }
  metrics() {
    return {
      model: this.model,
      inferenceProfile: this.localCadence ? 'verified-local' : 'metered',
      maxRequestsPerTurn: this.limits.maxRequestsPerTurn,
      maxOutputTokens: this.limits.maxOutputTokens,
      maxConcurrent: this.limits.maxConcurrent,
      reviewInterval: this.limits.reviewInterval,
      minRequestIntervalTicks: this.minRequestIntervalTicks,
      minRequestIntervalMs: this.minRequestIntervalMs,
      maxRequestsPerHour: this.maxRequestsPerHour,
      totalRequests: this.totalRequests,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      citizenTicks: this.citizenTicks,
      requestsPer1000CitizenTicks: this.citizenTicks
        ? (this.totalRequests * 1000) / this.citizenTicks
        : 0,
    };
  }
  private hasHourlyCapacity() {
    const now = Date.now();
    this.requestStarts = this.requestStarts.filter((time) => time > now - 3600000);
    let starts: number[];
    try {
      starts =
        this.compact && this.mode === 'live'
          ? this.liveLedger().recentReservationTimes(now - 3600000)
          : this.requestStarts;
    } catch {
      return false;
    } // Accounting failure closes inference, never the physical clock.
    return (
      starts.length < this.maxRequestsPerHour &&
      (!this.compact || starts.every((time) => now - time >= this.minRequestIntervalMs))
    );
  }
  budget(): RequestBudgetStatus {
    if (this.compact && this.mode === 'live') return this.liveLedger().status();
    if (this.mode === 'live') {
      const ledger = this.liveLedger();
      const status = ledger.status();
      if (!status.error) {
        // Restored runners have no failed turn to inspect. Only suppress globally
        // when no fresh citizen request fits: continuations can be larger than
        // fresh contexts, and citizens have different observation sizes.
        let smallest = Infinity;
        for (const citizen of Object.values(this.host.world().citizens)) {
          if (!citizen.alive || this.active.has(citizen.id)) continue;
          const bytes = Buffer.byteLength(
            JSON.stringify(this.payload(this.context(this.host.observe(citizen.id)))),
          );
          if (bytes <= 128000) smallest = Math.min(smallest, bytes + this.limits.maxOutputTokens);
        }
        if (smallest !== Infinity) {
          try {
            ledger.checkCapacity(smallest);
          } catch {
            // Accounting failures are exposed by status below, never permission to spend.
          }
        }
      }
      return ledger.status();
    }
    return (
      this.ledger?.status() ?? {
        requests: 0,
        pending: 0,
        spent: 0,
        limit: this.options.ledgerOptions?.maxRequests ?? 100,
        unit: 'requests',
        tokens: 0,
        maxTokens: this.options.ledgerOptions?.maxTokens ?? 100000,
      }
    );
  }
  private liveLedger(): RequestLedger {
    return (this.ledger ??= new RequestLedger(this.options.ledgerOptions));
  }
  private context(
    observation: CitizenObservation,
    sinceSequence = observation.citizen.review?.eventSequence ?? 0,
  ) {
    const messages = this.compact
      ? strategicContext(observation, sinceSequence)
      : freshContext(observation, this.limits.reviewInterval);
    if (this.localCadence)
      messages[0].content +=
        '\nThis is verified local inference: policy reviews recur after 600 ticks, subject to the shared fair queue. Set reviewAfter:600. Reconsider stale specialization, prices, territorial disputes and alliances using the supplied evidence.';
    return messages;
  }
  private parseDecision(value: unknown): StrategySpec {
    return this.compact
      ? parseStrategySpec({ mode: 'keep', ...strategicDecisionSchema.parse(value) })
      : parseStrategySpec(value);
  }
  private payload(messages: ChatMessage[]): ProviderPayload {
    return {
      model: this.model,
      reasoning_effort: this.options.reasoningEffort ?? (this.compact ? 'none' : 'low'),
      max_tokens: this.limits.maxOutputTokens,
      stream: false,
      messages: clone(messages),
      tools: this.options.legacyPlanningTools
        ? [
            ...tools,
            ...legacyTools.filter((tool) =>
              ['draft_plan', 'approve_plan'].includes(tool.function.name),
            ),
          ]
        : this.compact
          ? strategicTools
          : tools,
    };
  }
  private current(turn: Active): boolean {
    const world = this.host.world();
    return (
      !turn.controller.signal.aborted &&
      turn.record.generation === this.generation &&
      world.runId === turn.record.runId &&
      world.citizens[turn.record.citizenId]?.alive === true &&
      this.active.get(turn.record.citizenId) === turn
    );
  }
  private guard(turn: Active): void {
    if (!this.current(turn)) throw interrupted();
  }
  private trimRecords(): void {
    const activeRecords = new Set([...this.active.values()].map((turn) => turn.record));
    let excess =
      this.history.filter((record) => !activeRecords.has(record)).length - this.limits.maxRecords;
    this.history = this.history.filter((record) => activeRecords.has(record) || excess-- <= 0);
  }
  private emit(record: CitizenTurnRecord): void {
    try {
      this.host.diagnostic(clone(record));
    } catch {
      /* Diagnostics must not pause physical work. */
    }
  }
  private commit(
    turn: Active,
    command: Command,
    commandId: string,
    requestId?: string,
  ): CommandResult {
    this.guard(turn);
    const tick = this.host.world().tick;
    const result = this.host.command(turn.record.citizenId, command);
    turn.record.calls.push({ command: clone(command), result: clone(result) });
    turn.record.commandIdentities.push({ commandId, tick, ...(requestId ? { requestId } : {}) });
    this.emit(turn.record); // already entered synchronous commits are never replayed
    return result;
  }
  private async execute(turn: Active): Promise<void> {
    const record = turn.record;
    try {
      this.guard(turn);
      const observation = clone(this.host.observe(record.citizenId));
      record.observation = this.compact
        ? (this.context(observation, turn.previousReviewSequence)[1].content ?? '')
        : JSON.stringify(observation);
      this.emit(record);
      if (record.mode === 'scripted') {
        if (!observation.citizen.autonomy)
          for (const [index, command] of scriptedCommands(observation).entries())
            this.commit(turn, command, `${record.id}:script:${index}`);
        record.response = 'Scripted basic survival/tool progression demonstration.';
      } else {
        await this.toolLoop(
          turn,
          this.context(observation, turn.previousReviewSequence),
          observation.tick,
        );
      }
      this.guard(turn);
      record.status = 'completed';
    } catch (error) {
      if (record.status === 'interrupted') return;
      if (this.current(turn) && (error instanceof TurnYield || error instanceof BudgetExhausted)) {
        record.status = 'yielded';
        record.stopReason =
          error instanceof TurnYield ? error.stopReason : `budget_${error.blocked.reason}`;
        record.notes.push(error.message);
      } else {
        record.status = this.current(turn) ? 'error' : 'interrupted';
        record.error =
          error instanceof Error
            ? error.message
            : 'Citizen planner failed; physical work continues.';
      }
    } finally {
      // A slow request must not consume the cooldown and immediately retrigger while idle.
      if (record.mode !== 'scripted' && this.current(turn)) {
        const world = this.host.world();
        const citizen = world.citizens[record.citizenId];
        citizen.nextReviewTick = Math.max(
          citizen.nextReviewTick,
          world.tick + this.limits.reviewInterval,
        );
        if (this.compact && citizen.autonomy) {
          citizen.nextReviewTick = this.localCadence
            ? world.tick + this.limits.reviewInterval
            : Math.max(citizen.nextReviewTick, citizen.strategy?.reviewTick ?? world.tick + 4800);
          // Provider failures back off while the local mind keeps acting.
          if (!this.localCadence && (record.status === 'error' || record.status === 'yielded'))
            citizen.nextReviewTick = Math.max(citizen.nextReviewTick, world.tick + 4800);
        }
        if (citizen.review && (record.status === 'completed' || record.status === 'yielded')) {
          // Learn in simulation ticks, automatically following runtime speed. This
          // is a lead for overlap, never a physical-work quota or extra budget.
          citizen.review.replanLeadTicks = Math.min(
            1000,
            Math.max(120, Math.ceil((world.tick - record.tick) * 1.25)),
          );
        }
        // A failed answer has not acknowledged the reason we woke for.
        if (record.status === 'error' || record.stopReason === 'output_limit')
          delete citizen.review;
      }
      record.elapsedMs = Date.now() - turn.started;
      if (this.active.get(record.citizenId) === turn) this.active.delete(record.citizenId);
      this.trimRecords();
      this.emit(record);
    }
  }
  private emergencyFeedback(turn: Active) {
    const world = this.host.world();
    const citizen = world.citizens[turn.record.citizenId];
    const events = world.events.filter(
      (event) =>
        event.kind === 'emergency' &&
        (event.citizenId === citizen.id || event.audience?.includes(citizen.id)) &&
        Number(event.id.slice(event.id.lastIndexOf('-') + 1)) >
          (turn.emergencySequence ?? world.nextId - 1),
    );
    // Durable notes catch a completed burst even if the bounded world event buffer aged out.
    const notes = citizen.memories.filter(
      (note) =>
        /^Emergency feeding at tick \d+: /.test(note.text) &&
        !turn.emergencyNotes?.includes(JSON.stringify(note)),
    );
    const changed = JSON.stringify(citizen.emergency ?? null) !== turn.emergencyState;
    if (!events.length && !notes.length && !changed) return undefined;
    return {
      ok: false as const,
      code: 'emergency_state_changed',
      message:
        'Emergency feeding changed your work/state during this request. This consequential decision was not applied; reconsider using the fresh evidence. Existing work remains. Memory/messages and keep-only acknowledgements may still commit.',
      events: events.slice(-8),
      emergencyNotes: notes.slice(-4),
      // The next iteration supplies one complete fresh primary observation.
      // Never embed it per rejected call: a batch can otherwise exceed 128KB.
      observationRefresh: 'next-request' as const,
    };
  }
  private async toolLoop(
    turn: Active,
    messages: ChatMessage[],
    observationTick: number,
  ): Promise<void> {
    let executed = 0;
    const seen = new Set<string>();
    for (let index = 0; index < this.limits.maxRequestsPerTurn; index++) {
      this.guard(turn);
      if (index > 0) {
        // Refresh only existing recovery/query requests; retain receipts and IDs,
        // without rebasing the original review's event acknowledgements.
        const observation = this.host.observe(turn.record.citizenId);
        observationTick = observation.tick;
        messages = [
          ...this.context(observation, turn.previousReviewSequence),
          ...messages.filter((message) => message.role === 'assistant' || message.role === 'tool'),
        ];
      }
      const finalApprovalSlot = index === this.limits.maxRequestsPerTurn - 1 && !!turn.draft;
      if (finalApprovalSlot)
        messages.push({
          role: 'user',
          content: `This is the final request of the turn. The latest valid draftId is ${turn.draft!.id}. Use approve_plan to commit it if appropriate; conditional discovery/route warnings are not approval failures. You may instead choose no work. No more whole-list revisions fit in this turn. Physical work already approved continues throughout reasoning.`,
        });
      const payload = this.payload(messages);
      if (finalApprovalSlot)
        payload.tools = [
          ...tools,
          ...legacyTools.filter((tool) => tool.function.name === 'approve_plan'),
        ];
      // Snapshot an event sequence, not a physics timestamp: routine ticks do not invalidate intent.
      turn.emergencySequence = this.host.world().nextId - 1;
      const requestCitizen = this.host.world().citizens[turn.record.citizenId];
      turn.emergencyNotes = requestCitizen.memories
        .filter((note) => /^Emergency feeding at tick \d+: /.test(note.text))
        .map((note) => JSON.stringify(note));
      turn.emergencyState = JSON.stringify(requestCitizen.emergency ?? null);
      turn.requestStrategy = clone(requestCitizen.strategy);
      turn.requestPolicyRevision = requestCitizen.autonomy?.policyRevision ?? 0;
      const bytes = Buffer.byteLength(JSON.stringify(payload));
      if (bytes > 128000)
        throw new Error(
          'Fresh request exceeds 128KB context bound; compact goals/memory or reduce observation size. No request sent.',
        );
      let requestId = `${turn.record.id}:fixture:${index}`;
      let response: ProviderResponse;
      if (turn.record.mode === 'recorded') {
        const fixture = turn.fixture?.responses[index];
        if (!fixture) throw new Error('Imported recorded fixture exhausted; no live fallback.');
        turn.record.requests.push({ requestId, payload: clone(payload), observationTick });
        response = validateResponse(clone(fixture));
      } else {
        this.ledger ??= new RequestLedger(this.options.ledgerOptions);
        // UTF-8 bytes are a conservative input estimate, not a verified tokenizer or dollar cost.
        const reservation = this.ledger.reserve(
          {
            runId: turn.record.runId,
            turnId: turn.record.id,
            citizenId: turn.record.citizenId,
            inputTokens: bytes,
            maxOutputTokens: this.limits.maxOutputTokens,
          },
          this.compact
            ? {
                minIntervalMs: this.minRequestIntervalMs,
                maxRequestsPerHour: this.maxRequestsPerHour,
              }
            : undefined,
        );
        requestId = reservation.requestId;
        this.totalRequests++;
        this.requestStarts.push(Date.now());
        turn.record.requests.push({ requestId, payload: clone(payload), observationTick });
        response = await this.request(turn, requestId, payload);
      }
      this.guard(turn);
      turn.record.requests.at(-1)!.finishReason = response.finishReason;
      if (response.usage) {
        turn.record.inputTokens = (turn.record.inputTokens ?? 0) + response.usage.inputTokens;
        turn.record.outputTokens = (turn.record.outputTokens ?? 0) + response.usage.outputTokens;
        this.totalInputTokens += response.usage.inputTokens;
        this.totalOutputTokens += response.usage.outputTokens;
      }
      // Small models may lack tool support. A strict JSON object is the same
      // decision surface, without a second inference to wrap it in a tool call.
      let calls = response.toolCalls ?? [];
      if (
        this.compact &&
        turn.record.mode === 'live' &&
        !calls.length &&
        response.content?.trim() &&
        response.finishReason !== 'length'
      ) {
        try {
          const text = response.content
            .trim()
            .replace(/^```(?:json)?\s*/, '')
            .replace(/\s*```$/, '');
          const decision: unknown = JSON.parse(text);
          this.parseDecision(decision);
          calls = [
            {
              id: `${turn.record.id}:json`,
              name: 'set_policy',
              arguments: JSON.stringify(decision),
            },
          ];
        } catch {
          throw new TurnYield(
            'invalid_decision',
            'Model returned no valid structured policy. Existing local behavior continues; no correction call was sent.',
          );
        }
      }
      const outputLimited = response.finishReason === 'length';
      if (response.content) turn.record.response = response.content;
      if (!calls.length) {
        if (outputLimited)
          throw new TurnYield(
            'output_limit',
            'Provider output limit reached before a complete answer or tool call. Reasoning may consume the output allowance; no retry was sent within this turn.',
          );
        if (!response.content?.trim())
          throw new Error(
            `Provider returned no visible response or tool calls (${response.usage?.outputTokens ?? 'unknown'} output tokens, allowance ${this.limits.maxOutputTokens}). This is not a completed review.`,
          );
        return;
      }
      messages.push({
        role: 'assistant',
        content: response.content ?? null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      let needsFeedback = false;
      for (const call of calls) {
        this.guard(turn);
        if (executed >= this.limits.maxToolsPerTurn)
          throw new TurnYield(
            'tool_limit',
            'Turn tool limit reached; remaining calls were not executed. Committed effects retained; continue unfinished intent on a fresh turn.',
          );
        executed++;
        let result: unknown;
        if (seen.has(call.id))
          result = {
            ok: false,
            code: 'duplicate_call',
            message:
              'Tool call ID already handled this turn; not executed again. Use a new ID for a genuinely different action.',
          };
        else {
          seen.add(call.id);
          try {
            if (this.compact && turn.record.mode === 'live' && call.name !== 'set_policy')
              throw new Error(
                'The compact strategic function accepts only set_policy; physical/query tools are available only through the legacy debug harness.',
              );
            const args: unknown = JSON.parse(call.arguments);
            if ((!this.compact && call.name === 'set_strategy') || call.name === 'set_policy') {
              if (turn.approved)
                throw new Error(
                  'This review already committed a decision. Choose new work in a fresh review.',
                );
              const spec = this.parseDecision(args);
              const consequential = spec.mode !== 'keep';
              const currentCitizen = this.host.world().citizens[turn.record.citizenId];
              const superseded =
                this.compact &&
                (currentCitizen.autonomy?.policyRevision ?? 0) !== turn.requestPolicyRevision;
              const stale = superseded
                ? {
                    ok: false,
                    code: 'policy_superseded',
                    message:
                      'A newer explicit policy committed during inference. This older response was not applied; local behavior continues without a retry.',
                  }
                : consequential
                  ? (this.emergencyFeedback(turn) ??
                    completedWorkFeedback(
                      turn.requestStrategy,
                      this.host.world().citizens[turn.record.citizenId],
                      spec,
                      observationTick,
                    ))
                  : undefined;
              if (stale) result = stale;
              else {
                this.guard(turn);
                const world = this.host.world();
                const citizenId = turn.record.citizenId;
                const previousPolicy = clone(world.citizens[citizenId].autonomy?.policy);
                let metadataIndex = 0;
                result = commitStrategy(world, citizenId, spec, {
                  command: (command: Command) =>
                    this.commit(
                      turn,
                      command,
                      `${turn.record.id}:${call.id}:metadata:${metadataIndex++}`,
                      requestId,
                    ),
                  cancel: () => cancelAction(world, citizenId),
                });
                if ((result as CommandResult).ok) {
                  turn.approved = true;
                  turn.decisionKind = 'strategy';
                  const citizen = world.citizens[citizenId];
                  turn.record.policyOutcome =
                    JSON.stringify(previousPolicy) === JSON.stringify(citizen.autonomy?.policy)
                      ? 'continued'
                      : 'changed';
                  if (citizen.autonomy) {
                    citizen.autonomy.source = turn.record.mode;
                    citizen.autonomy.reviewedTick = world.tick;
                  }
                  // This empty marker is the decision just committed, not an unseen work outcome.
                  // Leave event/mail/food acknowledgements at the original context boundary.
                  if (citizen.review && citizen.strategy && !citizen.strategy.directives.length)
                    citizen.review.planningWorkId = `${citizen.strategy.id}:${citizen.strategy.status}`;
                  turn.record.commandIdentities.push({
                    commandId: `${turn.record.id}:${call.id}`,
                    tick: world.tick,
                    requestId,
                  });
                  turn.record.notes.push(
                    'Strategy committed; existing work continues unless explicitly replaced.',
                  );
                }
              }
            } else if (call.name === 'draft_plan') {
              if (turn.approved)
                throw new Error(
                  'This turn already approved a plan; draft again in a fresh review.',
                );
              if (finalApprovalSlot)
                throw new Error(
                  'The final request is reserved for approving the latest draft or choosing no work, not another revision.',
                );
              const spec = parsePlanSpec(args);
              const observation = this.host.observe(turn.record.citizenId);
              const forecast = forecastPlan(observation, spec);
              const draftId = randomUUID();
              turn.draft = { id: draftId, spec: clone(spec) };
              result = {
                ok: true,
                draftId,
                forecast,
                requestsRemaining: this.limits.maxRequestsPerTurn - index - 1,
                message:
                  'Draft only: no work cancelled, inputs reserved or plan started. Review conditional estimates, then approve this draftId if appropriate. Whole-list revisions cost another request; preserve the final request for approval. Discovery-dependent gathering is checked locally after travel. Draft expires when this turn ends.',
              };
            } else if (call.name === 'approve_plan') {
              if (
                !args ||
                typeof args !== 'object' ||
                Array.isArray(args) ||
                Object.keys(args).length !== 1 ||
                typeof (args as { draftId?: unknown }).draftId !== 'string'
              )
                throw new Error('approve_plan requires only {"draftId":"the latest draft ID"}.');
              const draftId = (args as { draftId: string }).draftId;
              if (turn.approved || !turn.draft || turn.draft.id !== draftId)
                throw new Error(
                  'No matching latest draft in this turn. Submit the complete plan with draft_plan first; old revisions and other turns cannot approve.',
                );
              this.guard(turn);
              const world = this.host.world();
              const citizenId = turn.record.citizenId;
              const spec = parsePlanSpec(turn.draft.spec);
              const forecast = forecastPlan(this.host.observe(citizenId), spec);
              const stale = this.emergencyFeedback(turn);
              const approval =
                stale ??
                approvePlan(world, citizenId, spec, {
                  cancel: () => cancelAction(world, citizenId),
                });
              result = { ...approval, forecast, forecastTick: world.tick };
              if (approval.ok) {
                turn.approved = true;
                turn.decisionKind = 'plan';
                delete turn.draft;
                turn.record.commandIdentities.push({
                  commandId: `${turn.record.id}:${call.id}`,
                  tick: world.tick,
                  requestId,
                });
                turn.record.notes.push(
                  'Approved plan committed; this reasoning turn ends after remaining calls in this response.',
                );
              }
            } else if (call.name === 'command') {
              const command = parseCommand(args);
              const work = [
                'move',
                'harvest',
                'craft',
                'build',
                'refine',
                'attack',
                'loot',
                'reproduce',
                'cancel',
              ].includes(command.type);
              if ((turn.draft || turn.decisionKind === 'plan') && work)
                throw new Error(
                  'Physical work must use draft_plan/approve_plan while planning. Drafts do not alter existing work; choose mode=replace explicitly if needed. Memory/goals and social/market commands remain available.',
                );
              const consequential = !['remember', 'goals', 'message', 'consent'].includes(
                command.type,
              );
              result =
                (consequential ? this.emergencyFeedback(turn) : undefined) ??
                this.commit(turn, command, `${turn.record.id}:${call.id}`, requestId);
            } else if (call.name === 'query_tile')
              result = queryTile(args, this.host.observe(turn.record.citizenId));
            else
              result = {
                ok: false,
                code: 'unknown_tool',
                message:
                  'Available tools: set_strategy, command, query_tile. message/remember/goals are command types, not tool names. Use set_strategy metadata or command({"type":"message","text":"..."}). Legacy draft_plan/approve_plan are debug compatibility only.',
              };
          } catch (error) {
            this.guard(turn);
            result = {
              ok: false,
              code: 'invalid_tool',
              message:
                error instanceof SyntaxError
                  ? 'Arguments must be a valid JSON object matching the tool schema.'
                  : error instanceof Error
                    ? error.message
                    : 'Tool failed; inspect state before retrying.',
            };
          }
        }
        if (
          call.name === 'query_tile' ||
          call.name === 'draft_plan' ||
          (result as { ok?: boolean })?.ok === false
        )
          needsFeedback = true;
        turn.record.toolEvents.push({
          id: call.id,
          requestId,
          name: call.name,
          arguments: call.arguments,
          result: clone(result),
          tick: this.host.world().tick,
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        this.emit(turn.record);
      }
      if (outputLimited)
        throw new TurnYield(
          'output_limit',
          'Provider output limit reached. Valid committed tool effects retained; response was not fully completed.',
        );
      // Explicit approval is the end-turn boundary: no redundant acknowledgement request.
      if (turn.approved || !needsFeedback) return;
      if (executed >= this.limits.maxToolsPerTurn)
        throw new TurnYield(
          'tool_limit',
          'Turn tool limit reached; review yielded without full completion. Committed effects retained; continue on a fresh turn.',
        );
    }
    throw new TurnYield(
      'request_limit',
      'Turn request limit reached; review yielded without full completion. Committed effects retained; resume unfinished intent through durable goals.',
    );
  }
  private async request(
    turn: Active,
    requestId: string,
    payload: ProviderPayload,
  ): Promise<ProviderResponse> {
    const started = performance.now();
    const requestRecord = turn.record.requests.find((request) => request.requestId === requestId)!;
    const controller = new AbortController();
    const signal = controller.signal;
    let onAbort: () => void = () => {};
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort();
        reject(interrupted());
      };
      turn.controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new Error(
            `Provider request deadline exceeded (${this.requestTimeoutMs}ms); uncertain usage remains reserved, physical work continues.`,
          ),
        );
      }, this.requestTimeoutMs);
    });
    // The receipt path may settle after invalidation, but has no command authority.
    const receipt = Promise.resolve()
      .then(() => {
        this.guard(turn);
        return (
          this.options.transport ??
          ((this.options.provider ??
            (this.compact && !this.model.includes('cloud') ? 'native' : 'openai')) === 'native'
            ? ollamaNativeTransport
            : ollamaTransport)
        )({
          requestId,
          runId: turn.record.runId,
          turnId: turn.record.id,
          citizenId: turn.record.citizenId,
          generation: turn.record.generation,
          payload,
          signal,
          onTiming: (timing) => {
            if (!this.current(turn)) return;
            const safe: TransportTiming = {};
            for (const key of ['headerWaitMs', 'bodyReadMs', 'parseMs'] as const) {
              const value = timing[key];
              if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
                safe[key] = value;
            }
            requestRecord.transportTiming = safe;
          },
        });
      })
      .then(
        (raw) => {
          const response = validateResponse(raw);
          this.ledger!.settle(requestId, response.usage);
          return response;
        },
        (error: unknown) => {
          if (!signal.aborted) this.ledger!.settle(requestId); // failed send is conservatively charged
          throw new Error(
            error instanceof Error && error.message.startsWith('Local Ollama')
              ? error.message
              : 'Provider request failed; reserved usage retained. Check local Ollama configuration/diagnostics.',
          );
        },
      );
    try {
      return await Promise.race([receipt, abort, deadline]);
    } finally {
      requestRecord.elapsedMs = performance.now() - started;
      clearTimeout(timer!);
      turn.controller.signal.removeEventListener('abort', onAbort);
    }
  }
}
