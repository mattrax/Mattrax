import { createTRPCRouter, tenantProcedure } from "../trpc";
import { db, tenantUserProvider, users } from "../db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sendEmail } from "../emails";

export const userRouter = createTRPCRouter({
  // TODO: Copy after `devicesRouter`.

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
      // TODO: Pagination abstraction
      // TODO: Can a cursor make this more efficent???
      // TODO: Switch to DB

      return await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          provider: {
            variant: tenantUserProvider.variant,
            remoteId: tenantUserProvider.remoteId,
          },
        })
        .from(users)
        .where(eq(users.tenantPk, ctx.tenant.pk))
        .innerJoin(
          tenantUserProvider,
          eq(users.providerPk, tenantUserProvider.pk)
        );
    }),
  get: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return (
        (
          await db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              providerResourceId: users.providerResourceId,
              provider: {
                variant: tenantUserProvider.variant,
                remoteId: tenantUserProvider.remoteId,
              },
            })
            .from(users)
            .where(
              and(eq(users.tenantPk, ctx.tenant.pk), eq(users.id, input.id))
            )
            .innerJoin(
              tenantUserProvider,
              eq(users.providerPk, tenantUserProvider.pk)
            )
        )[0] ?? null
      );
    }),
  invite: tenantProcedure
    .input(z.object({ email: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (
        await db.query.users.findFirst({
          where: and(
            eq(users.tenantPk, ctx.tenant.pk),
            eq(users.email, input.email)
          ),
        })
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "User already exists",
        });

      await sendEmail({
        type: "userEnrollmentInvite",
        to: input.email,
        subject: "Enroll your device to join Mattrax",
        tenantName: ctx.tenant.name,
      });
    }),
});
