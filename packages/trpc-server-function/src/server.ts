import { AsyncLocalStorage } from "node:async_hooks";
import { getEvent } from "vinxi/http";

export const TRPC_LOCAL_STORAGE = new AsyncLocalStorage<() => void>();

export function flushResponse() {
	const flush = TRPC_LOCAL_STORAGE.getStore();
	if (!flush)
		throw new Error("Cannot call flushResponse outside of a trpc handler");

	flush();
}

export function waitUntil(fn: () => Promise<void>) {
	const waitUtil = getEvent().context?.waitUntil;
	if (!waitUtil) throw new Error("Not found 'waitUtil'");
	waitUntil(fn);
}
