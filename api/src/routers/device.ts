import { z } from "zod";
import { createTRPCRouter, tenantProcedure } from "../trpc";
import { db, devices, tenantAccounts } from "../db";
import { and, eq } from "drizzle-orm";
import { encodeId } from "../utils";

export const deviceRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    return (
      await db
        .select({
          id: devices.id,
          name: devices.name,
        })
        .from(devices)
        .leftJoin(tenantAccounts, eq(devices.tenantId, tenantAccounts.tenantId))
        .where(
          and(
            eq(devices.tenantId, ctx.tenantId),
            eq(tenantAccounts.accountId, ctx.session.data.id)
          )
        )
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
});
