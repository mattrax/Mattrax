import { auditLog, db } from "~/db";
import type { auditLogDefinition } from "./auditLogDefinition";
import { sql } from "drizzle-orm";

export function withAuditLog<T, K extends keyof typeof auditLogDefinition>(
	action: K,
	data: (typeof auditLogDefinition)[K]["#ty"],
	[tenantPk, userPk]: [number, number | undefined],
	cb: Parameters<typeof db.transaction<T>>[0],
) {
	// TODO: I know Planetscale's HTTP adapter does a request to open and close the transaction + one for every operation
	// TODO: Can we make our own HTTP edge that can do this in a single HTTP request???

	db.transaction<T>(async (db) => {
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
