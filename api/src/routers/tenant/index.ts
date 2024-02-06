import { z } from "zod";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../../trpc";
import { encodeId, promiseObjectAll } from "../../utils";
import {
  accounts,
  db,
  devices,
  policies,
  tenantAccounts,
  tenants,
  users,
} from "../../db";
import { count, eq } from "drizzle-orm";
import { billingRouter } from "./billing";
import { tenantAuthRouter } from "./auth";

export const tenantRouter = createTRPCRouter({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const lastInsertId = await db.transaction(async (tx) => {
        const result = await db.insert(tenants).values({
          name: input.name,
          owner_id: ctx.session.data.id,
        });
        const tenantId = parseInt(result.insertId);

        await db.insert(tenantAccounts).values({
          tenantId,
          accountId: ctx.session.data.id,
        });

        return tenantId;
      });

      // TODO: Invalidate `tenants`

      return {
        id: encodeId("tenant", lastInsertId),
      };
    }),

  stats: tenantProcedure.query(({ ctx }) =>
    promiseObjectAll({
      devices: db
        .select({ count: count() })
        .from(devices)
        .where(eq(devices.tenantId, ctx.session.data.id))
        .then((rows) => rows[0]!.count),
      users: db
        .select({ count: count() })
        .from(users)
        .where(eq(users.tenantId, ctx.session.data.id))
        .then((rows) => rows[0]!.count),
      policies: db
        .select({ count: count() })
        .from(policies)
        .where(eq(policies.tenantId, ctx.session.data.id))
        .then((rows) => rows[0]!.count),
      apps: Promise.resolve(420), // TODO: Enable this query
      groups: Promise.resolve(69), // TODO: Enable this query
      // applications: db
      //   .select({ count: count() })
      //   .from(apps)
      //   .where(eq(tenants.owner_id, ctx.session.data.id))
      //   .then((rows) => rows[0]!.count),
      // groups: db
      //   .select({ count: count() })
      //   .from(groups)
      //   .where(eq(groups.tenantId, ctx.session.data.id))
      //   .then((rows) => rows[0]!.count),
    })
  ),

  delete: tenantProcedure.mutation(async ({ ctx }) => {
    // TODO: Ensure no outstanding bills

    await db.transaction(async (db) => {
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

  billing: billingRouter,
  auth: tenantAuthRouter,
});
