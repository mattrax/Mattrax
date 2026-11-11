import { Auth, Email, EmailDelivery, Hooks, Password, Proofs, Sessions, Totp } from "@yielded/auth";
import {
  appSessionConfiguration,
  makeAppAuth,
  TOTP_MODULE_ID,
  type AuthClaims,
} from "@mattrax/enterprise-domain";
import { Database, makeTotpPersistenceServices } from "@yielded/auth-persistence-drizzle/Mysql2";
import {
  Db,
  authRequirement,
  authStorage,
  AuthPersistenceConfig,
  totpMapping,
} from "@mattrax/enterprise-core";
import { DateTime } from "effect";
import { Effect, Layer, Redacted } from "effect";
import { SecureRandom } from "effect/crypto";
import { provisionEmailCredential } from "./emailCredential.ts";
import { signToken } from "./tokens.ts";

export const sessionCookie = "__Host-mattrax_session";

/** Application-owned AES-256 key material for TOTP secret envelopes. */
export const deriveTotpSecretKey = async (authSecret: string) =>
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`mattrax/totp/secret-key/v1:${authSecret}`),
    ),
  );
type EmailBinding = {
  send(message: {
    to: string;
    from: { name: string; email: string };
    subject: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
};

export type AppAuthService = ReturnType<typeof makeAppAuth>;

export type AuthLiveOptions = {
  readonly appAuth: AppAuthService;
  readonly cryptoLayer: Layer.Layer<any, any, any>;
  readonly proofSchedulerLayer?: Layer.Layer<any, any, any>;
  readonly email?: EmailBinding;
  readonly emailFrom?: string;
  /** Application secret used to sign passwordless request bindings and email proofs. */
  readonly authSecret?: string;
  /** Canonical public origin used in verification links. */
  readonly origin?: string;
};

export const makeAuthLive = ({
  appAuth,
  cryptoLayer,
  proofSchedulerLayer,
  email,
  emailFrom,
  authSecret,
  origin,
}: AuthLiveOptions) => {
  const ClaimsLive = Layer.effect(
    appAuth.strategies.password.SessionClaims,
    Effect.gen(function* () {
      const db = yield* Db;

      return {
        resolve: ({ subjectId }: { subjectId: string }) =>
          Effect.gen(function* () {
            const user = yield* db.query.user
              .findFirst({ where: { id: subjectId } })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));
            if (!user || user.disabled) return yield* Password.PasswordUnavailable.make({});
            return {
              name: user.name,
              email: user.email,
              emailVerified: user.emailVerified,
            } satisfies AuthClaims;
          }),
      };
    }),
  );

  const ProvisioningLive = Layer.effect(
    AuthPersistenceConfig.Provisioning,
    Effect.gen(function* () {
      const random = yield* SecureRandom.SecureRandom;

      return {
        password: {
          values: ({ identifier, registration }: any) =>
            Effect.gen(function* () {
              const id = yield* random.uuidV4();
              const revision = yield* random.uuidV4();
              const now = new Date();
              return {
                id,
                name: registration.name,
                email: identifier.value,
                emailVerified: false,
                image: null,
                stripeCustomerId: null,
                disabled: false,
                authRevision: revision,
                createdAt: now,
                updatedAt: now,
              };
            }),
        },
      };
    }),
  );

  const EmailDeliveryLive = Layer.succeed(EmailDelivery.EmailDelivery, {
    send: (message) =>
      Effect.tryPromise({
        try: async () => {
          if (!email) {
            console.log("EMAIL", message.to, message.subject, Redacted.value(message.text));
            return;
          }
          await email.send({
            to: message.to,
            from: { name: "Mattrax", email: emailFrom ?? "hello@mattrax.cloud" },
            subject: message.subject,
            text: Redacted.value(message.text),
            ...(message.html ? { html: Redacted.value(message.html) } : {}),
          });
        },
        catch: () => EmailDelivery.EmailNotAccepted.make({}),
      }),
  });

  const LifecycleHooksLive = Layer.effect(
    Hooks.LifecycleHooks,
    Effect.gen(function* () {
      const db = yield* Db;
      return Hooks.LifecycleHooks.of({
        before: () => Effect.void,
        after: (event) =>
          Effect.gen(function* () {
            if (
              (event.snapshot.action === "registration" || event.snapshot.action === "sign-in") &&
              event.snapshot.subjectId
            ) {
              yield* provisionEmailCredential(
                db,
                appAuth.strategies.email.persistence.moduleId as string,
                event.snapshot.subjectId,
              );
              if (event.snapshot.action === "registration" && authSecret && origin) {
                const user = yield* db.query.user
                  .findFirst({ where: { id: event.snapshot.subjectId } })
                  .pipe(Effect.catch(() => Effect.succeed(undefined)));
                if (user) {
                  const token = yield* signToken(authSecret, {
                    sub: user.id,
                    email: user.email,
                    exp: Date.now() + 24 * 60 * 60 * 1000,
                    purpose: "email-verify",
                  }).pipe(Effect.catch(() => Effect.succeed("")));
                  const link = token
                    ? `${origin}/verify-email?token=${encodeURIComponent(token)}`
                    : "";
                  if (token && email) {
                    yield* Effect.tryPromise({
                      try: () =>
                        email.send({
                          to: user.email,
                          from: {
                            name: "Mattrax",
                            email: emailFrom ?? "hello@mattrax.cloud",
                          },
                          subject: "Verify your Mattrax email address",
                          text: `Welcome to Mattrax. Verify your email address by opening this link:\n\n${link}\n\nThis link expires in 24 hours.`,
                          html: `<p>Welcome to Mattrax.</p><p><a href="${link}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
                        }),
                      catch: () => EmailDelivery.EmailNotAccepted.make({}),
                    }).pipe(Effect.catch(() => Effect.void));
                  } else if (token) {
                    console.log("VERIFY EMAIL", user.email, link);
                  }
                }
              }
            }
            return [];
          }),
      });
    }),
  );

  const CompromisedPasswordsLive = Layer.succeed(Password.CompromisedPasswords, {
    check: () => Effect.succeed({ _tag: "Allowed" as const }),
  });

  const NewPasswordCheckLive = Password.NewPasswordCheck.layer(Password.defaultPasswordPolicy).pipe(
    Layer.provide(CompromisedPasswordsLive),
  );

  const ActionEvidenceLive = Layer.succeed(Password.PasswordActionEvidence, {
    verify: ({ challenge, currentPasswordEvidence, recovery }) =>
      Effect.gen(function* () {
        if (currentPasswordEvidence) {
          return {
            evidence: {
              ...currentPasswordEvidence,
              flowId: Sessions.AuthenticationFlowId.make(challenge.commandId),
              bindingDigest: challenge.bindingDigest,
              revision: challenge.revision,
            },
            requirement: authRequirement,
          };
        }

        if (recovery) {
          const credentialId =
            challenge.targetCredentialId ?? challenge.revision.credentials[0]?.credentialId;
          if (!credentialId) return yield* Password.PasswordActionRequired.make({});
          return {
            evidence: {
              revision: challenge.revision,
              flowId: Sessions.AuthenticationFlowId.make(challenge.commandId),
              bindingDigest: challenge.bindingDigest,
              proofs: [
                {
                  method: "password-reset",
                  credentialId,
                  factors: ["knowledge"] as Array<"knowledge" | "possession" | "inherence">,
                  userVerified: false,
                  phishingResistant: false,
                  verifiedAt: DateTime.nowUnsafe(),
                },
              ],
            },
            requirement: authRequirement,
          };
        }

        return yield* Password.PasswordActionRequired.make({});
      }),
  });

  const resolveClaims = (subjectId: string) =>
    Effect.gen(function* () {
      const db = yield* Db;
      const user = yield* db.query.user
        .findFirst({ where: { id: subjectId } })
        .pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (!user || user.disabled) return yield* Password.PasswordUnavailable.make({});
      return {
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      } satisfies AuthClaims;
    });

  const EmailClaimsLive = Layer.effect(
    appAuth.strategies.email.SessionClaims,
    Effect.succeed({ resolve: ({ subjectId }: { subjectId: string }) => resolveClaims(subjectId) }),
  );

  const EmailReturnTargetsLive = Email.EmailReturnTargets.exactRoutes([
    "/",
    "/dashboard",
    "/account",
    "/login",
  ]);

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
      const hooks = yield* Hooks.LifecycleHooks;
      const services = yield* makeTotpPersistenceServices(totpMapping).pipe(
        Effect.provideService(Database, db as any),
        Effect.provideService(Hooks.LifecycleHooks, hooks),
      );
      return services.totpPersistence;
    }),
  ).pipe(Layer.provide(cryptoLayer), Layer.provide(LifecycleHooksLive));

  const TotpCryptographyLive = Totp.TotpCryptography.layer.pipe(
    Layer.provide(TotpSecretKeysLive),
    Layer.provide(cryptoLayer),
  );

  /**
   * Management actions require a fresh password and authenticator code once a
   * factor is active. The single `actionProof` field carries
   * `{"password":"…","code":"…"}`; the raw legacy form is treated as a code and
   * only works when the session itself carries fresh knowledge evidence. A
   * replayed code is rejected by the factor commit's accepted-step guard.
   */
  const TotpActionEvidenceLive = Layer.effect(
    Totp.TotpActionEvidence,
    Effect.gen(function* () {
      const persistence = yield* Totp.TotpPersistence;
      const cryptography = yield* Totp.TotpCryptography;
      const passwords = yield* Password.PasswordPersistence;
      const passwordHashing = yield* Password.PasswordHashing;
      const passwordModuleId = appAuth.strategies.password.persistence.moduleId as string;

      const parseProof = (raw: string): { password?: string; code?: string } => {
        try {
          const parsed = JSON.parse(raw) as { password?: unknown; code?: unknown };
          if (parsed && typeof parsed === "object")
            return {
              ...(typeof parsed.password === "string" ? { password: parsed.password } : {}),
              ...(typeof parsed.code === "string" ? { code: parsed.code } : {}),
            };
        } catch {
          // Not JSON: keep compatibility with a code-only proof.
        }
        return { code: raw };
      };

      return Totp.TotpActionEvidence.of({
        verify: ({ invocation, challenge, proof }) =>
          Effect.gen(function* () {
            if (invocation._tag !== "Authenticated") return yield* Totp.TotpActionRequired.make({});
            if (invocation.subjectId !== challenge.revision.subjectId)
              return yield* Totp.TotpActionRequired.make({});

            const snapshot = yield* persistence
              .snapshot({ moduleId: TOTP_MODULE_ID, subjectId: invocation.subjectId })
              .pipe(Effect.catchCause(() => Effect.fail(Totp.TotpActionRequired.make({}))));
            if (snapshot === undefined) return yield* Totp.TotpActionRequired.make({});

            const firstCredential = challenge.revision.credentials[0]?.credentialId;
            if (firstCredential === undefined) return yield* Totp.TotpActionRequired.make({});

            const assuranceProofs = (invocation.assurance.evidence ?? []).map((item) => ({
              method: item.method,
              credentialId:
                challenge.revision.credentials[item.credentialOrdinal ?? 0]?.credentialId ??
                firstCredential,
              factors: [...item.factors],
              userVerified: item.userVerified,
              phishingResistant: item.phishingResistant,
              verifiedAt: item.verifiedAt,
            }));

            const proofs: Array<{
              method: string;
              credentialId: string;
              factors: Array<"knowledge" | "possession" | "inherence">;
              userVerified: boolean;
              phishingResistant: boolean;
              verifiedAt: unknown;
            }> =
              assuranceProofs.length > 0
                ? assuranceProofs
                : [
                    {
                      method: invocation.assurance.method,
                      credentialId: firstCredential,
                      factors: [...invocation.assurance.factors],
                      userVerified: false,
                      phishingResistant: false,
                      verifiedAt: invocation.assurance.authenticatedAt,
                    },
                  ];

            const record = snapshot.record;
            if (!record?.secret) {
              // MFA requires a knowledge factor. Passwordless/SSO-only
              // accounts can never satisfy password + authenticator, so refuse
              // enrollment instead of creating an unrecoverable account.
              const candidate = yield* passwords
                .readForSubject({
                  moduleId: passwordModuleId,
                  subjectId: invocation.subjectId,
                })
                .pipe(Effect.catchCause(() => Effect.fail(Totp.TotpActionRequired.make({}))));
              if (candidate._tag === "None") return yield* Totp.TotpActionRequired.make({});
            }
            if (record?.secret) {
              if (proof === undefined) return yield* Totp.TotpActionRequired.make({});
              const parsed = parseProof(Redacted.value(proof));
              if (!parsed.password || !parsed.code) return yield* Totp.TotpActionRequired.make({});

              const candidate = yield* passwords
                .readForSubject({
                  moduleId: passwordModuleId,
                  subjectId: invocation.subjectId,
                })
                .pipe(Effect.catchCause(() => Effect.fail(Totp.TotpActionRequired.make({}))));
              if (candidate._tag === "None") return yield* Totp.TotpActionRequired.make({});
              const verified = yield* passwordHashing
                .verify(Redacted.make(parsed.password), candidate.value.verifier)
                .pipe(Effect.catchCause(() => Effect.fail(Totp.TotpActionRequired.make({}))));
              if (!verified.matches) return yield* Totp.TotpActionRequired.make({});

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
              proofs.push(
                {
                  method: "password",
                  credentialId: candidate.value.credentialId,
                  factors: ["knowledge"],
                  userVerified: false,
                  phishingResistant: false,
                  verifiedAt: yield* DateTime.now,
                },
                {
                  method: "totp",
                  credentialId: record.credentialId,
                  factors: ["possession"],
                  userVerified: false,
                  phishingResistant: false,
                  verifiedAt: yield* DateTime.now,
                },
              );
            }

            if (proofs.length === 0) return yield* Totp.TotpActionRequired.make({});

            return Sessions.AuthenticationEvidence.make({
              revision: challenge.revision,
              flowId: challenge.flowId,
              bindingDigest: challenge.bindingDigest,
              proofs: proofs as any,
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
            factors: ["knowledge", "possession"],
            userVerified: false,
            phishingResistant: false,
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
    Layer.provide(ProvisioningLive),
  );

  const layer = appAuth.layer.pipe(
    Layer.provide(CompletionLive),
    Layer.provide(SessionStepUpLive),
    Layer.provide(SessionStrategyLive),
    Layer.provide(TotpLive),
    Layer.provide(PersistenceLive),
    Layer.provide(ClaimsLive),
    Layer.provide(EmailDeliveryLive),
    Layer.provide(NewPasswordCheckLive),
    Layer.provide(ActionEvidenceLive),
    Layer.provide(LifecycleHooksLive),
    Layer.provide(Password.PasswordAttemptLimiter.layer),
    Layer.provide(EmailClaimsLive),
    Layer.provide(EmailReturnTargetsLive),
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
              Proofs.ProofKeys.layer(keyring),
            ),
          ),
        );

  return proofSchedulerLayer
    ? withRequestBinding.pipe(Layer.provide(proofSchedulerLayer))
    : withRequestBinding;
};
