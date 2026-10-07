import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { validateResponse } from '../citizen/provider.ts';
import { dataDirectory, loadCheckpoint, saveCheckpoint, type Checkpoint } from './checkpoint.ts';

export const controlSchema = z
  .object({
    type: z.enum(['play', 'pause', 'step', 'speed', 'scenario', 'mode', 'checkpoint']),
    ticks: z.number().int().min(1).max(10000).optional(),
    speed: z.number().min(0.1).max(100).optional(),
    scenario: z.enum(['village', 'competition', 'progression']).optional(),
    mode: z.enum(['scripted', 'live', 'recorded']).optional(),
  })
  .strict();
export interface RuntimeOptions {
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
  private state: 'ready' | 'reloading' | 'error' = 'ready';
  private error?: string;
  private diagnosticError?: string;
  private commandSequence = 0;
  private recorded: RecordedTurn[] = [];
  private clock?: ReturnType<typeof setTimeout>;
  private resumeWanted?: boolean;
  private readonly ledger: RequestLedger;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.directory = dataDirectory(options.directory);
    this.checkpointPath = options.checkpointPath ?? join(this.directory, 'checkpoint.json');
    const cp = options.restore ? loadCheckpoint(this.checkpointPath) : undefined; // never substitute an empty world
    this.world = cp?.world ?? options.world ?? createWorld({ runId: `run-${randomUUID()}` });
    this.running = cp?.runtime.running ?? false;
    this.speed = cp?.runtime.speed ?? 1;
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
  private makeRunner(mode: AppSnapshot['status']['mode']): CitizenRunner {
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
  }
  private advance(count: number): void {
    for (let i = 0; i < count; i++) {
      tickWorld(this.world);
      updateKnowledge(this.world);
      this.log({ type: 'tick', order: this.commandSequence });
      this.runner.tick(); // intentionally not awaited
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
    return this.apply(citizenId, parseCommand(value), 'browser');
  }
  observation(citizenId: string) {
    if (!this.world.citizens[citizenId]) throw new Error('Unknown citizen.');
    updateKnowledge(this.world);
    return observe(this.world, citizenId);
  }
  snapshot(): AppSnapshot {
    updateKnowledge(this.world);
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
    return structuredClone({
      world: this.world,
      status: {
        ...status,
        running: this.running,
        speed: this.speed,
        state: this.state,
        ...(error ? { error } : {}),
      },
      turns,
      budget: this.ledger.status(),
    });
  }
  control(value: unknown): AppSnapshot {
    const control = controlSchema.parse(value) as Control;
    if (control.type === 'checkpoint') {
      this.checkpoint(false);
      return this.snapshot();
    }
    this.available();
    switch (control.type) {
      case 'play':
        this.running = true;
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
        break;
      case 'scenario':
        if (!control.scenario) throw new Error('scenario is required.');
        this.running = false;
        this.runner.interrupt('scenario changed');
        this.world = createWorld({ scenario: control.scenario, runId: `run-${randomUUID()}` });
        this.recorded = [];
        this.commandSequence = 0;
        this.runner = this.makeRunner('scripted');
        this.log({ type: 'scenario', scenario: control.scenario });
        break;
      case 'mode':
        if (!control.mode) throw new Error('mode is required.');
        if (control.mode === 'recorded' && !this.recorded.length)
          throw new Error('Import recorded fixtures explicitly before selecting recorded mode.');
        this.runner.setMode(control.mode);
        break;
    }
    this.schedule();
    return this.snapshot();
  }
  importFixtures(value: unknown): AppSnapshot {
    this.available();
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
  }
}
