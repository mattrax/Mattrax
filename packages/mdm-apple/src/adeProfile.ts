import { Effect, Schema } from "effect";
import { eq } from "drizzle-orm";
import { schema as s } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { PlistValue, serializePlist } from "@mattrax/plist";
import type { PlistSerializeError } from "@mattrax/plist";
import { buildAppleEnrollmentProfile } from "@mattrax/dm-apple";
import { issueScepChallenge } from "@mattrax/mdm-core";
import { ScepError } from "@mattrax/scep";

/** Default lifetime of the one-time challenge in an ADE/install profile. */
export const ADE_ENROLLMENT_PROFILE_TTL_SECONDS = 60 * 60;

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

/**
 * The tenant's enrollment row, creating it when the tenant has never issued an
 * enrollment link. The row id binds the SCEP challenge to the tenant, so both
 * the manual/ADE URL path and the inline Authenticate path must use the same
 * row rather than inventing a challenge without one.
 */
export const getOrCreateEnterpriseEnrollment = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<typeof s.enterpriseEnrollment.$inferSelect, ScepError> =>
  Effect.gen(function* () {
    const [existing] = yield* db
      .select()
      .from(s.enterpriseEnrollment)
      .where(eq(s.enterpriseEnrollment.organizationId, organizationId))
      .limit(1);

    if (existing) return existing;

    const timestamp = new Date();
    const enrollment = { id: newId(), organizationId, createdAt: timestamp, updatedAt: timestamp };

    yield* db.insert(s.enterpriseEnrollment).ignore().values(enrollment);

    const [created] = yield* db
      .select()
      .from(s.enterpriseEnrollment)
      .where(eq(s.enterpriseEnrollment.organizationId, organizationId))
      .limit(1);

    return (
      created ?? {
        ...enrollment,
        code: null,
        enabledApple: true,
        enabledWindows: true,
        enabledAndroid: false,
        enabledAssetTag: false,
        maxDevices: 100,
      }
    );
  }).pipe(
    Effect.mapError(
      (cause) => new ScepError({ message: "Could not resolve the tenant enrollment row", cause }),
    ),
  );

export const enterpriseEnrollmentProfile = (config: {
  origin: string;
  topic: string;
  organizationId: string;
  organizationName?: string;
  supportEmail?: string;
  challenge?: string;
  displayName?: string;
  identifier?: string;
  profileUuid?: string;
}) =>
  buildAppleEnrollmentProfile({
    origin: config.origin,
    topic: config.topic,
    organizationId: config.organizationId,
    organizationName: config.organizationName ?? "Mattrax",
    supportEmail: config.supportEmail,
    challenge: config.challenge ?? crypto.randomUUID(),
    displayName: config.displayName,
    identifier: config.identifier,
    profileUuid: config.profileUuid,
  });

export type BuildAdeEnrollmentProfileInput<SignError> = {
  readonly db: EnterpriseDb;
  readonly origin: string;
  readonly authSecret?: string;
  readonly organizationId: string;
  readonly topic: string;
  readonly organizationName: string;
  readonly supportEmail?: string;
  /** Stable ADE profile revision from ABM. */
  readonly profileUuid: string;
  readonly displayName: string;
  readonly ttlSeconds?: number;
  readonly sign: (plist: string) => Effect.Effect<Uint8Array, SignError>;
};

/**
 * The single canonical ADE profile builder.
 *
 * Both the public ADE enrollment endpoint and the inline Authenticate response
 * call this, so the profile identifier, payload UUIDs, display name, challenge
 * lifetime and enrollment row cannot drift between the two delivery paths.
 */
export const buildAdeEnrollmentProfile = <SignError>(
  input: BuildAdeEnrollmentProfileInput<SignError>,
): Effect.Effect<Uint8Array, ScepError | SignError | PlistSerializeError> =>
  Effect.gen(function* () {
    const enrollment = yield* getOrCreateEnterpriseEnrollment(input.db, input.organizationId);

    const { challenge } = yield* issueScepChallenge(input.db, {
      enrollmentId: enrollment.id,
      organizationId: input.organizationId,
      authSecret: input.authSecret ?? "",
      ttlSeconds: input.ttlSeconds ?? ADE_ENROLLMENT_PROFILE_TTL_SECONDS,
    });

    const plist = yield* serializePlist(
      // SAFETY: the profile builder only emits JSON-compatible plist values and
      // `enterpriseEnrollmentProfile` is the same shape used by the URL path.
      Schema.decodeUnknownSync(PlistValue)(
        enterpriseEnrollmentProfile({
          origin: input.origin,
          topic: input.topic,
          organizationId: input.organizationId,
          organizationName: input.organizationName,
          supportEmail: input.supportEmail,
          challenge,
          displayName: input.displayName,
          identifier: `com.mattrax.ade.${input.profileUuid}`,
          profileUuid: input.profileUuid,
        }),
      ),
    );

    return yield* input.sign(plist);
  });
