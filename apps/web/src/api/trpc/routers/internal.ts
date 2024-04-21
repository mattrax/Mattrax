import { count, sql } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";

import { devices, policies, tenants, users } from "~/db";
import { createTRPCRouter, superAdminProcedure } from "../helpers";

type StatsTarget = "tenants" | "users" | "devices" | "policies";

export const internalRouter = createTRPCRouter({
	stats: superAdminProcedure.query(({ ctx }) =>
		union(
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"tenants"` })
				.from(tenants),
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"users"` })
				.from(users),
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"devices"` })
				.from(devices),
			ctx.db
				.select({ count: count(), variant: sql<StatsTarget>`"policies"` })
				.from(policies),
		),
	),
});
