export type Job = () => Promise<void>;

export interface JobQueue {
  enqueue(job: Job): void;
  /** Admission control: callers check this before accepting new work. */
  hasCapacity(): boolean;
  /** Resolves when nothing is running or pending (tests, graceful shutdown). */
  onIdle(): Promise<void>;
}

/** In-process queue with a concurrency limit. Production: BullMQ on Redis. */
export class InProcessJobQueue implements JobQueue {
  private readonly pending: Job[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxPending: number,
    /** Called when a job rejects. Jobs handle their own errors, so this signals a bug. */
    private readonly onJobError: (error: unknown) => void = () => undefined,
  ) {}

  hasCapacity(): boolean {
    return this.pending.length < this.maxPending;
  }

  enqueue(job: Job): void {
    this.pending.push(job);
    queueMicrotask(() => {
      this.pump();
    });
  }

  onIdle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const job = this.pending.shift();
      if (!job) break;
      this.running += 1;
      // Jobs handle their own errors; this catch is a last line of defence that must not stay silent.
      void job()
        .catch((error: unknown) => {
          this.onJobError(error);
        })
        .finally(() => {
          this.running -= 1;
          this.pump();
          if (this.running === 0 && this.pending.length === 0) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            for (const resolve of waiters) resolve();
          }
        });
    }
  }
}
