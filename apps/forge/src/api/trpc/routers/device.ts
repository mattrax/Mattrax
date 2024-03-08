import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import { db, devices, users } from "~/db";
import { omit } from "~/api/utils";

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

	get: authedProcedure
		.input(z.object({ deviceId: z.string() }))
		.query(async ({ ctx, input }) => {
			const [device] = await db
				.select({
					id: devices.id,
					name: devices.name,
					description: devices.description,
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
					tenantPk: devices.tenantPk,
					ownerId: users.id,
					ownerName: users.name,
				})
				.from(devices)
				.leftJoin(users, eq(users.pk, devices.owner))
				.where(eq(devices.id, input.deviceId));
			if (!device) return null;

			await ctx.ensureTenantAccount(device.tenantPk);

			return omit(device, ["tenantPk"]);
		}),

	sync: authedProcedure
		.input(z.object({ deviceId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const device = await db.query.devices.findFirst({
				where: eq(devices.id, input.deviceId),
			});
			if (!device) return null;

			await ctx.ensureTenantAccount(device.tenantPk);

			// TODO
			console.log("TODO: Trigger device checking using WNS", device.id);

			return {};
		}),
});
