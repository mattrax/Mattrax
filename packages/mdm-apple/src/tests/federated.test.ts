import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  federatedAuthServiceUrl,
  federatedIssuer,
  federatedJwksUri,
  federatedRealm,
  isFederatedToken,
  unverifiedFederatedTenantId,
  validateFederatedEntraToken,
  type FederatedJsonWebKeySet,
} from "@mattrax/mdm-windows";

const tenantId = "11111111-1111-1111-1111-111111111111";

const audience = "22222222-2222-2222-2222-222222222222";

const base64Url = (value: Uint8Array | string): string => {
  const bytes = Schema.is(Schema.String)(value) ? new TextEncoder().encode(value) : value;
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

type SigningKey = {
  privateKey: CryptoKey;
  jwks: FederatedJsonWebKeySet;
};

const makeKey = async (kid = "test-key"): Promise<SigningKey> => {
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

  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  return {
    privateKey: pair.privateKey,
    jwks: {
      keys: [
        {
          kty: "RSA",
          kid,
          use: "sig",
          alg: "RS256",
          n: publicJwk.n!,
          e: publicJwk.e!,
        },
      ],
    },
  };
};

const signToken = async (
  key: SigningKey,
  claims: Schema.JsonObject,
  options: { alg?: string; kid?: string; signature?: Uint8Array } = {},
): Promise<string> => {
  const header = base64Url(
    JSON.stringify({ alg: options.alg ?? "RS256", typ: "JWT", kid: options.kid ?? "test-key" }),
  );

  const payload = base64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;

  const signature =
    options.signature ??
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        key.privateKey,
        new TextEncoder().encode(signingInput),
      ),
    );

  return `${signingInput}.${base64Url(signature)}`;
};

const claims = (overrides: Schema.JsonObject = {}) =>
  Object.assign(
    {
      iss: federatedIssuer(tenantId),
      aud: audience,
      tid: tenantId,
      sub: "subject-1",
      oid: "object-1",
      preferred_username: "user@contoso.com",
      exp: Math.floor(Date.now() / 1000) + 3_600,
      nbf: Math.floor(Date.now() / 1000) - 10,
      iat: Math.floor(Date.now() / 1000) - 10,
    },
    overrides,
  );

const validate = async (
  token: string,
  key: SigningKey,
  overrides: Partial<Parameters<typeof validateFederatedEntraToken>[0]> = {},
) =>
  validateFederatedEntraToken({
    token,
    tenantId,
    audience,
    jwks: key.jwks,
    ...overrides,
  });

describe("federated Entra token validation", () => {
  it("accepts a valid RS256 token for the configured tenant and audience", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims());
    const result = await validate(token, key);

    expect(result.ok).toBe(true);

    if (!result.ok) return;
    expect(result.claims).toMatchObject({
      tenantId,
      audience: [audience],
      subject: "object-1",
      userPrincipalName: "user@contoso.com",
    });
  });

  it("rejects a token signed by a different key", async () => {
    const signer = await makeKey();
    const verifier = await makeKey("other-key");
    const token = await signToken(signer, claims());
    const result = await validate(token, verifier);

    expect(result).toMatchObject({ ok: false, reason: "signature" });
  });

  it("rejects a tampered signature", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims(), { signature: new Uint8Array(256) });
    const result = await validate(token, key);

    expect(result).toMatchObject({ ok: false, reason: "signature" });
  });

  it("rejects a mismatched issuer", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims({ iss: "https://evil.example/v2.0" }));
    const result = await validate(token, key);

    expect(result).toMatchObject({ ok: false, reason: "issuer" });
  });

  it("accepts the v1 issuer for the same tenant", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims({ iss: `https://sts.windows.net/${tenantId}/` }));
    const result = await validate(token, key);

    expect(result.ok).toBe(true);
  });

  it("rejects a mismatched audience", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims({ aud: "some-other-api" }));
    const result = await validate(token, key);

    expect(result).toMatchObject({ ok: false, reason: "audience" });
  });

  it("rejects a token issued for another tenant", async () => {
    const key = await makeKey();
    const otherTenant = "33333333-3333-3333-3333-333333333333";

    const token = await signToken(
      key,
      claims({ tid: otherTenant, iss: federatedIssuer(otherTenant) }),
    );

    const result = await validate(token, key);

    expect(result).toMatchObject({ ok: false, reason: "tenant" });
  });

  it("rejects an expired token", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims({ exp: Math.floor(Date.now() / 1000) - 3_600 }));
    const result = await validate(token, key);

    expect(result).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects a token that is not valid yet", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims({ nbf: Math.floor(Date.now() / 1000) + 3_600 }));
    const result = await validate(token, key);

    expect(result).toMatchObject({ ok: false, reason: "not_yet_valid" });
  });

  it("rejects malformed tokens and unsupported algorithms", async () => {
    const key = await makeKey();
    expect(await validate("not-a-jwt", key)).toMatchObject({ ok: false, reason: "malformed" });

    const token = await signToken(key, claims(), { alg: "HS256" });
    expect(await validate(token, key)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("routes by the unverified tenant claim but still requires verification", async () => {
    const key = await makeKey();
    const token = await signToken(key, claims());
    expect(isFederatedToken(token)).toBe(true);
    expect(unverifiedFederatedTenantId(token)).toBe(tenantId);
    expect(isFederatedToken("opaque")).toBe(false);
  });

  it("builds tenant-specific issuer, JWKS and auth-service URLs", () => {
    expect(federatedIssuer(tenantId)).toBe(`https://login.microsoftonline.com/${tenantId}/v2.0`);
    expect(federatedJwksUri(tenantId)).toContain(`/${tenantId}/discovery/v2.0/keys`);
    expect(federatedRealm(tenantId)).toBe(tenantId);
    const authUrl = new URL(federatedAuthServiceUrl(tenantId, { clientId: "client-1" }));
    expect(authUrl.pathname).toBe(`/${tenantId}/wsfed`);
    expect(authUrl.searchParams.get("wtrealm")).toBe("client-1");
  });
});
