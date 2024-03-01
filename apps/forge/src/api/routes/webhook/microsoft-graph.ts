import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as MSGraph from "@microsoft/microsoft-graph-types";
import { zValidator } from "@hono/zod-validator";

import { msGraphClient } from "~/api/microsoft";
import {
  mapUser,
  onDuplicateKeyUpdateUser,
} from "~/api/trpc/routers/tenant/identityProvider";
import { db, identityProviders, users } from "~/db";
import { env } from "~/env";

const CHANGE_TYPE = z.enum(["created", "updated", "deleted"]);

// https://learn.microsoft.com/en-us/graph/api/resources/resourcedata?view=graph-rest-1.0
const RESOURCE_DATA = z.object({
  "@odata.type": z.string(),
  "@odata.id": z.string(),
  "@odata.etag": z.string(),
  id: z.string(),
});

const BASE_NOTIFICATION = z.object({
  subscriptionId: z.string(),
  subscriptionExpriationDateTime: z.coerce.date(),
  tenantId: z.string(),
  clientState: z.string(),
});

// https://learn.microsoft.com/en-us/graph/api/resources/changenotification?view=graph-rest-1.0
const CHANGE_NOTIFICATION = BASE_NOTIFICATION.and(
  z.object({
    changeType: CHANGE_TYPE,
    id: z.string(),
    resource: z.string(),
    resourceData: RESOURCE_DATA,
  })
);

// https://learn.microsoft.com/en-us/graph/api/resources/changenotificationcollection?view=graph-rest-1.0
const CHANGE_NOTIFICATION_COLLECTION = z.object({
  value: z.array(CHANGE_NOTIFICATION),
  validationTokens: z.array(z.string()).optional(),
});

// https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events?tabs=http#structure-of-a-lifecycle-notification
const LIFECYCLE_EVENT = z.enum([
  "subscriptionRemoved",
  "missed",
  "reauthorizationRequired",
]);

// https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events?tabs=http#structure-of-a-lifecycle-notification
const LIFECYCLE_NOTIFICATION = BASE_NOTIFICATION.and(
  z.object({ lifecycleEvent: LIFECYCLE_EVENT })
);

const LIFECYCLE_NOTIFICATION_COLLECTION = z.object({
  value: z.array(LIFECYCLE_NOTIFICATION),
});

export const microsoftGraphRouter = new Hono()
  .use(async (c, next) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken) return c.text(validationToken);

    console.log(c.req.json());

    return await next();
  })
  .post("/", zValidator("json", CHANGE_NOTIFICATION_COLLECTION), async (c) => {
    const { value } = c.req.valid("json");
    console.log(value);

    await Promise.all(value.map(handleChangeNotification));

    return c.text("");
  })
  .post(
    "/lifecycle",
    zValidator("json", LIFECYCLE_NOTIFICATION_COLLECTION),
    async (c) => {
      const { value } = c.req.valid("json");

      await Promise.all(value.map(handleLifecycleNotification));

      return c.text("");
    }
  );

async function handleChangeNotification(
  notification: z.infer<typeof CHANGE_NOTIFICATION>
) {
  if (notification.clientState !== env.INTERNAL_SECRET) {
    console.error("Client state mismatch. Not processing!");
    return;
  }

  const entraTenantId = notification.tenantId;

  const [identityProvider] = await db
    .select()
    .from(identityProviders)
    .where(eq(identityProviders.remoteId, entraTenantId));
  if (!identityProvider) {
    console.error(`No identity provider found for tenantId ${entraTenantId}`);
    return;
  }

  switch (notification.resourceData["@odata.type"]) {
    case "#Microsoft.Graph.User":
      await handleUserChangeNotification(notification, identityProvider);
      break;
    default:
      console.error(
        `Unhandled resource type '${notification.resourceData["@odata.type"]}'`
      );
  }
}

async function handleUserChangeNotification(
  notification: z.infer<typeof CHANGE_NOTIFICATION>,
  identityProvider: typeof identityProviders.$inferSelect
) {
  const userId = notification.resourceData.id;

  switch (notification.changeType) {
    case "created":
    case "updated":
      const user: Pick<
        MSGraph.User,
        "id" | "displayName" | "userPrincipalName"
      > = await msGraphClient(notification.tenantId)
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

async function handleLifecycleNotification(
  notification: z.infer<typeof LIFECYCLE_NOTIFICATION>
) {
  switch (notification.lifecycleEvent) {
    case "reauthorizationRequired": {
      await msGraphClient(notification.tenantId)
        .api(`/subscriptions/${notification.subscriptionId}/reauthorize`)
        .patch({
          expirationDateTime: new Date(
            new Date().getTime() + 60 * 60 * 24 * 25 // 25 days
          ),
        });

      break;
    }
    // subscriptionRemoved and missed don't get emitted for the events we care about
    // https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events?tabs=http#supported-resources
    default:
      break;
  }
}
