// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ssoRedirectUrl, startOrganisationSso } from "./sso-start";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("email-first SSO start", () => {
  it("returns a valid provider redirect and preserves the return target", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ url: "https://login.microsoftonline.com/tenant/authorize" }),
    );

    await expect(startOrganisationSso("ada@acme.com", "/t/acme/devices")).resolves.toEqual({
      kind: "redirect",
      url: "https://login.microsoftonline.com/tenant/authorize",
    });

    const [input, init] = fetchMock.mock.calls[0]!;
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
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "No SSO tenant found for this email" }, { status: 404 }),
    );

    await expect(startOrganisationSso("person@example.com")).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("keeps an unconfigured self-hosted deployment on the passkey path", async () => {
    // Status alone identifies the case; do not depend on the body wording.
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503 }));

    await expect(startOrganisationSso("person@example.com")).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("keeps provider failures retryable without exposing provider detail", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "private tenant id tenant-secret" }, { status: 500 }),
    );

    const result = await startOrganisationSso("ada@acme.com");

    expect(result).toEqual({
      kind: "error",
      message: "Organisation sign-in is temporarily unavailable. Try again in a moment.",
    });
    expect(result).not.toMatchObject({ message: expect.stringContaining("tenant-secret") });
  });

  it("uses accurate copy for a rejected address request", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 400 }));

    await expect(startOrganisationSso("ada@acme.com")).resolves.toEqual({
      kind: "error",
      message:
        "That email address couldn't be used for organisation sign-in. Check it and try again.",
    });
  });

  it("treats a malformed success as a retryable provider failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "unexpected success body" }));

    await expect(startOrganisationSso("ada@acme.com")).resolves.toMatchObject({ kind: "error" });
  });

  it("rejects unsafe redirect schemes", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ url: "javascript:alert(1)" }));

    await expect(startOrganisationSso("ada@acme.com")).resolves.toMatchObject({ kind: "error" });
    expect(ssoRedirectUrl("javascript:alert(1)", "https://mattrax.test")).toBeNull();
    expect(ssoRedirectUrl("/login?sso=started", "https://mattrax.test")).toBe("/login?sso=started");
  });

  it("keeps network failures retryable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    await expect(startOrganisationSso("ada@acme.com")).resolves.toEqual({
      kind: "error",
      message: "We couldn't reach organisation sign-in. Check your connection and try again.",
    });
  });

  it("aborts a lookup after ten seconds and offers a retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = startOrganisationSso("ada@acme.com");

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({
      kind: "error",
      message: "Organisation sign-in took too long. Check your connection and try again.",
    });
  });

  it("gives rate-limited attempts a specific recovery step", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 429 }));

    await expect(startOrganisationSso("ada@acme.com")).resolves.toEqual({
      kind: "error",
      message: "Too many sign-in attempts. Wait a minute and try again.",
    });
  });
});
