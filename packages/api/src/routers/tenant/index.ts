import { z } from "zod";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../../trpc";
import { encodeId, promiseObjectAll } from "../../utils";
import {
  accounts,
  applications,
  db,
  devices,
  groups,
  policies,
  tenantAccounts,
  tenants,
  users,
} from "../../db";
import { count, eq } from "drizzle-orm";
import { billingRouter } from "./billing";
import { tenantAuthRouter } from "./auth";
import { domainsRouter } from "./domains";
import { adminsRouter } from "./admins";

export const tenantRouter = createTRPCRouter({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const lastInsertId = await db.transaction(async (db) => {
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

  edit: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.name === undefined) return;

      await db
        .update(tenants)
        .set({
          ...(input.name !== undefined && {
            name: input.name,
          }),
        })
        .where(eq(tenants.id, ctx.tenantId));
    }),

  enrollmentInfo: tenantProcedure.query(async ({ ctx }) =>
    db
      .select({
        enrollmentEnabled: tenants.enrollmentEnabled,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .then((rows) => rows[0])
  ),

  setEnrollmentInfo: tenantProcedure
    .input(z.object({ enrollmentEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      db
        .update(tenants)
        .set({
          enrollmentEnabled: input.enrollmentEnabled,
        })
        .where(eq(tenants.id, ctx.tenantId))
    ),

  stats: tenantProcedure.query(({ ctx }) =>
    promiseObjectAll({
      devices: db
        .select({ count: count() })
        .from(devices)
        .where(eq(devices.tenantId, ctx.tenantId))
        .then((rows) => rows[0]!.count),
      users: db
        .select({ count: count() })
        .from(users)
        .where(eq(users.tenantId, ctx.tenantId))
        .then((rows) => rows[0]!.count),
      policies: db
        .select({ count: count() })
        .from(policies)
        .where(eq(policies.tenantId, ctx.tenantId))
        .then((rows) => rows[0]!.count),
      applications: db
        .select({ count: count() })
        .from(applications)
        .where(eq(applications.tenantId, ctx.tenantId))
        .then((rows) => rows[0]!.count),
      groups: db
        .select({ count: count() })
        .from(groups)
        .where(eq(groups.tenantId, ctx.tenantId))
        .then((rows) => rows[0]!.count),
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

  administrators: adminsRouter,
  billing: billingRouter,
  auth: tenantAuthRouter,
  domains: domainsRouter,
});
