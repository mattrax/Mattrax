import { Effect } from "effect";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseDbError,
  EnterpriseForbidden,
  EnterpriseNotFound,
} from "@mattrax/enterprise-domain";
import { type EnterpriseDb, schema } from "@mattrax/enterprise-core";

export type LinkDirectoryUserSsoInput = {
  readonly organizationId: string;
  readonly directoryUserId: string;
};

export type LinkDirectoryUserSsoResult = {
  readonly accountId: string;
  readonly objectId: string;
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

    if (directoryUser.source !== "entra" || !directoryUser.externalId)
      return yield* Effect.fail(
        new EnterpriseBadRequest({
          message:
            "Only a directory user imported from Microsoft Entra ID has an SSO identity to link.",
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

    const objectId = directoryUser.externalId;

    const byObject = yield* db.query.ssoIdentity.findFirst({
      where: { organizationId: input.organizationId, objectId },
    });

    if (byObject) {
      if (byObject.accountId === account.id) return { accountId: account.id, objectId };

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

    return { accountId: account.id, objectId };
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
