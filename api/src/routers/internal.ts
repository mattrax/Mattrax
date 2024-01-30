import { z } from "zod";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import { db, kvStore, users } from "../db";
import { eq } from "drizzle-orm";
import { decodeId } from "../utils";
import { getSubscription, subscribe } from "../microsoft/graph";
import { env } from "../env";
import { FetchError } from "../microsoft";

export const franksScopes =
  "offline_access DeviceManagementServiceConfig.Read.All DeviceManagementServiceConfig.ReadWrite.All DeviceManagementConfiguration.Read.All DeviceManagementConfiguration.ReadWrite.All";

export const internalRouter = createTRPCRouter({
  stats: superAdminProcedure.query(async ({ ctx }) => {
    return {
      tenants: 0,
      devices: 0,
      users: 0,
      policies: 0,
      applications: 0,
    };
  }),

  setup: superAdminProcedure.mutation(async ({ ctx }) => {
    const subscriptionId = (
      await db
        .select()
        .from(kvStore)
        .where(eq(kvStore.key, "devices_subscription_id"))
    )?.[0];

    if (subscriptionId) {
      try {
        await getSubscription(subscriptionId.value);
        return {};
      } catch (err) {
        // If the subscription has expired we wanna recreate it, regardless of if it's in the DB.
        if (!(err instanceof FetchError && err.status === 404)) {
          throw err;
        }
      }
    }

    const result = await subscribe(
      "/devices",
      ["created", "updated", "deleted"],
      env.INTERNAL_SECRET
    );

    await db
      .insert(kvStore)
      .values({
        key: "devices_subscription_id",
        value: result!.id,
      })
      .onDuplicateKeyUpdate({
        set: {
          value: result!.id,
        },
      });

    return {};
  }),

  // TODO: Remove this in the future once user sync is setup.
  seed_tenant: superAdminProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      const id = decodeId("tenant", input.tenantId);

      await db.insert(users).values(
        (
          await import("./users.json")
        ).map(
          (user) =>
            ({
              name: user.name,
              email: user.email,
              tenantId: id,
              provider: "mock",
              providerId: user.id.toString(),
            } as const)
        )
      );

      return "ok";
    }),
});
