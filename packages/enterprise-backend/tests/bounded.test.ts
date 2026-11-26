import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { exportPrivateKeyJwk, generateCaKeyPair, sealSecret } from "@mattrax/crypto";
import { schema } from "@mattrax/enterprise-core";
import { forEachBounded, chunk } from "../src/bounded.ts";
import { makeApplePush } from "../src/Device/push.ts";

describe("forEachBounded", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];

    await Effect.runPromise(
      forEachBounded(
        Array.from({ length: 20 }, (_, index) => index),
        { concurrency: 3, chunkSize: 5 },
        (item) =>
          Effect.gen(function* () {
            active++;
            peak = Math.max(peak, active);
            yield* Effect.promise(
              () =>
                new Promise((resolve) => {
                  setTimeout(resolve, 1);
                }),
            );
            seen.push(item);
            active--;
          }),
      ),
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

    const sleep = (ms: number) =>
      Effect.promise(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, ms);
          }),
      );

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
          yield* sleep(pushToken === "token-device-2" ? 3 : 1);
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
      apple.pushAppleDevices(["device-1", "device-2", "device-3", "device-1"]),
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(result.requested).toBe(3);
    expect(result.succeeded).toEqual(["device-1", "device-3"]);
    expect(result.failed.map((row) => row.deviceId)).toEqual(["device-2"]);
    expect(result.skipped).toEqual([]);
  });
});
