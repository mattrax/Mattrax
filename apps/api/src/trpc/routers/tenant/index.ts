import { and, count, eq, sql } from "drizzle-orm";
import { union } from "drizzle-orm/mysql-core";
import { z } from "zod";

import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { blueprints, devices, tenantMembers, tenants } from "~/db";
import { env } from "~/env";
import {
	authedProcedure,
	createTRPCRouter,
	tenantProcedure,
} from "../../helpers";
import { sendDiscordMessage } from "../meta";
import { settingsRouter } from "./settings";

export const tenantRouter = createTRPCRouter({
	list: authedProcedure.query(({ ctx }) =>
		ctx.db
			.select({
				id: tenants.id,
				name: tenants.name,
			})
			.from(tenants)
			.innerJoin(
				tenantMembers,
				and(
					eq(tenants.pk, tenantMembers.tenantPk),
					eq(tenantMembers.accountPk, ctx.account.pk),
				),
			)
			.orderBy(tenants.id),
	),

	stats: tenantProcedure.query(async ({ ctx }) => {
		const [a, b] = await union(
			ctx.db
				.select({ count: count() })
				.from(devices)
				.where(eq(devices.tenantPk, ctx.tenant.pk)),
			ctx.db
				.select({ count: count() })
				.from(blueprints)
				.where(eq(blueprints.tenantPk, ctx.tenant.pk)),
		);

		return {
			devices: a?.count || 0,
			blueprints: b?.count || 0,
		};
	}),

	create: authedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(255),
				billingEmail: z.string().email().min(1).max(255),
			}),
		)
		.mutation(({ ctx, input }) =>
			ctx.db.transaction(async (db) => {
				const id = createId();
				await db.insert(tenants).values({
					id,
					name: input.name,
					billingEmail: input.billingEmail,
				});

				const [tenant] = await db
					.select({ pk: tenants.pk })
					.from(tenants)
					.where(eq(tenants.id, id));
				if (!tenant) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

				await db.insert(tenantMembers).values({
					tenantPk: tenant.pk,
					accountPk: ctx.account.pk,
				});

				return id;
			}),
		),

	update: tenantProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100).optional(),
				billingEmail: z.string().email().min(1).max(255).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.name === undefined && input.billingEmail === undefined) return;

			await ctx.db
				.update(tenants)
				.set({
					...(input.name !== undefined && { name: input.name }),
					...(input.billingEmail !== undefined && {
						billingEmail: input.billingEmail,
					}),
				})
				.where(eq(tenants.pk, ctx.tenant.pk));
		}),

	delete: tenantProcedure.mutation(async ({ ctx }) => {
		// TODO: Require the user to remove all devices first

		// TODO: Implement this properly
		await sendDiscordMessage(
			`User \`${ctx.account.id}\` with email \`${ctx.account.email}\` requested deletion of tenant \`${ctx.tenant.id}\`!`,
			env.DO_THE_THING_WEBHOOK_URL,
		);
	}),

	settings: settingsRouter,
});
