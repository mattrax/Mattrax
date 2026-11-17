import { eq, lt } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { Auth, Schema as AuthSchema, Sessions } from "@yielded/auth";
import { AuthCredentialCommandCollector, type AuthInvocation } from "@yielded/auth/Operations";
import type { StrategyDefinition } from "@yielded/auth/Auth";
import { Db, authCredentials, authRequirementForSubject, schema } from "@mattrax/enterprise-core";
import { AuthClaims, SsoRejected } from "@mattrax/enterprise-domain";
import { verifyToken } from "@mattrax/enterprise-tokens";

type SsoServices = {
  readonly db: Db["Service"];
  /* oxlint-disable-next-line typescript/no-explicit-any -- The completion
   * service is generic over the strategy's claims codec, which only exists
   * inside the library's `bind` callback, so its shape cannot be named here. */
  readonly completion: any;
  readonly secret: string;
};

class SsoServicesTag extends Context.Service<SsoServicesTag, SsoServices>()(
  "mattrax/enterprise-backend/SsoServices",
) {}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const digest = (value: string) =>
  Effect.promise(async () => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return toBase64Url(new Uint8Array(bytes));
  });

/**
 * A host-defined SSO strategy. The public action receives a short-lived,
 * HMAC-signed assertion minted by the OIDC callback after it verifies the IdP
 * token. The strategy only trusts that assertion and revalidates the subject,
 * tenant membership and active credential vector before issuing a session.
 */
/* oxlint-disable-next-line typescript/no-explicit-any -- `StrategyDefinition`
 * is generic over the library's claims type lambda, which callers only see
 * through the service it produces. */
export const makeSsoStrategy = (): StrategyDefinition<any, string | undefined> => ({
  namespace: undefined,
  bind: ({ sessions }) => {
    const layer = Layer.effect(
      SsoServicesTag,
      Effect.gen(function* () {
        const db = yield* Db;
        const completion = yield* sessions.AuthenticationCompletion;
        const config = yield* Auth.AuthConfig;

        return SsoServicesTag.of({
          db,
          completion,
          secret: Redacted.value(config.secret),
        });
      }).pipe(Effect.tapCause((cause) => Effect.logError(`SSO layer failed: ${String(cause)}`))),
    );

    const strategy = Auth.makeStrategy(
      {
        signIn: (_invocation: AuthInvocation, input: { token: string }) =>
          Effect.gen(function* () {
            const services = yield* SsoServicesTag;

            const payload = yield* verifyToken(services.secret, input.token).pipe(
              Effect.mapError(() => new SsoRejected({ message: "Invalid SSO assertion" })),
            );

            if (payload.exp <= Date.now() || payload.purpose !== "sso-assertion")
              return yield* Effect.fail(new SsoRejected({ message: "SSO assertion expired" }));
            const tenantId = payload.tenantId;

            if (!tenantId)
              return yield* Effect.fail(
                new SsoRejected({ message: "SSO assertion has no tenant" }),
              );

            // The assertion arrives in a URL, so it is single-use. The primary
            // key insert is the atomic claim; a second redemption loses.
            if (!payload.jti)
              return yield* Effect.fail(new SsoRejected({ message: "SSO assertion has no id" }));

            yield* services.db
              .delete(schema.ssoAssertion)
              .where(lt(schema.ssoAssertion.expiresAt, new Date()));

            const claimed = yield* services.db
              .insert(schema.ssoAssertion)
              .ignore()
              .values({
                jti: payload.jti,
                expiresAt: new Date(payload.exp),
                createdAt: new Date(),
              });

            if (claimed.affectedRows === 0)
              return yield* Effect.fail(
                new SsoRejected({ message: "SSO assertion was already used" }),
              );

            const user = yield* services.db.query.user.findFirst({ where: { id: payload.sub } });

            if (!user || user.disabled)
              return yield* Effect.fail(new SsoRejected({ message: "Unknown SSO user" }));

            if (user.email.toLowerCase() !== payload.email.toLowerCase())
              return yield* Effect.fail(
                new SsoRejected({ message: "SSO email does not match the account" }),
              );

            const member = yield* services.db.query.member.findFirst({
              where: { userId: user.id, organizationId: tenantId },
            });

            if (!member)
              return yield* Effect.fail(
                new SsoRejected({ message: "User is not a member of this tenant" }),
              );

            const credentials = yield* services.db
              .select()
              .from(authCredentials)
              .where(eq(authCredentials.subjectId, user.id));

            const active = credentials.filter((credential) => credential.active);

            if (active.length === 0)
              return yield* Effect.fail(
                new SsoRejected({ message: "User has no active credential" }),
              );

            if (!user.emailVerified)
              yield* services.db
                .update(schema.user)
                .set({ emailVerified: true, updatedAt: new Date() })
                .where(eq(schema.user.id, user.id));

            const flowId = Sessions.AuthenticationFlowId.make(`sso:${crypto.randomUUID()}`);

            const bindingDigest = AuthSchema.TokenDigest.make(
              yield* digest(`${input.token}:${flowId}`),
            );

            const revision = yield* Schema.decodeUnknownEffect(Sessions.AuthenticationRevision)({
              subjectId: user.id,
              securityRevision: user.authRevision,
              credentials: active.map((credential) => ({
                credentialId: credential.credentialId,
                revision: credential.revision,
              })),
            });

            const evidence: Sessions.AuthenticationEvidence = {
              flowId,
              bindingDigest,
              revision,
              proofs: [
                {
                  method: "sso-oidc",
                  credentialId: active[0]!.credentialId,
                  factors: ["possession"],
                  userVerified: true,
                  phishingResistant: false,
                  verifiedAt: DateTime.nowUnsafe(),
                },
              ],
            };

            const applicationClaims: AuthClaims = {
              name: user.name,
              email: user.email,
              emailVerified: true,
            };

            const prepared = yield* services.completion.prepare({
              evidence,
              requirement: authRequirementForSubject(user),
              claims: applicationClaims,
            });

            const result = yield* prepared.read;
            const collector = yield* AuthCredentialCommandCollector;

            if (result.credentialCommands.length > 0) yield* collector(result.credentialCommands);

            return result.value;
          }).pipe(
            Effect.catch((error) =>
              Effect.fail(
                new SsoRejected({
                  message: error instanceof SsoRejected ? error.message : "SSO sign-in failed",
                }),
              ),
            ),
            Effect.catchDefect((defect) =>
              Effect.fail(new SsoRejected({ message: `SSO defect: ${String(defect)}` })),
            ),
          ),
      },
      layer,
      { completion: true },
    );

    return { strategy };
  },
});
