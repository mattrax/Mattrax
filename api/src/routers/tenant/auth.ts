import { and, eq } from "drizzle-orm";
import { db, tenantUserProvider, users } from "../../db";
import { createTRPCRouter, tenantProcedure } from "../../trpc";
import { z } from "zod";
import { encodeId, decodeId } from "../../utils";
import { createId } from "@paralleldrive/cuid2";
import { env } from "../..";
import { msGraphClient } from "../../microsoft";

export const tenantAuthRouter = createTRPCRouter({
  query: tenantProcedure.query(async ({ ctx }) => {
    return (
      await db
        .select({
          id: tenantUserProvider.id,
          resourceId: tenantUserProvider.resourceId,
          name: tenantUserProvider.name,
          lastSynced: tenantUserProvider.lastSynced,
        })
        .from(tenantUserProvider)
        .where(eq(tenantUserProvider.tenantId, ctx.tenantId))
    ).map((r) => ({
      ...r,
      id: encodeId("userProvider", r.id),
    }));
  }),

  linkEntra: tenantProcedure.mutation(async ({ ctx }) => {
    // This will cause all in-progress linking to hit the CSRF error.
    // Due to this being an infrequent operation, I think this is fine.
    const state = createId();
    await ctx.session.update({
      ...ctx.session.data,
      oauthData: {
        tenant: ctx.tenantId,
        state,
      },
    });

    const params = new URLSearchParams();
    params.set("client_id", env.ENTRA_CLIENT_ID);
    params.set("scope", "https://graph.microsoft.com/.default");
    params.set("redirect_uri", `${env.PROD_URL}/api/ms/link`);
    params.set("response_type", "code");
    params.set("response_mode", "query");
    params.set("state", state);
    return `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`;
  }),

  unlink: tenantProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = decodeId("userProvider", input.id);

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
              eq(tenantUserProvider.tenantId, ctx.tenantId),
              eq(tenantUserProvider.id, id)
            )
          );

        await db.delete(users).where(eq(users.provider, id));
      });

      // TODO: Revoke admin consent with Microsoft as an extra precaution
    }),

  sync: tenantProcedure.mutation(async ({ ctx }) => {
    console.log(`Syncing tenant '${ctx.tenantId}'`);

    // TODO: Check user has permission to the tenant

    const tenantProvider = (
      await db
        .select()
        .from(tenantUserProvider)
        .where(eq(tenantUserProvider.tenantId, ctx.tenantId))
    )?.[0]; // TODO: Run a sync for each provider cause we can have more than one.
    if (!tenantProvider)
      throw new Error(`Tenant '${ctx.tenantId}' not found or has no providers`); // TODO: make an error the frontend can handle

    const client = msGraphClient(tenantProvider.resourceId);

    // TODO: Typescript with the client????
    // TODO: Pagination

    const result = await client.api("/users").get();

    // TODO: This will cause users to build up. Really we want to upsert on `resourceId` but idk how to do that with a bulk-insert using Drizzle ORM.
    // TODO: Ensure `values` contains more than one value or skip the insert so it doesn't error out.
    await db.insert(users).values(
      result.value
        // TODO: Support null emails
        .filter((u: any) => u.mail !== null)
        .map((u: any) => ({
          name: u.displayName,
          email: u.mail,
          tenantId: ctx.tenantId,
          provider: tenantProvider.id,
          // resourceId: u.id, // TODO: Add this column
        }))
    );
  }),
});
