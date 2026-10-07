/** Small injectable reload state machine. Only a successful checkpoint permits termination. */
export interface Backend {
  alive?(): boolean;
  prepare(): Promise<void>;
  stop(): Promise<void>;
}
export interface ReloadOperations {
  start(restore: boolean): Promise<Backend>;
  status(state: 'ready' | 'reloading' | 'error', error?: string): void;
}
export class ReloadCoordinator {
  private child?: Backend;
  private pending = false;
  private active?: Promise<void>;
  private recoverable = false;
  private lostWorld = false;
  private closed = false;
  constructor(private readonly operations: ReloadOperations) {}
  initialize(restore: boolean): Promise<void> {
    this.recoverable = restore;
    this.operations.status('reloading');
    this.active = (async () => {
      try {
        const child = await this.operations.start(restore);
        if (this.closed) {
          await child.stop();
          return;
        }
        this.child = child;
        this.operations.status('ready');
      } catch (error) {
        this.operations.status('error', this.message(error));
      }
      if (this.pending && !this.closed) await this.drain();
    })().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  request(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.pending = true;
    if (!this.active)
      this.active = this.drain().finally(() => {
        this.active = undefined;
      });
    return this.active;
  }
  private async drain(): Promise<void> {
    while (this.pending && !this.closed) {
      this.pending = false;
      this.operations.status('reloading');
      try {
        if (this.child?.alive?.() === false) {
          this.child = undefined;
          this.lostWorld = true;
        }
        if (this.lostWorld && !this.recoverable)
          throw new Error(
            'Backend exited without a recoverable checkpoint; refusing to create an empty world.',
          );
        if (this.child) {
          await this.child.prepare(); // on failure keep this exact child paused, do NOT kill
          this.recoverable = true;
          await this.child.stop();
          this.child = undefined;
        }
        this.child = await this.operations.start(this.recoverable);
        this.lostWorld = false;
        this.operations.status('ready');
      } catch (error) {
        this.operations.status('error', this.message(error));
      }
    }
  }
  /** User shutdown is distinct from save-triggered reload. Best effort checkpoint, then stop. */
  async close(): Promise<void> {
    this.closed = true;
    this.pending = false;
    await this.active;
    if (this.child) {
      try {
        await this.child.prepare();
      } catch (error) {
        this.operations.status('error', this.message(error));
      }
      await this.child.stop();
      this.child = undefined;
    }
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
