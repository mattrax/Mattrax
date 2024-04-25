import { auditLog, db } from "~/db";
import type { auditLogDefinition } from "./auditLogDefinition";

export function withAuditLog<T, K extends keyof typeof auditLogDefinition>(
	action: K,
	data: (typeof auditLogDefinition)[K]["#ty"],
	[tenantPk, userPk]: [number, number | undefined],
	cb: Parameters<typeof db.transaction<T>>[0],
) {
	return db.transaction<T>(async (db) => {
		const promise = db.insert(auditLog).values({
			tenantPk,
			action,
			data,
			accountPk: userPk || null,
		});

		const ret = await cb(db);

		await promise;

		return ret;
	});
}

export type AuditLogDefinition = typeof auditLogDefinition;
