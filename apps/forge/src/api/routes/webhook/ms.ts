import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as MSGraph from "@microsoft/microsoft-graph-types";

import { msGraphClient } from "~/api/microsoft";
import {
  mapUser,
  onDuplicateKeyUpdateUser,
} from "~/api/trpc/routers/tenant/identityProvider";
import { db, identityProviders, users } from "~/db";
import { env } from "~/env";

export const msRouter = new Hono()
  .post("/", async (c) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken) return c.text(validationToken);

    const data = CHANGE_NOTIFICATION_COLLECTION.parse(await c.req.json());

    for (const changeNotification of data.value) {
      await handleChangeNotification(changeNotification);
    }

    return c.text("");
  })
  .post("/lifecycle", async (c) => {
    console.log("ms lifecycle webhook");
    console.log(await c.req.json());
    return c.text("");
  });

async function handleChangeNotification(
  changeNotification: z.infer<typeof CHANGE_NOTIFICATION>
) {
  if (changeNotification.clientState !== env.INTERNAL_SECRET) {
    console.error("Client state mismatch. Not processing!");
    return;
  }

  const entraTenantId = changeNotification.tenantId;

  const [identityProvider] = await db
    .select()
    .from(identityProviders)
    .where(eq(identityProviders.remoteId, entraTenantId));
  if (!identityProvider) {
    console.error(`No identity provider found for tenantId ${entraTenantId}`);
    return;
  }

  switch (changeNotification.resourceData["@odata.type"]) {
    case "#Microsoft.Graph.User":
      await handleUserChangeNotification(changeNotification, identityProvider);
      break;
    default:
      console.error(
        `Unhandled resource type '${changeNotification.resourceData["@odata.type"]}'`
      );
  }
}

async function handleUserChangeNotification(
  changeNotification: z.infer<typeof CHANGE_NOTIFICATION>,
  identityProvider: typeof identityProviders.$inferSelect
) {
  const userId = changeNotification.resourceData.id;

  switch (changeNotification.changeType) {
    case "created":
    case "updated":
      const user: Pick<
        MSGraph.User,
        "id" | "displayName" | "userPrincipalName"
      > = await msGraphClient(changeNotification.tenantId)
        .api(`/users/${userId}`)
        .select("id")
        .select("displayName")
        .select("userPrincipalName")
        .get();

      await db
        .insert(users)
        .values(mapUser(user, identityProvider.tenantPk, identityProvider.pk))
        .onDuplicateKeyUpdate(onDuplicateKeyUpdateUser());

      break;

    case "deleted":
      await db
        .update(users)
        .set({ providerResourceId: null })
        .where(
          and(
            eq(users.providerResourceId, userId),
            eq(users.providerPk, identityProvider.pk)
          )
        );

      break;
  }
}

const CHANGE_TYPE = z.enum(["created", "updated", "deleted"]);

// https://learn.microsoft.com/en-us/graph/api/resources/resourcedata?view=graph-rest-1.0
const RESOURCE_DATA = z.object({
  "@odata.type": z.string(),
  "@odata.id": z.string(),
  "@odata.etag": z.string(),
  id: z.string(),
});

// https://learn.microsoft.com/en-us/graph/api/resources/changenotification?view=graph-rest-1.0
const CHANGE_NOTIFICATION = z.object({
  changeType: CHANGE_TYPE,
  clientState: z.string(),
  id: z.string().optional(),
  resource: z.string(),
  resourceData: RESOURCE_DATA,
  subscriptionId: z.string(),
  tenantId: z.string(),
});

// https://learn.microsoft.com/en-us/graph/api/resources/changenotificationcollection?view=graph-rest-1.0
const CHANGE_NOTIFICATION_COLLECTION = z.object({
  value: z.array(CHANGE_NOTIFICATION),
  validationTokens: z.array(z.string()).optional(),
});
