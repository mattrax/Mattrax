import { EmailDelivery, Hooks, Password, Sessions } from "@yielded/auth";
import { makeAppAuth, type AuthClaims } from "@mattrax/enterprise-domain";
import {
  Db,
  authRequirement,
  authStorage,
  AuthPersistenceConfig,
  schema,
} from "@mattrax/enterprise-core";
import { and, eq } from "drizzle-orm";
import { DateTime } from "effect";
import { Effect, Layer, Redacted } from "effect";
import { SecureRandom } from "effect/crypto";

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
  readonly email?: EmailBinding;
  readonly emailFrom?: string;
};

export const makeAuthLive = ({ appAuth, cryptoLayer, email, emailFrom }: AuthLiveOptions) => {
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
                emailVerified: true,
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
            if (event.snapshot.action === "registration" && event.snapshot.subjectId) {
              yield* db
                .update((schema as any).authIdentifiers)
                .set({ verifiedAt: Date.now() })
                .where(
                  and(
                    eq((schema as any).authIdentifiers.subjectId, event.snapshot.subjectId),
                    eq((schema as any).authIdentifiers.namespace, "email"),
                  ),
                )
                .pipe(Effect.catch(() => Effect.void));
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

  const PersistenceLive = AuthPersistenceConfig.layer.pipe(
    Layer.provide(AuthPersistenceConfig.Config.layer(authStorage)),
    Layer.provide(ProvisioningLive),
  );

  return appAuth.layer.pipe(
    Layer.provide(PersistenceLive),
    Layer.provide(ClaimsLive),
    Layer.provide(EmailDeliveryLive),
    Layer.provide(NewPasswordCheckLive),
    Layer.provide(ActionEvidenceLive),
    Layer.provide(LifecycleHooksLive),
    Layer.provide(Password.PasswordAttemptLimiter.layer),
    Layer.provide(cryptoLayer),
  );
};
