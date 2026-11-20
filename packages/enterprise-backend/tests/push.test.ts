import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { exportPrivateKeyJwk, generateCaKeyPair, sealSecret } from "@mattrax/crypto";
import { schema } from "@mattrax/enterprise-core";
import { makeApplePush } from "../src/Device/push.ts";
import {
  classifyApplePushFailure,
  describeApplePushFailure,
  summarizeApplePushHealth,
} from "../src/Device/push.ts";

describe("classifyApplePushFailure", () => {
  it("treats Apple's invalid-token reasons as invalid_token", () => {
    for (const message of [
      'APNs rejected push (HTTP 400): {"reason":"BadDeviceToken"}',
      'APNs rejected push (HTTP 410): {"reason":"Unregistered"}',
      'APNs rejected push (HTTP 400): {"reason":"DeviceTokenNotForTopic"}',
      'APNs rejected push (HTTP 400): {"reason":"MissingDeviceToken"}',
    ])
      expect(classifyApplePushFailure(new Error(message))).toBe("invalid_token");
  });

  it("treats HTTP 410 as an invalid token even without a reason body", () => {
    expect(classifyApplePushFailure({ message: "APNs rejected push (HTTP 410)" })).toBe(
      "invalid_token",
    );
  });

  it("classifies transport and certificate failures as delivery_failed", () => {
    expect(classifyApplePushFailure({ message: "APNs request failed", cause: "ECONNRESET" })).toBe(
      "delivery_failed",
    );
    expect(
      classifyApplePushFailure({
        message: "APNs push requires a certificate and private key for this transport",
      }),
    ).toBe("delivery_failed");
  });
});

describe("describeApplePushFailure", () => {
  it("collapses whitespace and bounds the stored message", () => {
    const message = describeApplePushFailure(new Error(`bad\n\n${"x".repeat(400)}`));
    expect(message).not.toContain("\n");
    expect(message.length).toBe(255);
  });

  it("falls back to a stable message", () => {
    expect(describeApplePushFailure(null)).toBe("APNs push failed");
  });
});

describe("summarizeApplePushHealth", () => {
  it("counts configured, attempted, succeeded, failing and invalid devices", () => {
    const counts = summarizeApplePushHealth([
      {
        token: "t",
        pushMagic: "m",
        lastPushAt: new Date(),
        lastPushOkAt: new Date(),
        lastPushErrorCode: null,
        consecutivePushFailures: 0,
      },
      {
        token: "t",
        pushMagic: "m",
        lastPushAt: new Date(),
        lastPushOkAt: null,
        lastPushErrorCode: "delivery_failed",
        consecutivePushFailures: 2,
      },
      {
        token: "t",
        pushMagic: "m",
        lastPushAt: new Date(),
        lastPushOkAt: new Date("2026-01-01"),
        lastPushErrorCode: "invalid_token",
        consecutivePushFailures: 1,
      },
      // No credentials: not configured and never attempted.
      { token: null, pushMagic: null, consecutivePushFailures: 0 },
    ]);

    expect(counts).toEqual({
      configured: 3,
      attempted: 3,
      succeeded: 1,
      failing: 2,
      invalidToken: 1,
    });
  });

  it("does not count a failed device as succeeded", () => {
    const counts = summarizeApplePushHealth([
      { token: "t", pushMagic: "m", lastPushOkAt: new Date(), consecutivePushFailures: 1 },
    ]);

    expect(counts.succeeded).toBe(0);
    expect(counts.failing).toBe(1);
  });
});

describe("makeApplePush outbound backstop", () => {
  const authSecret = "push-test-secret";

  /** Columns `pushAppleDevice` writes back to the device row. */
  type PushPatch = Partial<{
    lastPushAt: Date;
    lastPushOkAt: Date | null;
    lastPushError: string | null;
    lastPushErrorCode: string | null;
    consecutivePushFailures: number;
  }>;

  /** The audit row `pushAppleDevice` inserts when the failure state changes. */
  type PushAuditRow = Partial<{
    organizationId: string;
    actorEmail: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Schema.Json;
  }>;

  /** Writes and audit rows the fake captured for assertions. */
  type PushCapture = { patch?: PushPatch; audit?: PushAuditRow[] };

  /** Minimal read/write surface used by `pushAppleDevice`. */
  const makeFakeDb = (
    sealedKey: string,
    captured: PushCapture,
    previousCode: string | null = null,
  ) => ({
    query: {
      device: {
        findFirst: () =>
          Effect.succeed({
            id: "device-1",
            proto: "apple",
            status: "enrolled",
            organizationId: "org-1",
          }),
      },
      deviceApple: {
        findFirst: () =>
          Effect.succeed({
            token: "token-1",
            pushMagic: "magic-1",
            topic: "com.apple.mgmt.External.acme",
            consecutivePushFailures: 0,
            lastPushErrorCode: previousCode,
          }),
      },
      applePushCertificate: {
        findFirst: () =>
          Effect.succeed({
            certPem: "CERT",
            encryptedKey: sealedKey,
            topic: "com.apple.mgmt.External.acme",
          }),
      },
    },
    insert: (table: typeof schema.auditLog | typeof schema.realtimeEvent) => ({
      values: (row: PushAuditRow) => {
        // The push path also appends a realtime notification; only the audit
        // row is what this assertion is about.
        if (table === schema.auditLog) captured.audit?.push(row);

        return Effect.void;
      },
    }),
    update: () => ({
      set: (patch: PushPatch) => ({
        where: () => {
          captured.patch = patch;

          return Effect.void;
        },
      }),
    }),
  });

  const makeApns = (push: () => Effect.Effect<void, Error>) =>
    // SAFETY: the push path only calls `name`, `available` and `push`; the rest of
    // the APNs service is credential/registration management.
    ({ name: "fake", available: true, push }) as never;

  /** Build the push service over the fake db with the given transport. */
  const makePush = (
    db: ReturnType<typeof makeFakeDb>,
    push: () => Effect.Effect<void, Error>,
    pushTimeoutMs: number,
  ) =>
    makeApplePush({
      // SAFETY: the fake implements the device/certificate reads and the update
      // the push path performs, but not the full Drizzle `EnterpriseDb`.
      db: db as never,
      // SAFETY: the core schema and the backend's generated schema are distinct
      // nominal objects over the same tables.
      schema: schema as never,
      apns: makeApns(push),
      authSecret,
      pushTimeoutMs,
    });

  it("gives up on a transport that never settles and records delivery_failed", async () => {
    const keyPair = await generateCaKeyPair();
    const jwk = await exportPrivateKeyJwk(keyPair.privateKey);
    const sealedKey = await sealSecret(authSecret, JSON.stringify(jwk));
    const captured: PushCapture = {};

    const apple = makePush(makeFakeDb(sealedKey, captured), () => Effect.never, 25);

    const started = Date.now();
    await Effect.runPromise(apple.pushAppleDevice("device-1"));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(captured.patch).toMatchObject({ lastPushErrorCode: "delivery_failed" });
    expect(String(captured.patch?.lastPushError)).toContain("timed out");
  });

  it("records success without waiting for the backstop", async () => {
    const keyPair = await generateCaKeyPair();
    const jwk = await exportPrivateKeyJwk(keyPair.privateKey);
    const sealedKey = await sealSecret(authSecret, JSON.stringify(jwk));
    const captured: PushCapture = {};

    const apple = makePush(makeFakeDb(sealedKey, captured), () => Effect.void, 5_000);

    const started = Date.now();
    await Effect.runPromise(apple.pushAppleDevice("device-1"));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(captured.patch).toMatchObject({ consecutivePushFailures: 0 });
  });

  it("writes a system audit event on the first invalid-token failure", async () => {
    const keyPair = await generateCaKeyPair();
    const jwk = await exportPrivateKeyJwk(keyPair.privateKey);
    const sealedKey = await sealSecret(authSecret, JSON.stringify(jwk));

    const captured: PushCapture = { audit: [] };

    const apple = makePush(
      makeFakeDb(sealedKey, captured),
      () => Effect.fail(new Error('APNs rejected push (HTTP 410): {"reason":"Unregistered"}')),
      5_000,
    );

    await Effect.runPromise(apple.pushAppleDevice("device-1"));
    expect(captured.patch).toMatchObject({ lastPushErrorCode: "invalid_token" });
    expect(captured.audit).toHaveLength(1);
    expect(captured.audit?.[0]).toMatchObject({
      organizationId: "org-1",
      actorEmail: "system",
      action: "device.push_invalid_token",
      targetType: "device",
      targetId: "device-1",
    });
  });

  it("does not audit a repeated invalid-token state or ordinary delivery failures", async () => {
    const keyPair = await generateCaKeyPair();
    const jwk = await exportPrivateKeyJwk(keyPair.privateKey);
    const sealedKey = await sealSecret(authSecret, JSON.stringify(jwk));

    const repeated: PushCapture = { audit: [] };

    const repeatedApple = makePush(
      makeFakeDb(sealedKey, repeated, "invalid_token"),
      () => Effect.fail(new Error('APNs rejected push (HTTP 410): {"reason":"Unregistered"}')),
      5_000,
    );

    await Effect.runPromise(repeatedApple.pushAppleDevice("device-1"));
    expect(repeated.audit).toHaveLength(0);

    const delivery: PushCapture = { audit: [] };

    const deliveryApple = makePush(
      makeFakeDb(sealedKey, delivery),
      () => Effect.fail(new Error("APNs request failed: ECONNRESET")),
      5_000,
    );

    await Effect.runPromise(deliveryApple.pushAppleDevice("device-1"));
    expect(delivery.audit).toHaveLength(0);
  });
});
