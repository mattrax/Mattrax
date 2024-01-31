import { z } from "zod";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../trpc";
import { encodeId } from "../utils";
import {
  accounts,
  db,
  devices,
  policies,
  tenantAccounts,
  tenants,
  users,
} from "../db";
import { eq } from "drizzle-orm";
import { stripe } from "../stripe";
import { env } from "../env";

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

  administrators: tenantProcedure.query(async ({ ctx }) => {
    const [ownerId, rows] = await Promise.allSettled([
      db
        .select({
          ownerId: tenants.owner_id,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .then((v) => v?.[0]?.ownerId),
      db
        .select({
          id: accounts.id,
          name: accounts.name,
          email: accounts.email,
        })
        .from(accounts)
        .leftJoin(tenantAccounts, eq(tenantAccounts.accountId, accounts.id))
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

  stripePortalUrl: tenantProcedure.mutation(async ({ ctx }) => {
    const tenant = (
      await db
        .select({
          name: tenants.name,
          billingEmail: tenants.billingEmail,
          stripeCustomerId: tenants.stripeCustomerId,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
    )?.[0];
    if (!tenant) throw new Error("Tenant not found!"); // TODO: Proper error code which the frontend knows how to handle

    let customerId: string;
    if (!tenant.stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: tenant.name,
        email: tenant.billingEmail || undefined,
      });

      await db
        .update(tenants)
        .set({ stripeCustomerId: customer.id })
        .where(eq(tenants.id, ctx.tenantId));

      customerId = customer.id;
    } else {
      customerId = tenant.stripeCustomerId;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.PROD_URL}/${encodeId(
        "tenant",
        ctx.tenantId
      )}/settings`,
    });

    return session.url;
  }),
});
