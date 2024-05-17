// @ts-nocheck // TODO: Make the types parse and reenable this

import { match } from "ts-pattern";
import type { AuditLogDefinition } from "~/api/auditLog";
import { AUTH_PROVIDER_DISPLAY } from "./values";

export function formatAuditLogEvent<
	K extends keyof AuditLogDefinition,
	D extends AuditLogDefinition[K]["#ty"],
>(action: K, data: D) {
	return (
		// TODO: Hyperlink
		tryOrNull(() =>
			match(action)
				.with("addIdp", () => ({
					title: `Added ${
						AUTH_PROVIDER_DISPLAY[data.variant]
					} identity provider`,
					href: "settings/identity-provider",
				}))
				.with("removeIdp", () => ({
					title: `Removed ${
						AUTH_PROVIDER_DISPLAY[data.variant]
					} identity provider`,
					href: "settings/identity-provider",
				}))
				.with("addDevice", () => ({
					title: "todo",
					href: null,
				}))
				.with("deviceAction", () => ({
					title: "todo",
					href: null,
				}))
				.with("removeDevice", () => ({
					title: "todo",
					href: null,
				}))
				.with("addPolicy", () => ({
					title: `Created policy '${data.name}'`,
					href: `policies/${encodeURIComponent(data.id)}`,
				}))
				.with("deployPolicy", () => ({
					title: "todo",
					href: null,
				}))
				.with("deletePolicy", () => ({
					title: `Removed policy '${data.name}'`,
					href: null,
				}))
				.with("addApp", () => ({
					title: `Added application '${data.name}'`,
					href: `apps/${encodeURIComponent(data.id)}`,
				}))
				.with("editApp", () => ({
					title: "todo",
					href: null,
				}))
				.with("removeApp", () => ({
					title: "todo",
					href: null,
				}))
				.with("addGroup", () => ({
					title: `Added group '${data.name}'`,
					href: `groups/${encodeURIComponent(data.id)}`,
				}))
				.with("editGroup", () => ({
					title: "todo",
					href: null,
				}))
				.with("removeGroup", () => ({
					title: "todo",
					href: null,
				}))
				.exhaustive(),
		)
	);
}

function tryOrNull<T>(t: () => T) {
	try {
		return t();
	} catch (err) {
		return null;
	}
}
