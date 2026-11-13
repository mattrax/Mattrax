import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import {
  ScepCaKeyError,
  ScepError,
  ScepRepository,
  openCaPrivateKey,
  sealCaPrivateKey,
  verifyScepChallenge,
  type ScepAuthentication,
  type ScepPkcsReq,
} from "@mattrax/scep";

const databaseError =
  (message: string) =>
  (cause: unknown): ScepError =>
    cause instanceof ScepError ? cause : new ScepError({ message, cause });

const processEnvSecret = (): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;

  return env?.AUTH_SECRET ?? env?.MATTRAX_AUTH_SECRET;
};

/**
 * Canonical form of a certificate serial, matching the `serial` primary key
 * written by `certificateSerialHex` in `@mattrax/scep`: lowercase hex with
 * leading zeros stripped, but never empty. mTLS forwarders may send the serial
 * uppercase, `0x`-prefixed or colon-separated, so normalise before matching.
 */
export const normalizeIssuedCertificateSerial = (value: string): string => {
  const hex = value
    .replace(/^0x/i, "")
    .replace(/[^0-9a-f]/gi, "")
    .toLowerCase();

  return hex.replace(/^0+(?=.)/, "");
};

export type ScepRepositoryOptions = {
  /** Application secret used to verify per-enrollment challenges. */
  readonly authSecret?: string;
};

export class ScepRepositoryLive extends ScepRepository {
  static readonly make = (
    db: Db["Service"],
    options: ScepRepositoryOptions = {},
  ): ScepRepository["Service"] => {
    const authenticatePkcsReq = (req: ScepPkcsReq): Effect.Effect<ScepAuthentication, ScepError> =>
      Effect.gen(function* () {
        const secret = options.authSecret ?? processEnvSecret();

        if (!secret) {
          return yield* Effect.fail(
            new ScepError({
              message: "SCEP challenge verification is not configured (AUTH_SECRET is missing)",
            }),
          );
        }

        const verification = yield* Effect.tryPromise({
          try: () => verifyScepChallenge(req.challengePassword, secret),
          catch: (cause) => new ScepError({ message: "Failed to verify SCEP challenge", cause }),
        });

        if (!verification) {
          return yield* Effect.fail(new ScepError({ message: "Invalid SCEP challenge" }));
        }

        const [enrollment] = yield* db
          .select()
          .from(schema.enterpriseEnrollment)
          .where(eq(schema.enterpriseEnrollment.id, verification.enrollmentId))
          .limit(1)
          .pipe(
            Effect.mapError(
              (cause) => new ScepError({ message: "Failed to resolve SCEP enrollment", cause }),
            ),
          );

        if (!enrollment) {
          return yield* Effect.fail(new ScepError({ message: "Unknown SCEP enrollment" }));
        }

        // Authenticated tenant id becomes the issued certificate's OU. It is
        // never derived from attacker-controlled CSR content.
        return {
          organizationalUnit: enrollment.organizationId,
          enrollmentId: enrollment.id,
        };
      });

    /**
     * Renewal rows may reference the internal `device.id` (new issuance) or the
     * Windows DeviceID / Apple UDID in `device.dmIdentifier` (legacy issuance).
     * Try the internal id first so a dmIdentifier that happens to equal another
     * row's id cannot shadow the intended device.
     */
    const findDeviceForCertificate = (organizationId: string, identifier: string) =>
      Effect.gen(function* () {
        const [byId] = yield* db
          .select({ status: schema.device.status })
          .from(schema.device)
          .where(
            and(eq(schema.device.organizationId, organizationId), eq(schema.device.id, identifier)),
          )
          .limit(1);

        if (byId) return byId;

        const [byDmIdentifier] = yield* db
          .select({ status: schema.device.status })
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, organizationId),
              eq(schema.device.dmIdentifier, identifier),
            ),
          )
          .limit(1);

        return byDmIdentifier ?? null;
      });

    const authSecret = (): string | undefined => options.authSecret ?? processEnvSecret();

    /**
     * Resolve the tenant-wide CA signing key. The column holds either the
     * sealed envelope or a legacy plaintext JWK; the latter is sealed and
     * written back before it is used, so a database or backup reader can no
     * longer mint device identities. Any failure is fatal: regenerating the CA
     * here would invalidate every certificate already issued to a device.
     */
    const loadCaPrivateKey = (stored: unknown) =>
      Effect.gen(function* () {
        const opened = yield* Effect.tryPromise({
          try: () => openCaPrivateKey(stored, authSecret()),
          catch: (cause) =>
            cause instanceof ScepCaKeyError
              ? new ScepError({ message: cause.message })
              : new ScepError({ message: "Failed to read the SCEP CA private key" }),
        });

        if (opened.migrated) {
          const sealed = opened.migrated;
          yield* db
            .update(schema.scepCa)
            .set({ privateKeyJwk: sealed })
            .where(eq(schema.scepCa.id, 1))
            .pipe(
              Effect.mapError(
                () =>
                  new ScepError({
                    message:
                      "Failed to persist the encrypted SCEP CA private key; the CA was not used",
                  }),
              ),
            );
        }

        return opened.privateKeyJwk;
      });

    return ScepRepository.of({
      getCa: () =>
        Effect.gen(function* () {
          const [row] = yield* db
            .select()
            .from(schema.scepCa)
            .where(eq(schema.scepCa.id, 1))
            .limit(1);

          if (!row) return null;
          const privateKeyJwk = yield* loadCaPrivateKey(row.privateKeyJwk);

          return {
            certPem: row.certPem,
            privateKeyJwk,
          };
        }).pipe(Effect.mapError(databaseError("Failed to get CA"))),

      saveCa: (certPem: string, privateKeyJwk: JsonWebKey) =>
        Effect.gen(function* () {
          const sealed = yield* Effect.tryPromise({
            try: () => sealCaPrivateKey(authSecret(), privateKeyJwk),
            catch: (cause) =>
              cause instanceof ScepCaKeyError
                ? new ScepError({ message: cause.message })
                : new ScepError({ message: "Failed to encrypt the SCEP CA private key" }),
          });

          yield* db
            .insert(schema.scepCa)
            .values({
              id: 1,
              certPem,
              privateKeyJwk: sealed,
              createdAt: new Date(),
            })
            .onDuplicateKeyUpdate({
              set: { certPem, privateKeyJwk: sealed },
            });
        }).pipe(Effect.mapError(databaseError("Failed to save CA"))),

      authenticatePkcsReq,
      recordIssuedCertificate: (certificate) =>
        Effect.gen(function* () {
          const [existing] = yield* db
            .select()
            .from(schema.scepIssuedCertificate)
            .where(eq(schema.scepIssuedCertificate.serial, certificate.serial))
            .limit(1);

          if (!existing) {
            yield* db.insert(schema.scepIssuedCertificate).values({
              serial: certificate.serial,
              organizationId: certificate.organizationId,
              enrollmentId: certificate.enrollmentId ?? null,
              deviceId: certificate.deviceId ?? null,
              notAfter: certificate.notAfter,
              createdAt: new Date(),
            });

            return;
          }

          // A serial is a global primary key, so a duplicate is either a retry
          // of the same identity or a collision. Only refresh the same identity;
          // overwriting another tenant/device would make its renewals
          // authenticate as the wrong identity.
          const sameDevice = (existing.deviceId ?? null) === (certificate.deviceId ?? null);

          if (existing.organizationId !== certificate.organizationId || !sameDevice) {
            return yield* Effect.fail(
              new ScepError({
                message:
                  "SCEP serial number collision: refusing to overwrite another identity's certificate",
              }),
            );
          }

          yield* db
            .update(schema.scepIssuedCertificate)
            .set({
              enrollmentId: certificate.enrollmentId ?? null,
              notAfter: certificate.notAfter,
              // `revokedAt` is intentionally preserved. A duplicate serial is a
              // replay or collision, not proof that the identity is trusted
              // again, so it must never silently un-revoke a certificate.
            })
            .where(eq(schema.scepIssuedCertificate.serial, certificate.serial));
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ScepError
              ? cause
              : new ScepError({ message: "Failed to record certificate", cause }),
          ),
        ),
      findIssuedCertificate: (serial) =>
        Effect.gen(function* () {
          const [row] = yield* db
            .select()
            .from(schema.scepIssuedCertificate)
            .where(eq(schema.scepIssuedCertificate.serial, serial))
            .limit(1)
            .pipe(
              Effect.mapError(
                (cause) => new ScepError({ message: "Failed to read certificate", cause }),
              ),
            );

          if (!row) return null;

          // Revocation is checked before expiry so operators get an actionable
          // log line ("revoked") instead of a generic "unknown or expired".
          if (row.revokedAt) {
            return yield* Effect.fail(
              new ScepError({
                message: "SCEP renewal rejected: the issued identity certificate has been revoked",
              }),
            );
          }

          if (row.deviceId) {
            // New rows store the internal `device.id`; legacy Windows rows
            // store the DeviceID (`device.dmIdentifier`). Accept both.
            const device = yield* findDeviceForCertificate(row.organizationId, row.deviceId).pipe(
              Effect.mapError(databaseError("Failed to read device")),
            );

            if (!device || device.status !== "enrolled") {
              return yield* Effect.fail(
                new ScepError({
                  message:
                    "SCEP renewal rejected: the device is no longer enrolled or no longer exists",
                }),
              );
            }
          }

          return {
            serial: row.serial,
            organizationId: row.organizationId,
            enrollmentId: row.enrollmentId ?? undefined,
            deviceId: row.deviceId ?? undefined,
            notAfter: row.notAfter,
          };
        }),
    });
  };

  /**
   * Kept as a plain layer for existing hosts. The secret is read from
   * `AUTH_SECRET` / `MATTRAX_AUTH_SECRET` at request time; use
   * {@link ScepRepositoryLive.layerWithOptions} to inject it explicitly.
   */
  static readonly layer: Layer.Layer<ScepRepository, never, Db> = Layer.effect(
    ScepRepository,
    Effect.gen(function* () {
      const db = yield* Db;

      return ScepRepositoryLive.make(db);
    }),
  );

  static readonly layerWithOptions = (
    options: ScepRepositoryOptions,
  ): Layer.Layer<ScepRepository, never, Db> =>
    Layer.effect(
      ScepRepository,
      Effect.gen(function* () {
        const db = yield* Db;

        return ScepRepositoryLive.make(db, options);
      }),
    );
}
