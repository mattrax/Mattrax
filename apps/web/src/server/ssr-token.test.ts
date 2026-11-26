import type { SsrRevisionPayload, SsrTokenPayload } from "@mattrax/enterprise-domain/client";
import { ssrSessionFingerprint } from "@mattrax/enterprise-domain/client";
import { describe, expect, it } from "vitest";
import { verifySsrRevision, verifySsrToken } from "./ssr-token";

const secret = "edge-verify-test-secret";

/** One fixed clock for every time-bearing fixture and verifier call. */
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/** Mirrors the API's HMAC encoding so the edge verifier is exercised for real. */
type SignedPayload =
  | SsrTokenPayload
  | SsrRevisionPayload
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
  iat: NOW,
  exp: NOW + 300_000,
  ver: "revision-1",
  account: {
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

/** Every verification uses the fixed clock instead of the ambient one. */
const verifyToken = (token: string, cookie: string | undefined) =>
  verifySsrToken(secret, token, cookie, NOW);

const verifyRevision = (token: string) => verifySsrRevision(secret, token, NOW);

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
    const result = await verifyToken(token, sessionCookie);

    expect(result?.sub).toBe("user-1");
    expect(result?.tenants?.[0]?.permissions).toEqual(["tenant.read", "devices.read"]);
  });

  it("rejects a token bound to a different session cookie", async () => {
    const token = await bound();

    expect(await verifyToken(token, "rotated-cookie")).toBeUndefined();
  });

  it("rejects a token when the session cookie is missing", async () => {
    const token = await bound();

    // Without the cookie there is no binding to check, so the verifier must
    // fail closed rather than skip the fingerprint comparison.
    expect(await verifyToken(token, undefined)).toBeUndefined();
    expect(await verifyToken(token, "")).toBeUndefined();
  });

  it("accepts a token whose tenant list was omitted for size", async () => {
    const token = await bound({ tenants: undefined });

    expect((await verifyToken(token, sessionCookie))?.tenants).toBeUndefined();
  });

  it("rejects an expired token", async () => {
    const token = await bound({ exp: NOW - 1 });

    expect(await verifyToken(token, sessionCookie)).toBeUndefined();
    // The boundary is inclusive: expiring at NOW is already a miss, while one
    // millisecond past it is still a valid token.
    expect(await verifyToken(await bound({ exp: NOW }), sessionCookie)).toBeUndefined();
    expect(await verifyToken(await bound({ exp: NOW + 1 }), sessionCookie)).toBeDefined();
  });

  it("rejects a tampered signature or body", async () => {
    const token = await bound();
    const [body, signature] = token.split(".");
    const tamperedSignature = `${body}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    const tamperedPayload = await bound({ sub: "user-2" });

    expect(await verifyToken(tamperedSignature, sessionCookie)).toBeUndefined();
    expect(
      await verifyToken(`${tamperedPayload.split(".")[0]}.${signature}`, sessionCookie),
    ).toBeUndefined();
    expect(await verifyToken(body, sessionCookie)).toBeUndefined();
  });

  it("rejects a token minted for another purpose", async () => {
    const token = await sign({
      purpose: "password-reset",
      sub: "user-1",
      email: "owner@example.com",
      exp: NOW + 60_000,
    });

    expect(await verifyToken(token, sessionCookie)).toBeUndefined();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await sign(payload(), "different-secret");

    expect(await verifyToken(token, sessionCookie)).toBeUndefined();
  });

  it("rejects malformed input without throwing", async () => {
    for (const token of ["", "not-a-token", "a.b.c", "."]) {
      expect(await verifyToken(token, sessionCookie)).toBeUndefined();
    }
  });
});

const revision = (overrides: Partial<SsrRevisionPayload> = {}): SsrRevisionPayload => ({
  purpose: "ssr-rev",
  sid: "session-1",
  ver: "revision-1",
  iat: NOW - 1_000,
  exp: NOW + 240_000,
  ...overrides,
});

describe("edge SSR revision verification", () => {
  it("accepts a signed, unexpired revision", async () => {
    const token = await sign(revision());
    const payload = await verifyRevision(token);

    expect(payload).toMatchObject({ sid: "session-1", ver: "revision-1" });
  });

  it("rejects an expired revision", async () => {
    const token = await sign(revision({ exp: NOW - 1 }));

    expect(await verifyRevision(token)).toBeUndefined();
    // Same inclusive boundary as the shell token verifier.
    expect(await verifyRevision(await sign(revision({ exp: NOW })))).toBeUndefined();
    expect(await verifyRevision(await sign(revision({ exp: NOW + 1 })))).toBeDefined();
  });

  it("rejects a tampered body or signature", async () => {
    const token = await sign(revision());
    const [body, signature] = token.split(".");
    const tampered = await sign(revision({ ver: "revision-2" }));
    const tamperedSignature = `${body}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    expect(await verifyRevision(tamperedSignature)).toBeUndefined();
    expect(await verifyRevision(`${tampered.split(".")[0]}.${signature}`)).toBeUndefined();
  });

  it("rejects another purpose or another secret", async () => {
    const wrongPurpose = await sign({
      purpose: "ssr",
      sub: "session-1",
      email: "owner@example.com",
      exp: NOW + 60_000,
    });

    expect(await verifyRevision(wrongPurpose)).toBeUndefined();
    expect(await verifyRevision(await sign(revision(), "other-secret"))).toBeUndefined();
  });

  it("rejects malformed input without throwing", async () => {
    for (const token of ["", ".", "a.b.c", "not-a-token"]) {
      expect(await verifyRevision(token)).toBeUndefined();
    }
  });
});
