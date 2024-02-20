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
import { createTRPCRouter, publicProcedure, tenantProcedure } from "../../trpc";
import { encodeId } from "../../utils";
import { sendEmail } from "../../emails";
import { env } from "../../env";
import { lucia } from "../../auth";
import { generateId } from "lucia";
import { appendResponseHeader } from "h3";

export const adminsRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    const [ownerId, rows] = await Promise.allSettled([
      db
        .select({
          ownerId: tenants.ownerPk,
        })
        .from(tenants)
        .where(eq(tenants.pk, ctx.tenantId))
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
    }));
  }),
  sendInvite: tenantProcedure
    .input(z.object({ email: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tenant = await db.query.tenants.findFirst({
        columns: {
          name: true,
        },
        where: eq(tenants.pk, ctx.tenantId),
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
  acceptInvite: publicProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await db.query.tenantAccountInvites.findFirst({
        where: eq(tenantAccountInvites.code, input.code),
      });
      if (!invite)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Invalid invite code",
        });

      const name = invite.email.split("@")[0] ?? "";
      const id = generateId(16);
      const result = await db
        .insert(accounts)
        .values({ name, email: invite.email, id })
        .onDuplicateKeyUpdate({
          set: { email: invite.email },
        });

      let accountPk = parseInt(result.insertId);
      let accountId = id;

      if (accountPk === 0) {
        const account = await db.query.accounts.findFirst({
          where: eq(accounts.email, invite.email),
        });
        if (!account)
          throw new Error("Error getting account we just inserted!");
        accountPk = account.pk;
        accountId = account.id;
      }

      await db.transaction(async (db) => {
        await db.insert(tenantAccounts).values({
          tenantId: invite.tenantId,
          accountPk: accountPk,
        });

        await db
          .delete(tenantAccountInvites)
          .where(eq(tenantAccountInvites.code, input.code));
      });

      const session = await lucia.createSession(accountId, {});
      appendResponseHeader(
        ctx.event,
        "Set-Cookie",
        lucia.createSessionCookie(session.id).serialize()
      );

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.pk, invite.tenantId),
      });
      if (!tenant)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "tenant",
        });

      return { id: tenant.id, name: tenant.name };
    }),
});
