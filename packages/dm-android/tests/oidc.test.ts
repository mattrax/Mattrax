import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  base64UrlEncode,
  clearJwksCache,
  verifyPubSubOidcToken,
  type PubSubOidcVerifierConfig,
} from "../src/index.js";

const audience = "https://mattrax.test/api/v1/android/pubsub";
const serviceAccountEmail = "android-pubsub@test-project.iam.gserviceaccount.com";
const jwksUri = "https://keys.test/jwks";
const kid = "test-key-1";

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;
let jwksResponse: () => Response;

const encoder = new TextEncoder();

function sign(
  claims: Record<string, unknown>,
  options: { kid?: string; header?: Record<string, unknown> } = {},
): Promise<string> {
  return (async () => {
    const header = base64UrlEncode(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: options.kid ?? kid, ...options.header }),
    );

    const payload = base64UrlEncode(JSON.stringify(claims));

    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privateKey,
      encoder.encode(`${header}.${payload}`),
    );

    return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
  })();
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);

  return {
    iss: "https://accounts.google.com",
    aud: audience,
    sub: "1234567890",
    email: serviceAccountEmail,
    email_verified: true,
    iat: now - 10,
    exp: now + 600,
    ...overrides,
  };
}

function config(overrides: Partial<PubSubOidcVerifierConfig> = {}): PubSubOidcVerifierConfig {
  return {
    audience,
    serviceAccountEmail,
    jwksUri,
    fetch: (async () => jwksResponse()) as typeof globalThis.fetch,
    ...overrides,
  };
}

const verify = (token: string, overrides: Partial<PubSubOidcVerifierConfig> = {}) =>
  Effect.runPromise(verifyPubSubOidcToken(token, config(overrides)));

const rejection = (token: string, overrides: Partial<PubSubOidcVerifierConfig> = {}) =>
  Effect.runPromise(Effect.flip(verifyPubSubOidcToken(token, config(overrides))));

describe("verifyPubSubOidcToken", () => {
  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    privateKey = pair.privateKey;
    publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const jwk = publicJwk as Record<string, unknown>;
    jwk["kid"] = kid;
    jwk["alg"] = "RS256";
    jwk["use"] = "sig";
    jwksResponse = () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
  });

  beforeEach(() => clearJwksCache());

  it("accepts a valid Google-signed token", async () => {
    const result = await verify(await sign(claims()));
    expect(result.email).toBe(serviceAccountEmail);
    expect(result.issuer).toBe("https://accounts.google.com");
    expect(result.audience).toBe(audience);
    expect(result.emailVerified).toBe(true);
  });

  it("accepts the legacy issuer form", async () => {
    const result = await verify(await sign(claims({ iss: "accounts.google.com" })));
    expect(result.issuer).toBe("accounts.google.com");
  });

  it("rejects an untrusted issuer", async () => {
    const error = await rejection(await sign(claims({ iss: "https://evil.test" })));
    expect(error.message).toContain("issuer");
  });

  it("rejects a mismatched audience", async () => {
    const error = await rejection(await sign(claims({ aud: "https://other.test/pubsub" })));
    expect(error.message).toContain("audience");
  });

  it("rejects an unexpected service account", async () => {
    const error = await rejection(await sign(claims({ email: "other@example.test" })));
    expect(error.message).toContain("service account");
  });

  it("rejects a modified signature", async () => {
    const token = await sign(claims());
    const [header, payload, signature] = token.split(".");
    const tampered = `${header}.${payload}.${signature!.slice(0, -2)}AA`;
    const error = await rejection(tampered);
    expect(error.message).toContain("signature");
  });

  it("rejects a token signed by a different key", async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const header = base64UrlEncode(JSON.stringify({ alg: "RS256", kid }));
    const payload = base64UrlEncode(JSON.stringify(claims()));

    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      pair.privateKey,
      encoder.encode(`${header}.${payload}`),
    );

    const error = await rejection(
      `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`,
    );

    expect(error.message).toContain("signature");
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const error = await rejection(await sign(claims({ iat: now - 1200, exp: now - 600 })));
    expect(error.message).toContain("expired");
  });

  it("rejects tokens with an unknown key id", async () => {
    const error = await rejection(await sign(claims(), { kid: "rotated-away" }));
    expect(error.message).toContain("signing key");
  });

  it("rejects malformed tokens and non-RS256 algorithms", async () => {
    expect((await rejection("not-a-token")).message).toContain("malformed");
    const token = await sign(claims(), { header: { alg: "HS256" } });
    expect((await rejection(token)).message).toContain("RS256");
  });

  it("refuses to verify without an audience", async () => {
    const error = await rejection(await sign(claims()), { audience: "" });
    expect(error.message).toContain("audience is not configured");
  });
});
