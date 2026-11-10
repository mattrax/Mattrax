import { describe, expect, it } from "vitest";
import {
  OUTBOUND_TIMEOUTS,
  OutboundTimeoutError,
  fetchWithTimeout,
  isAbortError,
  outboundTimeoutSignal,
} from "../src/index.js";

/** A fetch that never responds, but rejects when aborted like a real one. */
const hangingFetch = (seen: { signal?: AbortSignal } = {}): typeof globalThis.fetch =>
  ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      seen.signal = init?.signal ?? undefined;
      seen.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    })) as typeof globalThis.fetch;

describe("fetchWithTimeout", () => {
  it("returns a response that arrives in time", async () => {
    const response = await fetchWithTimeout(
      "https://example.test/ok",
      {},
      {
        timeoutMs: 1_000,
        fetch: (async () => new Response("ok", { status: 200 })) as typeof fetch,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("aborts a hung request and reports the deadline", async () => {
    const seen: { signal?: AbortSignal } = {};
    const started = Date.now();
    const error = await fetchWithTimeout(
      "https://example.test/hang",
      {},
      { timeoutMs: 25, fetch: hangingFetch(seen) },
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(OutboundTimeoutError);
    expect((error as OutboundTimeoutError).timeoutMs).toBe(25);
    expect((error as Error).message).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(seen.signal?.aborted).toBe(true);
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
        fetch: (async () => {
          throw failure;
        }) as typeof fetch,
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
