import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import {
	db,
	devices,
	policyAssignableVariants,
	users,
	deviceActions,
	possibleDeviceActions,
} from "~/db";
import { omit } from "~/api/utils";
import { TRPCError } from "@trpc/server";

export const deviceRouter = createTRPCRouter({
	list: tenantProcedure.query(async ({ ctx }) => {
		return await db
			.select({
				id: devices.id,
				name: devices.name,
				enrollmentType: devices.enrollmentType,
				os: devices.os,
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
					enrollmentType: devices.enrollmentType,
					os: devices.os,
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

			await ctx.ensureTenantMember(device.tenantPk);

			return omit(device, ["tenantPk"]);
		}),

	action: authedProcedure
		.input(
			z.object({
				deviceId: z.string(),
				action: z.enum([...possibleDeviceActions, "sync"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const device = await db.query.devices.findFirst({
				where: eq(devices.id, input.deviceId),
			});
			if (!device) return null;

			await ctx.ensureTenantMember(device.tenantPk);

			if (input.action !== "sync") {
				await db.insert(deviceActions).values({
					action: input.action,
					devicePk: device.pk,
					createdBy: ctx.account.pk,
				});
			}

			// TODO: Talk with WNS or APNS to ask the device to checkin to MDM.
			console.log("TODO: Trigger MDM device checkin");

			return {};
		}),

	members: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const policy = await db.query.devices.findFirst({
				where: eq(devices.id, input.id),
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });

			await ctx.ensureTenantMember(policy.tenantPk);

			// TODO: Finish this
			return [] as any[];

			// 	return await db
			// 		.select({
			// 			pk: policyAssignables.pk,
			// 			variant: policyAssignables.variant,
			// 			name: sql<PolicyAssignableVariant>`
			//     GROUP_CONCAT(
			//         CASE
			//             WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.device} THEN ${devices.name}
			//             WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.user} THEN ${users.name}
			//             WHEN ${policyAssignables.variant} = ${PolicyAssignableVariants.group} THEN ${groups.name}
			//         END
			//     )
			//   `.as("name"),
			// 		})
			// 		.from(policyAssignables)
			// 		.where(eq(policyAssignables.policyPk, policy.pk))
			// 		.leftJoin(
			// 			devices,
			// 			and(
			// 				eq(devices.pk, policyAssignables.pk),
			// 				eq(policyAssignables.variant, PolicyAssignableVariants.device),
			// 			),
			// 		)
			// 		.leftJoin(
			// 			users,
			// 			and(
			// 				eq(users.pk, policyAssignables.pk),
			// 				eq(policyAssignables.variant, PolicyAssignableVariants.user),
			// 			),
			// 		)
			// 		.leftJoin(
			// 			groups,
			// 			and(
			// 				eq(groups.pk, policyAssignables.pk),
			// 				eq(policyAssignables.variant, PolicyAssignableVariants.group),
			// 			),
			// 		)
			// 		.groupBy(policyAssignables.variant, policyAssignables.pk);
		}),

	addMembers: authedProcedure
		.input(
			z.object({
				id: z.string(),
				members: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(policyAssignableVariants), // TODO
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const policy = await db.query.devices.findFirst({
				where: eq(devices.id, input.id),
			});
			if (!policy)
				throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });

			await ctx.ensureTenantMember(policy.tenantPk);

			// TODO: Finish this
			// await db.insert(policyAssignables).values(
			// 	input.members.map((member) => ({
			// 		policyPk: policy.pk,
			// 		pk: member.pk,
			// 		variant: member.variant,
			// 	})),
			// );
		}),
});
