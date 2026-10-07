import { randomUUID } from 'node:crypto';
import type {
  World,
  CitizenObservation,
  Command,
  CommandResult,
  PlannerMode,
  TurnRecord,
} from '../shared/types.ts';
import { RequestLedger, type RequestLedgerOptions, type RequestBudgetStatus } from './budget.ts';
import { freshContext, PROMPT_VERSION } from './prompt.ts';
import {
  ollamaTransport,
  validateResponse,
  type Transport,
  type ProviderResponse,
  type ChatMessage,
  type ProviderPayload,
} from './provider.ts';
import { parseCommand, queryTile, tools } from './tools.ts';
import { scriptedCommands } from './scripted.ts';

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
  requests: { requestId: string; payload: ProviderPayload }[];
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
  /** Per live request; defaults to PROSPER_REQUEST_TIMEOUT_MS or 120 seconds. */
  requestTimeoutMs?: number;
}
interface Active {
  record: CitizenTurnRecord;
  controller: AbortController;
  done: Promise<void>;
  started: number;
  fixture?: RecordedTurn;
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
    this.runId = host.world().runId;
    this.ledger = options.ledger;
    this.fixtures = clone(options.recorded ?? []);
    this.limits = {
      reviewInterval: 12,
      maxConcurrent: 4,
      maxRequestsPerTurn: 4,
      maxToolsPerTurn: 12,
      maxOutputTokens: 1024,
      maxRecords: 100,
    };
    const maxima = {
      reviewInterval: 10000,
      maxConcurrent: 100,
      maxRequestsPerTurn: 8,
      maxToolsPerTurn: 32,
      maxOutputTokens: 8192,
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
      if (this.host.world().runId === turn.record.runId && citizen)
        citizen.nextReviewTick = this.host.world().tick;
      turn.controller.abort();
      this.emit(turn.record);
    }
    this.active.clear();
  }
  /** Call after host tickWorld, without awaiting; physical time is owned by the host. */
  tick(): void {
    const world = this.host.world();
    if (world.runId !== this.runId) {
      this.interrupt('run changed');
      this.runId = world.runId;
    }
    for (const citizen of Object.values(world.citizens).sort(
      (a, b) => a.nextReviewTick - b.nextReviewTick || a.id.localeCompare(b.id),
    )) {
      if (this.active.size >= this.limits.maxConcurrent) break;
      if (citizen.alive && citizen.nextReviewTick <= world.tick && !this.active.has(citizen.id))
        void this.startTurn(citizen.id, 'scheduled review');
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
    citizen.nextReviewTick = world.tick + this.limits.reviewInterval;
    const record: CitizenTurnRecord = {
      id: randomUUID(),
      runId: world.runId,
      citizenId,
      tick: world.tick,
      generation: this.generation,
      mode: this.mode,
      promptVersion: PROMPT_VERSION,
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
    };
    if (this.mode === 'recorded') {
      const index = this.fixtures.findIndex((fixture) => fixture.citizenId === citizenId);
      if (index >= 0) turn.fixture = this.fixtures.splice(index, 1)[0];
    }
    this.active.set(citizenId, turn);
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
  budget(): RequestBudgetStatus {
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
      record.observation = JSON.stringify(observation);
      this.emit(record);
      if (record.mode === 'scripted') {
        for (const [index, command] of scriptedCommands(observation).entries())
          this.commit(turn, command, `${record.id}:script:${index}`);
        record.response = 'Scripted basic survival/tool progression demonstration.';
      } else {
        await this.toolLoop(turn, freshContext(observation));
      }
      this.guard(turn);
      record.status = 'completed';
    } catch (error) {
      if (record.status === 'interrupted') return;
      record.status = this.current(turn) ? 'error' : 'interrupted';
      record.error =
        error instanceof Error ? error.message : 'Citizen planner failed; physical work continues.';
    } finally {
      record.elapsedMs = Date.now() - turn.started;
      if (this.active.get(record.citizenId) === turn) this.active.delete(record.citizenId);
      this.trimRecords();
      this.emit(record);
    }
  }
  private async toolLoop(turn: Active, messages: ChatMessage[]): Promise<void> {
    let executed = 0;
    const seen = new Set<string>();
    for (let index = 0; index < this.limits.maxRequestsPerTurn; index++) {
      this.guard(turn);
      const payload: ProviderPayload = {
        model: 'deepseek-v4.1-flash:cloud',
        reasoning_effort: 'high',
        max_tokens: this.limits.maxOutputTokens,
        stream: false,
        messages: clone(messages),
        tools,
      };
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
        turn.record.requests.push({ requestId, payload: clone(payload) });
        response = validateResponse(clone(fixture));
      } else {
        this.ledger ??= new RequestLedger(this.options.ledgerOptions);
        // UTF-8 bytes are a conservative input estimate, not a verified tokenizer or dollar cost.
        const reservation = this.ledger.reserve({
          runId: turn.record.runId,
          turnId: turn.record.id,
          citizenId: turn.record.citizenId,
          inputTokens: bytes,
          maxOutputTokens: this.limits.maxOutputTokens,
        });
        requestId = reservation.requestId;
        turn.record.requests.push({ requestId, payload: clone(payload) });
        response = await this.request(turn, requestId, payload);
      }
      this.guard(turn);
      const calls = response.toolCalls ?? [];
      if (response.content) turn.record.response = response.content;
      if (response.usage) {
        turn.record.inputTokens = (turn.record.inputTokens ?? 0) + response.usage.inputTokens;
        turn.record.outputTokens = (turn.record.outputTokens ?? 0) + response.usage.outputTokens;
      }
      if (!calls.length) return;
      messages.push({
        role: 'assistant',
        content: response.content ?? null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const call of calls) {
        this.guard(turn);
        if (++executed > this.limits.maxToolsPerTurn)
          throw new Error(
            'Turn tool limit reached; committed effects retained. Continue via goals on a fresh turn.',
          );
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
            const args: unknown = JSON.parse(call.arguments);
            if (call.name === 'command')
              result = this.commit(
                turn,
                parseCommand(args),
                `${turn.record.id}:${call.id}`,
                requestId,
              );
            else if (call.name === 'query_tile')
              result = queryTile(args, this.host.observe(turn.record.citizenId));
            else
              result = {
                ok: false,
                code: 'unknown_tool',
                message: 'Available tools: command, query_tile. Follow their schemas.',
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
    }
    throw new Error(
      'Turn request limit reached; committed effects retained. Resume unfinished intent through durable goals.',
    );
  }
  private async request(
    turn: Active,
    requestId: string,
    payload: ProviderPayload,
  ): Promise<ProviderResponse> {
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
        return (this.options.transport ?? ollamaTransport)({
          requestId,
          runId: turn.record.runId,
          turnId: turn.record.id,
          citizenId: turn.record.citizenId,
          generation: turn.record.generation,
          payload,
          signal,
        });
      })
      .then(
        (raw) => {
          const response = validateResponse(raw);
          this.ledger!.settle(requestId, response.usage);
          return response;
        },
        () => {
          if (!signal.aborted) this.ledger!.settle(requestId); // failed send is conservatively charged
          throw new Error(
            'Provider request failed; reserved usage retained. Check local Ollama configuration/diagnostics.',
          );
        },
      );
    try {
      return await Promise.race([receipt, abort, deadline]);
    } finally {
      clearTimeout(timer!);
      turn.controller.signal.removeEventListener('abort', onAbort);
    }
  }
}
