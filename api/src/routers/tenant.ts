import { z } from "zod";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../trpc";
import { encodeId } from "../utils";
import { db, devices, policies, tenantAccounts, tenants, users } from "../db";
import { eq } from "drizzle-orm";

export const tenantRouter = createTRPCRouter({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const lastInsertId = await db.transaction(async (tx) => {
        const result = await db.insert(tenants).values({
          name: input.name,
          owner_id: ctx.session.data.id,
        });
        const lastInsertId = parseInt(result.insertId);

        await db.insert(tenantAccounts).values({
          tenantId: lastInsertId,
          accountId: ctx.session.data.id,
        });

        return lastInsertId;
      });

      // TODO: Invalidate `tenants`

      return {
        id: encodeId("tenant", lastInsertId),
      };
    }),

  delete: tenantProcedure.mutation(async ({ ctx }) => {
    // TODO: Ensure no outstanding bills

    await db.transaction(async (tx) => {
      await db.delete(tenants).where(eq(tenants.id, ctx.tenantId));
      await db
        .delete(tenantAccounts)
        .where(eq(tenantAccounts.tenantId, ctx.tenantId));
      await db.delete(users).where(eq(users.tenantId, ctx.tenantId));
      await db.delete(policies).where(eq(policies.tenantId, ctx.tenantId));
      await db.delete(devices).where(eq(devices.tenantId, ctx.tenantId)); // TODO: Don't do this
    });

    // TODO: Schedule all devices for unenrolment
  }),
});
