import type { SsrTokenPayload } from "@mattrax/enterprise-domain/client";
import { ssrSessionFingerprint } from "@mattrax/enterprise-domain/client";
import { describe, expect, it } from "vitest";
import { verifySsrToken } from "./ssr-token";

const secret = "edge-verify-test-secret";

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/** Mirrors the API's HMAC encoding so the edge verifier is exercised for real. */
type SignedPayload =
  | SsrTokenPayload
  | { purpose: string; sub: string; email: string; exp: number };

const sign = async (payload: SignedPayload, key = secret) => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(body));

  return `${body}.${base64Url(new Uint8Array(signature))}`;
};

const payload = (overrides: Partial<SsrTokenPayload> = {}): SsrTokenPayload => ({
  purpose: "ssr",
  sub: "user-1",
  email: "owner@example.com",
  emailVerified: true,
  name: "Owner",
  sid: "session-1",
  ch: "session-cookie-fingerprint",
  iat: Date.now(),
  exp: Date.now() + 300_000,
  ver: "revision-1",
  user: {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    mfaEnabled: false,
    totpEnabled: false,
    passkeyEnabled: false,
    mfaRequired: false,
  },
  tenants: [
    {
      id: "tenant-1",
      name: "Acme",
      slug: "acme",
      role: "owner",
      roleId: null,
      roleName: "Owner",
      roleKind: "built-in",
      permissions: ["tenant.read", "devices.read"],
      logo: null,
      displayName: null,
      brandColor: null,
    },
  ],
  ...overrides,
});

const sessionCookie = "session-cookie-1";

const bound = async (overrides: Partial<SsrTokenPayload> = {}) =>
  sign(
    payload({
      ch: await ssrSessionFingerprint(secret, sessionCookie),
      ...overrides,
    }),
  );

describe("edge SSR token verification", () => {
  it("accepts a valid token and returns the decoded shell", async () => {
    const token = await bound();
    const result = await verifySsrToken(secret, token, sessionCookie);

    expect(result?.sub).toBe("user-1");
    expect(result?.tenants?.[0]?.permissions).toEqual(["tenant.read", "devices.read"]);
  });

  it("rejects a token bound to a different session cookie", async () => {
    const token = await bound();

    expect(await verifySsrToken(secret, token, "rotated-cookie")).toBeUndefined();
  });

  it("rejects a token when the session cookie is missing", async () => {
    const token = await bound();

    // Without the cookie there is no binding to check, so the verifier must
    // fail closed rather than skip the fingerprint comparison.
    expect(await verifySsrToken(secret, token, undefined)).toBeUndefined();
    expect(await verifySsrToken(secret, token, "")).toBeUndefined();
  });

  it("accepts a token whose tenant list was omitted for size", async () => {
    const token = await bound({ tenants: undefined });

    expect((await verifySsrToken(secret, token, sessionCookie))?.tenants).toBeUndefined();
  });

  it("rejects an expired token", async () => {
    const token = await bound({ exp: Date.now() - 1 });

    expect(await verifySsrToken(secret, token, sessionCookie)).toBeUndefined();
  });

  it("rejects a tampered signature or body", async () => {
    const token = await bound();
    const [body, signature] = token.split(".");
    const tamperedSignature = `${body}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;
    const tamperedPayload = await bound({ sub: "user-2" });

    expect(await verifySsrToken(secret, tamperedSignature, sessionCookie)).toBeUndefined();
    expect(
      await verifySsrToken(
        secret,
        `${tamperedPayload.split(".")[0]}.${signature}`,
        sessionCookie,
      ),
    ).toBeUndefined();
    expect(await verifySsrToken(secret, body!, sessionCookie)).toBeUndefined();
  });

  it("rejects a token minted for another purpose", async () => {
    const token = await sign({
      purpose: "password-reset",
      sub: "user-1",
      email: "owner@example.com",
      exp: Date.now() + 60_000,
    });

    expect(await verifySsrToken(secret, token, sessionCookie)).toBeUndefined();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await sign(payload(), "different-secret");

    expect(await verifySsrToken(secret, token, sessionCookie)).toBeUndefined();
  });

  it("rejects malformed input without throwing", async () => {
    for (const token of ["", "not-a-token", "a.b.c", "."]) {
      expect(await verifySsrToken(secret, token, sessionCookie)).toBeUndefined();
    }
  });
});
