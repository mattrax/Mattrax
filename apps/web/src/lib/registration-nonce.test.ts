// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  clientRegistrationNonce,
  getRegistrationNonce,
  rememberRegistrationNonce,
  setRegistrationNonce,
} from "./registration-nonce";

describe("registration nonce store", () => {
  it("keeps a nonce per request so renders cannot share one", () => {
    const first = new Request("https://mattrax.test/register");
    const second = new Request("https://mattrax.test/register");

    setRegistrationNonce(first, "nonce-one");
    setRegistrationNonce(second, "nonce-two");

    expect(getRegistrationNonce(first)).toBe("nonce-one");
    expect(getRegistrationNonce(second)).toBe("nonce-two");
    expect(getRegistrationNonce(new Request("https://mattrax.test/login"))).toBeUndefined();
  });

  it("remembers a rotated nonce for the next mount", () => {
    rememberRegistrationNonce("rotated-nonce");

    expect(clientRegistrationNonce()).toBe("rotated-nonce");

    delete (globalThis as { __MATTRAX_REGISTRATION_NONCE__?: string })
      .__MATTRAX_REGISTRATION_NONCE__;
  });

  it("reads back the nonce serialised into the document", () => {
    (globalThis as { __MATTRAX_REGISTRATION_NONCE__?: string }).__MATTRAX_REGISTRATION_NONCE__ =
      "from-document";

    expect(clientRegistrationNonce()).toBe("from-document");

    delete (globalThis as { __MATTRAX_REGISTRATION_NONCE__?: string })
      .__MATTRAX_REGISTRATION_NONCE__;
  });
});
