import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, devices, users } from "~/db";
import { createTRPCRouter, tenantProcedure } from "../helpers";

export const deviceRouter = createTRPCRouter({
	list: tenantProcedure.query(async ({ ctx }) => {
		return await db
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
			.where(and(eq(devices.tenantPk, ctx.tenant.pk)));
	}),

	get: tenantProcedure
		.input(z.object({ deviceId: z.string() }))
		.query(async ({ ctx, input }) => {
			const [device] = await db
				.select({
					id: devices.pk,
					name: devices.name,
					operatingSystem: devices.operatingSystem,
					serialNumber: devices.serialNumber,
					manufacturer: devices.manufacturer,
					azureADDeviceId: devices.azureADDeviceId,
					freeStorageSpaceInBytes: devices.freeStorageSpaceInBytes,
					totalStorageSpaceInBytes: devices.totalStorageSpaceInBytes,
					imei: devices.imei,
					model: devices.model,
					lastSynced: devices.lastSynced,
					enrolledAt: devices.enrolledAt,
					ownerId: users.id,
					ownerName: users.name,
				})
				.from(devices)
				.leftJoin(users, eq(users.pk, devices.owner))
				.where(
					and(
						eq(devices.id, input.deviceId),
						eq(devices.tenantPk, ctx.tenant.pk),
					),
				);

			return device ?? null;
		}),

	sync: tenantProcedure
		.input(z.object({ deviceId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			// TODO

			//   // TODO: Check user is authorised to access tenant which owns the device

			//   // TODO: Filter to only devices in current tenant
			//   // TODO: .where(eq(devices.tenantId, todo))
			//   const [device] = (
			//     await db
			//       .select({
			//         intuneId: devices.intuneId,
			//       })
			//       .from(devices)
			//   );
			//   if (!device) throw new Error("Device not found"); // TODO: Properly handle this error on frontend

			//   await syncDevice(device.intuneId);

			return {};
		}),
});
