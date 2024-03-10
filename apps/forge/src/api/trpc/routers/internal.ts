import { count, sql } from "drizzle-orm";
import { union } from "drizzle-orm/mysql-core";

import { getDb, devices, policies, tenants, users } from "~/db";
import { createTRPCRouter, superAdminProcedure } from "../helpers";

type StatsTarget = "tenants" | "users" | "devices" | "policies";

export const internalRouter = createTRPCRouter({
	stats: superAdminProcedure.query(() =>
		union(
			getDb()
				.select({ count: count(), variant: sql<StatsTarget>`"tenants"` })
				.from(tenants),
			getDb()
				.select({ count: count(), variant: sql<StatsTarget>`"users"` })
				.from(users),
			getDb()
				.select({ count: count(), variant: sql<StatsTarget>`"devices"` })
				.from(devices),
			getDb()
				.select({ count: count(), variant: sql<StatsTarget>`"policies"` })
				.from(policies),
		),
	),
});
