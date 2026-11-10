import { Effect } from "effect";
import { eq, inArray } from "drizzle-orm";
import { ApnsError, ApnsService } from "@mattrax/apns";
import { importPrivateKeyJwk, openSecret, pemEncode } from "@mattrax/crypto";
import type { EnterpriseDb, EnterpriseSchema } from "./schema.ts";

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

const apnsErrorText = (error: unknown): string => {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.message} ${String(error.cause ?? "")}`;
  const record = error as { readonly message?: unknown; readonly cause?: unknown };
  return [record.message, record.cause]
    .filter((part) => part != null)
    .map((part) => String(part))
    .join(" ");
};

/**
 * Classify a transport error. Everything the transports raise is an
 * `ApnsError` carrying the HTTP status and Apple's `reason` in its message, so
 * string inspection is the only signal available without changing the
 * transport contract.
 */
export const classifyApplePushFailure = (error: unknown): ApplePushFailureCode => {
  const text = apnsErrorText(error).toLowerCase();
  if (/http\s*410\b/.test(text)) return "invalid_token";
  if (INVALID_TOKEN_MARKERS.some((marker) => text.includes(marker.toLowerCase())))
    return "invalid_token";
  return "delivery_failed";
};

/** Condense an error into the short, secret-free string stored on the device. */
export const describeApplePushFailure = (error: unknown, limit = 255) => {
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
};

/**
 * Product-level APNs helper. Reads the device's push credentials and tenant
 * certificate, decrypts the private key, and asks the configured transport to
 * deliver a wake-up push.
 *
 * Every failure is swallowed and logged: pushes are a best-effort optimisation
 * and must never fail the surrounding HTTP request (devices still poll).
 */
export const makeApplePush = ({ db, schema, apns, authSecret }: ApplePushOptions) => {
  const privateKeyPem = (encryptedKey: string) =>
    Effect.tryPromise({
      try: async () => {
        if (!authSecret) throw new Error("APNs key encryption is not configured");
        const jwk = JSON.parse(await openSecret(authSecret, encryptedKey)) as JsonWebKey;
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
    outcome: { readonly ok: true } | { readonly ok: false; readonly error: unknown },
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
      yield* db
        .update(schema.deviceApple)
        .set({
          lastPushAt: at,
          lastPushError: describeApplePushFailure(outcome.error),
          lastPushErrorCode: classifyApplePushFailure(outcome.error),
          consecutivePushFailures: (apple.consecutivePushFailures ?? 0) + 1,
        })
        .where(eq(schema.deviceApple.deviceId, deviceId));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(
          `Failed to record APNs push outcome for device ${deviceId}: ${String(cause)}`,
        ),
      ),
    );

  const pushAppleDevice = (deviceId: string, allowUnenrolling = false): Effect.Effect<void> =>
    Effect.gen(function* () {
      const device = yield* db.query.device.findFirst({ where: { id: deviceId } });
      const pushable =
        device?.proto === "apple" &&
        (device.status === "enrolled" || (allowUnenrolling && device.status === "unenrolling"));
      if (!device || !pushable) return;

      const apple = yield* db.query.deviceApple.findFirst({ where: { deviceId } });
      if (!apple?.token || !apple.pushMagic) return;

      const certificate = yield* db.query.applePushCertificate.findFirst({
        where: { organizationId: device.organizationId },
      });
      if (!certificate?.encryptedKey) return;

      const keyPem = yield* privateKeyPem(certificate.encryptedKey);
      const outcome = yield* Effect.match(
        apns.push({
          pushToken: apple.token,
          pushMagic: apple.pushMagic,
          topic: apple.topic ?? certificate.topic,
          certPem: certificate.certPem,
          privateKeyPem: keyPem,
        }),
        {
          onSuccess: () => ({ ok: true as const }),
          onFailure: (error) => ({ ok: false as const, error }),
        },
      );
      yield* recordPushOutcome(device.id, outcome);
      if (!outcome.ok)
        yield* Effect.logWarning(
          `Failed to send APNs push for device ${deviceId}: ${String(outcome.error)}`,
        );
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(`Failed to send APNs push for device ${deviceId}: ${String(error)}`),
      ),
    );

  const pushAppleDevices = (deviceIds: ReadonlyArray<string>): Effect.Effect<void> =>
    Effect.forEach([...new Set(deviceIds)], (deviceId) => pushAppleDevice(deviceId), {
      discard: true,
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
      return [...new Set([...grouped, ...direct.map((row: { deviceId: string }) => row.deviceId)])];
    });

  return { pushAppleDevice, pushAppleDevices, deviceIdsInGroups, deviceIdsInPolicies };
};

export type ApplePush = ReturnType<typeof makeApplePush>;
