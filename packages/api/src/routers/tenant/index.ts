import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

import { authedProcedure, createTRPCRouter, tenantProcedure } from "../../trpc";
import { promiseObjectAll } from "../../utils";
import {
  applications,
  db,
  devices,
  groups,
  policies,
  tenantAccounts,
  tenants,
  users,
} from "../../db";
import { billingRouter } from "./billing";
import { tenantAuthRouter } from "./auth";
import { domainsRouter } from "./domains";
import { adminsRouter } from "./admins";

export const tenantRouter = createTRPCRouter({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await db.transaction(async (db) => {
        const id = createId();
        const result = await db.insert(tenants).values({
          id,
          name: input.name,
          ownerPk: ctx.account.pk,
        });
        const tenantPk = parseInt(result.insertId);

        await db.insert(tenantAccounts).values({
          tenantPk,
          accountPk: ctx.account.pk,
        });

        return id;
      });

      // TODO: Invalidate `tenants`

      return tenantId;
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
        .where(eq(tenants.pk, ctx.tenantPk));
    }),

  enrollmentInfo: tenantProcedure.query(async ({ ctx }) =>
    db
      .select({
        enrollmentEnabled: tenants.enrollmentEnabled,
      })
      .from(tenants)
      .where(eq(tenants.pk, ctx.tenantPk))
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
        .where(eq(tenants.pk, ctx.tenantPk))
    ),

  stats: tenantProcedure.query(({ ctx }) =>
    promiseObjectAll({
      devices: db
        .select({ count: count() })
        .from(devices)
        .where(eq(devices.tenantPk, ctx.tenantPk))
        .then((rows) => rows[0]!.count),
      users: db
        .select({ count: count() })
        .from(users)
        .where(eq(users.tenantPk, ctx.tenantPk))
        .then((rows) => rows[0]!.count),
      policies: db
        .select({ count: count() })
        .from(policies)
        .where(eq(policies.tenantPk, ctx.tenantPk))
        .then((rows) => rows[0]!.count),
      applications: db
        .select({ count: count() })
        .from(applications)
        .where(eq(applications.tenantPk, ctx.tenantPk))
        .then((rows) => rows[0]!.count),
      groups: db
        .select({ count: count() })
        .from(groups)
        .where(eq(groups.tenantPk, ctx.tenantPk))
        .then((rows) => rows[0]!.count),
    })
  ),

  delete: tenantProcedure.mutation(async ({ ctx }) => {
    // TODO: Ensure no outstanding bills

    await db.transaction(async (db) => {
      await db.delete(tenants).where(eq(tenants.pk, ctx.tenantPk));
      await db
        .delete(tenantAccounts)
        .where(eq(tenantAccounts.tenantPk, ctx.tenantPk));
      await db.delete(users).where(eq(users.tenantPk, ctx.tenantPk));
      await db.delete(policies).where(eq(policies.tenantPk, ctx.tenantPk));
      await db.delete(devices).where(eq(devices.tenantPk, ctx.tenantPk)); // TODO: Don't do this
    });

    // TODO: Schedule all devices for unenrolment
  }),

  administrators: adminsRouter,
  billing: billingRouter,
  auth: tenantAuthRouter,
  domains: domainsRouter,
});
