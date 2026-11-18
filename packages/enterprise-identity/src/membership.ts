import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { type EnterpriseDb, schema } from "@mattrax/enterprise-core";

type MembershipDatabase = Pick<EnterpriseDb, "delete">;

/**
 * Remove the account-to-IdP link that survives a membership removal.
 *
 * The membership row is the tenant's own record and is removed by the caller,
 * which also enforces the owner safeguards. The SSO identity row belongs to the
 * account, so it is cleared here as well; otherwise a later sign-in would keep
 * resolving the removed account through this tenant.
 *
 * Directory users are a separate identity and deliberately survive: removing an
 * administrator does not remove the person from the tenant's directory, their
 * device links or their user policies.
 */
export const clearTenantAccountDirectoryState = (
  db: MembershipDatabase,
  organizationId: string,
  accountId: string,
) =>
  Effect.gen(function* () {
    yield* db
      .delete(schema.ssoIdentity)
      .where(
        and(
          eq(schema.ssoIdentity.organizationId, organizationId),
          eq(schema.ssoIdentity.accountId, accountId),
        ),
      );
  });
