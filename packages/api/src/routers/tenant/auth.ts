import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";

import { db, tenantUserProvider, users } from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";
import { env } from "../..";
import { msGraphClient } from "../../microsoft";

export const tenantAuthRouter = createTRPCRouter({
  query: tenantProcedure.query(async ({ ctx }) => {
    return await db
      .select({
        id: tenantUserProvider.pk,
        remoteId: tenantUserProvider.remoteId,
        variant: tenantUserProvider.variant,
        lastSynced: tenantUserProvider.lastSynced,
      })
      .from(tenantUserProvider)
      .where(eq(tenantUserProvider.tenantPk, ctx.tenantPk));
  }),

  linkEntra: tenantProcedure.mutation(async ({ ctx }) => {
    // This will cause all in-progress linking to hit the CSRF error.
    // Due to this being an infrequent operation, I think this is fine.
    const state = createId();
    await ctx.env.session.update({
      ...ctx.env.session.data,
      oauthData: {
        tenant: ctx.tenantPk,
        state,
      },
    });

    const params = new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      scope: "https://graph.microsoft.com/.default",
      redirect_uri: `${env.PROD_URL}/api/ms/link`,
      response_type: "code",
      response_mode: "query",
      state: state,
    });

    return `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`;
  }),

  unlink: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Ensure no devices are owned by a user coming from this provider
      // await db
      //   .select()
      //   .from(users)
      //   .leftJoin(devices)
      //   .where(eq(devices.owner, users.id));

      // TODO: Ensure all other resources targeting this user remove their relations with this user
      // TODO: Return to the frontend a list of what needs removing

      await db.transaction(async (db) => {
        await db
          .delete(tenantUserProvider)
          .where(
            and(
              eq(tenantUserProvider.tenantPk, ctx.tenantPk),
              eq(tenantUserProvider.pk, input.id)
            )
          );

        await db.delete(users).where(eq(users.providerPk, input.id));
      });

      // TODO: Revoke admin consent with Microsoft as an extra precaution
    }),

  sync: tenantProcedure.mutation(async ({ ctx }) => {
    // TODO: Check user has permission to the tenant

    const tenantProvider = (
      await db
        .select()
        .from(tenantUserProvider)
        .where(eq(tenantUserProvider.tenantPk, ctx.tenantPk))
    )?.[0]; // TODO: Run a sync for each provider cause we can have more than one.
    if (!tenantProvider)
      throw new Error(`Tenant '${ctx.tenantPk}' not found or has no providers`); // TODO: make an error the frontend can handle

    const client = msGraphClient(tenantProvider.remoteId);

    // TODO: Typescript with the client????
    // TODO: Pagination

    const result = await client.api("/users").get();
    console.log(result);

    // TODO: This will cause users to build up. Really we want to upsert on `resourceId` but idk how to do that with a bulk-insert using Drizzle ORM.
    // TODO: Ensure `values` contains more than one value or skip the insert so it doesn't error out.
    await db.insert(users).values(
      result.value
        // TODO: Support null emails
        .filter((u: any) => u.mail !== null)
        .map((u: any) => ({
          name: u.displayName,
          email: u.mail,
          tenantPk: ctx.tenantPk,
          providerPk: tenantProvider.pk,
          providerResourceId: u.id, // TODO: Add this column
        }))
    );
  }),
});
