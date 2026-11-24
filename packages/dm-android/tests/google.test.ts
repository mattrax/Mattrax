import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  ANDROID_MANAGEMENT_SCOPE,
  GoogleApiError,
  GoogleAuth,
  GoogleAuthError,
  GoogleAuthLive,
  buildServiceAccountJwt,
} from "../src/index.js";
import type { ServiceAccountConfig } from "../src/index.js";
import { decodeJwt, jsonResponse, makeServiceAccount, mockFetch, verifyJwt } from "./helpers.js";
import type { ServiceAccountFixture } from "./helpers.js";

const tokenUri = "https://oauth.test/token";

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

let account: ServiceAccountFixture;

function config(overrides: Partial<ServiceAccountConfig> = {}): ServiceAccountConfig {
  return {
    clientEmail: account.clientEmail,
    privateKeyPem: account.privateKeyPem,
    projectId: account.projectId,
    tokenUri,
    ...overrides,
  };
}

function pendingResponse(
  started: ReturnType<typeof deferredPromise<void>>,
  onAbort: () => void = () => undefined,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;

    started.resolve();

    if (signal === undefined || signal === null) return;

    const abort = () => {
      onAbort();
      reject(signal.reason);
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

describe("google service account auth", () => {
  beforeAll(async () => {
    account = await makeServiceAccount();
  });

  it("builds an RS256 JWT with the Android Management scope", async () => {
    const issuedAt = 1_700_000_000;

    const jwt = await Effect.runPromise(
      buildServiceAccountJwt({
        clientEmail: account.clientEmail,
        privateKeyPem: account.privateKeyPem,
        audience: tokenUri,
        issuedAt,
      }),
    );

    expect(jwt.split(".")).toHaveLength(3);
    const decoded = decodeJwt(jwt);
    expect(decoded.header).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(decoded.claims).toMatchObject({
      iss: account.clientEmail,
      scope: ANDROID_MANAGEMENT_SCOPE,
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    });
    await expect(verifyJwt(jwt, account.publicKey)).resolves.toBe(true);
  });

  it("accepts PEM private keys with escaped newlines", async () => {
    const jwt = await Effect.runPromise(
      buildServiceAccountJwt({
        clientEmail: account.clientEmail,
        privateKeyPem: account.privateKeyPem.replaceAll("\n", String.raw`\n`),
        audience: tokenUri,
      }),
    );

    await expect(verifyJwt(jwt, account.publicKey)).resolves.toBe(true);
  });

  it("exchanges a JWT and caches the token until 60s before expiry", async () => {
    const mock = mockFetch(() =>
      jsonResponse({ access_token: "ya29.token", expires_in: 3600, token_type: "Bearer" }),
    );

    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const first = yield* auth.accessToken();
      const second = yield* auth.accessToken();

      return { first, second };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(result.first.accessToken).toBe("ya29.token");
    expect(result.second.accessToken).toBe("ya29.token");
    expect(result.first.expiresAt).toBeGreaterThan(Date.now());
    const tokenRequests = mock.requests.filter((request) => request.pathname === "/token");
    expect(tokenRequests).toHaveLength(1);

    const body = new URLSearchParams(tokenRequests[0].body);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = body.get("assertion");
    expect(assertion?.split(".")).toHaveLength(3);
    expect(decodeJwt(assertion!).claims).toMatchObject({
      aud: tokenUri,
      scope: ANDROID_MANAGEMENT_SCOPE,
    });
  });

  it("refreshes a token that is within 60 seconds of expiry", async () => {
    let issued = 0;

    const mock = mockFetch(() => {
      issued++;

      return jsonResponse({ access_token: `ya29.${issued}`, expires_in: 30 });
    });

    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const first = yield* auth.accessToken();
      const second = yield* auth.accessToken();

      return { first: first.accessToken, second: second.accessToken };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toEqual({ first: "ya29.1", second: "ya29.2" });
    expect(mock.requests.filter((request) => request.pathname === "/token")).toHaveLength(2);
  });

  it("uses expires_in minus the expiry skew with the Effect clock", async () => {
    let issued = 0;
    const mock = mockFetch(() =>
      jsonResponse({ access_token: `ya29.${++issued}`, expires_in: 120 }),
    );
    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const first = yield* auth.accessToken();
      yield* TestClock.adjust("59 seconds");
      const cached = yield* auth.accessToken();
      yield* TestClock.adjust("1 second");
      const refreshed = yield* auth.accessToken();

      return { first, cached, refreshed };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    );

    expect(result.first.accessToken).toBe("ya29.1");
    expect(result.first.expiresAt).toBe(60_000);
    expect(result.cached.accessToken).toBe("ya29.1");
    expect(result.refreshed.accessToken).toBe("ya29.2");
    expect(mock.requests.filter((request) => request.pathname === "/token")).toHaveLength(2);

    const assertion = new URLSearchParams(mock.requests[0]?.body).get("assertion");
    expect(decodeJwt(assertion!).claims["iat"]).toBe(0);
  });

  it("shares one in-flight token refresh across concurrent callers", async () => {
    const started = deferredPromise<void>();
    const response = deferredPromise<Response>();
    const mock = mockFetch((request) => {
      if (request.pathname !== "/token") throw new Error("Unexpected request");

      started.resolve();

      return response.promise;
    });
    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const fibers = yield* Effect.forEach(
        Array.from({ length: 5 }, () => auth.accessToken()),
        (request) => request.pipe(Effect.forkChild),
      );

      yield* Effect.promise(() => started.promise);
      expect(mock.requests.filter((request) => request.pathname === "/token")).toHaveLength(1);

      response.resolve(jsonResponse({ access_token: "ya29.shared", expires_in: 3600 }));

      return yield* Effect.forEach(fibers, Fiber.join);
    });

    const tokens = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(tokens.map((token) => token.accessToken)).toEqual([
      "ya29.shared",
      "ya29.shared",
      "ya29.shared",
      "ya29.shared",
      "ya29.shared",
    ]);
    expect(mock.requests.filter((request) => request.pathname === "/token")).toHaveLength(1);
  });

  it("cancels a shared token refresh only after every waiter is interrupted", async () => {
    const started = deferredPromise<void>();
    let aborted = false;
    const mock = mockFetch((_request, init) =>
      pendingResponse(
        started,
        () => {
          aborted = true;
        },
        init,
      ),
    );
    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const first = yield* auth.accessToken().pipe(Effect.forkChild);
      const second = yield* auth.accessToken().pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(first);
      expect(aborted).toBe(false);
      yield* Fiber.interrupt(second);
      expect(aborted).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  });

  it("invalidates a cached token after a 401 response", async () => {
    let issued = 0;
    let apiCalls = 0;
    const mock = mockFetch((request) => {
      if (request.pathname === "/token") {
        return jsonResponse({ access_token: `ya29.${++issued}`, expires_in: 3600 });
      }

      apiCalls++;

      return apiCalls === 1
        ? jsonResponse({ error: { message: "expired token" } }, 401)
        : jsonResponse({ name: "enterprises/LC123" });
    });
    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const request = {
        url: "https://android.test/v1/enterprises/LC123",
        schema: Schema.Struct({ name: Schema.String }),
      } as const;
      const firstError = yield* Effect.flip(auth.authorizedFetch(request));
      const second = yield* auth.authorizedFetch(request);

      return { firstError, second };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    const apiRequests = mock.requests.filter((request) => request.pathname !== "/token");

    expect(result.firstError).toMatchObject({ status: 401 });
    expect(result.second.name).toBe("enterprises/LC123");
    expect(apiRequests.map((request) => request.headers.get("authorization"))).toEqual([
      "Bearer ya29.1",
      "Bearer ya29.2",
    ]);
    expect(mock.requests.filter((request) => request.pathname === "/token")).toHaveLength(2);
  });

  it("times out token headers with a typed error", async () => {
    const started = deferredPromise<void>();
    const mock = mockFetch((_request, init) => pendingResponse(started, undefined, init));
    const layer = GoogleAuthLive(
      config({ httpTimeouts: { headers: "1 second", body: "1 second" } }),
    ).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const fiber = yield* auth.accessToken().pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust("1 second");

      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(
      Effect.flip(program).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    );

    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error.message).toContain("token request timed out waiting for headers");
  });

  it("times out and aborts a stalled token response body", async () => {
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
    const layer = GoogleAuthLive(
      config({ httpTimeouts: { headers: "1 second", body: "1 second" } }),
    ).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const fiber = yield* auth.accessToken().pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust("1 second");

      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(
      Effect.flip(program).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    );

    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error.message).toContain("token response body timed out");
    expect(aborted).toBe(true);
  });

  it("times out and cancels a stalled API response body", async () => {
    const started = deferredPromise<void>();
    let cancelled = false;
    const mock = mockFetch((request, init) => {
      if (request.pathname === "/token") {
        return jsonResponse({ access_token: "ya29.abc", expires_in: 3600 });
      }

      started.resolve();
      init?.signal?.addEventListener(
        "abort",
        () => {
          cancelled = true;
        },
        { once: true },
      );

      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      );
    });
    const layer = GoogleAuthLive(
      config({ httpTimeouts: { headers: "1 second", body: "1 second" } }),
    ).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const fiber = yield* auth
        .authorizedFetch({
          url: "https://android.test/v1/stalled",
          schema: Schema.Struct({}),
        })
        .pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust("1 second");

      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(
      Effect.flip(program).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    );

    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error.message).toContain("response body timed out");
    expect(cancelled).toBe(true);
  });

  it("aborts an API request when its parent fiber is interrupted", async () => {
    const started = deferredPromise<void>();
    let aborted = false;
    const mock = mockFetch((request, init) => {
      if (request.pathname === "/token") {
        return jsonResponse({ access_token: "ya29.abc", expires_in: 3600 });
      }

      return pendingResponse(
        started,
        () => {
          aborted = true;
        },
        init,
      );
    });
    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      const fiber = yield* auth
        .authorizedFetch({
          url: "https://android.test/v1/stalled",
          schema: Schema.Struct({}),
        })
        .pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(aborted).toBe(true);
  });

  it("surfaces token endpoint errors with the HTTP status", async () => {
    const mock = mockFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "Invalid JWT" }, 401),
    );

    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;

      return yield* auth.accessToken();
    });

    const error = await Effect.runPromise(Effect.flip(program).pipe(Effect.provide(layer)));
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(error.message).toContain("invalid_grant");
  });

  it("authorizedFetch attaches the bearer token and decodes JSON", async () => {
    const mock = mockFetch((request) => {
      if (request.pathname === "/token") {
        return jsonResponse({ access_token: "ya29.abc", expires_in: 3600, token_type: "Bearer" });
      }

      return jsonResponse({ name: "enterprises/LC123" });
    });

    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;

      return yield* auth.authorizedFetch({
        method: "GET",
        url: "https://android.test/v1/enterprises/LC123",
        schema: Schema.Struct({ name: Schema.String }),
        label: "getEnterprise",
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result.name).toBe("enterprises/LC123");

    const apiRequest = mock.requests.find(
      (request) => request.pathname === "/v1/enterprises/LC123",
    );

    expect(apiRequest?.headers.get("authorization")).toBe("Bearer ya29.abc");
  });

  it("authorizedFetch reports API errors with status and message", async () => {
    const mock = mockFetch((request) => {
      if (request.pathname === "/token") {
        return jsonResponse({ access_token: "ya29.abc", expires_in: 3600 });
      }

      return jsonResponse(
        { error: { code: 403, message: "Caller is not authorized", status: "PERMISSION_DENIED" } },
        403,
      );
    });

    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;

      return yield* auth.authorizedFetch({
        method: "GET",
        url: "https://android.test/v1/enterprises/LC123",
        schema: Schema.Struct({ name: Schema.String }),
        label: "getEnterprise",
      });
    });

    const error = await Effect.runPromise(Effect.flip(program).pipe(Effect.provide(layer)));
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error).toMatchObject({ status: 403 });
    expect(error.message).toContain("Caller is not authorized");
  });

  it("authorizedFetch rejects an empty response body", async () => {
    const mock = mockFetch((request) =>
      request.pathname === "/token"
        ? jsonResponse({ access_token: "ya29.abc", expires_in: 3600 })
        : new Response(null, { status: 200 }),
    );

    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;

      return yield* auth.authorizedFetch({
        method: "GET",
        url: "https://android.test/v1/empty",
        schema: Schema.Struct({}),
      });
    });

    const error = await Effect.runPromise(Effect.flip(program).pipe(Effect.provide(layer)));
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error.message).toContain("empty body");
  });

  it("authorizedFetchVoid accepts 204 without a body", async () => {
    const mock = mockFetch((request) =>
      request.pathname === "/token"
        ? jsonResponse({ access_token: "ya29.abc", expires_in: 3600 })
        : new Response(null, { status: 204 }),
    );

    const layer = GoogleAuthLive(config()).pipe(Layer.provide(mock.layer));

    const program = Effect.gen(function* () {
      const auth = yield* GoogleAuth;
      yield* auth.authorizedFetchVoid({
        method: "DELETE",
        url: "https://android.test/v1/enterprises/LC123/devices/1",
        label: "deleteDevice",
      });
    });

    await expect(Effect.runPromise(program.pipe(Effect.provide(layer)))).resolves.toBeUndefined();
  });

  it("rejects an invalid PKCS#8 private key", async () => {
    const result = await Effect.runPromise(
      Effect.flip(
        buildServiceAccountJwt({
          clientEmail: account.clientEmail,
          privateKeyPem: "not a pem",
        }),
      ),
    );

    expect(result).toBeInstanceOf(GoogleAuthError);
  });
});
