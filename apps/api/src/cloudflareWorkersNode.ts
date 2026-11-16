/**
 * Node stand-in for the Workers `cloudflare:workers` module.
 *
 * The API and its dependencies read deployment configuration from `env`; on
 * Node that is the process environment. Background work scheduled with
 * `waitUntil` has no request lifecycle to attach to, so it starts immediately
 * and failures are logged rather than silently swallowed.
 */

const environment = process.env as unknown as Record<string, unknown>;

export const env = environment;

export const waitUntil = (promise: Promise<unknown>): void => {
  void promise.catch((cause) => console.error("Background task failed", cause));
};

export const passThroughOnException = (): void => {};
