import { beforeAll, describe, expect, it } from "vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { AzureOidc, AzureOidcError, AzureOidcLive, JsonWebKey, azureIssuer } from "../src/index.js";
import type { AzureOidcConfig } from "../src/index.js";

const tenantId = "11111111-1111-1111-1111-111111111111";

const audience = "api://mattrax";

const kid = "test-key-1";

let sharedPair: CryptoKeyPair;

let sharedJwk: JsonWebKey;

function base64Url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = Schema.is(Schema.String)(data)
    ? new TextEncoder().encode(data)
    : data instanceof Uint8Array
      ? data
      : new Uint8Array(data);

  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(/=+$/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  return buffer;
}

function base64UrlToBytes(input: string): Uint8Array {
  const binary = atob(
    input
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(input.length + ((4 - (input.length % 4)) % 4), "="),
  );

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function makeKeyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );

  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  const decoded = Schema.decodeUnknownSync(JsonWebKey)({
    ...jwk,
    kid,
    kty: "RSA",
    use: "sig",
    alg: "RS256",
  });

  return { pair, jwk: decoded };
}

async function signJwt(
  privateKey: CryptoKey,
  claims: Schema.JsonObject,
  header: Schema.JsonObject = {},
) {
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid, ...header }));
  const encodedPayload = base64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    privateKey,
    toArrayBuffer(new TextEncoder().encode(signingInput)),
  );

  return `${signingInput}.${base64Url(signature)}`;
}

function mockAzureLayer(jwks: Schema.Json, counters?: { discovery: number; jwks: number }) {
  const discovery = {
    issuer: azureIssuer(tenantId),
    jwks_uri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  };

  const fetch: typeof globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;

    if (url.endsWith("/.well-known/openid-configuration")) {
      if (counters) counters.discovery++;

      return new Response(JSON.stringify(discovery), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/discovery/v2.0/keys")) {
      if (counters) counters.jwks++;

      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  };

  return FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)));
}

function runWithOidc<A, E>(
  effect: Effect.Effect<A, E, AzureOidc>,
  jwks: Schema.Json,
  counters?: { discovery: number; jwks: number },
  overrides: AzureOidcConfig = {},
) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        AzureOidcLive({ cacheTtlMs: 60_000, ...overrides }).pipe(
          Layer.provide(mockAzureLayer(jwks, counters)),
        ),
      ),
    ),
  );
}

function runWithOidcClock<A, E>(
  effect: Effect.Effect<A, E, AzureOidc>,
  jwks: Schema.Json,
  counters?: { discovery: number; jwks: number },
  overrides: AzureOidcConfig = {},
) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        AzureOidcLive({ cacheTtlMs: 60_000, ...overrides }).pipe(
          Layer.provide(mockAzureLayer(jwks, counters)),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ),
  );
}

describe("AzureOidc", () => {
  beforeAll(async () => {
    const { pair, jwk } = await makeKeyPair();
    sharedPair = pair;
    sharedJwk = jwk;
  });

  it("fetches discovery and JWKS through the Effect HTTP client", async () => {
    const counters = { discovery: 0, jwks: 0 };

    const result = await runWithOidc(
      Effect.gen(function* () {
        const oidc = yield* AzureOidc;
        const discovery = yield* oidc.discovery(tenantId);
        const keys = yield* oidc.jwks(tenantId);

        return { discovery, keys };
      }),
      { keys: [sharedJwk] },
      counters,
    );

    expect(result.discovery.issuer).toBe(azureIssuer(tenantId));
    expect(result.keys.keys[0]?.kid).toBe(kid);
    expect(counters).toEqual({ discovery: 1, jwks: 1 });
  });

  it("validates a signed Azure AD v2 JWT", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await signJwt(sharedPair.privateKey, {
      iss: azureIssuer(tenantId),
      aud: audience,
      exp: now + 3600,
      nbf: now - 60,
      iat: now,
      tid: tenantId,
      sub: "subject-1",
      preferred_username: "device@example.com",
    });

    const parts = token.split(".");

    const imported = await crypto.subtle.importKey(
      "jwk",
      { kty: sharedJwk.kty, n: sharedJwk.n, e: sharedJwk.e, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    expect(
      await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        imported,
        toArrayBuffer(base64UrlToBytes(parts[2])),
        toArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
      ),
    ).toBe(true);

    const claims = await runWithOidc(
      Effect.gen(function* () {
        const oidc = yield* AzureOidc;

        return yield* oidc.validateJwt(token, { tenantIds: [tenantId], audience });
      }),
      { keys: [sharedJwk] },
    );

    expect(claims.tid).toBe(tenantId);
    expect(claims.preferred_username).toBe("device@example.com");
  });

  it("rejects wrong audience", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await signJwt(sharedPair.privateKey, {
      iss: azureIssuer(tenantId),
      aud: "wrong",
      exp: now + 3600,
      tid: tenantId,
      sub: "subject-1",
    });

    await expect(
      runWithOidc(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.validateJwt(token, { tenantIds: [tenantId], audience });
        }),
        { keys: [sharedJwk] },
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
  });

  it("rejects wrong tenant", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await signJwt(sharedPair.privateKey, {
      iss: azureIssuer(tenantId),
      aud: audience,
      exp: now + 3600,
      tid: tenantId,
      sub: "subject-1",
    });

    await expect(
      runWithOidc(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.validateJwt(token, {
            tenantIds: ["22222222-2222-2222-2222-222222222222"],
            audience,
          });
        }),
        { keys: [sharedJwk] },
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await signJwt(sharedPair.privateKey, {
      iss: azureIssuer(tenantId),
      aud: audience,
      exp: now - 10,
      tid: tenantId,
      sub: "subject-1",
    });

    await expect(
      runWithOidc(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.validateJwt(token, {
            tenantIds: [tenantId],
            audience,
            clockToleranceSeconds: 0,
          });
        }),
        { keys: [sharedJwk] },
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
  });

  it("refreshes JWKS when the token kid is missing", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await signJwt(sharedPair.privateKey, {
      iss: azureIssuer(tenantId),
      aud: audience,
      exp: now + 3600,
      tid: tenantId,
      sub: "subject-1",
    });

    let calls = 0;

    const fetch: typeof globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;

      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            issuer: azureIssuer(tenantId),
            jwks_uri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
          }),
          { status: 200 },
        );
      }

      calls++;

      return new Response(JSON.stringify({ keys: calls === 1 ? [] : [sharedJwk] }), {
        status: 200,
      });
    };

    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    );

    const claims = await Effect.runPromise(
      Effect.gen(function* () {
        const oidc = yield* AzureOidc;

        return yield* oidc.validateJwt(token, { tenantIds: [tenantId], audience });
      }).pipe(Effect.provide(AzureOidcLive({ cooldownMs: 0 }).pipe(Layer.provide(layer)))),
    );

    expect(claims.sub).toBe("subject-1");
    expect(calls).toBe(2);
  });
});

describe("AzureOidc bounded JWKS caching", () => {
  beforeAll(async () => {
    if (sharedPair === undefined) {
      const { pair, jwk } = await makeKeyPair();
      sharedPair = pair;
      sharedJwk = jwk;
    }
  });

  it("expires discovery and JWKS entries according to TestClock", async () => {
    const counters = { discovery: 0, jwks: 0 };

    await runWithOidcClock(
      Effect.gen(function* () {
        const oidc = yield* AzureOidc;

        yield* oidc.discovery(tenantId);
        yield* oidc.jwks(tenantId);
        yield* TestClock.adjust("59 seconds");
        yield* oidc.discovery(tenantId);
        yield* oidc.jwks(tenantId);
        yield* TestClock.adjust("2 seconds");
        yield* oidc.discovery(tenantId);
        yield* oidc.jwks(tenantId);
      }),
      { keys: [sharedJwk] },
      counters,
    );

    expect(counters).toEqual({ discovery: 2, jwks: 2 });
  });

  it("coalesces concurrent discovery and JWKS requests", async () => {
    const token = await signJwt(sharedPair.privateKey, {
      iss: azureIssuer(tenantId),
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 3_600,
      tid: tenantId,
      sub: "subject-1",
    });
    const started = Deferred.makeUnsafe<void>();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const counters = { discovery: 0, jwks: 0 };
    const discovery = {
      issuer: azureIssuer(tenantId),
      jwks_uri: "https://login.microsoftonline.com/" + tenantId + "/discovery/v2.0/keys",
    };
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;

      if (url.endsWith("/.well-known/openid-configuration")) {
        counters.discovery++;

        return new Response(JSON.stringify(discovery), { status: 200 });
      }

      counters.jwks++;
      Deferred.doneUnsafe(started, Effect.void);
      await gate;

      return new Response(JSON.stringify({ keys: [sharedJwk] }), { status: 200 });
    };
    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    );

    const claims = await Effect.runPromise(
      Effect.gen(function* () {
        const oidc = yield* AzureOidc;
        const validations = yield* Effect.all(
          Array.from({ length: 8 }, () =>
            oidc.validateJwt(token, { tenantIds: [tenantId], audience }),
          ),
          { concurrency: "unbounded" },
        ).pipe(Effect.forkChild({ startImmediately: true }));

        yield* Deferred.await(started);

        for (let i = 0; i < 10; i++) yield* Effect.yieldNow;

        release();

        return yield* Fiber.join(validations);
      }).pipe(Effect.provide(AzureOidcLive().pipe(Layer.provide(layer)))),
    );

    expect(claims).toHaveLength(8);
    expect(counters).toEqual({ discovery: 1, jwks: 1 });
  });

  it("refreshes an unknown key after the cooldown and picks up rotation", async () => {
    const token = await signJwt(sharedPair.privateKey, {
      iss: azureIssuer(tenantId),
      aud: audience,
      exp: 100_000,
      tid: tenantId,
      sub: "subject-1",
    });
    const counters = { discovery: 0, jwks: 0 };
    let includeKey = false;
    const discovery = {
      issuer: azureIssuer(tenantId),
      jwks_uri: "https://login.microsoftonline.com/" + tenantId + "/discovery/v2.0/keys",
    };
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;

      if (url.endsWith("/.well-known/openid-configuration")) {
        counters.discovery++;

        return new Response(JSON.stringify(discovery), { status: 200 });
      }

      counters.jwks++;

      return new Response(JSON.stringify({ keys: includeKey ? [sharedJwk] : [] }), {
        status: 200,
      });
    };
    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    );

    const exits = await Effect.runPromise(
      Effect.gen(function* () {
        const oidc = yield* AzureOidc;
        const validate = () =>
          Effect.exit(oidc.validateJwt(token, { tenantIds: [tenantId], audience }));
        const first = yield* validate();
        const second = yield* validate();
        yield* TestClock.adjust("29 seconds");
        const third = yield* validate();
        yield* Effect.sync(() => {
          includeKey = true;
        });
        yield* TestClock.adjust("1 second");
        const fourth = yield* validate();

        return { first, second, third, fourth };
      }).pipe(
        Effect.provide(
          AzureOidcLive({ cacheTtlMs: 60_000, cooldownMs: 30_000 }).pipe(Layer.provide(layer)),
        ),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(Exit.isSuccess(exits.first)).toBe(false);
    expect(Exit.isSuccess(exits.second)).toBe(false);
    expect(Exit.isSuccess(exits.third)).toBe(false);
    expect(Exit.isSuccess(exits.fourth)).toBe(true);
    expect(counters.jwks).toBe(2);
  });

  it("applies the cooldown after a failed JWKS fetch", async () => {
    const counters = { discovery: 0, jwks: 0 };
    const discovery = {
      issuer: azureIssuer(tenantId),
      jwks_uri: "https://login.microsoftonline.com/" + tenantId + "/discovery/v2.0/keys",
    };
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;

      if (url.endsWith("/.well-known/openid-configuration")) {
        counters.discovery++;

        return new Response(JSON.stringify(discovery), { status: 200 });
      }

      counters.jwks++;

      return counters.jwks === 1
        ? new Response("unavailable", { status: 503 })
        : new Response(JSON.stringify({ keys: [sharedJwk] }), { status: 200 });
    };
    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    );

    const exits = await Effect.runPromise(
      Effect.gen(function* () {
        const oidc = yield* AzureOidc;
        const first = yield* Effect.exit(oidc.jwks(tenantId));
        const second = yield* Effect.exit(oidc.jwks(tenantId));
        yield* TestClock.adjust("30 seconds");
        const third = yield* Effect.exit(oidc.jwks(tenantId));

        return { first, second, third };
      }).pipe(
        Effect.provide(
          AzureOidcLive({ cacheTtlMs: 60_000, cooldownMs: 30_000 }).pipe(Layer.provide(layer)),
        ),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(Exit.isSuccess(exits.first)).toBe(false);
    expect(Exit.isSuccess(exits.second)).toBe(false);
    expect(Exit.isSuccess(exits.third)).toBe(true);
    expect(counters.jwks).toBe(2);
  });

  it("bounds the JWKS response body", async () => {
    await expect(
      runWithOidc(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.jwks(tenantId);
        }),
        { keys: [sharedJwk] },
        undefined,
        { maxResponseBytes: 300 },
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
  });

  it("bounds the number of JWKS keys", async () => {
    await expect(
      runWithOidc(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.jwks(tenantId);
        }),
        { keys: [sharedJwk, { ...sharedJwk, kid: "test-key-2" }] },
        undefined,
        { maxKeys: 1 },
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
  });

  it("rejects malformed JWKS documents", async () => {
    await expect(
      runWithOidc(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.jwks(tenantId);
        }),
        { keys: "not an array" },
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
  });

  it("rejects a discovery document that points JWKS at another origin", async () => {
    let attackerCalls = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;

      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            issuer: azureIssuer(tenantId),
            jwks_uri: "https://attacker.example/keys",
          }),
          { status: 200 },
        );
      }

      attackerCalls++;

      return new Response(JSON.stringify({ keys: [sharedJwk] }), { status: 200 });
    };
    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.jwks(tenantId);
        }).pipe(Effect.provide(AzureOidcLive().pipe(Layer.provide(layer)))),
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
    expect(attackerCalls).toBe(0);
  });

  it("bounds untrusted token length before decoding or fetching keys", async () => {
    const counters = { discovery: 0, jwks: 0 };

    await expect(
      runWithOidc(
        Effect.gen(function* () {
          const oidc = yield* AzureOidc;

          return yield* oidc.validateJwt("a".repeat(20_000), {
            tenantIds: [tenantId],
            audience,
          });
        }),
        { keys: [sharedJwk] },
        counters,
      ),
    ).rejects.toBeInstanceOf(AzureOidcError);
    expect(counters).toEqual({ discovery: 0, jwks: 0 });
  });
});
