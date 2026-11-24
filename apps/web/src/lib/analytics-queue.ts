type TimerSchedule = (run: () => void, delay: number) => () => void;

export type AnalyticsQueueOptions<T> = {
  readonly delay: number;
  readonly send: (batch: ReadonlyArray<T>) => Promise<void>;
  /** Injection seam for tests; production uses the browser timer. */
  readonly schedule?: TimerSchedule;
};

/** Owns one analytics queue, its debounce timer and at most one in-flight send. */
export class AnalyticsQueue<T> {
  private pending: T[] = [];
  private cancelTimer: (() => void) | undefined;
  private inFlight: Promise<void> | undefined;
  private disposed = false;
  private readonly delay: number;
  private readonly send: (batch: ReadonlyArray<T>) => Promise<void>;
  private readonly schedule: TimerSchedule;

  constructor(options: AnalyticsQueueOptions<T>) {
    this.delay = options.delay;
    this.send = options.send;
    this.schedule =
      options.schedule ??
      ((run, delay) => {
        const timer = setTimeout(run, delay);

        return () => clearTimeout(timer);
      });
  }

  get size(): number {
    return this.pending.length;
  }

  push(item: T): void {
    if (this.disposed) return;
    this.pending.push(item);
    this.scheduleFlush();
  }

  flush = (): Promise<void> => this.flushWith(this.send);

  flushWith = (send: (batch: ReadonlyArray<T>) => Promise<void>): Promise<void> => {
    if (this.inFlight) return this.inFlight;
    if (this.disposed || this.pending.length === 0) return Promise.resolve();

    this.clearTimer();
    const batch = this.pending;
    this.pending = [];
    const attempt = send(batch).catch(() => {
      // Analytics is best-effort, but a transient failure must not silently
      // discard the batch or overlap the next scheduled attempt.
      this.pending.unshift(...batch);
    });
    this.inFlight = attempt.finally(() => {
      this.inFlight = undefined;
      if (!this.disposed && this.pending.length > 0) this.scheduleFlush();
    });

    return this.inFlight;
  };

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    this.clearTimer();
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }

  private scheduleFlush(): void {
    if (this.disposed || this.cancelTimer || this.inFlight) return;
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = undefined;
      void this.flush();
    }, this.delay);
  }
}
