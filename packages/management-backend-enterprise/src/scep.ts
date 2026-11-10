import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import {
  ScepError,
  ScepRepository,
  verifyScepChallenge,
  type ScepAuthentication,
  type ScepPkcsReq,
} from "@mattrax/scep";

const isJsonWebKey = (value: unknown): value is JsonWebKey =>
  typeof value === "object" && value !== null;

const databaseError =
  (message: string) =>
  (cause: unknown): ScepError =>
    cause instanceof ScepError ? cause : new ScepError({ message, cause });

const processEnvSecret = (): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.AUTH_SECRET ?? env?.MATTRAX_AUTH_SECRET;
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

    return ScepRepository.of({
      getCa: () =>
        Effect.gen(function* () {
          const [row] = yield* db
            .select()
            .from(schema.scepCa)
            .where(eq(schema.scepCa.id, 1))
            .limit(1);
          if (!row) return null;
          if (!isJsonWebKey(row.privateKeyJwk)) {
            return yield* Effect.fail(
              new ScepError({ message: "Stored CA private key is invalid" }),
            );
          }
          return {
            certPem: row.certPem,
            privateKeyJwk: row.privateKeyJwk,
          };
        }).pipe(Effect.mapError((cause) => new ScepError({ message: "Failed to get CA", cause }))),

      saveCa: (certPem: string, privateKeyJwk: JsonWebKey) =>
        Effect.gen(function* () {
          yield* db
            .insert(schema.scepCa)
            .values({
              id: 1,
              certPem,
              privateKeyJwk,
              createdAt: new Date(),
            })
            .onDuplicateKeyUpdate({
              set: { certPem, privateKeyJwk },
            });
        }).pipe(Effect.mapError((cause) => new ScepError({ message: "Failed to save CA", cause }))),

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
