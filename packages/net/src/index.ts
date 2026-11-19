/**
 * Shared bounds for outbound network calls.
 *
 * A Worker request must never be held open by a hung upstream: every outbound
 * call either has a deadline or a hard cap on attempts. These values are
 * intentionally conservative (fail fast, retry a bounded number of times)
 * rather than tuned for large payloads.
 */

export * from "./clientAddress.js";

/** Default deadline for a single outbound request. */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 10_000;

/** Per-provider deadlines, chosen to fit inside typical Worker/request budgets. */
export const OUTBOUND_TIMEOUTS = {
  /** APNs push delivery. Apple's own gateway is fast or the token is dead. */
  apns: 10_000,
  /** Microsoft Graph (token + reads). Graph can be slow on large delta pages. */
  azureGraph: 15_000,
  /** Stripe API calls, which are usually sub-second. */
  stripe: 15_000,
  /** SCEP/push relay calls between our own services. */
  relay: 10_000,
  /** Self-hosted deployment to the cloud billing API. */
  billing: 15_000,
} as const;

/** Retries handed to the Stripe SDK (`maxNetworkRetries`). */
export const STRIPE_MAX_NETWORK_RETRIES = 2;

export class OutboundTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Outbound request timed out after ${timeoutMs}ms`);
    this.name = "OutboundTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** An abort signal that fires after `timeoutMs`. */
export const outboundTimeoutSignal = (timeoutMs = DEFAULT_OUTBOUND_TIMEOUT_MS): AbortSignal =>
  AbortSignal.timeout(timeoutMs);

type ErrorWithName = { readonly name?: string };

const isErrorWithName = (cause: unknown): cause is ErrorWithName =>
  typeof cause === "object" && cause !== null;

/** Whether an error came from an aborted/timed-out request rather than the peer. */
export const isAbortError = (cause: unknown): boolean =>
  isErrorWithName(cause) && (cause.name === "AbortError" || cause.name === "TimeoutError");

const combineSignals = (timeout: AbortSignal, signal?: AbortSignal | null): AbortSignal =>
  signal ? AbortSignal.any([signal, timeout]) : timeout;

export type FetchWithTimeoutOptions = {
  /** Deadline for the whole request (connect + headers + body). */
  readonly timeoutMs?: number;
  /** Override for tests or alternative runtimes. */
  readonly fetch?: typeof globalThis.fetch;
};

/**
 * `fetch` with a deadline. The returned promise rejects with
 * {@link OutboundTimeoutError} when the deadline fires, so callers can report a
 * timeout instead of a generic network failure.
 *
 * The abort signal also covers the response body, so a stalled body read fails
 * rather than hanging; that secondary failure surfaces as an abort error.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeout = outboundTimeoutSignal(timeoutMs);
  const signal = combineSignals(timeout, init.signal);

  try {
    return await doFetch(input, { ...init, signal });
  } catch (error) {
    if (timeout.aborted) throw new OutboundTimeoutError(timeoutMs);
    throw error;
  }
}
