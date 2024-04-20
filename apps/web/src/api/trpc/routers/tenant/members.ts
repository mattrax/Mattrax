import { createTRPCRouter, tenantProcedure } from "../../helpers";
import { applications, devices, groups, policies, users } from "~/db";
import { eq } from "drizzle-orm";

export const variantTableRouter = createTRPCRouter({
  users: tenantProcedure
    // TODO: Pagination
    .query(async ({ ctx }) => {
      return await ctx.db
        .select({
          name: users.name,
          id: users.id,
          pk: users.pk,
        })
        .from(users)
        .where(eq(users.tenantPk, ctx.tenant.pk));
    }),

  devices: tenantProcedure
    // TODO: Pagination
    .query(async ({ ctx }) => {
      return await ctx.db
        .select({
          name: devices.name,
          id: devices.id,
          pk: devices.pk,
        })
        .from(devices)
        .where(eq(devices.tenantPk, ctx.tenant.pk));
    }),

  groups: tenantProcedure
    // TODO: Pagination
    .query(async ({ ctx }) => {
      return await ctx.db
        .select({
          name: groups.name,
          id: groups.id,
          pk: groups.pk,
        })
        .from(groups)
        .where(eq(groups.tenantPk, ctx.tenant.pk));
    }),
  policies: tenantProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select({
        name: policies.name,
        id: policies.id,
        pk: policies.pk,
      })
      .from(policies)
      .where(eq(policies.tenantPk, ctx.tenant.pk));
  }),
  apps: tenantProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select({
        name: applications.name,
        id: applications.id,
        pk: applications.pk,
      })
      .from(applications)
      .where(eq(applications.tenantPk, ctx.tenant.pk));
  }),
});
