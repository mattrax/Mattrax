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

  it("keeps fork idleness separate from unrelated parent work", async () => {
    const parent = createBackgroundTasks();
    const tick = parent.fork();
    let releaseRequest!: () => void;
    let releaseTick!: () => void;
    const request = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const work = new Promise<void>((resolve) => {
      releaseTick = resolve;
    });
    parent.waitUntil(request);
    tick.waitUntil(work);
    let tickIdle = false;
    const waiting = tick.idle().then(() => {
      tickIdle = true;
    });

    await Promise.resolve();
    expect(tickIdle).toBe(false);
    releaseTick();
    await waiting;
    expect(tickIdle).toBe(true);

    let parentIdle = false;
    const parentWaiting = parent.idle().then(() => {
      parentIdle = true;
    });
    await Promise.resolve();
    expect(parentIdle).toBe(false);
    releaseRequest();
    await parentWaiting;
  });

  it("tracks forked work in the parent shutdown deadline", async () => {
    const parent = createBackgroundTasks();
    const tick = parent.fork();
    const running = Effect.runPromiseExit(Effect.never, { signal: tick.signal });
    tick.waitUntil(running);

    await expect(parent.drain(5)).resolves.toBe("interrupted");
    expect(tick.signal).toBe(parent.signal);
    const exit = await running;

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  });

  it("drains successful work without interrupting it", async () => {
    const tasks = createBackgroundTasks();
    let interrupted = false;
    const running = Effect.runPromiseExit(
      Effect.sleep("1 milli").pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      ),
      { signal: tasks.signal },
    );
    tasks.waitUntil(running);

    await expect(tasks.drain(20)).resolves.toBe("drained");
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
