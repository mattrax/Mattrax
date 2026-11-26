import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  EnterpriseService,
  enterpriseAccountApi,
  enterpriseApi,
} from "@mattrax/enterprise-domain";
import { makeEnterpriseAuthLive } from "@mattrax/enterprise-backend";
import { signStepUpGrant } from "../../enterprise-backend/src/Account/stepUp.ts";
import {
  createEnterpriseService,
  enterpriseAccountHandlers,
  enterpriseHandlers,
} from "@mattrax/enterprise-api";
import { makeDb, makeHttpHandler, schema } from "./helpers.js";
import { enterpriseSecurityHeaders } from "../../../apps/web/src/lib/enterprise-headers.ts";

const origin = "https://enterprise.test";
const authSecret = "account-auth-http-test-secret";
const email = "owner@example.com";

const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const sha256Base64Url = async (value: string) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const accountRow = () => ({
  id: "user-1",
  name: "Owner",
  email,
  emailVerified: true,
  disabled: false,
  superadmin: false,
  source: "manual",
  welcomeEmailSentAt: null,
  defaultTenantId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const apiTokenRow = async (raw: string) => ({
  id: "token-read",
  accountId: "user-1",
  name: "Monitor",
  tokenPrefix: raw.slice(0, 12),
  tokenHash: await sha256Hex(raw),
  scopes: ["read"],
  tenantId: null,
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const oauthRows = async (raw: string) => {
  const now = new Date();

  return {
    mcp_oauth_client: [
      {
        id: "client-1",
        name: "Test MCP client",
        redirectUris: ["https://client.test/callback"],
        createdAt: now,
        lastUsedAt: null,
      },
    ],
    mcp_oauth_connection: [
      {
        id: "connection-1",
        accountId: "user-1",
        clientId: "client-1",
        scopes: ["mcp"],
        lastUsedAt: null,
        lastAction: null,
        requestCount: 0,
        revokedAt: null,
        createdAt: now,
      },
    ],
    mcp_oauth_token: [
      {
        id: "oauth-token-1",
        connectionId: "connection-1",
        clientId: "client-1",
        kind: "access",
        tokenHash: await sha256Base64Url(raw),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        lastUsedAt: null,
        createdAt: now,
      },
    ],
  };
};

type AuthCall = {
  readonly kind: "requireUser" | "requireStepUp";
  readonly request: Parameters<EnterpriseAuth["Service"]["requireUser"]>[0];
};

const makeAuthHandler = async (
  options: {
    readonly credential?: "session" | "read-token" | "oauth";
    readonly tenant?: boolean;
  } = {},
) => {
  const now = new Date();
  const rawToken = "mtx_read_only_account_delete";
  const rawOAuthToken = "mcp_oauth_account_delete";
  const db = makeDb({
    account: [accountRow()],
    account_api_token: options.credential === "read-token" ? [await apiTokenRow(rawToken)] : [],
    ...(options.credential === "oauth" ? await oauthRows(rawOAuthToken) : {}),
    ...(options.tenant
      ? {
          organization: [
            { id: "tenant-1", name: "Acme", slug: "acme", createdAt: now, updatedAt: now },
          ],
          member: [
            {
              id: "member-1",
              organizationId: "tenant-1",
              accountId: "user-1",
              role: "owner",
              customRoleId: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }
      : {}),
  });
  const appAuth = {
    verifySession: () => Effect.succeed({ subjectId: "user-1", sessionId: "session-1" }),
    strategies: { email: { persistence: { moduleId: "email" } } },
  };
  const appAuthService = Object.assign(Effect.succeed(appAuth), {
    strategies: appAuth.strategies,
  });
  const authLayer = makeEnterpriseAuthLive({
    // SAFETY: the fake carries only the session verifier and strategy metadata
    // exercised by these fixtures, not the full auth definition.
    appAuth: appAuthService as any,
    origin,
    authSecret,
  }).pipe(Layer.provide(Layer.succeed(Db, db))) as Layer.Layer<EnterpriseAuth>;
  const realAuth = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* EnterpriseAuth;
    }).pipe(Effect.provide(authLayer)),
  );
  const calls: Array<AuthCall> = [];
  const auth = {
    ...realAuth,
    requireUser: (request: AuthCall["request"]) => {
      calls.push({ kind: "requireUser", request });

      return realAuth.requireUser(request);
    },
    requireStepUp: (
      request: AuthCall["request"],
      action: Parameters<EnterpriseAuth["Service"]["requireStepUp"]>[1],
    ) => {
      calls.push({ kind: "requireStepUp", request });

      return realAuth.requireStepUp(request, action);
    },
  };
  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: account deletion with no tenant never reaches storage.
    storage: {} as any,
    auth,
    authSecret,
  });
  const api = HttpApi.make("AccountAuthHttpTest").add(enterpriseApi).add(enterpriseAccountApi);
  const layer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      Layer.mergeAll(
        HttpApiBuilder.group(api, "EnterpriseApi", (handlers) => enterpriseHandlers(handlers)),
        HttpApiBuilder.group(api, "EnterpriseAccount", (handlers) =>
          enterpriseAccountHandlers(handlers),
        ),
      ),
    ),
    Layer.provide(Layer.succeed(EnterpriseService, service as any)),
    Layer.provide(HttpRouter.layer),
    Layer.provide(HttpServer.layerServices),
  );

  return {
    handler: makeHttpHandler(layer),
    db,
    calls,
    rawToken,
    rawOAuthToken,
  };
};

const bearerHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
const sessionHeaders = (method: string, forwardedOrigin?: string) => ({
  cookie: "__Host-mattrax_session=test",
  // A browser adds Origin to unsafe fetches; SSR must forward it explicitly.
  ...(forwardedOrigin ? {} : { origin }),
  ...enterpriseSecurityHeaders(method, forwardedOrigin),
});
const jsonHeaders = (headers: Record<string, string>) => ({
  ...headers,
  "content-type": "application/json",
});

describe("native-router account authentication", () => {
  it("denies OAuth API-token creation through canonical path", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request(`http://localhost/api/v1/account/api-tokens`, {
        method: "POST",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ name: "Escalated token" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account_api_token).toHaveLength(0);
  });

  it("denies OAuth API-token creation through uppercase path", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request(`http://localhost/API/V1/ACCOUNT/API-TOKENS`, {
        method: "POST",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ name: "Escalated token" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account_api_token).toHaveLength(0);
  });

  it("denies OAuth API-token creation through doubled slashes", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request(`http://localhost/api//v1//account//api-tokens`, {
        method: "POST",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ name: "Escalated token" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account_api_token).toHaveLength(0);
  });

  it("denies OAuth API-token creation through trailing slash", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request(`http://localhost/api/v1/account/api-tokens/`, {
        method: "POST",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ name: "Escalated token" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account_api_token).toHaveLength(0);
  });

  it("denies OAuth API-token creation through a percent-encoded segment", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request(`http://localhost/api/v1/%61ccount/api-tokens`, {
        method: "POST",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ name: "Escalated token" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account_api_token).toHaveLength(0);
  });

  it("denies OAuth API-token creation through percent-encoded uppercase segments", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request(`http://localhost/api/%76%31/%41CCOUNT/API-TOKENS/`, {
        method: "POST",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ name: "Escalated token" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account_api_token).toHaveLength(0);
  });

  it("denies OAuth API-token creation through a matrix-parameter suffix", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request(`http://localhost/api/v1/account/api-tokens;jsessionid=dummy`, {
        method: "POST",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ name: "Escalated token" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account_api_token).toHaveLength(0);
  });

  it("denies a read-only token deletion through canonical path", async () => {
    const { handler, db, rawToken } = await makeAuthHandler({ credential: "read-token" });
    const response = await handler(
      new Request(`http://localhost/api/v1/me`, {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
    expect(db.store.account_api_token[0]).toMatchObject({ revokedAt: null });
  });

  it("denies a read-only token deletion through uppercase path", async () => {
    const { handler, db, rawToken } = await makeAuthHandler({ credential: "read-token" });
    const response = await handler(
      new Request(`http://localhost/API/V1/ME`, {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
    expect(db.store.account_api_token[0]).toMatchObject({ revokedAt: null });
  });

  it("denies a read-only token deletion through doubled slashes", async () => {
    const { handler, db, rawToken } = await makeAuthHandler({ credential: "read-token" });
    const response = await handler(
      new Request(`http://localhost/api//v1//me`, {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
    expect(db.store.account_api_token[0]).toMatchObject({ revokedAt: null });
  });

  it("denies a read-only token deletion through trailing slash", async () => {
    const { handler, db, rawToken } = await makeAuthHandler({ credential: "read-token" });
    const response = await handler(
      new Request(`http://localhost/api/v1/me/`, {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
    expect(db.store.account_api_token[0]).toMatchObject({ revokedAt: null });
  });

  it("denies a read-only token deletion through a percent-encoded segment", async () => {
    const { handler, db, rawToken } = await makeAuthHandler({ credential: "read-token" });
    const response = await handler(
      new Request(`http://localhost/api/v1/%6De`, {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
    expect(db.store.account_api_token[0]).toMatchObject({ revokedAt: null });
  });

  it("denies a read-only token deletion through percent-encoded uppercase segments", async () => {
    const { handler, db, rawToken } = await makeAuthHandler({ credential: "read-token" });
    const response = await handler(
      new Request(`http://localhost/api/%76%31/ME/`, {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
    expect(db.store.account_api_token[0]).toMatchObject({ revokedAt: null });
  });

  it("denies a read-only token deletion through a matrix-parameter suffix", async () => {
    const { handler, db, rawToken } = await makeAuthHandler({ credential: "read-token" });
    const response = await handler(
      new Request(`http://localhost/api/v1/me;jsessionid=dummy`, {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
    expect(db.store.account_api_token[0]).toMatchObject({ revokedAt: null });
  });

  it("denies OAuth account deletion", async () => {
    const { handler, db, rawOAuthToken } = await makeAuthHandler({ credential: "oauth" });
    const response = await handler(
      new Request("http://localhost/api/v1/me", {
        method: "DELETE",
        headers: jsonHeaders(bearerHeaders(rawOAuthToken)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    expect(db.store.account).toHaveLength(1);
  });

  it("denies cookie deletion without a trusted Origin and CSRF header", async () => {
    const { handler, db } = await makeAuthHandler({ credential: "session" });
    const response = await handler(
      new Request("http://localhost/api/v1/me", {
        method: "DELETE",
        headers: jsonHeaders({ cookie: "__Host-mattrax_session=test" }),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ _tag: "EnterpriseForbidden" });
    expect(db.store.account).toHaveLength(1);
  });

  it("allows browser deletion with client-generated security headers", async () => {
    const { handler, db } = await makeAuthHandler({ credential: "session" });
    const response = await handler(
      new Request("http://localhost/api/v1/me", {
        method: "DELETE",
        headers: jsonHeaders(sessionHeaders("DELETE")),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", deletedTenants: [] });
    expect(db.store.account).toHaveLength(0);
  });

  it("allows SSR-forwarded deletion with client-generated security headers", async () => {
    const { handler, db } = await makeAuthHandler({ credential: "session" });
    const response = await handler(
      new Request("http://localhost/api/v1/me", {
        method: "DELETE",
        headers: jsonHeaders(sessionHeaders("DELETE", origin)),
        body: JSON.stringify({ confirmEmail: email }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", deletedTenants: [] });
    expect(db.store.account).toHaveLength(0);
  });

  it("preserves the tenant mutation method and path for authentication", async () => {
    const { handler, calls } = await makeAuthHandler({ credential: "session", tenant: true });
    const response = await handler(
      new Request("http://localhost/api/v1/tenants/tenant-1", {
        method: "PATCH",
        headers: jsonHeaders(sessionHeaders("PATCH")),
        body: JSON.stringify({ displayName: "Acme Corp" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("requireUser");
    expect(calls[0]?.request).toBeInstanceOf(Request);
    const request = calls[0]!.request as Request;
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/tenants/tenant-1");
  });

  it("preserves the step-up method and aliased path for authentication", async () => {
    const { handler, db, calls } = await makeAuthHandler({ credential: "session" });
    const grant = await Effect.runPromise(
      signStepUpGrant(authSecret, {
        subjectId: "user-1",
        email,
        sessionId: "session-1",
        action: "api-token-create",
        method: "totp",
        expiresAtMillis: Date.now() + 60_000,
      }),
    );
    const response = await handler(
      new Request("http://localhost/api/v1/%61ccount/api-tokens", {
        method: "POST",
        headers: jsonHeaders({ ...sessionHeaders("POST"), "x-mattrax-step-up": grant }),
        body: JSON.stringify({ name: "Browser CLI", scopes: ["read"] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.store.account_api_token).toHaveLength(1);
    expect(calls[0]?.kind).toBe("requireStepUp");
    expect(calls[0]?.request).toBeInstanceOf(Request);
    const request = calls[0]!.request as Request;
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/%61ccount/api-tokens");
  });
});
