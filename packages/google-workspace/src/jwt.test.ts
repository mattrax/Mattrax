import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { GOOGLE_DIRECTORY_SCOPES, GOOGLE_TOKEN_URL, signServiceAccountAssertion } from "./jwt.js";

const base64UrlDecode = (value: string) =>
  Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");

const makeKeyPair = async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString(
    "base64",
  );

  const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);

  return {
    pair,
    publicKey,
    pem: `-----BEGIN PRIVATE KEY-----\n${privateKey.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`,
  };
};

describe("Google service-account assertions", () => {
  it("signs an RS256 JWT with domain-wide delegation claims", async () => {
    const { pair, publicKey, pem } = await makeKeyPair();

    const result = await Effect.runPromise(
      signServiceAccountAssertion({
        serviceAccount: { clientEmail: "sync@project.iam.gserviceaccount.com", privateKeyPem: pem },
        adminEmail: "Admin@Example.com",
        issuedAt: 1_700_000_000_000,
      }),
    );

    const [header, payload, signature] = result.assertion.split(".");
    expect(JSON.parse(base64UrlDecode(header))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(base64UrlDecode(payload))).toEqual({
      iss: "sync@project.iam.gserviceaccount.com",
      sub: "admin@example.com",
      scope: GOOGLE_DIRECTORY_SCOPES,
      aud: GOOGLE_TOKEN_URL,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      Buffer.from(signature.replaceAll("-", "+").replaceAll("_", "/"), "base64"),
      new TextEncoder().encode(`${header}.${payload}`),
    );

    expect(valid).toBe(true);
    expect(publicKey.byteLength).toBeGreaterThan(0);
    expect(result.expiresAt - result.issuedAt).toBe(3_600);
  });

  it("caps the assertion lifetime at one hour", async () => {
    const { pem } = await makeKeyPair();

    await expect(
      Effect.runPromise(
        signServiceAccountAssertion({
          serviceAccount: { clientEmail: "sync@example.com", privateKeyPem: pem },
          adminEmail: "admin@example.com",
          lifetimeSeconds: 3_601,
        }),
      ),
    ).rejects.toThrow(/between 1 and 3600/);
  });

  it("uses the Effect clock when issuance time is not supplied", async () => {
    const { pem } = await makeKeyPair();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_123);

        return yield* signServiceAccountAssertion({
          serviceAccount: { clientEmail: "sync@example.com", privateKeyPem: pem },
          adminEmail: "admin@example.com",
        });
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(result.issuedAt).toBe(1_700_000_000);
    expect(result.expiresAt).toBe(1_700_003_600);
  });

  it("rejects a non-PKCS#8 key without echoing it", async () => {
    const secret = "-----BEGIN RSA PRIVATE KEY-----\nnot-a-key\n-----END RSA PRIVATE KEY-----";

    const error = await Effect.runPromise(
      Effect.flip(
        signServiceAccountAssertion({
          serviceAccount: { clientEmail: "sync@example.com", privateKeyPem: secret },
          adminEmail: "admin@example.com",
        }),
      ),
    );

    expect(error.message).toMatch(/PKCS#8/);
    expect(error.message).not.toContain("not-a-key");
  });
});
