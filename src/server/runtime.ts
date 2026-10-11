import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppSnapshot, Command, CommandResult, Control, World } from '../shared/types.ts';
import { createWorld, dispatch, tickWorld } from '../world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../world/observation.ts';
import {
  CitizenRunner,
  RequestLedger,
  type CitizenRunnerOptions,
  type CitizenTurnRecord,
  type RecordedTurn,
} from '../citizen/index.ts';
import { parseCommand } from '../citizen/tools.ts';
import { composedCommandSchema } from './autonomy-checkpoint.ts';
import { validateResponse } from '../citizen/provider.ts';
import { dataDirectory, loadCheckpoint, saveCheckpoint, type Checkpoint } from './checkpoint.ts';
import { projectSpectatorWorld } from './snapshot.ts';
import { BALANCE } from '../world/config.ts';
import { ensureTelemetry, globalHistory, citizenHistory } from '../world/telemetry.ts';
import type { GlobalHistory, CitizenHistory } from '../shared/telemetry-types.ts';
import type { MotionSnapshot } from '../shared/motion-types.ts';

export const controlSchema = z
  .object({
    type: z.enum(['play', 'pause', 'step', 'speed', 'scenario', 'mode', 'checkpoint', 'reset', 'decision-tree-debug']),
    enabled: z.boolean().optional(),
    ticks: z.number().int().min(1).max(10000).optional(),
    speed: z.number().min(0.1).max(100).optional(),
    scenario: z.enum(['village', 'competition', 'progression']).optional(),
    mode: z.enum(['scripted', 'live', 'recorded']).optional(),
    population: z.number().int().min(1).max(250).optional(),
  })
  .strict()
  .refine(
    (control) => control.type === 'decision-tree-debug' ? typeof control.enabled === 'boolean' : control.enabled === undefined,
    'enabled is required only for decision-tree-debug.',
  )
  .refine(
    (control) => control.population === undefined || ['scenario', 'reset'].includes(control.type),
    'population applies only to an explicit scenario or reset.',
  );
export const budgetSchema = z
  .object({
    maxRequests: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maxTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export interface RuntimeOptions {
  /** New runs use the continuous local mind; explicit mechanics fixtures may opt out. */
  autonomy?: boolean;
  /** Explicit legacy-controller creation for LLM/recorded fixtures; user-facing
   * worlds always default to composed. Not advertised on the control API. */
  legacy?: boolean;
  population?: number;
  directory?: string;
  checkpointPath?: string;
  restore?: boolean;
  world?: World;
  runner?: CitizenRunnerOptions;
  autoClock?: boolean;
  checkpointWriter?: typeof saveCheckpoint;
}
export function parseFixtures(value: unknown): RecordedTurn[] {
  const parsed = z
    .array(
      z
        .object({ citizenId: z.string().min(1).max(200), responses: z.array(z.unknown()).max(100) })
        .strict(),
    )
    .max(10000)
    .parse(value);
  return parsed.map((f) => ({
    citizenId: f.citizenId,
    responses: f.responses.map((response) =>
      validateResponse(response as Parameters<typeof validateResponse>[0]),
    ),
  }));
}

/** All commands and ticks enter synchronously on the Node event loop. No remote await in time/checkpoint boundaries. */
export class Runtime {
  world: World;
  readonly directory: string;
  readonly checkpointPath: string;
  runner: CitizenRunner;
  private running = false;
  private speed = 1;
  private decisionTreeDebug = false;
  private state: 'ready' | 'reloading' | 'error' = 'ready';
  private error?: string;
  private diagnosticError?: string;
  private commandSequence = 0;
  private recorded: RecordedTurn[] = [];
  private clock?: ReturnType<typeof setTimeout>;
  private resumeWanted?: boolean;
  private readonly ledger: RequestLedger;
  private readonly motionListeners = new Set<(snapshot: MotionSnapshot) => void>();
  private readonly motionStreamId = randomUUID();
  private lastMotionTickAt = performance.now();
  private motionTickMs = 250;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.directory = dataDirectory(options.directory);
    this.checkpointPath = options.checkpointPath ?? join(this.directory, 'checkpoint.json');
    const cp = options.restore ? loadCheckpoint(this.checkpointPath) : undefined; // never substitute an empty world
    this.world = cp?.world ?? options.world ?? this.freshWorld();
    if (!this.world.controllerMode) this.world.controllerMode = 'legacy'; // older untagged restores are explicitly legacy
    ensureTelemetry(this.world);
    updateKnowledge(this.world);
    this.running = cp?.runtime.running ?? false;
    this.speed = cp?.runtime.speed ?? 1;
    this.decisionTreeDebug = cp?.runtime.decisionTreeDebug ?? false;
    this.commandSequence = cp?.runtime.commandSequence ?? 0;
    this.recorded = structuredClone(cp?.runtime.recorded ?? options.runner?.recorded ?? []);
    this.ledger =
      options.runner?.ledger ??
      new RequestLedger({ ...options.runner?.ledgerOptions, directory: this.directory });
    this.runner = this.makeRunner(cp?.runtime.mode ?? options.runner?.mode ?? 'scripted');
    this.log({
      type: cp ? 'restore' : 'created',
      mode: this.runner.status().mode,
      running: this.running,
    });
    this.schedule(); // rebase: first tick is a full new interval, never wall-clock catchup
  }
  private freshWorld(scenario?: string, seed?: number, population?: number): World {
    const configuredPopulation =
      population ??
      this.options.population ??
      (process.env.PROSPER_POPULATION ? Number(process.env.PROSPER_POPULATION) : undefined);
    // Native composed creation mints rest and mind shells; no post-creation assignment.
    const world = createWorld({
      scenario,
      seed,
      runId: `run-${randomUUID()}`,
      autonomy: false,
      controllerMode: this.options.legacy ? 'legacy' : 'composed',
      population: configuredPopulation,
    });
    const citizens = Object.values(world.citizens);
    for (const [index, citizen] of citizens.entries())
      if (citizen.autonomy)
        citizen.nextReviewTick = world.tick + 600 + Math.floor((index * 4200) / citizens.length);
    ensureTelemetry(world);
    return world;
  }
  private requireSupportedMode(mode: AppSnapshot['status']['mode']): void {
    if (this.world.controllerMode === 'composed' && mode !== 'scripted')
      throw new Error('Composed worlds support Local AI only; live/recorded use the legacy controller.');
  }
  private makeRunner(mode: AppSnapshot['status']['mode']): CitizenRunner {
    this.requireSupportedMode(mode);
    const consumed = new Set<string>();
    const fixtures = this.recorded;
    return new CitizenRunner(
      {
        world: () => this.world,
        observe: (id) => observe(this.world, id),
        command: (id, command) => this.apply(id, command, 'citizen'),
        diagnostic: (record) => this.diagnostic(record, consumed, fixtures),
      },
      {
        ...this.options.runner,
        ledger: this.ledger,
        mode,
        recorded: this.recorded,
        maxRecords: 100,
      },
    );
  }
  private diagnostic(
    record: CitizenTurnRecord,
    consumed: Set<string>,
    fixtures: RecordedTurn[],
  ): void {
    // Capture each runner's fixture ownership: late diagnostics cannot consume a replacement runner's fixtures.
    if (record.mode === 'recorded' && !consumed.has(record.id)) {
      consumed.add(record.id);
      const index = fixtures.findIndex((f) => f.citizenId === record.citizenId);
      if (index >= 0) fixtures.splice(index, 1);
    }
    this.log({ type: 'turn', runId: record.runId, record });
  }
  private log(record: Record<string, unknown> & { runId?: string }): void {
    try {
      const directory = join(this.directory, 'diagnostics');
      mkdirSync(directory, { recursive: true });
      appendFileSync(
        join(directory, `${encodeURIComponent(record.runId ?? this.world.runId)}.jsonl`),
        `${JSON.stringify({ version: 1, codeVersion: 'spike-2-runtime-1', runId: this.world.runId, tick: this.world.tick, time: new Date().toISOString(), ...record })}\n`,
      );
    } catch (error) {
      this.diagnosticError = `Diagnostic write failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  private cancelClock(): void {
    if (this.clock) clearTimeout(this.clock);
    this.clock = undefined;
  }
  private schedule(): void {
    this.cancelClock();
    if (!this.running || this.state !== 'ready' || this.options.autoClock === false) return;
    this.clock = setTimeout(() => {
      this.clock = undefined;
      try {
        this.advance(1);
      } catch (error) {
        this.fail(error);
      }
      this.schedule();
    }, 250 / this.speed);
    this.clock.unref();
  }
  private fail(error: unknown): void {
    this.running = false;
    this.cancelClock();
    this.runner.interrupt('runtime error');
    this.state = 'error';
    this.error = error instanceof Error ? error.message : String(error);
    this.log({ type: 'runtime-error', error: this.error });
    this.publishMotion();
  }
  private advance(count: number): void {
    for (let i = 0; i < count; i++) {
      tickWorld(this.world);
      updateKnowledge(this.world);
      this.log({ type: 'tick', order: this.commandSequence });
      // Core owns composed decisions; never invoke the legacy director/model runner.
      if (this.world.controllerMode !== 'composed') this.runner.tick(); // intentionally not awaited
      const now = performance.now();
      this.motionTickMs = Math.max(1, now - this.lastMotionTickAt);
      this.lastMotionTickAt = now;
      this.publishMotion();
    }
  }
  private available(): void {
    if (this.state !== 'ready')
      throw new Error(this.error ?? 'Backend reloading; controls unavailable.');
  }
  private apply(citizenId: string, command: Command, source: string): CommandResult {
    this.available();
    const order = ++this.commandSequence;
    const known =
      source === 'citizen' ? validateKnownCommand(this.world, citizenId, command) : undefined;
    const result = known && !known.ok ? known : dispatch(this.world, citizenId, command);
    updateKnowledge(this.world);
    this.log({
      type: 'command',
      commandId: `${this.world.runId}:command:${order}`,
      order,
      citizenId,
      source,
      command,
      result,
    });
    return result;
  }
  command(citizenId: string, value: unknown): CommandResult {
    const composed = composedCommandSchema.safeParse(value);
    return this.apply(citizenId, composed.success ? composed.data : parseCommand(value), 'browser');
  }
  observation(citizenId: string) {
    if (!this.world.citizens[citizenId]) throw new Error('Unknown citizen.');
    updateKnowledge(this.world);
    return observe(this.world, citizenId);
  }
  /** Per-tick poses preserve turns; full notebooks/turn transcripts never enter this feed. */
  motionSnapshot(): MotionSnapshot {
    return {
      runId: this.world.runId,
      streamId: this.motionStreamId,
      tick: this.world.tick,
      running: this.running && this.state === 'ready',
      tickMs: Math.min(2000, this.motionTickMs),
      frames: [{ tick: this.world.tick, at: performance.now(), citizens: Object.values(this.world.citizens).map(citizen => {
        const action = citizen.action;
        const next = action?.phase === 'travel' ? action.path[0] : undefined;
        const adjacent = next && Math.abs(next.x - citizen.x) + Math.abs(next.y - citizen.y) === 1;
        const fraction = adjacent && action ? Math.max(0, Math.min(1, action.elapsed / BALANCE.moveTicks)) : 0;
        return {
          id: citizen.id, alive: citizen.alive,
          x: citizen.x + (adjacent ? (next.x - citizen.x) * fraction : 0),
          y: citizen.y + (adjacent ? (next.y - citizen.y) * fraction : 0),
          ...(action?.phase === 'work' ? { progress: Math.max(0, Math.min(1, action.elapsed / Math.max(1, action.duration))) } : {}),
        };
      }) }],
    };
  }
  subscribeMotion(listener: (snapshot: MotionSnapshot) => void): () => void {
    this.motionListeners.add(listener);
    listener(this.motionSnapshot());
    return () => { this.motionListeners.delete(listener); };
  }
  private publishMotion(): void {
    if (!this.motionListeners.size) return;
    const snapshot = this.motionSnapshot();
    for (const listener of this.motionListeners) {
      try { listener(snapshot); } catch { this.motionListeners.delete(listener); }
    }
  }
  globalHistory(): GlobalHistory {
    return globalHistory(this.world);
  }
  citizenHistory(citizenId: string): CitizenHistory {
    if (!Object.hasOwn(this.world.citizens, citizenId)) throw new Error('Unknown citizen.');
    return citizenHistory(this.world, citizenId);
  }
  snapshot(): AppSnapshot {
    const budget = this.runner.budget();
    const status = this.runner.status();
    const error = this.error ?? status.error ?? this.diagnosticError;
    // Private complete records are retained in JSONL; browser inspector is bounded explicitly.
    const turns = this.runner
      .records()
      .slice(-100)
      .map((record) => ({
        id: record.id,
        citizenId: record.citizenId,
        tick: record.tick,
        generation: record.generation,
        status: record.status,
        policyOutcome: record.policyOutcome,
        stopReason: record.stopReason,
        reason: record.reason,
        observation:
          record.observation.length > 24000
            ? `${record.observation.slice(0, 24000)}\n[omitted: full observation in diagnostic JSONL]`
            : record.observation,
        calls: record.calls.slice(-32),
        response: record.response,
        error: record.error,
        elapsedMs: record.elapsedMs,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
      }));
    return {
      world: projectSpectatorWorld(this.world, this.decisionTreeDebug),
      status: {
        ...status,
        planner: this.runner.metrics(),
        running: this.running,
        speed: this.speed,
        decisionTreeDebug: this.decisionTreeDebug,
        state: this.state,
        ...(error ? { error } : {}),
      },
      turns: structuredClone(turns),
      budget,
    };
  }
  updateBudget(value: unknown): AppSnapshot {
    this.available();
    const limits = budgetSchema.parse(value);
    this.ledger.setLimits(limits);
    this.log({ type: 'budget-limits', ...limits });
    return this.snapshot();
  }
  control(value: unknown): AppSnapshot {
    const control = controlSchema.parse(value) as Control;
    if (control.type === 'checkpoint') {
      this.checkpoint(false);
      return this.snapshot();
    }
    this.available();
    if (control.type === 'decision-tree-debug') {
      this.decisionTreeDebug = control.enabled!;
      return this.snapshot();
    }
    switch (control.type) {
      case 'play':
        this.running = true;
        this.lastMotionTickAt = performance.now();
        this.motionTickMs = 250 / this.speed;
        break;
      case 'pause':
        this.running = false;
        this.runner.interrupt('paused');
        break;
      case 'step':
        this.running = false;
        this.cancelClock();
        this.runner.interrupt('diagnostic step');
        this.advance(control.ticks ?? 1);
        break;
      case 'speed':
        if (control.speed === undefined) throw new Error('speed is required.');
        this.speed = control.speed;
        this.lastMotionTickAt = performance.now();
        this.motionTickMs = 250 / this.speed;
        break;
      case 'reset':
        this.resetWorld(control.population);
        break;
      case 'scenario':
        if (!control.scenario) throw new Error('scenario is required.');
        this.running = false;
        this.runner.interrupt('scenario changed');
        this.world = this.freshWorld(control.scenario, undefined, control.population);
        this.recorded = [];
        this.commandSequence = 0;
        this.runner = this.makeRunner('scripted');
        this.log({ type: 'scenario', scenario: control.scenario });
        break;
      case 'mode':
        if (!control.mode) throw new Error('mode is required.');
        if (control.mode === 'recorded' && !this.recorded.length)
          throw new Error('Import recorded fixtures explicitly before selecting recorded mode.');
        this.requireSupportedMode(control.mode);
        this.runner.setMode(control.mode);
        break;
    }
    this.schedule();
    this.publishMotion();
    return this.snapshot();
  }
  /** Archive before replacing anything; a failed save leaves the original world paused. */
  private resetWorld(population?: number): void {
    this.running = false;
    this.cancelClock();
    this.runner.interrupt('world reset');
    updateKnowledge(this.world);
    const mode = this.runner.status().mode;
    const archived: Checkpoint = {
      version: 1,
      savedAt: new Date().toISOString(),
      world: structuredClone(this.world),
      runtime: {
        running: false,
        decisionTreeDebug: this.decisionTreeDebug,
        speed: this.speed,
        mode,
        commandSequence: this.commandSequence,
        recorded: structuredClone(this.recorded),
      },
    };
    // Older checkpoints predate scenario metadata. Initial gold is conserved, unlike population.
    const scenario =
      this.world.scenario ??
      (this.world.initialGold === 900
        ? 'competition'
        : this.world.initialGold === 300
          ? 'progression'
          : 'village');
    const seed = (this.world.seed + randomInt(1, 0x1_0000_0000)) >>> 0;
    const nextWorld = this.freshWorld(
      scenario,
      seed,
      population ?? this.world.initialGold / BALANCE.startingGold,
    );
    updateKnowledge(nextWorld);
    const nextMode = 'scripted' as const;
    const archivePath = join(this.directory, 'checkpoints', `before-reset-${randomUUID()}.json`);
    const writer = this.options.checkpointWriter ?? saveCheckpoint;
    try {
      writer(archivePath, archived);
      writer(this.checkpointPath, {
        ...archived,
        world: nextWorld,
        runtime: { ...archived.runtime, mode: nextMode, commandSequence: 0, recorded: [] },
      });
    } catch (error) {
      this.log({ type: 'reset-failed', archivePath });
      throw new Error(
        `Reset failed; original world remains paused: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.world = nextWorld;
    this.recorded = [];
    this.commandSequence = 0;
    this.runner = this.makeRunner(nextMode);
    this.log({ type: 'reset', previousRunId: archived.world.runId, archivePath, scenario, seed });
  }
  importFixtures(value: unknown): AppSnapshot {
    this.available();
    this.requireSupportedMode('recorded');
    const recorded = parseFixtures(value);
    if (recorded.some((f) => !this.world.citizens[f.citizenId]))
      throw new Error('Fixture refers to an unknown citizen in this world.');
    this.running = false;
    this.cancelClock();
    this.runner.interrupt('explicit fixture import');
    this.recorded = structuredClone(recorded);
    this.runner = this.makeRunner('recorded');
    this.log({ type: 'fixtures-imported', count: recorded.length });
    return this.snapshot();
  }
  importConfiguredFixtures(): AppSnapshot {
    if (!process.env.PROSPER_FIXTURE_PATH)
      throw new Error('PROSPER_FIXTURE_PATH is not configured.');
    return this.importFixtures(JSON.parse(readFileSync(process.env.PROSPER_FIXTURE_PATH, 'utf8')));
  }
  /** Consistent checkpoint BEFORE termination. Failure leaves this child paused, retryable. */
  checkpoint(reload = true): Checkpoint {
    const running = this.resumeWanted ?? this.running;
    this.resumeWanted = running;
    this.running = false;
    this.cancelClock();
    this.runner.interrupt(reload ? 'backend reload' : 'checkpoint');
    this.state = 'reloading';
    this.error = undefined;
    try {
      updateKnowledge(this.world);
      const cp: Checkpoint = {
        version: 1,
        savedAt: new Date().toISOString(),
        world: structuredClone(this.world),
        runtime: {
          running,
          decisionTreeDebug: this.decisionTreeDebug,
          speed: this.speed,
          mode: this.runner.status().mode,
          commandSequence: this.commandSequence,
          recorded: structuredClone(this.recorded),
        },
      };
      (this.options.checkpointWriter ?? saveCheckpoint)(this.checkpointPath, cp);
      this.log({ type: 'checkpoint', running, reload });
      if (!reload) {
        this.state = 'ready';
        this.running = running;
        this.resumeWanted = undefined;
        this.schedule();
      }
      return cp;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  close(): void {
    this.running = false;
    this.cancelClock();
    this.runner.interrupt('runtime closed');
    this.publishMotion();
    this.motionListeners.clear();
  }
}
