import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import { EnterpriseService } from "@mattrax/enterprise-domain";
import { describe, expect, it } from "vitest";
import { mcpOAuthRoutes, validRedirectUri } from "@mattrax/enterprise-api";
import { makeDb } from "./helpers.js";

const origin = "https://app.test";

const sessionCookie = "__Host-mattrax_session=opaque-session";

const me = {
  account: { id: "account-1", name: "Owner", email: "owner@example.com" },
  tenants: [
    {
      id: "tenant-1",
      name: "Acme",
      role: "owner",
      permissions: [
        "tenant.read",
        "tenant.write",
        "devices.read",
        "devices.write",
        "devices.command",
        "devices.recovery_key",
        "policies.read",
        "policies.write",
      ],
    },
  ],
};

const makeHandler = (db: ReturnType<typeof makeDb>, user: typeof me | null = me) =>
  HttpRouter.toWebHandler(
    mcpOAuthRoutes({ origin }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(Db, db),
          // SAFETY: only `me` is consulted by the OAuth consent path.
          Layer.succeed(EnterpriseService, {
            me: () => (user ? Effect.succeed(user) : Effect.fail(new Error("signed out"))),
          } as any),
        ),
      ),
    ),
  ).handler;

const addClient = (
  db: ReturnType<typeof makeDb>,
  id: string,
  redirectUris: ReadonlyArray<string>,
  name = "MCP client",
) => {
  db.store.mcp_oauth_client.push({
    id,
    name,
    redirectUris: [...redirectUris],
    createdAt: new Date(),
    lastUsedAt: null,
  });
};

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const sha256 = async (value: string) =>
  base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

/** A valid RFC 7636 verifier and the S256 challenge derived from it. */
const pkce = async () => {
  const verifier = "test-verifier-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdef";

  return { verifier, challenge: await sha256(verifier) };
};

const authorizeUrl = (params: Record<string, string>) => {
  const url = new URL(`${origin}/api/oauth/authorize`);

  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  return url.toString();
};

const emptyContext = Context.makeUnsafe<any>(new Map());

const getConsent = (
  handler: ReturnType<typeof makeHandler>,
  params: Record<string, string>,
  options: { session?: string | null } = {},
) => {
  const headers = new Headers();

  if (options.session !== null) headers.set("cookie", options.session ?? sessionCookie);

  return handler(new Request(authorizeUrl(params), { headers }), emptyContext);
};

const postForm = (
  handler: ReturnType<typeof makeHandler>,
  path: string,
  values: Record<string, string>,
  options: { session?: string | null; origin?: string } = {},
) => {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });

  if (options.session !== null) headers.set("cookie", options.session ?? sessionCookie);

  if (options.origin) headers.set("origin", options.origin);

  return handler(
    new Request(`${origin}${path}`, {
      method: "POST",
      headers,
      body: new URLSearchParams(values).toString(),
    }),
    emptyContext,
  );
};

const JsonObject = Schema.Record(Schema.String, Schema.Json);

const body = async (response: Response) =>
  Schema.decodeUnknownSync(JsonObject)(await response.json());

const TokenPair = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
});

const tokenPair = async (response: Response) =>
  Schema.decodeUnknownSync(TokenPair)(await response.json());

/** Register a client and complete the consent form, returning the issued code. */
const issueCode = async (
  db: ReturnType<typeof makeDb>,
  options: { clientId?: string; redirectUri?: string; verifier?: string } = {},
) => {
  const clientId = options.clientId ?? "mcp_client_test";
  const redirectUri = options.redirectUri ?? "https://client.example/callback";
  const handler = makeHandler(db);
  const { verifier, challenge } = await pkce();
  const codeVerifier = options.verifier ?? verifier;

  addClient(db, clientId, [redirectUri]);

  const consent = await getConsent(handler, {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-1",
  });

  expect(consent.status).toBe(200);

  const approval = await postForm(handler, "/api/oauth/authorize", {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-1",
    decision: "approve",
  });

  expect(approval.status).toBe(302);
  const location = new URL(approval.headers.get("location")!);

  expect(location.origin).toBe("https://client.example");
  expect(location.searchParams.get("state")).toBe("state-1");

  return {
    handler,
    clientId,
    redirectUri,
    verifier: codeVerifier,
    code: location.searchParams.get("code")!,
  };
};

const exchange = (handler: ReturnType<typeof makeHandler>, values: Record<string, string>) =>
  postForm(handler, "/api/oauth/token", values, { session: null });

describe("MCP OAuth redirect URI validation", () => {
  it("requires exact registered URIs and refuses an open redirect", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { challenge } = await pkce();

    addClient(db, "mcp_client_test", ["https://client.example/callback"]);

    for (const redirectUri of [
      // Prefix, suffix, extra path, different subdomain and case variants are
      // all distinct URIs; none may be used.
      "https://client.example/callback/",
      "https://client.example/callback/extra",
      "https://client.example.evil.test/callback",
      "https://CLIENT.example/callback",
      "https://client.example/callback?next=https://evil.test",
      "http://client.example/callback",
    ]) {
      const response = await getConsent(handler, {
        client_id: "mcp_client_test",
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
      });

      expect(response.status, redirectUri).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("binds a redirect URI to the client that registered it", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { challenge } = await pkce();

    addClient(db, "client-a", ["https://a.example/callback"]);
    addClient(db, "client-b", ["https://b.example/callback"]);

    const response = await getConsent(handler, {
      client_id: "client-a",
      redirect_uri: "https://b.example/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects fragments, credentials and non-loopback http at registration", async () => {
    const db = makeDb();
    const handler = makeHandler(db);

    for (const uri of [
      "https://client.example/callback#fragment",
      "https://user:pass@client.example/callback",
      "http://client.example/callback",
      "ftp://client.example/callback",
      "not-a-url",
    ]) {
      const response = await handler(
        new Request(`${origin}/api/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_name: "Test", redirect_uris: [uri] }),
        }),
        emptyContext,
      );

      expect(response.status, uri).toBe(400);
      expect(await body(response)).toMatchObject({ error: "invalid_redirect_uri" });
    }

    expect(db.store.mcp_oauth_client).toHaveLength(0);
  });

  it("accepts https and loopback http and refuses a secret-bearing public client", async () => {
    const db = makeDb();
    const handler = makeHandler(db);

    const created = await handler(
      new Request(`${origin}/api/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Test",
          redirect_uris: ["https://client.example/callback", "http://127.0.0.1:33418/cb"],
        }),
      }),
      emptyContext,
    );

    expect(created.status).toBe(201);
    expect(await body(created)).toMatchObject({ token_endpoint_auth_method: "none" });

    const secretClient = await handler(
      new Request(`${origin}/api/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      }),
      emptyContext,
    );

    expect(secretClient.status).toBe(400);
    expect(validRedirectUri("https://client.example/callback")).toBe(true);
    expect(validRedirectUri("https://client.example/callback#x")).toBe(false);
  });
});

describe("MCP OAuth authorization request", () => {
  it("requires an S256 PKCE challenge", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { challenge } = await pkce();

    addClient(db, "mcp_client_test", ["https://client.example/callback"]);

    const invalidChallenges: Array<Record<string, string>> = [
      {},
      { code_challenge: challenge, code_challenge_method: "plain" },
      { code_challenge: "too-short", code_challenge_method: "S256" },
      { code_challenge: "a".repeat(43), code_challenge_method: "S256 " },
    ];

    for (const params of invalidChallenges) {
      const response = await getConsent(handler, {
        client_id: "mcp_client_test",
        redirect_uri: "https://client.example/callback",
        response_type: "code",
        ...params,
      });

      expect(response.status).toBe(400);
    }
  });

  it("sends a signed-out browser to login without redirecting to the client", async () => {
    const db = makeDb();
    const handler = makeHandler(db, null);
    const { challenge } = await pkce();

    addClient(db, "mcp_client_test", ["https://client.example/callback"]);

    const response = await getConsent(
      handler,
      {
        client_id: "mcp_client_test",
        redirect_uri: "https://client.example/callback",
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "state-1",
      },
      { session: null },
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);

    expect(location.origin).toBe(origin);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toContain("/api/oauth/authorize");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("escapes client-controlled text in the consent page", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { challenge } = await pkce();

    addClient(db, "mcp_client_test", ["https://client.example/callback"], '<script>"x"</script>');

    const response = await getConsent(handler, {
      client_id: "mcp_client_test",
      redirect_uri: "https://client.example/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const html = await response.text();

    expect(response.status).toBe(200);
    // The consent page owns one inline script for the permission controls; the
    // client-controlled name must never become executable markup.
    expect(html).not.toContain('<script>"x"</script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("lets the user narrow an MCP connection to selected permissions", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { verifier, challenge } = await pkce();
    const clientId = "mcp_client_permissions";
    const redirectUri = "https://client.example/callback";

    addClient(db, clientId, [redirectUri]);

    const consent = await getConsent(handler, {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const page = await consent.text();
    expect(page).toContain('data-group-control="devices"');
    expect(page).toContain('value="devices.write"');
    expect(page).toContain('value="policies.read"');

    const approval = await postForm(handler, "/api/oauth/authorize", {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      decision: "approve",
      permissions_field: "1",
      permission: "devices.write",
    });

    expect(approval.status).toBe(302);
    expect(db.store.mcp_oauth_connection).toHaveLength(1);
    expect(db.store.mcp_oauth_connection[0]).toMatchObject({
      clientId,
      // The write grant implies the read companion.
      scopes: ["devices.read", "devices.write"],
    });

    // The code exchange still works and the connection keeps the narrowed set.
    const location = new URL(approval.headers.get("location")!);

    const tokenResponse = await exchange(handler, {
      grant_type: "authorization_code",
      client_id: clientId,
      code: location.searchParams.get("code")!,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

    expect(tokenResponse.status).toBe(200);
    expect(db.store.mcp_oauth_connection[0]!.scopes).toEqual(["devices.read", "devices.write"]);
  });

  it("rejects a cross-origin consent decision", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { challenge } = await pkce();
    const clientId = "mcp_client_csrf";
    const redirectUri = "https://client.example/callback";

    addClient(db, clientId, [redirectUri]);

    const response = await postForm(
      handler,
      "/api/oauth/authorize",
      {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        decision: "approve",
        permissions_field: "1",
        permission: "devices.read",
      },
      { origin: "https://evil.test" },
    );

    expect(response.status).toBe(403);
    expect(db.store.mcp_oauth_connection).toHaveLength(0);
  });

  it("keeps the legacy full grant when an older client omits the permission fields", async () => {
    const db = makeDb();
    const { handler } = await issueCode(db);

    expect(handler).toBeDefined();
    expect(db.store.mcp_oauth_connection[0]!.scopes).toEqual(["mcp"]);
  });

  it("rejects a tampered form and an unsupported challenge method", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { challenge, verifier } = await pkce();

    addClient(db, "mcp_client_test", ["https://client.example/callback"]);

    const tampered = await postForm(handler, "/api/oauth/authorize", {
      client_id: "mcp_client_test",
      redirect_uri: "https://evil.test/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      decision: "approve",
    });

    expect(tampered.status).toBe(400);
    expect(tampered.headers.get("location")).toBeNull();

    const plain = await postForm(handler, "/api/oauth/authorize", {
      client_id: "mcp_client_test",
      redirect_uri: "https://client.example/callback",
      response_type: "code",
      code_challenge: verifier,
      code_challenge_method: "plain",
      decision: "approve",
    });

    expect(plain.status).toBe(400);
    expect(db.store.mcp_oauth_code).toHaveLength(0);
  });

  it("redirects a denial to the exact registered URI with the state", async () => {
    const db = makeDb();
    const handler = makeHandler(db);
    const { challenge } = await pkce();

    addClient(db, "mcp_client_test", ["https://client.example/callback"]);

    const response = await postForm(handler, "/api/oauth/authorize", {
      client_id: "mcp_client_test",
      redirect_uri: "https://client.example/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "state-1",
      decision: "deny",
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);

    expect(location.origin).toBe("https://client.example");
    expect(location.pathname).toBe("/callback");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("state-1");
    expect(db.store.mcp_oauth_code).toHaveLength(0);
  });
});

describe("MCP OAuth token exchange", () => {
  it("exchanges a code once and refuses the replay", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    const values = {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      redirect_uri: issued.redirectUri,
      code_verifier: issued.verifier,
    };

    const first = await exchange(issued.handler, values);

    expect(first.status).toBe(200);
    expect(await body(first)).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp",
    });

    const replay = await exchange(issued.handler, values);

    expect(replay.status).toBe(400);
    expect(await body(replay)).toMatchObject({ error: "invalid_grant" });
    expect(db.store.mcp_oauth_token).toHaveLength(2);
  });

  it("lets exactly one of two concurrent exchanges win", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    const values = {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      redirect_uri: issued.redirectUri,
      code_verifier: issued.verifier,
    };

    const responses = await Promise.all([
      exchange(issued.handler, values),
      exchange(issued.handler, values),
    ]);

    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([200, 400]);
    expect(db.store.mcp_oauth_token).toHaveLength(2);
    expect(db.store.mcp_oauth_code[0]).toMatchObject({ consumedAt: expect.any(Date) });
  });

  it("rejects a wrong, malformed or missing PKCE verifier", async () => {
    for (const code_verifier of [
      "wrong-verifier-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdef",
      "short",
      "x".repeat(129),
      "invalid!chars".padEnd(50, "a"),
    ]) {
      const db = makeDb();
      const issued = await issueCode(db);

      const response = await exchange(issued.handler, {
        grant_type: "authorization_code",
        client_id: issued.clientId,
        code: issued.code,
        redirect_uri: issued.redirectUri,
        code_verifier,
      });

      expect(response.status, code_verifier).toBe(400);
      expect(await body(response)).toMatchObject({ error: "invalid_grant" });
      expect(db.store.mcp_oauth_token).toHaveLength(0);
    }
  });

  it("keeps the code bound to its client and redirect URI", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    addClient(db, "other-client", ["https://client.example/callback"]);

    const otherClient = await exchange(issued.handler, {
      grant_type: "authorization_code",
      client_id: "other-client",
      code: issued.code,
      redirect_uri: issued.redirectUri,
      code_verifier: issued.verifier,
    });

    expect(otherClient.status).toBe(400);

    const otherRedirect = await exchange(issued.handler, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      redirect_uri: "https://client.example/callback/other",
      code_verifier: issued.verifier,
    });

    expect(otherRedirect.status).toBe(400);
    expect(db.store.mcp_oauth_token).toHaveLength(0);
  });

  it("rejects an expired authorization code", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    db.store.mcp_oauth_code[0]!.expiresAt = new Date(Date.now() - 1_000);

    const response = await exchange(issued.handler, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      redirect_uri: issued.redirectUri,
      code_verifier: issued.verifier,
    });

    expect(response.status).toBe(400);
    expect(db.store.mcp_oauth_token).toHaveLength(0);
  });

  it("rotates refresh tokens and refuses reuse", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    const first = await exchange(issued.handler, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      redirect_uri: issued.redirectUri,
      code_verifier: issued.verifier,
    });

    const firstBody = await tokenPair(first);
    const refreshToken = firstBody.refresh_token;

    const refreshed = await exchange(issued.handler, {
      grant_type: "refresh_token",
      client_id: issued.clientId,
      refresh_token: refreshToken,
    });

    expect(refreshed.status).toBe(200);
    const refreshedBody = await tokenPair(refreshed);

    expect(refreshedBody.refresh_token).not.toBe(refreshToken);

    const replay = await exchange(issued.handler, {
      grant_type: "refresh_token",
      client_id: issued.clientId,
      refresh_token: refreshToken,
    });

    expect(replay.status).toBe(400);
    expect(await body(replay)).toMatchObject({ error: "invalid_grant" });

    // The rotated token still works exactly once.
    const next = await exchange(issued.handler, {
      grant_type: "refresh_token",
      client_id: issued.clientId,
      refresh_token: refreshedBody.refresh_token,
    });

    expect(next.status).toBe(200);
  });

  it("lets exactly one of two concurrent refresh rotations win", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    const first = await tokenPair(
      await exchange(issued.handler, {
        grant_type: "authorization_code",
        client_id: issued.clientId,
        code: issued.code,
        redirect_uri: issued.redirectUri,
        code_verifier: issued.verifier,
      }),
    );

    const responses = await Promise.all([
      exchange(issued.handler, {
        grant_type: "refresh_token",
        client_id: issued.clientId,
        refresh_token: first.refresh_token,
      }),
      exchange(issued.handler, {
        grant_type: "refresh_token",
        client_id: issued.clientId,
        refresh_token: first.refresh_token,
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it("binds refresh tokens to the client and rejects an access token as a refresh", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    const tokens = await tokenPair(
      await exchange(issued.handler, {
        grant_type: "authorization_code",
        client_id: issued.clientId,
        code: issued.code,
        redirect_uri: issued.redirectUri,
        code_verifier: issued.verifier,
      }),
    );

    addClient(db, "other-client", ["https://client.example/callback"]);

    const otherClient = await exchange(issued.handler, {
      grant_type: "refresh_token",
      client_id: "other-client",
      refresh_token: tokens.refresh_token,
    });

    expect(otherClient.status).toBe(400);

    const accessAsRefresh = await exchange(issued.handler, {
      grant_type: "refresh_token",
      client_id: issued.clientId,
      refresh_token: tokens.access_token,
    });

    expect(accessAsRefresh.status).toBe(400);
  });

  it("rejects a refresh token after the connection is revoked", async () => {
    const db = makeDb();
    const issued = await issueCode(db);

    const tokens = await tokenPair(
      await exchange(issued.handler, {
        grant_type: "authorization_code",
        client_id: issued.clientId,
        code: issued.code,
        redirect_uri: issued.redirectUri,
        code_verifier: issued.verifier,
      }),
    );

    db.store.mcp_oauth_connection[0]!.revokedAt = new Date();

    const response = await exchange(issued.handler, {
      grant_type: "refresh_token",
      client_id: issued.clientId,
      refresh_token: tokens.refresh_token,
    });

    expect(response.status).toBe(400);
  });

  it("rejects an unknown client and an unsupported grant", async () => {
    const db = makeDb();
    const handler = makeHandler(db);

    const unknown = await exchange(handler, {
      grant_type: "authorization_code",
      client_id: "missing-client",
      code: "code",
      redirect_uri: "https://client.example/callback",
      code_verifier: "x".repeat(50),
    });

    expect(unknown.status).toBe(401);
    expect(await body(unknown)).toMatchObject({ error: "invalid_client" });

    addClient(db, "mcp_client_test", ["https://client.example/callback"]);

    const unsupported = await exchange(handler, {
      grant_type: "password",
      client_id: "mcp_client_test",
    });

    expect(unsupported.status).toBe(400);
    expect(await body(unsupported)).toMatchObject({ error: "unsupported_grant_type" });
  });
});
