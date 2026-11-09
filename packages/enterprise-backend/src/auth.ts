import { Auth, Email, EmailDelivery, Hooks, Password, Proofs, Sessions } from "@yielded/auth";
import { makeAppAuth, type AuthClaims } from "@mattrax/enterprise-domain";
import { Db, authRequirement, authStorage, AuthPersistenceConfig } from "@mattrax/enterprise-core";
import { DateTime } from "effect";
import { Effect, Layer, Redacted } from "effect";
import { SecureRandom } from "effect/crypto";
import { provisionEmailCredential } from "./emailCredential.ts";
import { signToken } from "./tokens.ts";

export const sessionCookie = "__Host-mattrax_session";
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

  const PersistenceLive = AuthPersistenceConfig.layer.pipe(
    Layer.provide(AuthPersistenceConfig.Config.layer(authStorage)),
    Layer.provide(ProvisioningLive),
  );

  const layer = appAuth.layer.pipe(
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
