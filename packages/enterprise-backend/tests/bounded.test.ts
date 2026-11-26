import { describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Ref } from "effect";
import { exportPrivateKeyJwk, generateCaKeyPair, sealSecret } from "@mattrax/crypto";
import { schema } from "@mattrax/enterprise-core";
import { forEachBounded, chunk } from "../src/bounded.ts";
import { makeApplePush } from "../src/Device/push.ts";

describe("forEachBounded", () => {
  it("never exceeds the concurrency limit", async () => {
    const { peak, seen } = await Effect.runPromise(
      Effect.gen(function* () {
        const active = yield* Ref.make(0);
        const peak = yield* Ref.make(0);
        const release = yield* Deferred.make<void>();
        const seen: number[] = [];

        const fiber = yield* Effect.forkChild(
          forEachBounded(
            Array.from({ length: 20 }, (_, index) => index),
            { concurrency: 3, chunkSize: 5 },
            (item) =>
              Effect.gen(function* () {
                const inFlight = yield* Ref.updateAndGet(active, (value) => value + 1);
                yield* Ref.update(peak, (value) => Math.max(value, inFlight));
                // Hold every worker at a Deferred gate so the observed peak is
                // the real concurrency limit, not a scheduling accident.
                yield* Deferred.await(release);
                seen.push(item);
                yield* Ref.update(active, (value) => value - 1);
              }),
          ),
          { startImmediately: true },
        );

        // Let the workers reach the gate before releasing it.
        for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
        const heldPeak = yield* Ref.get(peak);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);

        return { peak: heldPeak, seen };
      }),
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  it("rejects an invalid chunk size", () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow();
  });
});

describe("APNs fan-out", () => {
  it("bounds concurrency, preserves order and isolates one failed device", async () => {
    const authSecret = "batch-test-secret";
    const keyPair = await generateCaKeyPair();
    const jwk = await exportPrivateKeyJwk(keyPair.privateKey);
    const sealedKey = await sealSecret(authSecret, JSON.stringify(jwk));

    let active = 0;
    let peak = 0;
    // A barrier holds the two workers in flight until the test has observed
    // the peak. No timer (and therefore no wall-clock duration) is involved.
    const release = Deferred.makeUnsafe<void>();
    const twoInFlight = Deferred.makeUnsafe<void>();

    const db = {
      query: {
        device: {
          findFirst: ({ where }: { where: { id: string } }) =>
            Effect.succeed({
              id: where.id,
              proto: "apple",
              status: "enrolled",
              organizationId: "org-1",
            }),
        },
        deviceApple: {
          findFirst: ({ where }: { where: { deviceId: string } }) =>
            Effect.succeed({
              token: `token-${where.deviceId}`,
              pushMagic: "magic",
              topic: "topic",
              consecutivePushFailures: 0,
              lastPushErrorCode: null,
            }),
        },
        applePushCertificate: {
          findFirst: () =>
            Effect.succeed({
              certPem: "CERT",
              encryptedKey: sealedKey,
              topic: "topic",
            }),
        },
      },
      insert: () => ({ values: () => Effect.void }),
      update: () => ({ set: () => ({ where: () => Effect.void }) }),
    };

    // SAFETY: the fan-out only calls `name`, `available` and `push`; the
    // remaining APNs service members are credentials/registration flows.
    const apns = {
      name: "fake",
      available: true,
      push: ({ pushToken }: { pushToken: string }) =>
        Effect.gen(function* () {
          active++;
          peak = Math.max(peak, active);
          if (active === 2) yield* Deferred.succeed(twoInFlight, undefined);
          yield* Deferred.await(release);
          active--;

          if (pushToken === "token-device-2") return yield* Effect.fail(new Error("boom"));
        }),
    } as never;

    const apple = makeApplePush({
      // SAFETY: the fake exposes only the query/insert/update methods the
      // fan-out calls, not the full Drizzle `EnterpriseDb` surface.
      db: db as never,
      // SAFETY: the core schema and the backend's generated schema are distinct
      // nominal objects over the same tables.
      schema,
      apns,
      authSecret,
      pushTimeoutMs: 5_000,
      pushConcurrency: 2,
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          apple.pushAppleDevices(["device-1", "device-2", "device-3", "device-1"]),
          { startImmediately: true },
        );

        yield* Deferred.await(twoInFlight);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);

        return yield* Fiber.join(fiber);
      }),
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(result.requested).toBe(3);
    expect(result.succeeded).toEqual(["device-1", "device-3"]);
    expect(result.failed.map((row) => row.deviceId)).toEqual(["device-2"]);
    expect(result.skipped).toEqual([]);
  });
});
