type TimerSchedule = (run: () => void, delay: number) => () => void;

export type AnalyticsQueueOptions<T> = {
  readonly delay: number;
  readonly send: (batch: ReadonlyArray<T>) => Promise<void>;
  /** Injection seam for tests; production uses the browser timer. */
  readonly schedule?: TimerSchedule;
};

export type AnalyticsStorageQueueOptions<T> = {
  readonly delay: number;
  readonly persist: (value: T) => void;
  /** Injection seam for tests; production uses the browser timer. */
  readonly schedule?: TimerSchedule;
};

/** Coalesce frequent snapshots into one write of the latest value per window. */
export class AnalyticsStorageQueue<T> {
  private pending: T | undefined;
  private hasPending = false;
  private cancelTimer: (() => void) | undefined;
  private disposed = false;
  private readonly delay: number;
  private readonly persist: (value: T) => void;
  private readonly schedule: TimerSchedule;

  constructor(options: AnalyticsStorageQueueOptions<T>) {
    this.delay = options.delay;
    this.persist = options.persist;
    this.schedule =
      options.schedule ??
      ((run, delay) => {
        const timer = setTimeout(run, delay);

        return () => clearTimeout(timer);
      });
  }

  set(value: T): void {
    if (this.disposed) return;
    this.pending = value;
    this.hasPending = true;

    if (this.cancelTimer) return;
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = undefined;
      this.flush();
    }, this.delay);
  }

  flush = (): void => {
    this.clearTimer();

    if (!this.hasPending) return;

    const value = this.pending as T;
    this.pending = undefined;
    this.hasPending = false;
    this.persist(value);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.flush();
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
}

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

    return this.startSend(send);
  };

  /**
   * Lifecycle delivery must not wait for a normal send that may still be in
   * flight while the document unloads. Drain only the currently pending batch
   * through the durable sender; the normal batch keeps its own retry path.
   */
  flushPendingWith = (send: (batch: ReadonlyArray<T>) => Promise<void>): Promise<void> => {
    if (this.disposed || this.pending.length === 0) return Promise.resolve();

    this.clearTimer();
    const batch = this.pending;
    this.pending = [];

    return send(batch).catch(() => {
      this.pending.unshift(...batch);
      if (!this.disposed && !this.inFlight) this.scheduleFlush();
    });
  };

  private startSend(send: (batch: ReadonlyArray<T>) => Promise<void>): Promise<void> {
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
  }

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
