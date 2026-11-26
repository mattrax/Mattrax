import { Deferred, Effect, Exit, Fiber, PlatformError, Sink, Stdio } from "effect";
import { describe, expect, it } from "vitest";
import { line, processOutputLayer } from "./output.ts";

describe("CLI output", () => {
  it("represents EPIPE as an Effect failure", async () => {
    const epipe = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    const error = PlatformError.systemError({
      _tag: "Unknown",
      module: "Stdio",
      method: "stdout",
      cause: epipe,
    });
    const stdio = Stdio.layerTest({
      stdout: () => Sink.fail(error),
      stderr: () => Sink.drain,
    });

    const exit = await Effect.runPromise(
      Effect.exit(line("output").pipe(Effect.provide(processOutputLayer), Effect.provide(stdio))),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons[0]).toMatchObject({ error });
  });

  it("waits for the stdout sink instead of discarding backpressure", async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const stdio = Stdio.layerTest({
      stdout: () =>
        Sink.fromEffect(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.asVoid,
          ),
        ),
      stderr: () => Sink.drain,
    });
    const fiber = Effect.runFork(
      line("output").pipe(Effect.provide(processOutputLayer), Effect.provide(stdio)),
    );

    await Effect.runPromise(Deferred.await(started));
    let completed = false;
    const removeObserver = fiber.addObserver(() => {
      completed = true;
    });
    await Effect.runPromise(Effect.yieldNow);
    expect(completed).toBe(false);

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(fiber));
    removeObserver();
  });
});
