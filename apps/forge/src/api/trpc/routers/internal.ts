import { count } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";

import { db, devices, policies, tenants, users } from "~/db";
import { createTRPCRouter, superAdminProcedure } from "../helpers";
import { promiseAllObject } from "~/api/utils";

export const dbCount = <TFrom extends MySqlTable>(table: TFrom) =>
	db
		.select({ count: count() })
		.from(table)
		.then((rows) => rows[0]!.count);

export const internalRouter = createTRPCRouter({
	stats: superAdminProcedure.query(() =>
		promiseAllObject({
			tenants: dbCount(tenants),
			devices: dbCount(devices),
			users: dbCount(users),
			policies: dbCount(policies),
			// apps: dbCount(apps),
			// groups: dbCount(groups),
		}),
	),
});
