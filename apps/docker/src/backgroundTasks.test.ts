import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createBackgroundTasks } from "./backgroundTasks.js";

describe("tracked background tasks", () => {
  it("observes failures and removes completed work", async () => {
    const failures: unknown[] = [];
    const tasks = createBackgroundTasks((_operation, cause) => failures.push(cause));
    const cause = new Error("failed");

    tasks.waitUntil(Promise.reject(cause));
    await tasks.idle();

    expect(failures).toEqual([cause]);
    expect(tasks.signal.aborted).toBe(false);
  });

  it("waits for work added by an already running task", async () => {
    const tasks = createBackgroundTasks();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;

    tasks.waitUntil(
      (async () => {
        tasks.waitUntil(gate);
        await gate;
        finished = true;
      })(),
    );
    await Promise.resolve();
    release();
    await tasks.idle();

    expect(finished).toBe(true);
  });

  it("drains successful work without interrupting it", async () => {
    const tasks = createBackgroundTasks();
    let interrupted = false;
    const running = Effect.runPromiseExit(
      Effect.sleep("5 millis").pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      ),
      { signal: tasks.signal },
    );
    tasks.waitUntil(running);

    await expect(tasks.drain(100)).resolves.toBe("drained");
    expect(Exit.isSuccess(await running)).toBe(true);
    expect(interrupted).toBe(false);
  });

  it("interrupts remaining Effect fibers at the shutdown deadline", async () => {
    const tasks = createBackgroundTasks();
    const running = Effect.runPromiseExit(Effect.never, { signal: tasks.signal });
    tasks.waitUntil(running);

    await expect(tasks.drain(5)).resolves.toBe("interrupted");
    expect(tasks.signal.aborted).toBe(true);
    const exit = await running;

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  });
});
