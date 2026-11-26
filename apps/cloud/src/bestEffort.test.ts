import { Effect, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { logBestEffortFailure } from "./bestEffort.js";

describe("best-effort delivery diagnostics", () => {
  it("keeps the operation successful and logs tenant and cause", async () => {
    const entries: Array<{ level: string; message: unknown }> = [];
    const logger = Logger.make<unknown, void>((options) => {
      entries.push({
        level: options.logLevel,
        message: options.message,
      });
    });
    const cause = new Error("relay unavailable");

    await Effect.runPromise(
      Effect.fail(cause).pipe(
        logBestEffortFailure("apple_push", "tenant-123"),
        Effect.provide(Logger.layer([logger])),
      ),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "Warn",
      message: [
        "Best-effort delivery failed",
        {
          tenantId: "tenant-123",
          operation: "apple_push",
          cause,
        },
      ],
    });
  });

  it("does not log successful delivery", async () => {
    let entries = 0;
    const logger = Logger.make<unknown, void>(() => {
      entries += 1;
    });

    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        logBestEffortFailure("android_policy_sync", "tenant-123"),
        Effect.provide(Logger.layer([logger])),
      ),
    );

    expect(entries).toBe(0);
  });
});
