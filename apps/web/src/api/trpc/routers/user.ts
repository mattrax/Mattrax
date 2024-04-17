import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "~/api/emails";
import {
  applicationAssignments,
  applications,
  db,
  devices,
  identityProviders,
  policies,
  policyAssignableVariants,
  policyAssignments,
  users,
} from "~/db";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { omit } from "~/api/utils";

const userProcedure = authedProcedure
  .input(z.object({ id: z.string() }))
  .use(async ({ next, input, ctx }) => {
    const user = await db.query.users.findFirst({
      where: eq(users.id, input.id),
    });
    if (!user)
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    const tenant = await ctx.ensureTenantMember(user.tenantPk);

    return await next({ ctx: { user, tenant } });
  });

export const userRouter = createTRPCRouter({
  // TODO: Pagination
  list: tenantProcedure
    // .input(
    //   z.object({
    //     // TODO: Constrain offset and limit to specific max/min values
    //     offset: z.number().default(0),
    //     limit: z.number().default(50),
    //     // query: z.string().optional(),
    //   })
    // )
    .query(async ({ ctx, input }) => {
      // TODO: Full-text search???

      return await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          resourceId: users.resourceId,
          provider: {
            variant: identityProviders.provider,
            remoteId: identityProviders.remoteId,
          },
        })
        .from(users)
        .where(eq(users.tenantPk, ctx.tenant.pk))
        .innerJoin(
          identityProviders,
          eq(users.providerPk, identityProviders.pk),
        );
    }),

  get: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          providerResourceId: users.resourceId,
          provider: {
            variant: identityProviders.provider,
            remoteId: identityProviders.remoteId,
          },
          tenantPk: users.tenantPk,
        })
        .from(users)
        .where(eq(users.id, input.id))
        .innerJoin(
          identityProviders,
          eq(users.providerPk, identityProviders.pk),
        );

      if (!user) return null;
      await ctx.ensureTenantMember(user.tenantPk);
      return omit(user, ["tenantPk"]);
    }),

  devices: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await db
        .select({
          pk: users.pk,
          tenantPk: users.tenantPk,
        })
        .from(users)
        .where(eq(users.id, input.id))
        .innerJoin(
          identityProviders,
          eq(users.providerPk, identityProviders.pk),
        );

      if (!user) return null;
      await ctx.ensureTenantMember(user.tenantPk);

      return await db
        .select({
          id: devices.id,
          name: devices.name,
        })
        .from(devices)
        .where(eq(devices.owner, user.pk));
    }),

  invite: userProcedure
    .input(z.object({ message: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { user, tenant } = ctx;

      // TODO: "On behalf of {tenant_name}" in the content + render `input.message` inside the email.
      await sendEmail({
        type: "userEnrollmentInvite",
        to: user.email,
        subject: "Enroll your device to Mattrax",
        tenantName: tenant.name,
      });
    }),

  assignments: userProcedure.query(async ({ ctx }) => {
    const { user } = ctx;

    const [p, a] = await Promise.all([
      db
        .select({ pk: policies.pk, id: policies.id, name: policies.name })
        .from(policyAssignments)
        .where(
          and(
            eq(policyAssignments.variant, "user"),
            eq(policyAssignments.pk, user.pk),
          ),
        )
        .innerJoin(policies, eq(policyAssignments.policyPk, policies.pk)),
      db
        .select({
          pk: applications.pk,
          id: applications.id,
          name: applications.name,
        })
        .from(applicationAssignments)
        .where(
          and(
            eq(applicationAssignments.variant, "user"),
            eq(applicationAssignments.pk, user.pk),
          ),
        )
        .innerJoin(
          applications,
          eq(applicationAssignments.applicationPk, applications.pk),
        ),
    ]);

    return { policies: p, apps: a };
  }),

  addAssignments: userProcedure
    .input(
      z.object({
        assignments: z.array(
          z.object({
            pk: z.number(),
            variant: z.enum(["policy", "application"]),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx: { user }, input }) => {
      const pols: Array<number> = [],
        apps: Array<number> = [];

      input.assignments.forEach((a) => {
        if (a.variant === "policy") pols.push(a.pk);
        else apps.push(a.pk);
      });

      await db.transaction((db) =>
        Promise.all([
          db
            .insert(policyAssignments)
            .values(
              pols.map((pk) => ({
                pk: user.pk,
                policyPk: pk,
                variant: sql`"user"`,
              })),
            )
            .onDuplicateKeyUpdate({
              set: { policyPk: sql`${policyAssignments.policyPk}` },
            }),
          db
            .insert(applicationAssignments)
            .values(
              apps.map((pk) => ({
                pk: user.pk,
                applicationPk: pk,
                variant: sql`"user"`,
              })),
            )
            .onDuplicateKeyUpdate({
              set: {
                applicationPk: sql`${applicationAssignments.applicationPk}`,
              },
            }),
        ]),
      );
    }),
});
