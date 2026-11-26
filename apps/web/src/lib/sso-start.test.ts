// @vitest-environment happy-dom
import { Effect, Fiber } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { ssoRedirectUrl, startOrganisationSsoEffect } from "./sso-start";

/** Recording fake for the fetch port; no global fetch stubbing. */
type FetchArgs = Parameters<typeof fetch>;
const fetchCalls: Array<FetchArgs> = [];
let fetchImpl: typeof fetch = async () => {
  throw new Error("no fetch configured");
};
const fetchMock: typeof fetch = (input, init) => {
  fetchCalls.push([input, init]);

  return fetchImpl(input, init);
};
const respond = (response: Response) => {
  fetchImpl = async () => response;
};
const rejectWith = (error: unknown) => {
  fetchImpl = async () => {
    throw error;
  };
};

const runLookup = (email: string, returnTo?: string) =>
  Effect.runPromise(
    startOrganisationSsoEffect(email, returnTo).pipe(
      Effect.provideService(FetchHttpClient.Fetch, fetchMock),
      Effect.scoped,
    ),
  );

beforeEach(() => {
  fetchCalls.length = 0;
  fetchImpl = async () => {
    throw new Error("no fetch configured");
  };
});

describe("email-first SSO start", () => {
  it("returns a valid provider redirect and preserves the return target", async () => {
    respond(Response.json({ url: "https://login.microsoftonline.com/tenant/authorize" }));

    await expect(runLookup("ada@acme.com", "/t/acme/devices")).resolves.toEqual({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });

    const [input, init] = fetchCalls[0]!;
    const url = new URL(String(input), window.location.origin);

    expect(url.pathname).toBe("/api/v1/sso/azure/start");
    expect(url.searchParams.get("email")).toBe("ada@acme.com");
    expect(url.searchParams.get("returnTo")).toBe("/t/acme/devices");
    expect(init).toMatchObject({
      credentials: "include",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("keeps a missing organisation on the ordinary passkey path", async () => {
    respond(Response.json({ error: "No SSO tenant found for this email" }, { status: 404 }));

    await expect(runLookup("person@example.com")).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("keeps an unconfigured self-hosted deployment on the passkey path", async () => {
    // Status alone identifies the case; do not depend on the body wording.
    respond(Response.json({}, { status: 503 }));

    await expect(runLookup("person@example.com")).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("keeps provider failures retryable without exposing provider detail", async () => {
    respond(Response.json({ error: "private tenant id tenant-secret" }, { status: 500 }));

    const result = await runLookup("ada@acme.com");

    expect(result).toEqual({
      kind: "error",
      message: "Organisation sign-in is temporarily unavailable. Try again in a moment.",
    });
    expect(result).not.toMatchObject({ message: expect.stringContaining("tenant-secret") });
  });

  it("uses accurate copy for a rejected address request", async () => {
    respond(Response.json({}, { status: 400 }));

    await expect(runLookup("ada@acme.com")).resolves.toEqual({
      kind: "error",
      message:
        "That email address couldn't be used for organisation sign-in. Check it and try again.",
    });
  });

  it("treats a malformed success as a retryable provider failure", async () => {
    respond(Response.json({ error: "unexpected success body" }));

    await expect(runLookup("ada@acme.com")).resolves.toMatchObject({ kind: "error" });
  });

  it("rejects unsafe redirect schemes", async () => {
    respond(Response.json({ url: "javascript:alert(1)" }));

    await expect(runLookup("ada@acme.com")).resolves.toMatchObject({ kind: "error" });
    expect(ssoRedirectUrl("javascript:alert(1)", "https://mattrax.test")).toBeNull();
    expect(ssoRedirectUrl("/login?sso=started", "https://mattrax.test")).toBe("/login?sso=started");
  });

  it("keeps network failures retryable", async () => {
    rejectWith(new Error("offline"));

    await expect(runLookup("ada@acme.com")).resolves.toEqual({
      kind: "error",
      message: "We couldn't reach organisation sign-in. Check your connection and try again.",
    });
  });

  it("aborts a lookup after ten seconds and offers a retry", async () => {
    fetchImpl = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(startOrganisationSsoEffect("ada@acme.com"));
        yield* Effect.yieldNow;
        yield* TestClock.adjust(10_000);
        return yield* Fiber.join(fiber);
      }).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetchMock),
        Effect.provide(TestClock.layer()),
        Effect.scoped,
      ),
    );

    expect(result).toEqual({
      kind: "error",
      message: "Organisation sign-in took too long. Check your connection and try again.",
    });
  });

  it("gives rate-limited attempts a specific recovery step", async () => {
    respond(Response.json({}, { status: 429 }));

    await expect(runLookup("ada@acme.com")).resolves.toEqual({
      kind: "error",
      message: "Too many sign-in attempts. Wait a minute and try again.",
    });
  });
});
