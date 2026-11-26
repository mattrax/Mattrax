import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installGlobals } from "../../../../packages/config/testing/globals.ts";
import { recorder } from "../../../../packages/config/testing/recorder.ts";
import { authClient } from "./auth";

const NativeRequest = globalThis.Request;
const session = {
  sessionId: "session-1",
  subjectId: "account-1",
  claims: { name: "Ada", email: "ada@example.com", emailVerified: true },
};
const fetch = recorder(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  Response.json({ status: "ok", emailSent: true }),
);

const installBrowserRequest = () =>
  class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(
        typeof input === "string" && input.startsWith("/")
          ? new URL(input, "https://mattrax.test")
          : input,
        init,
      );
    }
  };

let restoreGlobals = () => {};

beforeEach(() => {
  fetch
    .mockClear()
    .mockImplementation(async () => Response.json({ status: "ok", emailSent: true }));
  restoreGlobals = installGlobals({ Request: installBrowserRequest(), fetch });
});

afterEach(() => {
  restoreGlobals();
  restoreGlobals = () => {};
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

  const signOutWithInvalidation = async (invalidation: string) => {
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
  };

  it("accepts a revoked sign-out result", () => signOutWithInvalidation("revoked"));

  it("accepts an already-invalid sign-out result", () =>
    signOutWithInvalidation("already-invalid"));

  it("accepts a client-only sign-out result", () => signOutWithInvalidation("client-only"));

  it("treats a declared sign-out-without-revocation result as signed out", async () => {
    fetch.mockResolvedValueOnce(
      Response.json({
        _tag: "Success",
        value: { _tag: "SessionSignOutUnavailable", clearCredential: true },
      }),
    );

    await expect(authClient.signOut()).resolves.toEqual({ data: { status: "ok" } });
  });

  const rejectsMalformedSignOut = async (responseBody: unknown) => {
    fetch.mockResolvedValueOnce(Response.json(responseBody));

    await expect(authClient.signOut()).resolves.toEqual({
      error: {
        message: "The authentication service returned an invalid success response",
        tag: "AuthResponseError",
      },
    });
  };

  it("rejects an empty body", () => rejectsMalformedSignOut({}));

  it("rejects a bare ok status", () => rejectsMalformedSignOut({ status: "ok" }));

  it("rejects a direct success body without a tag", () =>
    rejectsMalformedSignOut({ clearCredential: true, invalidation: "revoked" }));

  it("rejects a success value without a clear-credential flag", () =>
    rejectsMalformedSignOut({ _tag: "Success", value: { clearCredential: true } }));

  it("rejects a success value that does not clear the credential", () =>
    rejectsMalformedSignOut({
      _tag: "Success",
      value: { clearCredential: false, invalidation: "revoked" },
    }));

  it("rejects a success value with an unknown invalidation", () =>
    rejectsMalformedSignOut({
      _tag: "Success",
      value: { clearCredential: true, invalidation: "expired" },
    }));

  it("rejects a success value without a clear-credential variant", () =>
    rejectsMalformedSignOut({ _tag: "Success", value: { _tag: "SessionSignOutUnavailable" } }));

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
