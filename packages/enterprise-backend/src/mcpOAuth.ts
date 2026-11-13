import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { eq } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import { EnterpriseService } from "@mattrax/enterprise-domain";
import { sessionCookie } from "./auth.ts";

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });

const redirect = (location: string, status = 302) =>
  HttpServerResponse.empty({ status, headers: { location, "cache-control": "no-store" } });

const html = (body: string) =>
  HttpServerResponse.text(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const errorResponse = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

/**
 * Internal failures (database, provider, serialization) are logged in full but
 * never described to the OAuth client. The RFC error envelope stays intact.
 */
const internalError = (context: string, cause: unknown) =>
  Effect.logError(`MCP OAuth ${context} failed`, cause).pipe(
    Effect.as(errorResponse("server_error", "An unexpected error occurred", 500)),
  );

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const randomToken = (prefix: string) =>
  `${prefix}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;

const sha256 = async (value: string) =>
  base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

const validRedirectUri = (value: string) => {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
};

const parseForm = (value: string) => new URLSearchParams(value);

type ClientRow = typeof schema.mcpOAuthClient.$inferSelect;

const clientAndRedirect = (
  clientId: string | null,
  redirectUri: string | null,
): Effect.Effect<ClientRow | null, any, any> =>
  Effect.gen(function* () {
    if (!clientId || !redirectUri) return null;
    const db = yield* Db;
    const client = yield* db.query.mcpOAuthClient.findFirst({ where: { id: clientId } });

    if (!client) return null;
    const uris = Array.isArray(client.redirectUris) ? client.redirectUris : [];

    return uris.includes(redirectUri) ? client : null;
  });

const resolveUser = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    // Consent must come from a browser session, never from an existing MCP
    // bearer token that is trying to mint another connection.
    if (!request.cookies[sessionCookie]) return null;
    const service = yield* EnterpriseService;

    return yield* (
      service.me(request) as Effect.Effect<
        {
          user: { id: string; name: string; email: string };
          tenants: Array<{ id: string; name: string; role: string }>;
        },
        unknown
      >
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("MCP OAuth session lookup failed", cause).pipe(Effect.as(null)),
      ),
    );
  });

const tokenResponse = (accessToken: string, refreshToken: string, expiresIn: number) =>
  json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope: "mcp",
  });

const issueTokens = (
  connectionId: string,
  clientId: string,
): Effect.Effect<{ accessToken: string; refreshToken: string }, any, any> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = new Date();
    const accessToken = randomToken("mcp_at_");
    const refreshToken = randomToken("mcp_rt_");
    yield* db.insert(schema.mcpOAuthToken).values([
      {
        id: crypto.randomUUID(),
        connectionId,
        clientId,
        kind: "access",
        tokenHash: yield* Effect.promise(() => sha256(accessToken)),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        connectionId,
        clientId,
        kind: "refresh",
        tokenHash: yield* Effect.promise(() => sha256(refreshToken)),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        createdAt: now,
      },
    ]);

    return { accessToken, refreshToken };
  });

const consentPage = (options: {
  requestUrl: URL;
  client: ClientRow;
  user: { name: string; email: string };
  tenants: ReadonlyArray<{ name: string; role: string }>;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
}) => {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;

  const tenantList = options.tenants.length
    ? `<ul>${options.tenants
        .map(
          (tenant) => `<li>${escapeHtml(tenant.name)} <span>${escapeHtml(tenant.role)}</span></li>`,
        )
        .join("")}</ul>`
    : "<p>No tenant memberships.</p>";

  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorise ${escapeHtml(options.client.name)} · Mattrax</title>
<style>
  :root { color-scheme: dark; --bg:#09090b; --card:#18181b; --border:#27272a; --fg:#fafafa; --muted:#a1a1aa; --brand:#fafafa; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:14px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif; padding:24px; }
  main { width:100%; max-width:460px; background:var(--card); border:1px solid var(--border); border-radius:14px; padding:24px; }
  h1 { margin:0 0 4px; font-size:19px; letter-spacing:-0.02em; }
  p { color:var(--muted); }
  ul { margin:12px 0; padding:14px 14px 14px 30px; border:1px solid var(--border); border-radius:10px; color:var(--muted); }
  li { margin:4px 0; }
  li span { color:#71717a; font-size:12px; text-transform:capitalize; }
  .who { font-size:12px; color:var(--muted); margin-bottom:18px; }
  .scope { border:1px solid var(--border); border-radius:10px; padding:12px; margin:16px 0; }
  .scope strong { display:block; color:var(--fg); margin-bottom:4px; }
  .actions { display:flex; gap:8px; margin-top:20px; }
  button { flex:1; border-radius:9px; border:1px solid var(--border); padding:9px 12px; font:inherit; cursor:pointer; }
  .approve { background:var(--brand); color:#09090b; border-color:var(--brand); font-weight:600; }
  .deny { background:transparent; color:var(--muted); }
  code { font-size:11.5px; color:var(--muted); }
</style></head>
<body><main>
  <h1>Authorise ${escapeHtml(options.client.name)}</h1>
  <p class="who">Signed in as ${escapeHtml(options.user.name)} &lt;${escapeHtml(options.user.email)}&gt;</p>
  <p>This agent wants to connect to Mattrax through the Model Context Protocol.</p>
  <div class="scope"><strong>Tenant access</strong>${tenantList}</div>
  <div class="scope"><strong>What it can do</strong>Read and change devices, groups, policies, applications, dashboards and tenant settings. Account settings and credentials stay off-limits.</div>
  <form method="post" action="/api/oauth/authorize">
    ${hidden("client_id", options.client.id)}
    ${hidden("redirect_uri", options.redirectUri)}
    ${hidden("response_type", "code")}
    ${hidden("scope", options.scope)}
    ${hidden("code_challenge", options.codeChallenge)}
    ${hidden("code_challenge_method", "S256")}
    ${options.state ? hidden("state", options.state) : ""}
    <div class="actions">
      <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="approve" type="submit" name="decision" value="approve">Authorise</button>
    </div>
  </form>
  <p><code>${escapeHtml(options.redirectUri)}</code></p>
</main></body></html>`);
};

export const mcpOAuthRoutes = (options: { origin: string }) => {
  const register = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const db = yield* Db;

      let body: {
        client_name?: unknown;
        redirect_uris?: unknown;
        token_endpoint_auth_method?: unknown;
      };

      try {
        body = JSON.parse((yield* request.text) || "{}");
      } catch {
        return errorResponse("invalid_client_metadata", "Registration body must be JSON");
      }

      const name =
        typeof body.client_name === "string" && body.client_name.trim()
          ? body.client_name.trim().slice(0, 120)
          : "MCP client";

      const redirectUris = Array.isArray(body.redirect_uris)
        ? body.redirect_uris.filter((value): value is string => typeof value === "string")
        : [];

      if (
        redirectUris.length === 0 ||
        redirectUris.length > 10 ||
        redirectUris.some((uri) => !validRedirectUri(uri))
      )
        return errorResponse(
          "invalid_redirect_uri",
          "Redirect URIs must be https, or http on localhost/127.0.0.1",
        );

      if (
        body.token_endpoint_auth_method !== undefined &&
        body.token_endpoint_auth_method !== "none"
      )
        return errorResponse(
          "invalid_client_metadata",
          "Mattrax MCP clients are public clients and must use token_endpoint_auth_method=none",
        );
      const id = randomToken("mcp_client_");
      const now = new Date();
      yield* db.insert(schema.mcpOAuthClient).values({
        id,
        name,
        redirectUris,
        createdAt: now,
      });

      return json(
        {
          client_id: id,
          client_name: name,
          client_id_issued_at: Math.floor(now.getTime() / 1000),
          redirect_uris: redirectUris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        201,
        { "access-control-allow-origin": "*" },
      );
    }).pipe(Effect.catchCause((cause) => internalError("registration", cause)));

  const authorizeGet = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const url = new URL(request.url, options.origin);
      const clientId = url.searchParams.get("client_id");
      const redirectUri = url.searchParams.get("redirect_uri");
      const client = yield* clientAndRedirect(clientId, redirectUri);

      if (!client) return errorResponse("invalid_request", "Unknown client or redirect URI");

      if (url.searchParams.get("response_type") !== "code")
        return errorResponse("unsupported_response_type", "Only response_type=code is supported");
      const codeChallenge = url.searchParams.get("code_challenge");

      if (!codeChallenge || url.searchParams.get("code_challenge_method") !== "S256")
        return errorResponse("invalid_request", "PKCE with S256 is required");
      const me = yield* resolveUser(request);

      if (!me) {
        const returnTo = `${url.pathname}${url.search}`;

        return redirect(`${options.origin}/login?returnTo=${encodeURIComponent(returnTo)}`);
      }

      return consentPage({
        requestUrl: url,
        client,
        user: me.user,
        tenants: me.tenants,
        redirectUri: redirectUri!,
        state: url.searchParams.get("state"),
        codeChallenge,
        scope: url.searchParams.get("scope")?.trim() || "mcp",
      });
    }).pipe(Effect.catchCause((cause) => internalError("authorisation request", cause)));

  const authorizePost = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const db = yield* Db;
      const form = parseForm(yield* request.text);
      const clientId = form.get("client_id");
      const redirectUri = form.get("redirect_uri");
      const state = form.get("state");
      const client = yield* clientAndRedirect(clientId, redirectUri);

      if (!client || !redirectUri)
        return errorResponse("invalid_request", "Unknown client or redirect URI");
      const codeChallenge = form.get("code_challenge") ?? "";

      if (!codeChallenge) return errorResponse("invalid_request", "PKCE challenge is required");

      const me = yield* resolveUser(request);

      if (!me) {
        const url = new URL(request.url, options.origin);

        return redirect(
          `${options.origin}/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
        );
      }

      if (form.get("decision") !== "approve") {
        const denied = new URL(redirectUri);
        denied.searchParams.set("error", "access_denied");
        denied.searchParams.set("error_description", "The user denied the request");

        if (state) denied.searchParams.set("state", state);

        return redirect(denied.toString());
      }

      const existing = yield* db.query.mcpOAuthConnection.findFirst({
        where: {
          userId: me.user.id,
          clientId: client.id,
          revokedAt: { isNull: true },
        },
      });

      const connectionId = existing?.id ?? crypto.randomUUID();

      if (existing)
        yield* db
          .update(schema.mcpOAuthConnection)
          .set({ scopes: ["mcp"] })
          .where(eq(schema.mcpOAuthConnection.id, connectionId));
      else
        yield* db.insert(schema.mcpOAuthConnection).values({
          id: connectionId,
          userId: me.user.id,
          clientId: client.id,
          scopes: ["mcp"],
          requestCount: 0,
          createdAt: new Date(),
        });

      const code = randomToken("mcp_code_");
      const now = new Date();
      yield* db.insert(schema.mcpOAuthCode).values({
        id: crypto.randomUUID(),
        connectionId,
        clientId: client.id,
        codeHash: yield* Effect.promise(() => sha256(code)),
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        createdAt: now,
      });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);

      if (state) target.searchParams.set("state", state);

      return redirect(target.toString());
    }).pipe(Effect.catchCause((cause) => internalError("authorisation decision", cause)));

  const token = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const db = yield* Db;
      const form = parseForm(yield* request.text);
      const grantType = form.get("grant_type");
      const clientId = form.get("client_id");

      if (!clientId) return errorResponse("invalid_client", "client_id is required");
      const client = yield* db.query.mcpOAuthClient.findFirst({ where: { id: clientId } });

      if (!client) return errorResponse("invalid_client", "Unknown client", 401);

      if (grantType === "authorization_code") {
        const code = form.get("code");
        const redirectUri = form.get("redirect_uri");
        const verifier = form.get("code_verifier");

        if (!code || !redirectUri || !verifier)
          return errorResponse(
            "invalid_request",
            "code, redirect_uri and code_verifier are required",
          );
        const codeHash = yield* Effect.promise(() => sha256(code));

        const row = yield* db.query.mcpOAuthCode.findFirst({
          where: {
            codeHash,
            clientId,
            consumedAt: { isNull: true },
            expiresAt: { gt: new Date() },
          },
        });

        if (!row || row.redirectUri !== redirectUri)
          return errorResponse("invalid_grant", "Invalid or expired authorization code");
        const expected = yield* Effect.promise(() => sha256(verifier));

        if (expected !== row.codeChallenge)
          return errorResponse("invalid_grant", "PKCE verification failed");

        const connection = yield* db.query.mcpOAuthConnection.findFirst({
          where: {
            id: row.connectionId,
            revokedAt: { isNull: true },
          },
        });

        if (!connection) return errorResponse("invalid_grant", "This connection was revoked");
        yield* db
          .update(schema.mcpOAuthCode)
          .set({ consumedAt: new Date() })
          .where(eq(schema.mcpOAuthCode.id, row.id));
        const tokens = yield* issueTokens(connection.id, client.id);

        return tokenResponse(tokens.accessToken, tokens.refreshToken, 3600);
      }

      if (grantType === "refresh_token") {
        const refreshToken = form.get("refresh_token");

        if (!refreshToken) return errorResponse("invalid_request", "refresh_token is required");
        const tokenHash = yield* Effect.promise(() => sha256(refreshToken));

        const row = yield* db.query.mcpOAuthToken.findFirst({
          where: {
            tokenHash,
            kind: "refresh",
            clientId,
            revokedAt: { isNull: true },
            expiresAt: { gt: new Date() },
          },
        });

        if (!row) return errorResponse("invalid_grant", "Invalid or expired refresh token");

        const connection = yield* db.query.mcpOAuthConnection.findFirst({
          where: { id: row.connectionId, revokedAt: { isNull: true } },
        });

        if (!connection) return errorResponse("invalid_grant", "This connection was revoked");
        yield* db
          .update(schema.mcpOAuthToken)
          .set({ revokedAt: new Date() })
          .where(eq(schema.mcpOAuthToken.id, row.id));
        const tokens = yield* issueTokens(connection.id, client.id);

        return tokenResponse(tokens.accessToken, tokens.refreshToken, 3600);
      }

      return errorResponse("unsupported_grant_type", "Use authorization_code or refresh_token");
    }).pipe(Effect.catchCause((cause) => internalError("token exchange", cause)));

  const revoke = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const db = yield* Db;
      const form = parseForm(yield* request.text);
      const token = form.get("token");

      if (!token) return json({}, 200);
      const tokenHash = yield* Effect.promise(() => sha256(token));
      yield* db
        .update(schema.mcpOAuthToken)
        .set({ revokedAt: new Date() })
        .where(eq(schema.mcpOAuthToken.tokenHash, tokenHash));

      return json({}, 200);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("MCP OAuth token revocation failed", cause).pipe(
          Effect.as(json({ error: "temporarily_unavailable" }, 503)),
        ),
      ),
    );

  return Layer.mergeAll(
    HttpRouter.add("POST", "/api/oauth/register", register),
    HttpRouter.add("GET", "/api/oauth/authorize", authorizeGet),
    HttpRouter.add("POST", "/api/oauth/authorize", authorizePost),
    HttpRouter.add("POST", "/api/oauth/token", token),
    HttpRouter.add("POST", "/api/oauth/revoke", revoke),
  );
};
