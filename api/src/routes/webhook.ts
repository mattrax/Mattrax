import { env } from "../env";
import { newUnauthenticatedApp } from "../utils";
import { db, devices, kvStore } from "../db";
import { eq } from "drizzle-orm";
import { getEntraIDDevice, subscriptionRenew } from "../microsoft/graph";
import { getEnrollmentProfile } from "../microsoft";
import { EnrollmentProfileDescription } from "./devices";

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
        // TODO: Typescript type
        const device: any = await getEntraIDDevice(value.resourceData.id);

        // TODO: Use this to properly link the `owner`
        // TODO: If the enrollmentProfile is not found, what do we do? Should we just never delete the enrollment profiles???
        // try {
        //   const enrollmentProfile = await getEnrollmentProfile(
        //     device!.enrollmentProfileName
        //   );
        //   console.log(enrollmentProfile);

        //   const data: EnrollmentProfileDescription = JSON.parse(
        //     enrollmentProfile!.description
        //   );

        //   console.log(data);
        // } catch (err) {
        //   // TODO: Handle 404
        //   console.error(err);
        // }

        // TODO: Upsert & relink by serial number
        await db.insert(devices).values({
          name: device!.displayName as string,
          manufacturer: device!.manufacturer as string,
          model: device!.model as string,
          operatingSystem: device!.operatingSystem as string,
          osVersion: device!.osVersion as string,
          serialNumber: device!.serialNumber as string,
          freeStorageSpaceInBytes: device!.freeStorageSpaceInBytes,
          totalStorageSpaceInBytes: device!.totalStorageSpaceInBytes,
          owner: undefined, // TODO: Try and find the owner
          azureADDeviceId: device!.azureADDeviceId,
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
