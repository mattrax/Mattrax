import { eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  accounts,
  db,
  tenantAccountInvites,
  tenantAccounts,
  tenants,
} from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";
import { encodeId } from "../../utils";
import { sendEmail } from "../../emails";
import { env } from "../../env";

export const adminsRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    const [ownerId, rows] = await Promise.allSettled([
      db
        .select({
          ownerId: tenants.ownerPk,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .then((v) => v?.[0]?.ownerId),
      db
        .select({
          id: accounts.pk,
          name: accounts.name,
          email: accounts.email,
        })
        .from(accounts)
        .leftJoin(tenantAccounts, eq(tenantAccounts.accountPk, accounts.pk))
        .where(eq(tenantAccounts.tenantId, ctx.tenantId)),
    ]);
    // This is required. If the owner is not found, we gracefully continue.
    if (rows.status === "rejected") throw rows.reason;

    return rows.value.map((row) => ({
      ...row,
      isOwner:
        ownerId.status === "fulfilled" ? row.id === ownerId.value : false,
      id: encodeId("account", row.id),
    }));
  }),
  sendInvite: tenantProcedure
    .input(z.object({ email: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tenant = await db.query.tenants.findFirst({
        columns: {
          name: true,
        },
        where: eq(tenants.id, ctx.tenantId),
      });

      if (!tenant)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "tenant",
        });

      const code = crypto.randomUUID();

      await db.insert(tenantAccountInvites).values({
        tenantId: ctx.tenantId,
        email: input.email,
        code,
      });

      await sendEmail({
        to: input.email,
        subject: "Invitation to Mattrax Tenant",
        type: "tenantAdminInvite",
        invitedByEmail: ctx.account.email,
        tenantName: tenant.name,
        inviteLink: `${env.PROD_URL}/invite/tenant/${code}`,
      });
    }),
});
