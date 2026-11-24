import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@solidjs/web", () => ({ isServer: false, getRequestEvent: () => undefined }));
vi.mock("~/lib/posthog", () => ({ capturePostHog: vi.fn() }));
import { authClient } from "./auth";

const NativeRequest = globalThis.Request;
const session = {
  sessionId: "session-1",
  subjectId: "account-1",
  claims: { name: "Ada", email: "ada@example.com", emailVerified: true },
};
const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  Response.json({ status: "ok", emailSent: true }),
);

const installBrowserRequest = () => {
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === "string" && input.startsWith("/")
            ? new URL(input, "https://mattrax.test")
            : input,
          init,
        );
      }
    },
  );
};

beforeEach(() => {
  installBrowserRequest();
  fetch.mockReset();
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser auth transport", () => {
  // Chrome passes Effect's stream-support probe but rejects ReadableStream uploads over HTTP/1.1.
  it("sends HTTP/1.1-compatible JSON POSTs without Fetch duplex streaming", async () => {
    const payload = { name: "Ada", email: "ada@example.com" };
    fetch.mockResolvedValueOnce(Response.json({ status: "ok", emailSent: true }));

    await expect(authClient.requestRegistrationCode(payload)).resolves.toEqual({
      data: { status: "ok", emailSent: true },
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    const [input, init] = fetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);

    expect(String(input)).toBe("https://mattrax.test/api/v1/register/verification");
    expect(init?.method).toBe("POST");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-effect-auth-csrf")).toBe("1");
    expect(init?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(JSON.stringify(payload));
    expect((init as RequestInit & { duplex?: string }).duplex).toBeUndefined();
  });

  it("preserves direct Enterprise API errors", async () => {
    fetch.mockResolvedValueOnce(
      Response.json(
        { _tag: "EnterpriseBadRequest", message: "Enter your name and a valid email address." },
        { status: 400 },
      ),
    );

    await expect(
      authClient.requestRegistrationCode({ name: "Ada", email: "ada@example.com" }),
    ).resolves.toEqual({
      error: {
        message: "We couldn't complete that request. Try again.",
        tag: "EnterpriseBadRequest",
      },
    });
  });

  it("rejects malformed direct registration-verification success", async () => {
    fetch.mockResolvedValueOnce(Response.json({ status: "ok" }));

    await expect(
      authClient.requestRegistrationCode({ name: "Ada", email: "ada@example.com" }),
    ).resolves.toEqual({
      error: {
        message: "The authentication service returned an invalid success response",
        tag: "AuthResponseError",
      },
    });
  });

  it.each([
    {},
    { error: "Could not start SSO sign-in" },
    { _tag: "EnterpriseBadRequest", message: "SSO is not configured" },
  ])("rejects malformed or error SSO success %#", async (responseBody) => {
    fetch.mockResolvedValueOnce(Response.json(responseBody));

    await expect(authClient.startSso("ada@example.com")).resolves.toEqual({
      error: {
        message: "The authentication service returned an invalid success response",
        tag: "AuthResponseError",
      },
    });
  });

  it("accepts a valid direct SSO start response", async () => {
    const url = "https://login.microsoftonline.com/authorize";
    fetch.mockResolvedValueOnce(Response.json({ url }));

    await expect(authClient.startSso("ada@example.com")).resolves.toEqual({
      data: { url },
    });
  });

  it.each(["revoked", "already-invalid", "client-only"])(
    "accepts the sign-out action's enveloped %s result",
    async (invalidation) => {
      fetch.mockResolvedValueOnce(
        Response.json({
          _tag: "Success",
          value: { clearCredential: true, invalidation },
        }),
      );

      await expect(authClient.signOut()).resolves.toEqual({ data: { status: "ok" } });

      const [input, init] = fetch.mock.calls[0]!;
      const headers = new Headers(init?.headers);

      expect(String(input)).toBe("https://mattrax.test/api/v1/signOut");
      expect(init?.method).toBe("POST");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("x-effect-auth-csrf")).toBe("1");
      expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe("{}");
      expect((init as RequestInit & { duplex?: string }).duplex).toBeUndefined();
    },
  );

  it("treats a declared sign-out-without-revocation result as signed out", async () => {
    fetch.mockResolvedValueOnce(
      Response.json({
        _tag: "Success",
        value: { _tag: "SessionSignOutUnavailable", clearCredential: true },
      }),
    );

    await expect(authClient.signOut()).resolves.toEqual({ data: { status: "ok" } });
  });

  it.each([
    {},
    { status: "ok" },
    { clearCredential: true, invalidation: "revoked" },
    { _tag: "Success", value: { clearCredential: true } },
    { _tag: "Success", value: { clearCredential: false, invalidation: "revoked" } },
    { _tag: "Success", value: { clearCredential: true, invalidation: "expired" } },
    { _tag: "Success", value: { _tag: "SessionSignOutUnavailable" } },
  ])("rejects a malformed sign-out success %#", async (responseBody) => {
    fetch.mockResolvedValueOnce(Response.json(responseBody));

    await expect(authClient.signOut()).resolves.toEqual({
      error: {
        message: "The authentication service returned an invalid success response",
        tag: "AuthResponseError",
      },
    });
  });

  it("preserves a non-2xx sign-out failure", async () => {
    fetch.mockResolvedValueOnce(
      Response.json({ _tag: "Failure", error: { _tag: "SessionUnavailable" } }, { status: 503 }),
    );

    await expect(authClient.signOut()).resolves.toEqual({
      error: {
        message: "Your session has expired. Sign in again to continue.",
        tag: "SessionUnavailable",
      },
    });
  });

  it("rejects a direct session body from an auth-envelope endpoint", async () => {
    fetch.mockResolvedValueOnce(Response.json(session));

    await expect(authClient.session()).resolves.toEqual({
      error: {
        message: "The authentication service returned an invalid success response",
        tag: "AuthResponseError",
      },
    });
  });
});
