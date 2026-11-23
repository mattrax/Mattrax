import { Auth, Hooks, Passkey, Sessions, Totp } from "@yielded/auth";
import type { makeAppAuth } from "@mattrax/enterprise-domain";
import {
  appSessionConfiguration,
  PASSKEY_MODULE_ID,
  TOTP_MODULE_ID,
} from "@mattrax/enterprise-domain";
import type { AuthClaims } from "@mattrax/enterprise-domain";
import {
  Database,
  makePasskeyRegistrationServices,
  makeTotpPersistenceServices,
} from "@yielded/auth-persistence-drizzle/Mysql2";
import type { Services as AuthPlatformServices } from "@yielded/auth-platform-workerd";
import type { PasswordConfigurationError } from "@yielded/auth/Password";
import {
  Db,
  authRequirement,
  authStorage,
  AuthPersistenceConfig,
  passkeyRegistrationMapping,
  schema,
  totpMapping,
} from "@mattrax/enterprise-core";
import { DateTime } from "effect";
import { Effect, Layer, Option, Predicate, Redacted, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_AUDIT, recordAccountAudit } from "./accountAudit.ts";
import { readStepUpGrant, stepUpServiceLayer, verifyStepUpGrant } from "./stepUp.ts";

export const sessionCookie = "__Host-mattrax_session";

/** Short-lived step-up grant. Bound to the session, account and action set. */
export const stepUpCookie = "__Host-mattrax_stepup";

/** In-flight WebAuthn step-up challenge binding. */
export const stepUpFlowCookie = "__Host-mattrax_stepup_flow";

/**
 * Derive the WebAuthn relying-party profile from the deployment origin. The
 * origin is the only source of truth: there is no per-request or client-supplied
 * RP id. Origins that cannot host WebAuthn (an IP literal, or an origin whose
 * host is not a registrable domain) fall back to an unusable sentinel so auth
 * still boots while passkeys fail closed.
 */
export const passkeyProfile = (
  origin: string | undefined,
  trustedOrigins: ReadonlyArray<string> = [],
) => {
  const fallback = {
    id: "passkeys.invalid",
    name: "Mattrax",
    origins: ["https://passkeys.invalid"],
    developmentLocalhost: false,
  } as const;

  if (!origin) return fallback;

  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    return fallback;
  }

  const hostname = parsed.hostname;
  const developmentLocalhost = hostname === "localhost";

  const validHostname =
    developmentLocalhost ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname);

  if (!validHostname) return fallback;

  if (!developmentLocalhost && parsed.protocol !== "https:") return fallback;

  const origins = new Set<string>([parsed.origin]);

  for (const candidate of trustedOrigins) {
    let other: URL;

    try {
      other = new URL(candidate);
    } catch {
      continue;
    }

    const sameSite =
      other.hostname === hostname ||
      (!developmentLocalhost && other.hostname.endsWith(`.${hostname}`));

    const schemeOk = developmentLocalhost
      ? other.protocol === "https:" ||
        (other.hostname === "localhost" && other.protocol === "http:")
      : other.protocol === "https:";

    // A different registrable domain cannot share this RP id, so it is ignored
    // rather than silently weakening the allowlist.
    if (sameSite && schemeOk && other.origin === other.href.replace(/\/$/, ""))
      origins.add(other.origin);
  }

  return {
    id: hostname,
    name: "Mattrax",
    origins: [...origins],
    developmentLocalhost,
  } as const;
};

/** Application-owned AES-256 key material for TOTP secret envelopes. */
export const deriveTotpSecretKey = async (authSecret: string) =>
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`mattrax/totp/secret-key/v1:${authSecret}`),
    ),
  );

type TotpActionProof = { code?: string; grant?: string };

export type AppAuthService = ReturnType<typeof makeAppAuth>;

export type AuthLiveOptions = {
  readonly appAuth: AppAuthService;
  readonly cryptoLayer: Layer.Layer<AuthPlatformServices, PasswordConfigurationError>;
  /** Application secret used to sign step-up grants and derive TOTP keys. */
  readonly authSecret?: string;
  /** Canonical public origin used for the WebAuthn relying party. */
  readonly origin?: string;
  /** Extra browser origins that may share the WebAuthn relying party. */
  readonly trustedOrigins?: ReadonlyArray<string>;
};

/**
 * The WebAuthn server module the passkey protocol layer delegates to. Only
 * `make` is used, so a test can supply a stand-in and exercise a rejected
 * chunk load.
 */
type PasskeyServerModule = Pick<typeof import("@yielded/auth-simplewebauthn/Server"), "make">;

/** Loads the WebAuthn server module. Injectable so tests can reject the chunk. */
export type PasskeyServerLoader = () => Promise<PasskeyServerModule>;

/** Stable log message for a verifier whose chunk could not be loaded. */
export const PASSKEY_VERIFIER_LOAD_FAILED =
  "Passkey ceremonies are unavailable: the WebAuthn verifier could not be loaded";

/** Stable log message for a rejected relying-party profile. */
export const PASSKEY_PROFILE_INVALID =
  "Passkey ceremonies are unavailable: the WebAuthn relying-party profile is invalid";

/** One-line, secret-free description of a boundary failure cause. */
const describeFailure = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

/**
 * The WebAuthn verifier layer for the passkey protocol.
 *
 * The verifier is the single largest dependency in the auth graph and only a
 * passkey ceremony exercises it, so the module is imported on first use rather
 * than at module evaluation. Every protocol method delegates to one verifier,
 * memoised per layer, so a request that performs several ceremonies (including
 * concurrent ones) loads and builds it once.
 *
 * Both ways the verifier can fail to exist are logged for the operator at error
 * level and then surface to the client as `PasskeyUnavailable`:
 *
 * - the chunk could not be loaded (a transient deployment or edge failure);
 * - the relying-party profile was rejected (a permanent deployment
 *   misconfiguration, such as an origin that cannot host WebAuthn).
 *
 * A rejected profile cannot be a distinct client tag: the auth HTTP contract
 * declares `PasskeyFailure` (rejected, unavailable, action required, method
 * unsupported, hook denied) and `PasskeyConfigurationError` is not part of it,
 * so a new tag would change the API schema owned by `@yielded/auth`. The error
 * log is the actionable signal; the ceremony fails closed, as it did when the
 * layer was eager.
 */
export const makePasskeyProtocolLayer = (
  load: PasskeyServerLoader = () => import("@yielded/auth-simplewebauthn/Server"),
): Layer.Layer<Passkey.PasskeyProtocol, never, Passkey.PasskeyConfig> =>
  Layer.effect(
    Passkey.PasskeyProtocol,
    Effect.gen(function* () {
      const config = yield* Passkey.PasskeyConfig;

      // `Effect.cached` memoises the verifier effect for this layer: the import
      // runs once and concurrent first ceremonies await the same result.
      const verifier = yield* Effect.cached(
        Effect.gen(function* () {
          const module = yield* Effect.tryPromise({
            try: () => load(),
            catch: (cause) => cause,
          }).pipe(
            // A rejected dynamic import stays a typed failure, not a defect, so
            // caller `Effect.catch` handlers keep working.
            Effect.catch((error) =>
              Effect.logError(PASSKEY_VERIFIER_LOAD_FAILED, {
                cause: describeFailure(error),
              }).pipe(Effect.andThen(Effect.fail(Passkey.PasskeyUnavailable.make({})))),
            ),
          );

          return yield* module.make(config).pipe(
            Effect.catchTag("PasskeyConfigurationError", () =>
              Effect.logError(PASSKEY_PROFILE_INVALID, {
                profileIds: config.profiles.map((profile) => profile.profileId),
                rpIds: config.profiles.map((profile) => profile.rpId),
              }).pipe(Effect.andThen(Effect.fail(Passkey.PasskeyUnavailable.make({})))),
            ),
          );
        }),
      );

      return Passkey.PasskeyProtocol.of({
        prepareAuthentication: (input) =>
          Effect.flatMap(verifier, (service) => service.prepareAuthentication(input)),
        prepareRegistration: (input) =>
          Effect.flatMap(verifier, (service) => service.prepareRegistration(input)),
        verifyAuthentication: (input) =>
          Effect.flatMap(verifier, (service) => service.verifyAuthentication(input)),
        verifyRegistration: (input) =>
          Effect.flatMap(verifier, (service) => service.verifyRegistration(input)),
      });
    }),
  );

export const makeAuthLive = ({
  appAuth,
  cryptoLayer,
  authSecret,
  origin,
  trustedOrigins,
}: AuthLiveOptions) => {
  const LifecycleHooksLive = Layer.effect(
    Hooks.LifecycleHooks,
    Effect.gen(function* () {
      const db = yield* Db;

      /**
       * Mirror passkey ownership onto `account.passkey_enabled` so session
       * reads and the account UI decide whether a usable sign-in method
       * remains. Registration sets the flag when it inserts the first
       * credential; this hook covers later credential changes and accepts
       * that a failed update leaves the flag stale rather than losing the
       * credential itself.
       */
      const syncPasskeyFactor = (subjectId: string) =>
        Effect.gen(function* () {
          const remaining = yield* db
            .select({ credentialId: schema.authPasskeyCredentials.credentialId })
            .from(schema.authPasskeyCredentials)
            .where(
              and(
                eq(schema.authPasskeyCredentials.subjectId, subjectId),
                eq(schema.authPasskeyCredentials.active, true),
              ),
            )
            .limit(1)
            .pipe(Effect.catch(() => Effect.succeed([])));

          yield* db
            .update(schema.account)
            .set({ passkeyEnabled: remaining.length > 0 })
            .where(eq(schema.account.id, subjectId))
            .pipe(Effect.catch(() => Effect.void));
        });

      /**
       * Credential lifecycle events are committed by the auth library, so this
       * hook is the only place that sees an authenticator enrolment, removal,
       * disable or recovery-code regeneration. The audit write is best effort:
       * a bookkeeping failure must never fail the ceremony that produced it.
       */
      const recordCredentialAudit = (
        subjectId: string,
        action: (typeof ACCOUNT_AUDIT)[keyof typeof ACCOUNT_AUDIT],
        targetType: string,
        metadata?: Schema.Json,
      ) =>
        Effect.gen(function* () {
          const user = yield* db.query.account.findFirst({ where: { id: subjectId } });

          if (!user) return;

          yield* recordAccountAudit(db, {
            subjectAccountId: subjectId,
            subjectEmail: user.email,
            action,
            targetType,
            metadata: metadata ?? null,
          });
        }).pipe(Effect.catchCause(() => Effect.void));

      return Hooks.LifecycleHooks.of({
        before: () => Effect.void,
        after: (event) =>
          Effect.gen(function* () {
            if (event.snapshot.action === "credential-change" && event.snapshot.subjectId) {
              const operation = event.snapshot.operation;
              const subjectId = event.snapshot.subjectId;

              if (
                operation === `${PASSKEY_MODULE_ID}/passkey/enrollment` ||
                operation === `${PASSKEY_MODULE_ID}/passkey/remove`
              ) {
                yield* syncPasskeyFactor(subjectId);
                yield* recordCredentialAudit(
                  subjectId,
                  operation.endsWith("/remove")
                    ? ACCOUNT_AUDIT.passkeyRemoved
                    : ACCOUNT_AUDIT.passkeyAdded,
                  "passkey",
                  { method: event.snapshot.method ?? null },
                );
              }

              if (operation.startsWith(`${TOTP_MODULE_ID}/totp/`)) {
                const factorAction = operation.slice(`${TOTP_MODULE_ID}/totp/`.length);

                if (factorAction === "disable")
                  yield* recordCredentialAudit(subjectId, ACCOUNT_AUDIT.mfaDisabled, "totp");
                else if (factorAction === "regenerate")
                  yield* recordCredentialAudit(
                    subjectId,
                    ACCOUNT_AUDIT.mfaRecoveryRegenerated,
                    "totp",
                  );
                else
                  yield* recordCredentialAudit(subjectId, ACCOUNT_AUDIT.mfaEnrolled, "totp", {
                    step: factorAction,
                  });
              }
            }

            return [];
          }),
      });
    }),
  );

  const resolveClaims = (subjectId: string) =>
    Effect.gen(function* () {
      const db = yield* Db;

      const user = yield* db.query.account
        .findFirst({ where: { id: subjectId } })
        .pipe(Effect.catch(() => Effect.succeed(undefined)));

      if (!user || user.disabled) return yield* Passkey.PasskeyUnavailable.make({});

      return {
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      } satisfies AuthClaims;
    });

  /**
   * Registration is a guest ceremony. It provisions the subject and first
   * credential in the same commit, using the application mapping above.
   */
  const PasskeyRegistrationLive = Layer.effect(
    appAuth.strategies.registration.RegistrationAuthority,
    Effect.map(
      makePasskeyRegistrationServices(passkeyRegistrationMapping),
      (services) => services.passkeyRegistrationAuthority,
    ),
  ).pipe(
    // SAFETY: `Db` is the same Effect MySQL Drizzle database the persistence
    // adapter exposes under its own `Database` service tag.
    Layer.provide(
      Layer.effect(
        Database,
        Effect.map(Db, (db) => db as Database["Service"]),
      ),
    ),
    Layer.provide(cryptoLayer),
    Layer.provide(LifecycleHooksLive),
  );

  /**
   * Relying-party configuration is deployment configuration. `origin` is the
   * canonical public origin; `trustedOrigins` may add same-site origins. The
   * verifier and every passkey strategy read this same layer, so a challenge
   * issued by one facet is always verified against the same RP id.
   */
  const PasskeyConfigLive = Passkey.PasskeyConfig.layer(passkeyProfile(origin, trustedOrigins));

  const PasskeyProtocolLive = makePasskeyProtocolLayer().pipe(Layer.provide(PasskeyConfigLive));

  const PasskeyClaimsLive = Layer.effect(
    appAuth.strategies.passkey.SessionClaims,
    Effect.succeed({ resolve: ({ subjectId }: { subjectId: string }) => resolveClaims(subjectId) }),
  );

  /**
   * Passkey enrollment and removal require independent, recent action
   * evidence. The handler gates both behind a step-up grant; this owner turns
   * the session's recorded proofs into the evidence the library re-assesses
   * under the subject lock.
   */
  const PasskeyActionEvidenceLive = Layer.effect(
    Passkey.PasskeyActionEvidence,
    Effect.gen(function* () {
      const db = yield* Db;

      return Passkey.PasskeyActionEvidence.of({
        verify: ({ invocation, challenge, proof }) =>
          Effect.gen(function* () {
            if (!Predicate.isTagged(invocation, "Authenticated"))
              return yield* Passkey.PasskeyActionRequired.make({});

            if (invocation.subjectId !== challenge.revision.subjectId)
              return yield* Passkey.PasskeyActionRequired.make({});

            const user = yield* db.query.account
              .findFirst({ where: { id: invocation.subjectId } })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (!user || user.disabled) return yield* Passkey.PasskeyActionRequired.make({});

            const firstCredential = challenge.revision.credentials[0]?.credentialId;

            if (firstCredential === undefined) return yield* Passkey.PasskeyActionRequired.make({});

            // A step-up grant proves recent possession even when the session's
            // own sign-in is older than the management freshness window. It is
            // bound to this account, session and the enroll/remove action.
            const action = challenge.action === "remove" ? "passkey-remove" : "passkey-enroll";

            const steppedUp =
              proof !== undefined && invocation.sessionId !== undefined && authSecret !== undefined
                ? yield* verifyStepUpGrant(authSecret, Redacted.value(proof), {
                    subjectId: invocation.subjectId,
                    sessionId: invocation.sessionId,
                    action,
                    method: "passkey",
                  })
                : false;

            const verifiedAt = steppedUp ? DateTime.toEpochMillis(yield* DateTime.now) : undefined;

            const assurance = invocation.assurance;

            const proofs = (assurance.evidence ?? []).map((item) => ({
              method: item.method,
              credentialId:
                challenge.revision.credentials[item.credentialOrdinal ?? 0]?.credentialId ??
                firstCredential,
              factors: [...item.factors],
              userVerified: item.userVerified,
              phishingResistant: item.phishingResistant,
              verifiedAt: verifiedAt ?? item.verifiedAt,
            }));

            if (proofs.length === 0)
              proofs.push({
                method: assurance.method,
                credentialId: firstCredential,
                factors: [...assurance.factors],
                userVerified: false,
                phishingResistant: false,
                verifiedAt: verifiedAt ?? assurance.authenticatedAt,
              });

            return {
              evidence: Schema.decodeUnknownSync(Sessions.AuthenticationEvidence)({
                revision: challenge.revision,
                flowId: Sessions.AuthenticationFlowId.make(challenge.flowId),
                bindingDigest: challenge.bindingDigest,
                proofs,
              }),
              // Re-assess against the baseline assurance, not the current
              // account requirement: adding a passkey flips the account to
              // MFA, which the session that enrolled it cannot retroactively
              // satisfy. Freshness (and the step-up grant) carry the strength.
              requirement: authRequirement,
            };
          }),
      });
    }),
  );

  /**
   * Encrypts TOTP secrets with a stable key derived from AUTH_SECRET. Key IDs are
   * retained so envelopes can be re-encrypted later without invalidating factors.
   */
  const TotpSecretKeysLive = Layer.effect(
    Totp.TotpSecretKeys,
    Effect.gen(function* () {
      if (!authSecret) return yield* Totp.TotpUnavailable.make({});
      const key = Redacted.make(yield* Effect.promise(() => deriveTotpSecretKey(authSecret)));

      return Totp.TotpSecretKeys.of({
        current: Effect.succeed({ keyId: "v1", key }),
        get: (keyId) =>
          keyId === "v1" ? Effect.succeed(key) : Effect.fail(Totp.TotpUnavailable.make({})),
      });
    }),
  );

  const TotpPersistenceLive = Layer.effect(
    Totp.TotpPersistence,
    Effect.gen(function* () {
      const db = yield* Db;

      // `Hooks.LifecycleHooks` stays in this layer's requirements; the layer
      // below provides its implementation once at composition time.
      const services = yield* makeTotpPersistenceServices(totpMapping).pipe(
        Effect.provideService(Database, db),
      );

      return services.totpPersistence;
    }),
  ).pipe(Layer.provide(cryptoLayer), Layer.provide(LifecycleHooksLive));

  const TotpCryptographyLive = Totp.TotpCryptography.layer.pipe(
    Layer.provide(TotpSecretKeysLive),
    Layer.provide(cryptoLayer),
  );

  /**
   * TOTP management is authorized by a fresh passkey step-up plus, once the
   * authenticator is active, a current code. The single `actionProof` field
   * carries `{"grant":"…","code":"…"}`. The passkey step-up is what keeps TOTP
   * from being enrolled, replaced or removed with only a bearer session.
   */
  const TotpActionEvidenceLive = Layer.effect(
    Totp.TotpActionEvidence,
    Effect.gen(function* () {
      const persistence = yield* Totp.TotpPersistence;
      const cryptography = yield* Totp.TotpCryptography;

      const stepUpActionFor = (action: "enroll" | "confirm" | "disable" | "regenerate") => {
        if (action === "disable") return "mfa-disable" as const;

        if (action === "regenerate") return "mfa-regenerate" as const;

        return "mfa-enroll" as const;
      };

      const parseProof = (raw: string): TotpActionProof => {
        try {
          const parsed = Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json))(JSON.parse(raw)),
          );

          if (parsed) {
            const code = Option.getOrUndefined(
              Schema.decodeUnknownOption(Schema.String)(parsed.code),
            );

            const grant = Option.getOrUndefined(
              Schema.decodeUnknownOption(Schema.String)(parsed.grant),
            );

            const proof: TotpActionProof = {};

            if (code !== undefined) proof.code = code;

            if (grant !== undefined) proof.grant = grant;

            return proof;
          }
        } catch {
          // Enrollment and confirmation send the step-up grant directly; the
          // management forms send JSON with a code as well.
        }

        return { grant: raw };
      };

      return Totp.TotpActionEvidence.of({
        verify: ({ invocation, challenge, proof }) =>
          Effect.gen(function* () {
            if (!Predicate.isTagged(invocation, "Authenticated"))
              return yield* Totp.TotpActionRequired.make({});

            if (invocation.subjectId !== challenge.revision.subjectId)
              return yield* Totp.TotpActionRequired.make({});

            if (invocation.sessionId === undefined || authSecret === undefined)
              return yield* Totp.TotpActionRequired.make({});

            if (proof === undefined) return yield* Totp.TotpActionRequired.make({});

            const parsed = parseProof(Redacted.value(proof));

            if (parsed.grant === undefined || parsed.grant.length === 0)
              return yield* Totp.TotpActionRequired.make({});

            const stepUp = yield* readStepUpGrant(authSecret, parsed.grant, {
              subjectId: invocation.subjectId,
              sessionId: invocation.sessionId,
              action: stepUpActionFor(challenge.action),
            });

            if (stepUp?.method !== "passkey" || stepUp.credentialId === undefined)
              return yield* Totp.TotpActionRequired.make({});

            const passkeyCredentialId = stepUp.credentialId;

            if (
              !challenge.revision.credentials.some(
                (credential) => credential.credentialId === passkeyCredentialId,
              )
            )
              return yield* Totp.TotpActionRequired.make({});

            const snapshot = yield* persistence
              .snapshot({ moduleId: TOTP_MODULE_ID, subjectId: invocation.subjectId })
              .pipe(Effect.catchCause(() => Effect.fail(Totp.TotpActionRequired.make({}))));

            if (snapshot === undefined) return yield* Totp.TotpActionRequired.make({});

            const verifiedAt = DateTime.toEpochMillis(yield* DateTime.now);

            const proofs = [
              {
                method: "passkey",
                credentialId: passkeyCredentialId,
                factors: ["possession"],
                userVerified: true,
                phishingResistant: true,
                verifiedAt,
              },
            ];

            const record = snapshot.record;

            if (challenge.action === "disable" || challenge.action === "regenerate") {
              if (!record?.secret) return yield* Totp.TotpActionRequired.make({});

              if (!parsed.code) return yield* Totp.TotpActionRequired.make({});

              const nowMillis = DateTime.toEpochMillis(yield* DateTime.now);

              const step = yield* Effect.acquireUseRelease(
                cryptography.decryptSecret(
                  {
                    moduleId: TOTP_MODULE_ID,
                    subjectId: record.subjectId,
                    credentialId: record.credentialId,
                    revision: record.revision,
                  },
                  record.secret,
                ),
                (secret) => cryptography.matchCode(secret, parsed.code!, nowMillis, 1),
                (secret) => Effect.sync(() => secret.fill(0)),
              );

              if (step === null) return yield* Totp.TotpActionRequired.make({});

              proofs.push({
                method: "totp",
                credentialId: record.credentialId,
                factors: ["possession"],
                userVerified: false,
                phishingResistant: false,
                verifiedAt: DateTime.toEpochMillis(yield* DateTime.now),
              });
            }

            return Schema.decodeUnknownSync(Sessions.AuthenticationEvidence)({
              revision: challenge.revision,
              flowId: challenge.flowId,
              bindingDigest: challenge.bindingDigest,
              proofs,
            });
          }),
      });
    }),
  ).pipe(Layer.provide(TotpCryptographyLive), Layer.provide(TotpPersistenceLive));

  const TotpLive = Layer.mergeAll(
    TotpPersistenceLive,
    TotpCryptographyLive,
    TotpActionEvidenceLive,
  );

  const SessionStrategyLive = appAuth.sessions.statefulLayer(
    appSessionConfiguration.policy(appAuth.sessions.moduleId),
  );

  const SessionStepUpLive = appAuth.sessions.stepUpLayer([
    {
      profileId: Sessions.SessionStepUpProfileId.make("totp"),
      generation: 1,
      requirement: {
        alternatives: [
          {
            factors: ["possession"],
            userVerified: true,
            phishingResistant: true,
            minimumCredentials: 2,
          },
        ],
        maximumAgeMillis: 5 * 60 * 1000,
      },
      lifetimeMillis: 5 * 60 * 1000,
      attemptLimit: 5,
    },
  ]);

  const CompletionLive = appAuth.sessions.completionLayer({
    pendingLifetimeMillis: 10 * 60 * 1000,
    attemptLimit: 5,
  });

  const PersistenceLive = AuthPersistenceConfig.layer.pipe(
    Layer.provide(AuthPersistenceConfig.Config.layer(authStorage)),
  );

  const layer = appAuth.layer.pipe(
    Layer.provide(CompletionLive),
    Layer.provide(SessionStepUpLive),
    Layer.provide(SessionStrategyLive),
    Layer.provide(TotpLive),
    Layer.provide(PersistenceLive),
    Layer.provide(LifecycleHooksLive),
    Layer.provide(PasskeyConfigLive),
    Layer.provide(PasskeyProtocolLive),
    Layer.provide(PasskeyClaimsLive),
    Layer.provide(PasskeyActionEvidenceLive),
    Layer.provide(PasskeyRegistrationLive),
    Layer.provide(cryptoLayer),
  );

  const keyring = authSecret
    ? {
        activeKeyId: "default",
        keys: [
          {
            id: "default",
            material: Redacted.make(
              btoa(authSecret).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
            ),
          },
        ],
      }
    : undefined;

  const withRequestBinding =
    keyring === undefined
      ? layer
      : layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Auth.AuthConfig.layer({ secret: Redacted.make(authSecret!) }),
              Auth.RequestBindingConfig.layer({
                lifetimeMillis: 10 * 60 * 1000,
                generation: 1,
                keyring,
              }),
            ),
          ),
        );

  /**
   * Step-up factor verification shares the auth runtime's private storage
   * services. It is merged into this layer's output so tenant/account handlers
   * can require recent proof without reaching into auth internals.
   */
  const stepUpLayer = stepUpServiceLayer().pipe(
    Layer.provide(TotpLive),
    Layer.provide(PersistenceLive),
    Layer.provide(PasskeyConfigLive),
    Layer.provide(PasskeyProtocolLive),
    Layer.provide(LifecycleHooksLive),
    Layer.provide(cryptoLayer),
  );

  return Layer.merge(withRequestBinding, stepUpLayer);
};
