import { createBackgroundTasks } from "./backgroundTasks.ts";

/**
 * Node stand-in for the Workers `cloudflare:workers` module.
 *
 * The API and its dependencies read deployment configuration from `env`; on
 * Node that is the process environment. Background work scheduled with
 * `waitUntil` is tracked here so the host can drain it before exiting.
 */

export const env: Record<string, string | undefined> = process.env;

const backgroundTasks = createBackgroundTasks((operation, cause) =>
  console.error(operation, cause),
);

export const waitUntil = (promise: Promise<unknown>): void => {
  backgroundTasks.waitUntil(promise);
};

export const idleBackgroundTasks = (): Promise<void> => backgroundTasks.idle();

export const drainBackgroundTasks = (deadlineMs: number): Promise<"drained" | "interrupted"> =>
  backgroundTasks.drain(deadlineMs);

export const passThroughOnException = (): void => {};
