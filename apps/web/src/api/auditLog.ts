import { auditLog } from "~/db";
import { useAccountSafe } from "./account";
import type { auditLogDefinition } from "./auditLogDefinition";
import { useTenant } from "./tenant";
import { useTransaction } from "./utils/transaction";

export function createAuditLog<K extends keyof typeof auditLogDefinition>(
	action: K,
	data: (typeof auditLogDefinition)[K]["#ty"],
) {
	const tenant = useTenant();

	return useTransaction((db) =>
		db.insert(auditLog).values({
			tenantPk: tenant.pk,
			action,
			data,
			accountPk: useAccountSafe()?.pk,
		}),
	);
}

export type AuditLogDefinition = typeof auditLogDefinition;
