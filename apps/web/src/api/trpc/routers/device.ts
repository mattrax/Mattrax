import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";
import { withTenant } from "~/api/tenant";
import { omit } from "~/api/utils";
import { createEnrollmentSession } from "~/app/enroll/util";
import {
	applicationAssignables,
	applications,
	db,
	deviceActions,
	devices,
	policies,
	policyAssignments,
	possibleDeviceActions,
	users,
} from "~/db";
import { env } from "~/env";
import { authedProcedure, createTRPCRouter, tenantProcedure } from "../helpers";

const deviceProcedure = authedProcedure
	.input(z.object({ id: z.string() }))
	.use(async ({ next, input, ctx, type }) => {
		const device = await ctx.db.query.devices.findFirst({
			where: eq(devices.id, input.id),
		});
		if (!device) throw new TRPCError({ code: "NOT_FOUND", message: "device" });

		const tenant = await ctx.ensureTenantMember(device.tenantPk);

		return withTenant(tenant, () =>
			next({ ctx: { device, tenant } }).then((result) => {
				// TODO: Right now we invalidate everything but we will need to be more specific in the future
				// if (type === "mutation") invalidate(tenant.orgSlug, tenant.slug);
				return result;
			}),
		);
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
				owner: {
					id: users.id,
					name: users.name,
				},
				enrolledAt: devices.enrolledAt,
			})
			.from(devices)
			.leftJoin(users, eq(users.pk, devices.owner))
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
				.from(applicationAssignables)
				.where(
					and(
						eq(applicationAssignables.variant, "device"),
						eq(applicationAssignables.pk, device.pk),
					),
				)
				.innerJoin(
					applications,
					eq(applicationAssignables.applicationPk, applications.pk),
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
			// biome-ignore lint/style/useSingleVarDeclarator: <explanation>
			const pols: Array<number> = [],
				apps: Array<number> = [];

			input.assignments.forEach((a) => {
				if (a.variant === "policy") pols.push(a.pk);
				else apps.push(a.pk);
			});

			const ops: Promise<unknown>[] = [];
			if (pols.length > 0)
				ops.push(
					db
						.insert(policyAssignments)
						.values(
							pols.map((pk) => ({
								pk: device.pk,
								policyPk: pk,
								variant: sql`'device'`,
							})),
						)
						.onDuplicateKeyUpdate({
							set: {
								pk: sql`${policyAssignments.pk}`,
							},
						}),
				);

			if (apps.length > 0)
				ops.push(
					db
						.insert(applicationAssignables)
						.values(
							apps.map((pk) => ({
								pk: device.pk,
								applicationPk: pk,
								variant: sql`'device'`,
							})),
						)
						.onDuplicateKeyUpdate({
							set: {
								pk: sql`${applicationAssignables.pk}`,
							},
						}),
				);

			await db.transaction((db) => Promise.all(ops));
		}),

	generateEnrollmentSession: tenantProcedure
		.input(z.object({ userId: z.string().nullable() }))
		.mutation(async ({ ctx, input }) => {
			const p = new URLSearchParams();
			p.set("mode", "mdm");
			p.set("servername", env.VITE_PROD_ORIGIN);

			let data: { uid: number; upn: string } | undefined = undefined;
			if (input.userId) {
				const [user] = await db
					.select({
						pk: users.pk,
						upn: users.upn,
					})
					.from(users)
					.where(eq(users.id, input.userId));
				if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "user" }); // TODO: Handle this on the frontend

				p.set("username", user.upn);
				data = {
					uid: user.pk,
					upn: user.upn,
				};
			}

			const jwt = await createEnrollmentSession(
				data
					? {
							tid: ctx.tenant.pk,
							...data,
						}
					: {
							tid: ctx.tenant.pk,
							aid: ctx.account.pk,
						},
				// 7 days
				7 * 24 * 60,
			);

			p.set("accesstoken", jwt);

			return `ms-device-enrollment:?${p.toString()}`;
		}),
});
