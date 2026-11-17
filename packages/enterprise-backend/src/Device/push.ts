import { Cause, Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { ApnsError, ApnsService } from "@mattrax/apns";
import { importPrivateKeyJwk, openSecret, pemEncode } from "@mattrax/crypto";
import { OUTBOUND_TIMEOUTS } from "@mattrax/net";
import {
  SYSTEM_AUDIT_ACTIONS,
  pushInvalidTokenTransition,
  writeSystemAudit,
} from "@mattrax/mdm-apple";
import type { EnterpriseDb, EnterpriseSchema } from "../schema.ts";
import { forEachBounded } from "../bounded.ts";

/**
 * Backstop for the configured transport. Transports bound their own requests,
 * but a custom/injected transport (or a wedged DNS resolver inside one) must
 * not be able to hold the request that triggered the push open indefinitely.
 */
const APNS_PUSH_BACKSTOP_MS = OUTBOUND_TIMEOUTS.apns + 1_000;

/** Machine-readable class for a failed APNs delivery. */
export type ApplePushFailureCode = "invalid_token" | "delivery_failed";

/**
 * APNs reasons that mean the stored token can never work again. `Unregistered`
 * and HTTP 410 are Apple's explicit "stop pushing to this device" signal.
 */
const INVALID_TOKEN_MARKERS = [
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
  "MissingDeviceToken",
  "ExpiredToken",
  "invalid device token",
];

/** The plain-object shape transports and tests use for failures. */
export type ApplePushFailureDetail = {
  readonly message?: string;
  readonly cause?: string;
};

export type ApplePushFailure = Error | ApplePushFailureDetail | null | undefined;

const apnsErrorText = (error: ApplePushFailure): string => {
  if (error == null) return "";

  if (error instanceof Error) return `${error.message} ${String(error.cause ?? "")}`;

  return [error.message, error.cause].flatMap((part) => (part == null ? [] : [part])).join(" ");
};

/**
 * Classify a transport error. Everything the transports raise is an
 * `ApnsError` carrying the HTTP status and Apple's `reason` in its message, so
 * string inspection is the only signal available without changing the
 * transport contract.
 */
export const classifyApplePushFailure = (error: ApplePushFailure): ApplePushFailureCode => {
  const text = apnsErrorText(error).toLowerCase();

  if (/http\s*410\b/.test(text)) return "invalid_token";

  if (INVALID_TOKEN_MARKERS.some((marker) => text.includes(marker.toLowerCase())))
    return "invalid_token";

  return "delivery_failed";
};

/** Condense an error into the short, secret-free string stored on the device. */
export const describeApplePushFailure = (error: ApplePushFailure, limit = 255) => {
  const text = apnsErrorText(error).replace(/\s+/g, " ").trim();

  return (text || "APNs push failed").slice(0, limit);
};

export type ApplePushHealthRow = {
  readonly token?: string | null;
  readonly pushMagic?: string | null;
  readonly lastPushAt?: Date | string | null;
  readonly lastPushOkAt?: Date | string | null;
  readonly lastPushError?: string | null;
  readonly lastPushErrorCode?: string | null;
  readonly consecutivePushFailures?: number | null;
};

/**
 * Tenant rollup. `succeeded` means the last delivery succeeded and no failure
 * is outstanding, so a device that recovered is not counted in both buckets.
 */
export const summarizeApplePushHealth = (rows: ReadonlyArray<ApplePushHealthRow>) => {
  const counts = { configured: 0, attempted: 0, succeeded: 0, failing: 0, invalidToken: 0 };

  for (const row of rows) {
    if (row.token && row.pushMagic) counts.configured++;

    if (row.lastPushAt) counts.attempted++;
    const failures = row.consecutivePushFailures ?? 0;

    if (failures > 0) counts.failing++;
    else if (row.lastPushOkAt) counts.succeeded++;

    if (row.lastPushErrorCode === "invalid_token") counts.invalidToken++;
  }

  return counts;
};

export type ApplePushOptions = {
  readonly db: EnterpriseDb;
  readonly schema: EnterpriseSchema;
  readonly apns: ApnsService.Service;
  /** Application secret used to unseal APNs private keys. */
  readonly authSecret?: string;
  /**
   * Backstop deadline for a single transport call, in ms. Defaults to
   * {@link APNS_PUSH_BACKSTOP_MS}; transports already bound themselves.
   */
  readonly pushTimeoutMs?: number;
  /**
   * Maximum APNs deliveries in flight for a fan-out. Defaults to 12: enough to
   * drain a large group quickly without flooding the relay or the DB pool.
   */
  readonly pushConcurrency?: number;
  /** Items scheduled together; defaults to twice the concurrency. */
  readonly pushChunkSize?: number;
  /** Injected fetch used by outbound webhook deliveries (tests). */
  readonly webhookFetch?: typeof globalThis.fetch;
};

type MutableApplePushBatchResult = {
  requested: number;
  succeeded: string[];
  failed: Array<{ deviceId: string; error: string }>;
  skipped: string[];
};

/** Per-device outcome of a fan-out. `skipped` means nothing was pushable. */
export type ApplePushBatchResult = {
  readonly requested: number;
  readonly succeeded: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<{ readonly deviceId: string; readonly error: string }>;
  readonly skipped: ReadonlyArray<string>;
};

type PushOutcome =
  | { readonly status: "pushed" }
  | { readonly status: "skipped" }
  | { readonly status: "failed"; readonly error: string };

/**
 * Product-level APNs helper. Reads the device's push credentials and tenant
 * certificate, decrypts the private key, and asks the configured transport to
 * deliver a wake-up push.
 *
 * Every failure is swallowed and logged: pushes are a best-effort optimisation
 * and must never fail the surrounding HTTP request (devices still poll).
 */
export const applePushService = ({
  db,
  schema,
  apns,
  authSecret,
  pushTimeoutMs,
  pushConcurrency = 12,
  pushChunkSize,
  webhookFetch,
}: ApplePushOptions) => {
  const backstopMs = pushTimeoutMs ?? APNS_PUSH_BACKSTOP_MS;
  const concurrency = Math.max(1, Math.floor(pushConcurrency));
  const chunkSize = Math.max(concurrency, Math.floor(pushChunkSize ?? concurrency * 2));

  const privateKeyPem = (encryptedKey: string) =>
    Effect.tryPromise({
      try: async () => {
        if (!authSecret) throw new Error("APNs key encryption is not configured");
        const jwk: JsonWebKey = JSON.parse(await openSecret(authSecret, encryptedKey));
        const key = await importPrivateKeyJwk(jwk);
        const der = await crypto.subtle.exportKey("pkcs8", key);

        return pemEncode("PRIVATE KEY", der);
      },
      catch: (cause) => new ApnsError({ message: "Failed to decrypt APNs private key", cause }),
    });

  /**
   * Persist the delivery outcome on `device_apple`. Telemetry is diagnostic
   * only: a write failure (or a half-migrated deployment) must never fail the
   * request that triggered the push, so every error is swallowed and logged.
   */
  const recordPushOutcome = (
    deviceId: string,
    organizationId: string,
    outcome: { readonly ok: true } | { readonly ok: false; readonly error: ApplePushFailure },
  ) =>
    Effect.gen(function* () {
      const apple = yield* db.query.deviceApple.findFirst({ where: { deviceId } });

      if (!apple) return;
      const at = new Date();

      if (outcome.ok) {
        yield* db
          .update(schema.deviceApple)
          .set({
            lastPushAt: at,
            lastPushOkAt: at,
            lastPushError: null,
            lastPushErrorCode: null,
            consecutivePushFailures: 0,
          })
          .where(eq(schema.deviceApple.deviceId, deviceId));

        return;
      }

      const errorCode = classifyApplePushFailure(outcome.error);
      yield* db
        .update(schema.deviceApple)
        .set({
          lastPushAt: at,
          lastPushError: describeApplePushFailure(outcome.error),
          lastPushErrorCode: errorCode,
          consecutivePushFailures: (apple.consecutivePushFailures ?? 0) + 1,
        })
        .where(eq(schema.deviceApple.deviceId, deviceId));

      // A dead token stays dead until the device re-enrols. Audit only the
      // transition so every subsequent failed push does not create an event.
      if (pushInvalidTokenTransition(apple.lastPushErrorCode, errorCode))
        yield* writeSystemAudit(
          db,
          {
            organizationId,
            action: SYSTEM_AUDIT_ACTIONS.pushInvalidToken,
            targetType: "device",
            targetId: deviceId,
            metadata: { previousCode: apple.lastPushErrorCode ?? null },
          },
          { authSecret, webhookFetch },
        );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(
          `Failed to record APNs push outcome for device ${deviceId}: ${String(cause)}`,
        ),
      ),
    );

  const pushAppleDeviceInternal = (
    deviceId: string,
    allowUnenrolling = false,
  ): Effect.Effect<PushOutcome> =>
    Effect.gen(function* () {
      const device = yield* db.query.device.findFirst({ where: { id: deviceId } });

      const pushable =
        device?.proto === "apple" &&
        (device.status === "enrolled" || (allowUnenrolling && device.status === "unenrolling"));

      if (!device || !pushable) return { status: "skipped" as const };

      const apple = yield* db.query.deviceApple.findFirst({ where: { deviceId } });

      if (!apple?.token || !apple.pushMagic) return { status: "skipped" as const };

      const certificate = yield* db.query.applePushCertificate.findFirst({
        where: { organizationId: device.organizationId },
      });

      if (!certificate?.encryptedKey) return { status: "skipped" as const };

      const keyPem = yield* privateKeyPem(certificate.encryptedKey);

      const outcome = yield* Effect.match(
        apns
          .push({
            pushToken: apple.token,
            pushMagic: apple.pushMagic,
            topic: apple.topic ?? certificate.topic,
            certPem: certificate.certPem,
            privateKeyPem: keyPem,
          })
          .pipe(
            Effect.timeoutOrElse({
              duration: backstopMs,
              orElse: () =>
                Effect.fail(
                  new ApnsError({ message: `APNs push timed out after ${backstopMs}ms` }),
                ),
            }),
          ),
        {
          onSuccess: () => ({ ok: true as const }),
          onFailure: (error) => ({ ok: false as const, error }),
        },
      );

      yield* recordPushOutcome(device.id, device.organizationId, outcome);

      if (!outcome.ok) {
        const error = describeApplePushFailure(outcome.error);
        yield* Effect.logWarning(`Failed to send APNs push for device ${deviceId}: ${error}`);

        return { status: "failed" as const, error };
      }

      return { status: "pushed" as const };
    }).pipe(
      // A DB/decrypt failure is per-device: report it to the batch instead of
      // aborting every other device.
      Effect.catchCause((cause) => {
        const error = Cause.pretty(cause).slice(0, 255);

        return Effect.logWarning(`Failed to send APNs push for device ${deviceId}: ${error}`).pipe(
          Effect.as({ status: "failed" as const, error }),
        );
      }),
    );

  const pushAppleDevice = (deviceId: string, allowUnenrolling = false): Effect.Effect<void> =>
    Effect.asVoid(pushAppleDeviceInternal(deviceId, allowUnenrolling));

  /**
   * Push one Apple user channel. A user connection has its own APNs token and
   * push magic, so waking the device channel does not wake the user and vice
   * versa. Outcomes are recorded on `device_apple_user` for the device page.
   */
  const pushAppleUserChannelInternal = (
    deviceId: string,
    userId: string,
  ): Effect.Effect<PushOutcome> =>
    Effect.gen(function* () {
      const device = yield* db.query.device.findFirst({ where: { id: deviceId } });

      if (!device || device.proto !== "apple" || device.status !== "enrolled")
        return { status: "skipped" as const };

      const [user] = yield* db
        .select()
        .from(schema.deviceAppleUser)
        .where(
          and(
            eq(schema.deviceAppleUser.deviceId, deviceId),
            eq(schema.deviceAppleUser.userId, userId),
          ),
        )
        .limit(1);

      if (!user?.token || !user.pushMagic) return { status: "skipped" as const };

      const certificate = yield* db.query.applePushCertificate.findFirst({
        where: { organizationId: device.organizationId },
      });

      if (!certificate?.encryptedKey) return { status: "skipped" as const };

      const keyPem = yield* privateKeyPem(certificate.encryptedKey);

      const outcome = yield* Effect.match(
        apns
          .push({
            pushToken: user.token,
            pushMagic: user.pushMagic,
            topic: user.topic ?? certificate.topic,
            certPem: certificate.certPem,
            privateKeyPem: keyPem,
          })
          .pipe(
            Effect.timeoutOrElse({
              duration: backstopMs,
              orElse: () =>
                Effect.fail(
                  new ApnsError({ message: `APNs push timed out after ${backstopMs}ms` }),
                ),
            }),
          ),
        {
          onSuccess: () => ({ ok: true as const }),
          onFailure: (error) => ({ ok: false as const, error }),
        },
      );

      const at = new Date();

      const outcomeColumns = outcome.ok
        ? {
            lastPushAt: at,
            lastPushOkAt: at,
            lastPushError: null,
            consecutivePushFailures: 0,
          }
        : {
            lastPushAt: at,
            lastPushError: describeApplePushFailure(outcome.error),
            consecutivePushFailures: (user.consecutivePushFailures ?? 0) + 1,
          };

      yield* db
        .update(schema.deviceAppleUser)
        .set(outcomeColumns)
        .where(
          and(
            eq(schema.deviceAppleUser.deviceId, deviceId),
            eq(schema.deviceAppleUser.userId, userId),
          ),
        );

      if (!outcome.ok) {
        const error = describeApplePushFailure(outcome.error);
        yield* Effect.logWarning(
          `Failed to send APNs push for user channel ${userId} on device ${deviceId}: ${error}`,
        );

        return { status: "failed" as const, error };
      }

      return { status: "pushed" as const };
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.pretty(cause).slice(0, 255);

        return Effect.logWarning(
          `Failed to send APNs push for user channel ${userId} on device ${deviceId}: ${error}`,
        ).pipe(Effect.as({ status: "failed" as const, error }));
      }),
    );

  /** Wake one user channel; `false` means nothing pushable was configured. */
  const pushAppleUserChannel = (deviceId: string, userId: string): Effect.Effect<boolean> =>
    Effect.map(
      pushAppleUserChannelInternal(deviceId, userId),
      (outcome) => outcome.status === "pushed",
    );

  const pushAppleDevices = (
    deviceIds: ReadonlyArray<string>,
    options?: { readonly concurrency?: number; readonly chunkSize?: number },
  ): Effect.Effect<ApplePushBatchResult> =>
    Effect.gen(function* () {
      const ids = [...new Set(deviceIds)];
      const outcomes: Array<PushOutcome | undefined> = [];
      yield* forEachBounded(
        ids,
        {
          concurrency: Math.max(1, Math.floor(options?.concurrency ?? concurrency)),
          chunkSize: Math.max(1, Math.floor(options?.chunkSize ?? chunkSize)),
        },
        (deviceId, index) =>
          pushAppleDeviceInternal(deviceId).pipe(
            Effect.map((outcome) => {
              outcomes[index] = outcome;
            }),
          ),
      );

      const result: MutableApplePushBatchResult = {
        requested: ids.length,
        succeeded: [],
        failed: [],
        skipped: [],
      };

      ids.forEach((deviceId, index) => {
        const outcome = outcomes[index];

        if (!outcome || outcome.status === "skipped") result.skipped.push(deviceId);
        else if (outcome.status === "failed")
          result.failed.push({ deviceId, error: outcome.error });
        else result.succeeded.push(deviceId);
      });

      if (result.failed.length > 0)
        yield* Effect.logWarning(
          `APNs push batch completed with ${result.failed.length}/${result.requested} failures`,
        );

      return result;
    });

  /** Device ids assigned to any of the given groups, including unenrolled ones. */
  const deviceIdsInGroups = (
    groupIds: ReadonlyArray<string>,
  ): Effect.Effect<Array<string>, unknown> =>
    Effect.gen(function* () {
      if (groupIds.length === 0) return [];

      const rows = yield* db
        .select()
        .from(schema.groupDevice)
        .where(inArray(schema.groupDevice.groupId, [...groupIds]));

      return [...new Set(rows.map((row: { deviceId: string }) => row.deviceId))];
    });

  /** Device ids affected by any of the given policies, through their groups. */
  const deviceIdsInPolicies = (
    policyIds: ReadonlyArray<string>,
  ): Effect.Effect<Array<string>, unknown> =>
    Effect.gen(function* () {
      if (policyIds.length === 0) return [];

      const associations = yield* db
        .select()
        .from(schema.groupPolicy)
        .where(inArray(schema.groupPolicy.policyId, [...policyIds]));

      const direct = yield* db
        .select()
        .from(schema.devicePolicy)
        .where(inArray(schema.devicePolicy.policyId, [...policyIds]));

      const grouped = yield* deviceIdsInGroups(
        associations.map((row: { groupId: string }) => row.groupId),
      );

      // User-scoped assignments reach the device channel through linked
      // users, so editing or deleting such a policy must wake those devices.
      const userAssignments = yield* db
        .select({ userId: schema.userPolicy.userId })
        .from(schema.userPolicy)
        .where(inArray(schema.userPolicy.policyId, [...policyIds]));

      const userGroupAssignments = yield* db
        .select({ groupId: schema.userGroupPolicy.groupId })
        .from(schema.userGroupPolicy)
        .where(inArray(schema.userGroupPolicy.policyId, [...policyIds]));

      const groupMembers = userGroupAssignments.length
        ? yield* db
            .select({ userId: schema.userGroupMember.userId })
            .from(schema.userGroupMember)
            .where(
              inArray(
                schema.userGroupMember.groupId,
                userGroupAssignments.map((row: { groupId: string }) => row.groupId),
              ),
            )
        : [];

      const userIds = [
        ...new Set([
          ...userAssignments.map((row: { userId: string }) => row.userId),
          ...groupMembers.map((row: { userId: string }) => row.userId),
        ]),
      ];

      const userDevices = userIds.length
        ? yield* db
            .select({ deviceId: schema.deviceUser.deviceId })
            .from(schema.deviceUser)
            .where(inArray(schema.deviceUser.userId, userIds))
        : [];

      return [
        ...new Set([
          ...grouped,
          ...direct.map((row: { deviceId: string }) => row.deviceId),
          ...userDevices.map((row: { deviceId: string }) => row.deviceId),
        ]),
      ];
    });

  return {
    pushAppleDevice,
    pushAppleDevices,
    pushAppleUserChannel,
    deviceIdsInGroups,
    deviceIdsInPolicies,
  };
};

export const makeApplePush = applePushService;

export type ApplePush = ReturnType<typeof applePushService>;
