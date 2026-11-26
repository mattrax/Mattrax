import { beforeAll, describe, expect, it } from "vitest";
import { Context, Effect, Exit, Fiber, Layer, Scope } from "effect";
import type { Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import {
  PubSubAuthError,
  PubSubOidcVerifier,
  PubSubOidcVerifierLive,
  base64UrlEncode,
  invalidateSharedJwks,
} from "../src/index.js";
import type { PubSubOidcVerifierConfig } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const audience = "https://mattrax.test/api/v1/android/pubsub";

const serviceAccountEmail = "android-pubsub@test-project.iam.gserviceaccount.com";

const jwksUri = "https://keys.test/jwks";

const kid = "test-key-1";

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

let privateKey: CryptoKey;

let publicJwk: JsonWebKey & { kid?: string };

let jwksResponse: () => Response;

const encoder = new TextEncoder();

function sign(
  claims: Schema.JsonObject,
  options: { kid?: string; header?: Schema.JsonObject; key?: CryptoKey } = {},
): Promise<string> {
  return (async () => {
    const header = base64UrlEncode(
      JSON.stringify(
        Object.assign({ alg: "RS256", typ: "JWT", kid: options.kid ?? kid }, options.header),
      ),
    );

    const payload = base64UrlEncode(JSON.stringify(claims));

    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      options.key ?? privateKey,
      encoder.encode(`${header}.${payload}`),
    );

    return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
  })();
}

function claims(overrides: Schema.JsonObject = {}): Schema.JsonObject {
  const now = Math.floor(Date.now() / 1000);

  return Object.assign(
    {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "1234567890",
      email: serviceAccountEmail,
      email_verified: true,
      iat: now - 10,
      exp: now + 600,
    },
    overrides,
  );
}

function scopedConfig(overrides: Partial<PubSubOidcVerifierConfig> = {}): PubSubOidcVerifierConfig {
  return {
    audience,
    serviceAccountEmail,
    jwksUri,
    jwksTimeToLive: "1 hour",
    jwksCooldown: "1 minute",
    jwksTimeout: "1 second",
    ...overrides,
  };
}

const fetchLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, async () => jwksResponse())),
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
);

const verifyEffect = (token: string, overrides: Partial<PubSubOidcVerifierConfig> = {}) =>
  Effect.gen(function* () {
    const verifier = yield* PubSubOidcVerifier;

    return yield* verifier.verify(token);
  }).pipe(
    Effect.provide(PubSubOidcVerifierLive(scopedConfig(overrides))),
    Effect.provide(fetchLayer),
  );

const verify = (token: string, overrides: Partial<PubSubOidcVerifierConfig> = {}) =>
  Effect.runPromise(verifyEffect(token, overrides));

const rejection = (token: string, overrides: Partial<PubSubOidcVerifierConfig> = {}) =>
  Effect.runPromise(Effect.flip(verifyEffect(token, overrides)));

describe("PubSubOidcVerifier", () => {
  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"] as const,
    );

    privateKey = pair.privateKey;
    publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    jwksResponse = () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
  });

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
    // Change a byte unconditionally: replacing the last two characters can be
    // a no-op when they already are "AA", which is why this test flaked.
    const replacement = signature[0] === "A" ? "B" : "A";
    const tampered = `${header}.${payload}.${replacement}${signature.slice(1)}`;
    const error = await rejection(tampered);
    expect(error.message).toContain("signature");
  });

  it("rejects a token signed by a different key", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"] as const,
    );

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
    expect((await rejection(await sign(claims(), { kid: "" }))).message).toContain("no kid");
    const token = await sign(claims(), { header: { alg: "HS256" } });
    expect((await rejection(token)).message).toContain("RS256");
  });

  it("rejects oversized tokens before verification", async () => {
    const error = await rejection("x".repeat(17 * 1024));
    expect(error.message).toContain("too large");
  });

  it("enforces the configured maximum token age", async () => {
    const now = Math.floor(Date.now() / 1000);
    const error = await rejection(await sign(claims({ iat: now - 1200, exp: now + 600 })), {
      maxAgeSeconds: 600,
    });
    expect(error.message).toContain("too old");
  });

  it("refuses to verify without an audience", async () => {
    const error = await rejection(await sign(claims()), { audience: "" });
    expect(error.message).toContain("audience is not configured");
  });

  it("caches JWKS in the verifier scope until its Effect-clock TTL expires", async () => {
    const now = 1_700_000_000;
    const token = await sign(claims({ iat: now - 10, exp: now + 3600 }));
    const mock = mockFetch(() => jwksResponse());
    const layer = PubSubOidcVerifierLive(scopedConfig({ jwksTimeToLive: "10 minutes" })).pipe(
      Layer.provide(mock.layer),
    );

    const program = Effect.gen(function* () {
      yield* TestClock.setTime(now * 1000);
      const verifier = yield* PubSubOidcVerifier;
      yield* verifier.verify(token);
      yield* TestClock.adjust("9 minutes");
      yield* verifier.verify(token);
      yield* TestClock.adjust("2 minutes");
      yield* verifier.verify(token);
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer), Effect.provide(TestClock.layer())));

    expect(mock.requests.filter((request) => request.pathname === "/jwks")).toHaveLength(2);
  });

  it("reuses one shared key set across rebuilt request layers", async () => {
    const token = await sign(claims());
    const mock = mockFetch(() => jwksResponse());
    const layer = () =>
      PubSubOidcVerifierLive(scopedConfig(), { sharedJwks: true }).pipe(Layer.provide(mock.layer));
    const verifyOnce = () =>
      Effect.gen(function* () {
        const verifier = yield* PubSubOidcVerifier;

        return yield* verifier.verify(token);
      }).pipe(Effect.provide(layer()));

    try {
      const first = await Effect.runPromise(verifyOnce());
      const second = await Effect.runPromise(verifyOnce());

      expect(second.email).toBe(first.email);
      expect(mock.requests.filter((request) => request.pathname === "/jwks")).toHaveLength(1);
    } finally {
      invalidateSharedJwks(jwksUri);
    }
  });

  it("expires a shared key set on the ambient Effect clock", async () => {
    const token = await sign(claims({ iat: 1_699_999_990, exp: 1_700_010_800 }));
    const mock = mockFetch(() => jwksResponse());
    const layer = () =>
      PubSubOidcVerifierLive(scopedConfig({ jwksTimeToLive: "1 hour" }), {
        sharedJwks: true,
      }).pipe(Layer.provide(mock.layer));
    const verifyOnce = () =>
      Effect.gen(function* () {
        const verifier = yield* PubSubOidcVerifier;

        return yield* verifier.verify(token);
      }).pipe(Effect.provide(layer()));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(1_700_000_000_000);
          yield* verifyOnce();
          yield* TestClock.adjust("2 hours");
          yield* verifyOnce();
        }).pipe(Effect.provide(TestClock.layer())),
      );

      expect(mock.requests.filter((request) => request.pathname === "/jwks")).toHaveLength(2);
    } finally {
      invalidateSharedJwks(jwksUri);
    }
  });

  it("invalidates a shared key set so the next request fetches again", async () => {
    const token = await sign(claims());
    const mock = mockFetch(() => jwksResponse());
    const layer = () =>
      PubSubOidcVerifierLive(scopedConfig(), { sharedJwks: true }).pipe(Layer.provide(mock.layer));
    const verifyOnce = () =>
      Effect.gen(function* () {
        const verifier = yield* PubSubOidcVerifier;

        return yield* verifier.verify(token);
      }).pipe(Effect.provide(layer()));

    try {
      await Effect.runPromise(verifyOnce());
      invalidateSharedJwks(jwksUri);
      await Effect.runPromise(verifyOnce());

      expect(mock.requests.filter((request) => request.pathname === "/jwks")).toHaveLength(2);
    } finally {
      invalidateSharedJwks(jwksUri);
    }
  });

  it("refreshes JWKS for an unknown key after the cooldown", async () => {
    const now = 1_700_000_000;
    const rotated = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"] as const,
    );
    const rotatedJwk: JsonWebKey & { kid?: string } = {
      ...(await crypto.subtle.exportKey("jwk", rotated.publicKey)),
    };
    rotatedJwk.kid = "rotated-key";
    rotatedJwk.alg = "RS256";
    rotatedJwk.use = "sig";

    let fetches = 0;
    const mock = mockFetch(() => {
      fetches++;

      return new Response(JSON.stringify({ keys: [fetches === 1 ? publicJwk : rotatedJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const layer = PubSubOidcVerifierLive(scopedConfig()).pipe(Layer.provide(mock.layer));
    const token = await sign(claims({ iat: now - 10, exp: now + 600 }), {
      kid: "rotated-key",
      key: rotated.privateKey,
    });

    const program = Effect.gen(function* () {
      yield* TestClock.setTime(now * 1000);
      const verifier = yield* PubSubOidcVerifier;
      const first = yield* Effect.flip(verifier.verify(token));
      const coolingDown = yield* Effect.flip(verifier.verify(token));
      expect(fetches).toBe(1);
      yield* TestClock.adjust("1 minute");
      const refreshed = yield* verifier.verify(token);
      const cached = yield* verifier.verify(token);

      return { first, coolingDown, refreshed, cached };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    );

    expect(result.first).toBeInstanceOf(PubSubAuthError);
    expect(result.first.message).toContain("signing key not found");
    expect(result.coolingDown.message).toContain("signing key not found");
    expect(result.refreshed.email).toBe(serviceAccountEmail);
    expect(result.cached.email).toBe(serviceAccountEmail);
    expect(fetches).toBe(2);
  });

  it("bounds JWKS header and body reads with a timeout", async () => {
    const now = 1_700_000_000;
    const token = await sign(claims({ iat: now - 10, exp: now + 600 }));
    const started = deferredPromise<void>();
    const mock = mockFetch(() => {
      started.resolve();

      return new Promise<Response>(() => {
        // Intentionally never settles; the Effect deadline interrupts the read.
      });
    });
    const layer = PubSubOidcVerifierLive(scopedConfig()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      yield* TestClock.setTime(now * 1000);
      const verifier = yield* PubSubOidcVerifier;
      const fiber = yield* verifier.verify(token).pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust("1 second");

      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(
      Effect.flip(program).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    );

    expect(error).toBeInstanceOf(PubSubAuthError);
    expect(error.message).toContain("timed out");
  });

  it("times out and aborts a stalled JWKS response body", async () => {
    const now = 1_700_000_000;
    const token = await sign(claims({ iat: now - 10, exp: now + 600 }));
    const started = deferredPromise<void>();
    let aborted = false;
    const mock = mockFetch((_request, init) => {
      started.resolve();
      init?.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );

      return new Response(
        new ReadableStream({
          cancel() {
            aborted = true;
          },
        }),
      );
    });
    const layer = PubSubOidcVerifierLive(scopedConfig()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      yield* TestClock.setTime(now * 1000);
      const verifier = yield* PubSubOidcVerifier;
      const fiber = yield* verifier.verify(token).pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust("1 second");

      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(
      Effect.flip(program.pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))),
    );

    expect(error).toBeInstanceOf(PubSubAuthError);
    expect(error.message).toContain("timed out");
    expect(aborted).toBe(true);
  });

  it("aborts an in-flight JWKS request when the verifier scope closes", async () => {
    const now = 1_700_000_000;
    const token = await sign(claims({ iat: now - 10, exp: now + 600 }));
    const started = deferredPromise<void>();
    let aborted = false;
    const mock = mockFetch((_request, init) => {
      started.resolve();
      init?.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );

      return new Promise<Response>(() => {
        // Intentionally never settles; closing the scope aborts the request.
      });
    });
    const layer = PubSubOidcVerifierLive(scopedConfig()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      yield* TestClock.setTime(now * 1000);
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(layer, scope);
      const verifier = Context.get(context, PubSubOidcVerifier);
      const fiber = yield* verifier.verify(token).pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* Scope.close(scope, Exit.void);

      return yield* Fiber.join(fiber);
    }).pipe(Effect.scoped);

    const error = await Effect.runPromise(
      Effect.flip(program.pipe(Effect.provide(TestClock.layer()))),
    );

    expect(aborted).toBe(true);
    expect(error).toBeInstanceOf(PubSubAuthError);
    expect(error.message).toContain("Could not load Google signing keys");
  });
});
