import { createId } from "@paralleldrive/cuid2";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { blueprints, db, devices } from "~/db";
import { env } from "~/env";
import { createTRPCRouter, tenantProcedure } from "../helpers";
import { sendDiscordMessage } from "./meta";

export const blueprintRouter = createTRPCRouter({
	list: tenantProcedure.query(async ({ ctx }) => {
		return await db
			.select({
				id: blueprints.id,
				name: blueprints.name,
				description: blueprints.description,
				lastModified: blueprints.lastModified,
				devices: count(devices.pk),
			})
			.from(blueprints)
			.where(eq(blueprints.tenantPk, ctx.tenant.pk))
			.leftJoin(devices, eq(devices.blueprint, blueprints.pk))
			.groupBy(blueprints.id)
			.orderBy(asc(blueprints.name));
	}),

	get: tenantProcedure
		.input(
			z.object({
				id: z.string(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const [blueprint] = await db
				.select({
					id: blueprints.id,
					name: blueprints.name,
					description: blueprints.description,
					lastModified: blueprints.lastModified,
				})
				.from(blueprints)
				.where(
					and(
						eq(blueprints.tenantPk, ctx.tenant.pk),
						eq(blueprints.id, input.id),
					),
				);

			return blueprint;
		}),

	create: tenantProcedure
		.input(
			z.object({
				name: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const id = createId();

			await ctx.db.insert(blueprints).values({
				id,
				tenantPk: ctx.tenant.pk,
				name: input.name,
			});

			return id;
		}),

	update: tenantProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(100).optional(),
				description: z.string().email().min(1).max(255).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.name === undefined && input.description === undefined) return;

			await ctx.db
				.update(blueprints)
				.set({
					...(input.name !== undefined && { name: input.name }),
					...(input.description !== undefined && {
						description: input.description,
					}),
				})
				.where(
					and(
						eq(blueprints.tenantPk, ctx.tenant.pk),
						eq(blueprints.id, input.id),
					),
				);
		}),

	delete: tenantProcedure
		.input(
			z.object({
				ids: z.array(z.string()),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// TODO: Implement this properly
			await sendDiscordMessage(
				`User \`${ctx.account.id}\` with email \`${ctx.account.email}\` requested deletion of blueprints ${input.ids.map((s) => `\`${s}\``).join(",")} in tenant \`${ctx.tenant.id}\`!`,
				env.DO_THE_THING_WEBHOOK_URL,
			);
		}),
});
