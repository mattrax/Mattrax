import { Effect } from "effect";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseDbError,
  EnterpriseForbidden,
  EnterpriseNotFound,
} from "@mattrax/enterprise-domain";
import { type EnterpriseDb, schema } from "@mattrax/enterprise-core";
import { directoryProviderRegistry } from "../Directory/registry.ts";

export type LinkDirectoryUserSsoInput = {
  readonly organizationId: string;
  readonly directoryUserId: string;
};

export type LinkDirectoryUserSsoResult = {
  readonly accountId: string;
  readonly objectId: string;
  /** False when the same link already existed, so callers can skip the audit. */
  readonly created: boolean;
};

/**
 * Explicitly link a directory person imported from Entra to an existing
 * Mattrax account.
 *
 * The callback refuses to auto-link an account that belongs to more than one
 * tenant: doing so by email would let this tenant's administrator claim a
 * session that also reaches the account's other tenants. This is the
 * administrator-confirmed repair for that case. It still only uses the IdP
 * object id the tenant's own sync stored on the directory person, and only
 * links the account whose email is that person's email, so the confirmation
 * cannot be used to join two unrelated identities.
 */
export const linkDirectoryUserSso = (
  db: EnterpriseDb,
  input: LinkDirectoryUserSsoInput,
): Effect.Effect<
  LinkDirectoryUserSsoResult,
  | EnterpriseBadRequest
  | EnterpriseConflict
  | EnterpriseForbidden
  | EnterpriseNotFound
  | EnterpriseDbError
> =>
  Effect.gen(function* () {
    const directoryUser = yield* db.query.user.findFirst({
      where: { id: input.directoryUserId, organizationId: input.organizationId },
    });

    if (!directoryUser)
      return yield* Effect.fail(new EnterpriseNotFound({ message: "Directory user not found" }));

    // Only a provider with a deployed sign-in integration can be linked. This
    // is the registry's answer, not a source string in this handler: Google
    // Workspace sync is supported while its OIDC sign-in is not, so claiming a
    // link there would promise a sign-in that cannot happen.
    const provider = directoryProviderRegistry.byUserSource(directoryUser.source);

    if (!provider || !provider.capabilities.ssoSignIn || !directoryUser.externalId)
      return yield* Effect.fail(
        new EnterpriseBadRequest({
          message: provider
            ? `${provider.label} directory users cannot sign in to Mattrax yet. ${provider.label} single sign-on requires an OpenID Connect client for this deployment; directory sync alone does not provide one.`
            : "Only a directory user imported from an identity provider with single sign-on can be linked.",
        }),
      );

    const config = yield* db.query.ssoConfig.findFirst({
      where: { organizationId: input.organizationId },
    });

    if (!config?.enabled || !config.azureTenantId)
      return yield* Effect.fail(
        new EnterpriseBadRequest({
          message: "Enable Microsoft Entra single sign-on before linking an SSO identity.",
        }),
      );

    const email = directoryUser.email.trim().toLowerCase();

    const account = yield* db.query.account.findFirst({ where: { email } });

    if (!account)
      return yield* Effect.fail(
        new EnterpriseNotFound({ message: "No Mattrax account uses this email address." }),
      );

    if (account.disabled)
      return yield* Effect.fail(
        new EnterpriseForbidden({ message: "That Mattrax account is disabled." }),
      );

    const member = yield* db.query.member.findFirst({
      where: { organizationId: input.organizationId, accountId: account.id },
    });

    if (!member)
      return yield* Effect.fail(
        new EnterpriseBadRequest({
          message: "That Mattrax account is not a member of this tenant.",
        }),
      );

    // The callback only auto-links an email whose domain this tenant has
    // proven it controls. The explicit link must not be a way around that,
    // or an administrator could add a victim's address to an Entra object
    // they own and sign in as them across tenants.
    const emailDomain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();

    const verifiedDomain = yield* db.query.ssoDomain.findFirst({
      where: {
        domain: emailDomain,
        organizationId: input.organizationId,
        isVerified: true,
        source: "entra",
      },
    });

    if (!verifiedDomain)
      return yield* Effect.fail(
        new EnterpriseForbidden({
          message:
            "This email domain is not verified for this tenant. Finish Entra directory sync before linking single sign-on.",
        }),
      );

    const objectId = directoryUser.externalId;

    const byObject = yield* db.query.ssoIdentity.findFirst({
      where: { organizationId: input.organizationId, objectId },
    });

    if (byObject) {
      if (byObject.accountId === account.id)
        return { accountId: account.id, objectId, created: false };

      return yield* Effect.fail(
        new EnterpriseConflict({
          message: "This directory user is already linked to another Mattrax account.",
        }),
      );
    }

    const byAccount = yield* db.query.ssoIdentity.findFirst({
      where: { organizationId: input.organizationId, accountId: account.id },
    });

    if (byAccount)
      return yield* Effect.fail(
        new EnterpriseConflict({
          message: "That Mattrax account is already linked to another SSO identity in this tenant.",
        }),
      );

    yield* db.insert(schema.ssoIdentity).values({
      organizationId: input.organizationId,
      objectId,
      accountId: account.id,
      createdAt: new Date(),
    });

    return { accountId: account.id, objectId, created: true };
  }).pipe(
    // Database failures are the only non-domain error this path can produce.
    // Translate them so the endpoint's declared error union stays accurate.
    Effect.catch((error) =>
      Effect.fail(
        error instanceof EnterpriseBadRequest ||
          error instanceof EnterpriseConflict ||
          error instanceof EnterpriseForbidden ||
          error instanceof EnterpriseNotFound
          ? error
          : new EnterpriseDbError({
              message: "The SSO identity could not be linked.",
            }),
      ),
    ),
  );
