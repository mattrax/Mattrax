import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { catchCausePreservingInterrupts } from "./errorBoundary.js";

describe("enterprise request error boundary", () => {
  it("maps ordinary failures", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.fail("failure").pipe(catchCausePreservingInterrupts(() => Effect.succeed("mapped"))),
    );

    expect(Exit.isSuccess(exit) && exit.value).toBe("mapped");
  });

  it("preserves interruption instead of mapping it to a response", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.interrupt.pipe(catchCausePreservingInterrupts(() => Effect.succeed("mapped"))),
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
  });

  it("preserves interruption in a mixed cause", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.failCause(
        Cause.fromReasons([Cause.makeFailReason("failure"), Cause.makeInterruptReason(1)]),
      ).pipe(catchCausePreservingInterrupts(() => Effect.succeed("mapped"))),
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
  });
});
