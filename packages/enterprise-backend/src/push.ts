import { Effect } from "effect";
import { inArray } from "drizzle-orm";
import { ApnsError, ApnsService } from "@mattrax/apns";
import { importPrivateKeyJwk, openSecret, pemEncode } from "@mattrax/crypto";
import type { EnterpriseDb, EnterpriseSchema } from "./schema.ts";

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
      yield* apns.push({
        pushToken: apple.token,
        pushMagic: apple.pushMagic,
        topic: apple.topic ?? certificate.topic,
        certPem: certificate.certPem,
        privateKeyPem: keyPem,
      });
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
      return yield* deviceIdsInGroups(associations.map((row: { groupId: string }) => row.groupId));
    });

  return { pushAppleDevice, pushAppleDevices, deviceIdsInGroups, deviceIdsInPolicies };
};

export type ApplePush = ReturnType<typeof makeApplePush>;
