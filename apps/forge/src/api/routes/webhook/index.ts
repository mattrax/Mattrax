import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { msGraphClient } from "~/api/microsoft";
import {
  mapUser,
  onDuplicateKeyUpdateUser,
} from "~/api/trpc/routers/tenant/identityProvider";
import { db, identityProviders, users } from "~/db";
import { env } from "~/env";

export const webhookRouter = new Hono()
  .post("/ms", async (c) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken) return c.text(validationToken);

    const data = await c.req.json();

    console.log(JSON.stringify(data, null, 2)); // TODO: Remove this

    for (const value of data.value) {
      if (value.clientState !== env.INTERNAL_SECRET) {
        console.error("Client state mismatch. Not processing!");
        continue;
      }

      // {                                                                                                                              22:07:03
      //   changeType: 'updated',
      //   clientState: 'areallylongsecretthatyoushouldreplace',
      //   resource: 'Users/3e23cadd-f197-47ab-95e1-d929b94ed00a',
      //   resourceData: {
      //     '@odata.type': '#Microsoft.Graph.User',
      //     '@odata.id': 'Users/3e23cadd-f197-47ab-95e1-d929b94ed00a',
      //     id: '3e23cadd-f197-47ab-95e1-d929b94ed00a',
      //     organizationId: '3509b545-2799-4c5c-a0d2-f822ddbd416c'
      //   },
      //   subscriptionExpirationDateTime: '2024-03-24T06:47:55.003-07:00',
      //   subscriptionId: '9a15c438-7c11-461c-9283-49f800142ca5',
      //   tenantId: '3509b545-2799-4c5c-a0d2-f822ddbd416c'
      // }
      console.log(value);

      const entraTenantId = value.tenantId;

      if (value.resourceData["@odata.type"] === "#Microsoft.Graph.User") {
        const userId = value.resourceData.id;

        // TODO: Handle `value.changeType` -> `updated` to `created` and `deleted`

        const user = await msGraphClient(entraTenantId)
          .api(`/users/${userId}`)
          .get();

        const [provider] = await db
          .select()
          .from(identityProviders)
          .where(eq(identityProviders.remoteId, entraTenantId));
        if (!provider) {
          console.error(
            `No identity provider found for tenantId ${entraTenantId}`
          );
          continue;
        }

        await db
          .insert(users)
          .values(mapUser(user, provider.tenantPk, provider.pk))
          .onDuplicateKeyUpdate(onDuplicateKeyUpdateUser());
      } else {
        console.error(
          `Unhandled resource type '${value.resourceData["@odata.type"]}'`
        );
      }
    }

    return c.text("");
  })
  .post("/ms/lifecycle", async (c) => {
    console.log("ms lifecycle webhook");
    console.log(await c.req.json());
    return c.text("");
  });

// TODO: Listen to Stripe webhooks - https://stripe.com/docs/customer-management/integrate-customer-portal#webhooks
