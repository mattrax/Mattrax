import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";
import {
  ANDROID_MANAGEMENT_SCOPE,
  GoogleAuth,
  GoogleAuthLive,
  buildServiceAccountJwt,
  type ServiceAccountConfig,
} from "../src/index.js";
import {
  decodeJwt,
  jsonResponse,
  makeServiceAccount,
  mockFetch,
  verifyJwt,
  type ServiceAccountFixture,
} from "./helpers.js";

const tokenUri = "https://oauth.test/token";
let account: ServiceAccountFixture;

function config(): ServiceAccountConfig {
  return {
    clientEmail: account.clientEmail,
    privateKeyPem: account.privateKeyPem,
    projectId: account.projectId,
    tokenUri,
  };
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
        privateKeyPem: account.privateKeyPem.replace(/\n/g, "\\n"),
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

    const body = new URLSearchParams(tokenRequests[0]!.body);
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
    expect(error).toMatchObject({ _tag: "GoogleApiError", status: 401 });
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
    expect(error).toMatchObject({ _tag: "GoogleApiError", status: 403 });
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
    expect(error).toMatchObject({ _tag: "GoogleApiError" });
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

    expect(result).toMatchObject({ _tag: "GoogleAuthError" });
  });
});
