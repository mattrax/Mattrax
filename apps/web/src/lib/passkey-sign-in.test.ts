// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conditionalPasskeyAvailable,
  PasskeySignInError,
  startConditionalPasskey,
} from "./passkey-sign-in";

const buffer = (...values: number[]) => new Uint8Array(values).buffer;

const install = (available = true) => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: class {
      static isConditionalMediationAvailable = () => Promise.resolve(available);
    },
  });
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get: vi.fn() },
  });
};

const assertion = () => ({
  id: "credential-1",
  type: "public-key",
  rawId: buffer(1, 2, 3),
  authenticatorAttachment: "platform",
  response: {
    clientDataJSON: buffer(0x7b, 0x7d),
    authenticatorData: buffer(1),
    signature: buffer(0xff, 0xfe),
    userHandle: null,
  },
  getClientExtensionResults: () => ({ credProps: { rk: true } }),
});

beforeEach(() => install());

afterEach(() => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "credentials", { configurable: true, value: undefined });
});

describe("conditional passkey sign-in", () => {
  it("reports availability from the browser capability probe", async () => {
    await expect(conditionalPasskeyAvailable()).resolves.toBe(true);
  });

  it("reports unavailable when the capability probe throws", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: class {
        static isConditionalMediationAvailable = () => Promise.reject(new Error("denied"));
      },
    });

    await expect(conditionalPasskeyAvailable()).resolves.toBe(false);
  });

  it("serialises an assertion in the shape the completion endpoint accepts", async () => {
    const signal = new AbortController().signal;
    vi.mocked(navigator.credentials.get).mockResolvedValue(assertion() as Credential);

    await expect(
      startConditionalPasskey(
        { challenge: "AQID", timeout: 60_000, userVerification: "preferred" },
        signal,
      ),
    ).resolves.toEqual({
      id: "credential-1",
      rawId: "AQID",
      type: "public-key",
      response: {
        clientDataJSON: "e30",
        authenticatorData: "AQ",
        signature: "__4",
        userHandle: undefined,
      },
      clientExtensionResults: { credProps: { rk: true } },
      authenticatorAttachment: "platform",
    });

    expect(navigator.credentials.get).toHaveBeenCalledWith(
      expect.objectContaining({
        mediation: "conditional",
        signal,
        publicKey: expect.objectContaining({
          challenge: new Uint8Array([1, 2, 3]),
          allowCredentials: [],
          timeout: 60_000,
          userVerification: "preferred",
        }),
      }),
    );
  });

  it("refuses to start when the browser cannot offer conditional passkeys", async () => {
    install(false);

    await expect(
      startConditionalPasskey({ challenge: "AQID" }, new AbortController().signal),
    ).rejects.toBeInstanceOf(PasskeySignInError);
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });
});
