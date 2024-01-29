import { env } from "../env";
import { newUnauthenticatedApp } from "../utils";
import { db, devices, kvStore } from "../db";
import { eq } from "drizzle-orm";
import { getEntraIDDevice, subscriptionRenew } from "../microsoft/graph";

export const app = newUnauthenticatedApp()
  .post("/ms", async (c) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken) {
      return c.text(validationToken);
    }

    const data = await c.req.json();

    for (const value of data.value) {
      if (value.clientState !== env.INTERNAL_SECRET) {
        console.error("Client state mismatch. Not processing!");
        continue;
      }

      if (!value.resource.startsWith("Devices/")) {
        console.error(
          `Found resource '${value.resource}' which is not a device. Not processing!`
        );
        continue;
      }

      if (value.changeType === "deleted") {
        // TODO: Handle this properly! We should unlink and notify the administrator instead of just deleting the data.
        await db
          .delete(devices)
          .where(eq(devices.intuneId, value.resourceData.id));
      } else {
        const device = await getEntraIDDevice(value.resourceData.id);

        // TODO: device.enrollmentProfileName

        await db.insert(devices).values({
          name: device!.displayName as string,
          intuneId: device!.deviceId,
        });
      }
    }

    return c.json({});
  })
  .post("/msLifecycle", async (c) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken) {
      return c.text(validationToken);
    }

    const data = await c.req.json();
    for (const value of data.value) {
      if (value.lifecycleEvent === "reauthorizationRequired") {
        const activeSubscription = (
          await db
            .select()
            .from(kvStore)
            .where(eq(kvStore.key, "devices_subscription_id"))
        )?.[0];

        if (value.subscriptionId !== activeSubscription?.value) {
          console.error("Subscription ID mismatch. Not renewing!");
          continue;
        }

        if (value.clientState !== env.INTERNAL_SECRET) {
          console.error("Client state mismatch. Not renewing!");
          continue;
        }

        await subscriptionRenew(value.subscriptionId);
      }
    }

    c.status(202);
    return c.text("");
  });
