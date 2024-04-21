import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { auditLog, getDb } from "~/db";
import type * as schema from "~/db/schema";
import type { auditLogDefinition } from "./auditLogDefinition";

export function withAuditLog<T, K extends keyof typeof auditLogDefinition>(
	action: K,
	data: (typeof auditLogDefinition)[K]["#ty"],
	[tenantPk, userPk]: [number, number | undefined],
	cb: (
		tx: PgTransaction<
			PostgresJsQueryResultHKT,
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
		>,
	) => Promise<T>,
) {
	return getDb().transaction<T>(async (db) => {
		await db.insert(auditLog).values({
			tenantPk,
			action,
			data,
			userPk: userPk || sql`NULL`,
		});

		return await cb(db);
	});
}

export type AuditLogDefinition = typeof auditLogDefinition;
