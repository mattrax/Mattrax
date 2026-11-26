/** Schedules a shutdown deadline; the returned function cancels it. */
export type ScheduleDeadline = (callback: () => void, delayMs: number) => () => void;

export interface BackgroundTasks {
  readonly waitUntil: (promise: Promise<unknown>) => void;
  /** Wait for all work currently tracked, including work it schedules. */
  readonly idle: () => Promise<void>;
  /** Drain until the deadline, then interrupt Effect fibers via AbortSignal. */
  readonly drain: (deadlineMs: number) => Promise<"drained" | "interrupted">;
  readonly signal: AbortSignal;
  /**
   * Track a unit of work independently for idle(), while keeping it in this
   * collector for shutdown draining and interruption.
   */
  readonly fork: () => BackgroundTasks;
}

/**
 * Node's replacement for Workers' waitUntil. Rejections are observed once and
 * the signal interrupts Effect programs when shutdown exhausts its grace time.
 */
export const createBackgroundTasks = (
  onFailure: (operation: string, cause: unknown) => void = (operation, cause) =>
    console.error(operation, cause),
  options: { readonly scheduleDeadline?: ScheduleDeadline } = {},
): BackgroundTasks => {
  const scheduleDeadline: ScheduleDeadline =
    options.scheduleDeadline ??
    ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    });

  const make = (controller: AbortController, parent?: BackgroundTasks): BackgroundTasks => {
    const pending = new Set<Promise<void>>();

    const waitUntil = (promise: Promise<unknown>): void => {
      const tracked = promise
        .then(
          () => {},
          (error: unknown) => onFailure("mattrax self-host: background work failed", error),
        )
        .finally(() => {
          pending.delete(tracked);
        });

      pending.add(tracked);
      parent?.waitUntil(tracked);
    };

    const idle = async (): Promise<void> => {
      while (pending.size > 0) await Promise.all(pending);
    };

    const drain = async (deadlineMs: number): Promise<"drained" | "interrupted"> => {
      if (pending.size === 0) return "drained";

      let cancelDeadline: (() => void) | undefined;
      const timeout = new Promise<"interrupted">((resolve) => {
        cancelDeadline = scheduleDeadline(() => resolve("interrupted"), deadlineMs);
      });

      try {
        const result = await Promise.race([idle().then(() => "drained" as const), timeout]);

        if (result === "interrupted") controller.abort();

        return result;
      } finally {
        cancelDeadline?.();
      }
    };

    const tasks: BackgroundTasks = {
      waitUntil,
      idle,
      drain,
      signal: controller.signal,
      fork: () => make(controller, tasks),
    };

    return tasks;
  };

  return make(new AbortController());
};
