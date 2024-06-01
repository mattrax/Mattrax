import { initGraphClient } from "@mattrax/ms-graph";
import { env } from "~/env";

// A really simple in-memory cache.
// This will amortise the cost of constructing the same client multiple times in a single request.
// Also in my testing global variables can be shared between requests in Cloudflare Workers.
const cached: Record<string, any> = {};
function cache<T>(key: string, fn: () => T): T {
	if (cached[key]) return cached[key];
	const result = fn();
	cached[key] = result;
	return result;
}

function getEntraTokens() {
	return [env.ENTRA_CLIENT_ID, env.ENTRA_CLIENT_SECRET] as const;
}

// The MS Graph client for Entra ID sync within the user's tenant
// This uses the "Forge" application.
export const msGraphClient = (tenantId: string) =>
	cache(`tenantGraphClient|${tenantId}`, () =>
		initGraphClient(tenantId, ...getEntraTokens()),
	);

export const msClientFromRefreshToken = (
	tenantId: string,
	refreshToken: string,
) =>
	cache(`userGraphClient|${tenantId}`, () =>
		initGraphClient(tenantId, ...getEntraTokens(), refreshToken),
	);
