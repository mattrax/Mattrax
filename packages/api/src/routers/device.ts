import { z } from "zod";
import { createTRPCRouter, tenantProcedure } from "../trpc";
import { db, devices, tenantAccounts } from "../db";
import { and, eq } from "drizzle-orm";
import { encodeId } from "../utils";
// import { graphClient } from "../microsoft";
// import type { ManagedDevice } from "@microsoft/microsoft-graph-types";

export const deviceRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    return (
      await db
        .select({
          id: devices.id,
          name: devices.name,
          operatingSystem: devices.operatingSystem,
          serialNumber: devices.serialNumber,
          lastSynced: devices.lastSynced,
          owner: devices.owner, // TODO: Fetch `owner` name
          enrolledAt: devices.enrolledAt,
        })
        .from(devices)
        .where(and(eq(devices.tenantId, ctx.tenantId)))
    ).map((d) => ({
      ...d,
      id: encodeId("device", d.id),
    }));
  }),

  get: tenantProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      // TODO
      return {
        name: "todo",
      };
    }),

  sync: tenantProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // TODO

      //   // TODO: Check user is authorised to access tenant which owns the device

      //   // TODO: Filter to only devices in current tenant
      //   // TODO: .where(eq(devices.tenantId, todo))
      //   const device = (
      //     await db
      //       .select({
      //         intuneId: devices.intuneId,
      //       })
      //       .from(devices)
      //   )?.[0];
      //   if (!device) throw new Error("Device not found"); // TODO: Properly handle this error on frontend

      //   await syncDevice(device.intuneId);

      return {};
    }),

  // TODO: Remove this once we have the full MDM pairing process in place as this will be automatic, not synced.
  // TODO: This will pull *all* Intune devices into the current tenant. That's obviously not how it should work in prod.
  forcePullFromIntune: tenantProcedure.mutation(async ({ ctx }) => {
    // const resp = await graphClient
    //   .api("/deviceManagement/managedDevices")
    //   .get();

    // for (const d of resp.value as ManagedDevice[]) {
    //   // TODO: Removing all null checks
    //   const upsert = {
    //     manufacturer: d.manufacturer!,
    //     model: d.model!,
    //     operatingSystem: d.operatingSystem!,
    //     osVersion: d.osVersion!,
    //     serialNumber: d.serialNumber!,
    //     imei: d.imei,
    //     freeStorageSpaceInBytes: d.freeStorageSpaceInBytes!,
    //     totalStorageSpaceInBytes: d.totalStorageSpaceInBytes!,

    //     azureADDeviceId: d.azureADDeviceId!,
    //     intuneId: d.id!,

    //     enrolledAt: new Date(d.enrolledDateTime!),
    //     lastSynced: new Date(d.lastSyncDateTime!),
    //   };

    //   await db
    //     .insert(devices)
    //     .values({
    //       name: d.deviceName || d.model ? `${d.model}` : `Device`,
    //       tenantId: ctx.tenantId,
    //       groupableVariant: "device",
    //       ...upsert,
    //     })
    //     .onDuplicateKeyUpdate({
    //       set: {
    //         ...upsert,
    //       },
    //     });
    // }

    throw new Error("todo");

    return {};
  }),
});
