import { describe, expect, it } from "vitest";
import {
  OUTBOUND_TIMEOUTS,
  OutboundTimeoutError,
  fetchWithTimeout,
  isAbortError,
  outboundTimeoutSignal,
} from "../src/index.js";

/** A fetch that never responds, but rejects when aborted like a real one. */
const hangingFetch =
  (onSignal: (signal: AbortSignal | undefined) => void = () => {}) =>
  (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;

      onSignal(signal);
      signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    });

describe("fetchWithTimeout", () => {
  it("returns a response that arrives in time", async () => {
    const response = await fetchWithTimeout(
      "https://example.test/ok",
      {},
      {
        timeoutMs: 1_000,
        fetch: async () => new Response("ok", { status: 200 }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("aborts a hung request and reports the deadline", async () => {
    let seen: AbortSignal | undefined;
    const started = Date.now();

    const error = await fetchWithTimeout(
      "https://example.test/hang",
      {},
      {
        timeoutMs: 25,
        fetch: hangingFetch((signal) => {
          seen = signal;
        }),
      },
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(OutboundTimeoutError);

    if (error instanceof OutboundTimeoutError) expect(error.timeoutMs).toBe(25);

    if (error instanceof Error) expect(error.message).toContain("timed out");

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(seen?.aborted).toBe(true);
  });

  it("honours a caller-provided abort signal without masking it as a timeout", async () => {
    const controller = new AbortController();

    const promise = fetchWithTimeout(
      "https://example.test/abort",
      { signal: controller.signal },
      { timeoutMs: 10_000, fetch: hangingFetch() },
    );

    controller.abort();
    const error = await promise.catch((cause: unknown) => cause);
    expect(error).not.toBeInstanceOf(OutboundTimeoutError);
    expect(isAbortError(error)).toBe(true);
  });

  it("does not turn an upstream failure into a timeout", async () => {
    const failure = new Error("connection refused");

    const error = await fetchWithTimeout(
      "https://example.test/fail",
      {},
      {
        timeoutMs: 1_000,
        fetch: async () => {
          throw failure;
        },
      },
    ).catch((cause: unknown) => cause);

    expect(error).toBe(failure);
  });

  it("exposes conservative defaults", () => {
    expect(OUTBOUND_TIMEOUTS.apns).toBeLessThanOrEqual(15_000);
    expect(OUTBOUND_TIMEOUTS.azureGraph).toBeLessThanOrEqual(15_000);
    expect(OUTBOUND_TIMEOUTS.stripe).toBeLessThanOrEqual(15_000);
    expect(OUTBOUND_TIMEOUTS.relay).toBeLessThanOrEqual(15_000);
    expect(outboundTimeoutSignal(5).aborted).toBe(false);
  });

  it("classifies abort and non-abort errors", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "TimeoutError" })).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
