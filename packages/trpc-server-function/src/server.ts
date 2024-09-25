import { AsyncLocalStorage } from "node:async_hooks";
import { getRequestEvent } from "solid-js/web";

export const TRPC_LOCAL_STORAGE = new AsyncLocalStorage<() => void>();

export function flushResponse() {
	const flush = TRPC_LOCAL_STORAGE.getStore();
	if (!flush)
		throw new Error("Cannot call flushResponse outside of a trpc handler");

	flush();
}

export function waitUntil(promise: Promise<void> | (() => Promise<void>)) {
	const e = getRequestEvent();
	if (!e) throw new Error("Called `waitUtil` outside request context");
	(e as any).waitUntil(promise);
}
