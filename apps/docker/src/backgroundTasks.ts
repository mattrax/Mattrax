export interface BackgroundTasks {
  readonly waitUntil: (promise: Promise<unknown>) => void;
  /** Wait for all work currently tracked, including work it schedules. */
  readonly idle: () => Promise<void>;
  /** Drain until the deadline, then interrupt Effect fibers via AbortSignal. */
  readonly drain: (deadlineMs: number) => Promise<"drained" | "interrupted">;
  readonly signal: AbortSignal;
}

/**
 * Node's replacement for Workers' waitUntil. Rejections are observed once and
 * the signal interrupts Effect programs when shutdown exhausts its grace time.
 */
export const createBackgroundTasks = (
  onFailure: (operation: string, cause: unknown) => void = (operation, cause) =>
    console.error(operation, cause),
): BackgroundTasks => {
  const controller = new AbortController();
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
  };

  const idle = async (): Promise<void> => {
    while (pending.size > 0) await Promise.all(pending);
  };

  const drain = async (deadlineMs: number): Promise<"drained" | "interrupted"> => {
    if (pending.size === 0) return "drained";

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"interrupted">((resolve) => {
      timer = setTimeout(() => resolve("interrupted"), deadlineMs);
      timer.unref();
    });

    try {
      const result = await Promise.race([idle().then(() => "drained" as const), timeout]);

      if (result === "interrupted") controller.abort();

      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return { waitUntil, idle, drain, signal: controller.signal };
};
