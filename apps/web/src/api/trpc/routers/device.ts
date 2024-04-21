import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";
import {
	devices,
	policyAssignableVariants,
	users,
	deviceActions,
	possibleDeviceActions,
	policyAssignments,
	applicationAssignments,
	policies,
	applications,
} from "~/db";
import { omit } from "~/api/utils";
import { TRPCError } from "@trpc/server";

const deviceProcedure = authedProcedure
	.input(z.object({ id: z.string() }))
	.use(async ({ next, input, ctx }) => {
		const device = await ctx.db.query.devices.findFirst({
			where: eq(devices.id, input.id),
		});
		if (!device) throw new TRPCError({ code: "NOT_FOUND", message: "device" });

		const tenant = await ctx.ensureTenantMember(device.tenantPk);

		return next({ ctx: { device, tenant } });
	});

export const deviceRouter = createTRPCRouter({
	list: tenantProcedure.query(async ({ ctx }) => {
		return await ctx.db
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
			const [device] = await ctx.db
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
			const device = await ctx.db.query.devices.findFirst({
				where: eq(devices.id, input.deviceId),
			});
			if (!device) return null;

			await ctx.ensureTenantMember(device.tenantPk);

			if (input.action !== "sync") {
				await ctx.db.insert(deviceActions).values({
					action: input.action,
					devicePk: device.pk,
					createdBy: ctx.account.pk,
				});
			}

			// TODO: Talk with WNS or APNS to ask the device to checkin to MDM.
			console.log("TODO: Trigger MDM device checkin");

			return {};
		}),

	assignments: deviceProcedure.query(async ({ ctx }) => {
		const { device } = ctx;

		const [p, a] = await Promise.all([
			ctx.db
				.select({ pk: policies.pk, id: policies.id, name: policies.name })
				.from(policyAssignments)
				.where(
					and(
						eq(policyAssignments.variant, "device"),
						eq(policyAssignments.pk, device.pk),
					),
				)
				.innerJoin(policies, eq(policyAssignments.policyPk, policies.pk)),
			ctx.db
				.select({
					pk: applications.pk,
					id: applications.id,
					name: applications.name,
				})
				.from(applicationAssignments)
				.where(
					and(
						eq(applicationAssignments.variant, "device"),
						eq(applicationAssignments.pk, device.pk),
					),
				)
				.innerJoin(
					applications,
					eq(applicationAssignments.applicationPk, applications.pk),
				),
		]);

		return { policies: p, apps: a };
	}),

	addAssignments: deviceProcedure
		.input(
			z.object({
				assignments: z.array(
					z.object({
						pk: z.number(),
						variant: z.enum(["policy", "application"]),
					}),
				),
			}),
		)
		.mutation(async ({ ctx: { device, db }, input }) => {
			const pols: Array<number> = [],
				apps: Array<number> = [];

			input.assignments.forEach((a) => {
				if (a.variant === "policy") pols.push(a.pk);
				else apps.push(a.pk);
			});

			await db.transaction((db) =>
				Promise.all([
					db
						.insert(policyAssignments)
						.values(
							pols.map((pk) => ({
								pk: device.pk,
								policyPk: pk,
								variant: sql`"device"`,
							})),
						)
						.onConflictDoNothing(),
					db
						.insert(applicationAssignments)
						.values(
							apps.map((pk) => ({
								pk: device.pk,
								applicationPk: pk,
								variant: sql`"device"`,
							})),
						)
						.onConflictDoNothing(),
				]),
			);
		}),
});
