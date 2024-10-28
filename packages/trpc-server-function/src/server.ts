import { AsyncLocalStorage } from "node:async_hooks";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";

export const TRPC_LOCAL_STORAGE = new AsyncLocalStorage<() => void>();

export function flushResponse() {
	const flush = TRPC_LOCAL_STORAGE.getStore();
	if (!flush)
		throw new Error("Cannot call flushResponse outside of a trpc handler");

	flush();
}

export function waitUntil(promise: Promise<void> | (() => Promise<void>)) {
	// TODO: Vercel and Cloudflare do it differently
	// const e = getRequestEvent();
	// if (!e) throw new Error("Called `waitUntil` outside request context");
	// (e as any).waitUntil(promise);
	vercelWaitUntil(typeof promise === "function" ? promise() : promise);
}
