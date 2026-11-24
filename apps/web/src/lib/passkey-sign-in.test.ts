// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  passkeyAuthenticationFailure,
  passkeyEnvironmentAvailable,
  passkeyEnvironmentFailure,
  passkeySignInFailureMessage,
} from "./passkey-sign-in";

const originalSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(window, "PublicKeyCredential");
const originalCredentials = Object.getOwnPropertyDescriptor(navigator, "credentials");

const setEnvironment = (available: boolean) => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: available });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: available ? class PublicKeyCredential {} : undefined,
  });
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: available ? { get: vi.fn() } : undefined,
  });
};

beforeEach(() => {
  setEnvironment(true);
});

afterEach(() => {
  for (const [target, key, descriptor] of [
    [window, "isSecureContext", originalSecureContext],
    [window, "PublicKeyCredential", originalPublicKeyCredential],
    [navigator, "credentials", originalCredentials],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

describe("passkey environment", () => {
  it("requires WebAuthn, credentials.get, and a secure context", () => {
    expect(passkeyEnvironmentAvailable()).toBe(true);
    expect(passkeyEnvironmentFailure()).toBeNull();

    setEnvironment(false);

    expect(passkeyEnvironmentAvailable()).toBe(false);
    expect(passkeyEnvironmentFailure()).toMatchObject({
      tag: "PasskeyUnsupported",
      message: expect.stringContaining("HTTPS"),
    });
  });
});

describe("passkey authentication failures", () => {
  it("recognises a dismissed or timed-out NotAllowedError", () => {
    const failure = passkeyAuthenticationFailure(
      new DOMException("The operation was canceled.", "NotAllowedError"),
    );

    expect(failure.tag).toBe("PasskeyCancelled");
    expect(failure.message).not.toContain("wasn't accepted");
  });

  it("recognises an unavailable authenticator instead of blaming a passkey", () => {
    const failure = passkeyAuthenticationFailure(
      new DOMException("No available authenticator was found.", "NotAllowedError"),
    );

    expect(failure.tag).toBe("PasskeyNoAuthenticator");
    expect(failure.message).toContain("No passkey option was available");
    expect(failure.message).not.toContain("wasn't accepted");
  });

  it("covers both cancellation and a missing prompt for overloaded Safari errors", () => {
    const failure = passkeyAuthenticationFailure(new DOMException("", "NotAllowedError"));

    expect(failure.tag).toBe("PasskeyNotAllowed");
    expect(failure.message).toContain("If no prompt appeared");
    expect(failure.message).not.toContain("wasn't accepted");
  });

  it("treats Safari's blanket NotAllowedError as no-prompt, not cancellation", () => {
    // The exact message Safari/WebKit and Chromium use when a ceremony cannot
    // start. It contains "not allowed" and "denied permission", but no prompt
    // was shown, so it must stay actionable instead of reading as a cancel.
    const failure = passkeyAuthenticationFailure(
      new DOMException(
        "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
        "NotAllowedError",
      ),
    );

    expect(failure.tag).toBe("PasskeyNotAllowed");
    expect(failure.message).toContain("If no prompt appeared");
    expect(failure.message).not.toContain("cancelled");
  });

  it("still maps an explicit denied request or timeout to cancellation", () => {
    expect(
      passkeyAuthenticationFailure(
        new DOMException("The user denied the request.", "NotAllowedError"),
      ).tag,
    ).toBe("PasskeyCancelled");
    expect(
      passkeyAuthenticationFailure(new DOMException("The operation timed out.", "NotAllowedError"))
        .tag,
    ).toBe("PasskeyCancelled");
  });

  it("unwraps SimpleWebAuthn errors without leaking the browser message", () => {
    const failure = passkeyAuthenticationFailure(
      new Error("private-provider-detail", {
        cause: new DOMException(
          "No available authenticator: private-provider-detail",
          "NotAllowedError",
        ),
      }),
    );

    expect(failure.tag).toBe("PasskeyNoAuthenticator");
    expect(failure.message).not.toContain("private-provider-detail");
  });

  it("distinguishes unsupported and blocked WebAuthn", () => {
    expect(
      passkeyAuthenticationFailure(new DOMException("Unsupported", "NotSupportedError")).tag,
    ).toBe("PasskeyUnsupported");
    expect(passkeyAuthenticationFailure(new DOMException("Blocked", "SecurityError")).tag).toBe(
      "PasskeyBlocked",
    );
    expect(
      passkeyAuthenticationFailure(new Error("WebAuthn is not supported in this browser")).tag,
    ).toBe("PasskeyUnsupported");
  });

  it("keeps unknown authenticator failures actionable", () => {
    const failure = passkeyAuthenticationFailure(new DOMException("secret", "UnknownError"));

    expect(failure.tag).toBe("PasskeyNoAuthenticator");
    expect(failure.message).toContain("Try another authenticator");
    expect(failure.message).not.toContain("secret");
  });
});

describe("passkey failure copy", () => {
  it("only calls a server-rejected credential unaccepted", () => {
    expect(passkeySignInFailureMessage("PasskeyRejected")).toContain("wasn't accepted");

    for (const tag of [
      "PasskeyCancelled",
      "PasskeyNotAllowed",
      "PasskeyNoAuthenticator",
      "PasskeyUnsupported",
      "PasskeyBlocked",
      undefined,
    ])
      expect(passkeySignInFailureMessage(tag)).not.toContain("wasn't accepted");
  });

  it("offers the existing email recovery path without account claims", () => {
    const message = passkeySignInFailureMessage("PasskeyUnsupported");

    expect(message).toContain("email recovery link");
    expect(message).not.toContain("account");
  });
});
