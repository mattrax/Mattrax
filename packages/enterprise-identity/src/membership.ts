import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { type EnterpriseDb, schema } from "@mattrax/enterprise-core";

type MembershipDatabase = Pick<EnterpriseDb, "select" | "delete">;

/**
 * Remove the directory state that grants one user access through a tenant.
 *
 * The membership row is the tenant's own record and is removed by the caller,
 * which also enforces the owner safeguards. This clears what would otherwise
 * survive that removal: the user's membership of the tenant's directory
 * groups (and the policies those grant) and the IdP identity that lets a later
 * sync re-provision the member.
 */
export const clearTenantUserDirectoryState = (
  db: MembershipDatabase,
  organizationId: string,
  userId: string,
) =>
  Effect.gen(function* () {
    const groups = yield* db
      .select({ id: schema.userGroup.id })
      .from(schema.userGroup)
      .where(eq(schema.userGroup.organizationId, organizationId));

    if (groups.length > 0)
      yield* db.delete(schema.userGroupMember).where(
        and(
          eq(schema.userGroupMember.userId, userId),
          inArray(
            schema.userGroupMember.groupId,
            groups.map((group) => group.id),
          ),
        ),
      );

    yield* db
      .delete(schema.ssoIdentity)
      .where(
        and(
          eq(schema.ssoIdentity.organizationId, organizationId),
          eq(schema.ssoIdentity.userId, userId),
        ),
      );
  });
