import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";

type InvitationDatabase = Pick<EnterpriseDb, "select" | "update">;

/**
 * Close matching pending invitations after directory provisioning creates a
 * membership. The provisioned member keeps the role the directory assigned;
 * the invitation only stops being actionable.
 */
export const settlePendingInvitations = (
  db: InvitationDatabase,
  organizationId: string,
  email: string,
  acceptedAt: Date = new Date(),
) =>
  Effect.gen(function* () {
    const normalized = email.trim().toLowerCase();

    if (!normalized) return;

    const pending = yield* db
      .select({ id: schema.invitation.id, email: schema.invitation.email })
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, organizationId),
          eq(schema.invitation.status, "pending"),
        ),
      );

    for (const invitation of pending)
      if (invitation.email.trim().toLowerCase() === normalized)
        yield* db
          .update(schema.invitation)
          .set({ status: "accepted", acceptedAt, updatedAt: acceptedAt })
          .where(eq(schema.invitation.id, invitation.id));
  });
