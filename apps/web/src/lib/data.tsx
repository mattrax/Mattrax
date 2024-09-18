import { createComputed } from "solid-js";
import { trpc } from "./trpc";
import type { RouterOutput } from "~/api";
import { useTenantId } from "~/app/(dash)";

// TODO: Can we allow disabling the cache for testing & artificially slowing down queries

const ACCOUNT_LS_KEY = "account";
const TENANTS_LS_KEY = "tenants";

export const useAccount = () => {
	const query = trpc.auth.me.createQuery(void 0, () => ({
		// initialData: getCachedAccount(),
	}));

	// createComputed(() => {
	// 	// TODO: Redirect to login
	// 	if (query.error) {
	// 	}

	// 	if (query.data)
	// 		localStorage.setItem(ACCOUNT_LS_KEY, JSON.stringify(query.data));
	// });

	return query;
};

export const getCachedAccount = () => {
	try {
		const data = localStorage.getItem(ACCOUNT_LS_KEY);
		if (!data) return undefined;
		// TODO: Locally check the session expiry and if it's gone return `undefined`
		return JSON.parse(data) as RouterOutput["auth"]["me"];
	} catch (err) {
		return undefined;
	}
};

export function doLogin(user: RouterOutput["auth"]["me"]) {
	localStorage.setItem(ACCOUNT_LS_KEY, JSON.stringify(user));
}

export const useTenants = () => {
	const query = trpc.tenant.list.createQuery(void 0, () => ({
		// initialData: getCachedTenants(),
	}));

	// createComputed(() => {
	// 	// TODO: Redirect to login
	// 	if (query.error) {
	// 	}

	// 	if (query.data)
	// 		localStorage.setItem(ACCOUNT_LS_KEY, JSON.stringify(query.data));
	// });

	return query;
};

export const getCachedTenants = () => {
	try {
		const data = localStorage.getItem(TENANTS_LS_KEY);
		if (!data) return undefined;
		return JSON.parse(data) as RouterOutput["auth"]["me"]; // TODO: Type
	} catch (err) {
		return undefined;
	}
};

export const useTenantStats = () => {
	const tenantId = useTenantId();
	const data = trpc.tenant.stats.createQuery(() => ({
		tenantId: tenantId(),
	}));
	// TODO: Caching
	return data;
};
