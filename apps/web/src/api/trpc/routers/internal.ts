import { count, sql } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";

import { db, devices, policies, tenants, users } from "~/db";
import { createTRPCRouter, superAdminProcedure } from "../helpers";

type StatsTarget = "tenants" | "users" | "devices" | "policies";

export const internalRouter = createTRPCRouter({
	stats: superAdminProcedure.query(() =>
		union(
			db
				.select({ count: count(), variant: sql<StatsTarget>`"tenants"` })
				.from(tenants),
			db
				.select({ count: count(), variant: sql<StatsTarget>`"users"` })
				.from(users),
			db
				.select({ count: count(), variant: sql<StatsTarget>`"devices"` })
				.from(devices),
			db
				.select({ count: count(), variant: sql<StatsTarget>`"policies"` })
				.from(policies),
		),
	),
});
