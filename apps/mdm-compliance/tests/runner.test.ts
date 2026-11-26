import { Cause, Deferred, Effect, Exit, Fiber, Logger, Ref } from "effect";
import { describe, expect, it } from "vitest";
import { TestClock } from "effect/testing";
import { runChecks } from "../src/runner.ts";
import type { Check } from "../src/types.ts";

const check = (id: string, run: Check["run"]): Check => ({
  id,
  platform: "apple",
  category: "check-in",
  name: id,
  description: id,
  run,
});

describe("compliance runner", () => {
  it("interrupts timed-out checks and runs their finalizers", async () => {
    const interrupted = await Effect.runPromise(Ref.make(false));
    const started = await Effect.runPromise(Deferred.make<void>());
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          runChecks(
            [
              check("slow", () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Ref.set(interrupted, true)),
                ),
              ),
            ],
            { timeoutMs: 5 },
          ),
        );
        yield* Deferred.await(started);
        yield* TestClock.adjust(5);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(report.checks[0]?.status).toBe("failed");
    expect(report.checks[0]?.error).toBe("Check timed out after 5ms: slow");
    expect(await Effect.runPromise(Ref.get(interrupted))).toBe(true);
  });

  it("propagates external interruption instead of reporting a failed check", async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    const interrupted = await Effect.runPromise(Ref.make(false));
    const fiber = Effect.runFork(
      runChecks([
        check("slow", () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Ref.set(interrupted, true)),
          ),
        ),
      ]),
    );

    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(fiber));

    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(await Effect.runPromise(Ref.get(interrupted))).toBe(true);
  });

  it("scopes check logging without mutating console.error", async () => {
    const messages: Array<unknown> = [];
    const logger = Logger.make((options) => {
      messages.push(options.message);
    });
    const originalConsoleError = console.error;

    await Effect.runPromise(
      runChecks([check("logged", () => Effect.logError("expected protocol failure"))]).pipe(
        Effect.provide(Logger.layer([logger])),
      ),
    );

    expect(messages).toEqual([]);
    expect(console.error).toBe(originalConsoleError);
  });

  it("describes primitive defects with Predicate", async () => {
    const report = await Effect.runPromise(
      runChecks([check("symbol", () => Effect.die(Symbol("broken")))]),
    );

    expect(report.checks[0]?.error).toBe("Symbol(broken)");
  });

  it("keeps typed failures in the report", async () => {
    const report = await Effect.runPromise(
      runChecks([check("failure", () => Effect.fail(new Error("protocol rejected")))]),
    );

    expect(report.checks[0]?.error).toBe("protocol rejected");
  });
});
