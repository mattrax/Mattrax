import { flushResponse } from "@mattrax/trpc-server-function/server";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "~/api/auditLog";
import { useTransaction } from "~/api/utils/transaction";
import { applications } from "~/db";
import {
	authedProcedure,
	createTRPCRouter,
	publicProcedure,
	tenantProcedure,
} from "../helpers";

export const applicationRouter = createTRPCRouter({
	list: tenantProcedure
		// .input(
		//   z.object({
		//     // TODO: Constrain offset and limit to specific max/min values
		//     offset: z.number().default(0),
		//     limit: z.number().default(50),
		//     // query: z.string().optional(),
		//   })
		// )
		.query(async ({ ctx }) => {
			// TODO: Full-text search???
			// TODO: Pagination abstraction
			// TODO: Can a cursor make this more efficent???
			// TODO: Switch to DB

			return await ctx.db
				.select({
					id: applications.id,
					name: applications.name,
				})
				.from(applications)
				.where(eq(applications.tenantPk, ctx.tenant.pk));
		}),

	get: authedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ input, ctx }) => {
			const app = await ctx.db.query.applications.findFirst({
				where: eq(applications.id, input.id),
			});
			if (!app) return null;

			await ctx.ensureTenantMember(app.tenantPk);

			return app;
		}),

	create: tenantProcedure
		.input(
			z.object({
				name: z.string(),
				targetType: z.enum(["iOS", "Windows"]),
				targetId: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const id = createId();

			await useTransaction(async (db) => {
				await db.insert(applications).values({
					id,
					name: input.name,
					tenantPk: ctx.tenant.pk,
				});
				await createAuditLog("addApp", { id, name: input.name });
			});

			return { id };
		}),

	searchWindowsStore: publicProcedure
		.input(z.object({ query: z.string() }))
		.query(async ({ input, ctx }) => {
			flushResponse();

			const res = await fetch(
				"https://storeedgefd.dsx.mp.microsoft.com/v9.0/manifestSearch",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						MaximumResults: 50,
						Filters: [
							{
								PackageMatchField: "Market",
								RequestMatch: { KeyWord: "US", MatchType: "CaseInsensitive" },
							},
						],
						Query: { KeyWord: input.query, MatchType: "Substring" },
					}),
				},
			);
			if (!res.ok) throw new Error("Failed to search Windows Store");

			// TODO: Pagination support

			// TODO: Cache these results. Intune's seem to which Cache-Control but idk how much of that we can do with our batching.

			const data = await res.json();
			console.log(JSON.stringify(data.Data)); // TODO
			return microsoftManifestSearchSchema.parse(data);
		}),
});

const microsoftManifestSearchSchema = z.object({
	$type: z.string(),
	Data: z.array(
		z.object({
			$type: z.string(),
			PackageIdentifier: z.string(),
			PackageName: z.string(),
			Publisher: z.string(),
			Versions: z.array(
				z.object({
					$type: z.string(),
					PackageVersion: z.string(),
					PackageFamilyNames: z.array(z.string()).optional(),
				}),
			),
		}),
	),
});
