import { waitUntil } from "@mattrax/trpc-server-function/server";
import { env } from "~/env";

export const invalidate = (orgSlug: string, tenantSlug?: string) =>
	waitUntil(async () => {
		const resp = await fetch(`${env.MDM_URL}/realtime/invalidate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				authorization: `Bearer ${env.INTERNAL_SECRET}`,
			},
			body: JSON.stringify({
				orgSlug,
				tenantSlug,
			}),
		});
		if (!resp.ok && import.meta.env.MODE !== "development")
			throw new Error(
				`Failed to send cache invalidation request: ${
					resp.status
				}: ${await resp.text()}`,
			);
	});
