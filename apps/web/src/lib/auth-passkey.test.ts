// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webAuthn = vi.hoisted(() => ({ startAuthentication: vi.fn() }));

vi.mock("@simplewebauthn/browser", () => webAuthn);
vi.mock("@solidjs/web", () => ({ isServer: false, getRequestEvent: () => undefined }));
vi.mock("~/lib/posthog", () => ({ capturePostHog: vi.fn() }));
import { authClient } from "./auth";

const NativeRequest = globalThis.Request;
const fetchMock = vi.fn();
const requestStart = {
  flowId: "flow-1",
  expiresAtMillis: Date.now() + 60_000,
  options: { challenge: "challenge" },
};

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

const installEnvironment = () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: class PublicKeyCredential {},
  });
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get: vi.fn() },
  });
};

beforeEach(() => {
  installBrowserRequest();
  installEnvironment();
  fetchMock.mockReset();
  webAuthn.startAuthentication.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("passkey sign-in ceremony", () => {
  it("does not start a server flow when WebAuthn is unavailable", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });

    await expect(authClient.passkeySignIn()).resolves.toEqual({
      error: {
        tag: "PasskeyUnsupported",
        message: expect.stringContaining("HTTPS"),
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(webAuthn.startAuthentication).not.toHaveBeenCalled();
  });

  it("preserves a cancellation tag and never calls completion", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ _tag: "Success", value: requestStart }));
    webAuthn.startAuthentication.mockRejectedValueOnce(
      new DOMException("The operation was canceled.", "NotAllowedError"),
    );

    await expect(authClient.passkeySignIn()).resolves.toEqual({
      error: {
        tag: "PasskeyCancelled",
        message: expect.stringContaining("cancelled"),
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/beginPasskeySignIn");
  });

  it("preserves a missing-authenticator tag without claiming rejection", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ _tag: "Success", value: requestStart }));
    webAuthn.startAuthentication.mockRejectedValueOnce(
      new DOMException("No available authenticator", "NotAllowedError"),
    );

    const result = await authClient.passkeySignIn();

    expect(result.error?.tag).toBe("PasskeyNoAuthenticator");
    expect(result.error?.message).not.toContain("wasn't accepted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves an actual server rejection tag", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ _tag: "Success", value: requestStart }))
      .mockResolvedValueOnce(
        Response.json({ _tag: "Failure", error: { _tag: "PasskeyRejected" } }, { status: 400 }),
      );
    webAuthn.startAuthentication.mockResolvedValueOnce({
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      response: {
        authenticatorData: "data",
        clientDataJSON: "data",
        signature: "signature",
        userHandle: undefined,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    });

    await expect(authClient.passkeySignIn()).resolves.toMatchObject({
      error: { tag: "PasskeyRejected" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/completePasskeySignIn");
  });
});
