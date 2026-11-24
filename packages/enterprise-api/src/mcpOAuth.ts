import { DateTime, Effect, Layer, Option, Schema } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import {
  EnterpriseService,
  PERMISSION_GROUPS,
  PERMISSIONS,
  credentialPermissions,
  normalizeCredentialPermissions,
  isPermission,
  permissionLabel,
} from "@mattrax/enterprise-domain";
import type { Permission } from "@mattrax/enterprise-domain";
import { ACCOUNT_AUDIT, recordAccountAudit, sessionCookie } from "@mattrax/enterprise-backend";
import { catchCausePreservingInterrupts } from "./errorBoundary.js";

const json = (body: Schema.Json, status = 200, headers?: Record<string, string>) =>
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

export const validRedirectUri = (value: string) => {
  try {
    const url = new URL(value);

    // RFC 6749 §3.1.2: the redirection endpoint URI must be an absolute URI
    // without a fragment. Credentials in the URI are never a callback.
    if (url.hash !== "" || url.username !== "" || url.password !== "") return false;

    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"))
    );
  } catch {
    return false;
  }
};

/**
 * PKCE S256 values. The challenge is the base64url encoding of a SHA-256 digest
 * (43 characters); the verifier is 43–128 unreserved characters (RFC 7636
 * §4.1–4.2). Bounding both at the edge keeps a malformed ceremony from reaching
 * the token endpoint.
 */
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

const validCodeChallenge = (value: string | null): value is string =>
  value !== null && PKCE_CHALLENGE.test(value);

/** Constant-time comparison for equal-length SHA-256 digests. */
const equalChallenges = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;

  let difference = 0;

  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);

  return difference === 0;
};

const tokenExpired = (value: Date | string | null | undefined, now: Date): boolean =>
  value === null || value === undefined || new Date(value).getTime() <= now.getTime();

const parseForm = (value: string) => new URLSearchParams(value);

const storedScopes = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string").slice(0, 64)
    : ["mcp"];

const permissionNames = (scopes: ReadonlyArray<string>) =>
  scopes.includes("mcp") ? ["mcp"] : [...credentialPermissions(scopes)].map(permissionLabel);

const oauthAuditMetadata = (
  client: ClientRow,
  connectionId: string,
  scopes: ReadonlyArray<string>,
) => ({
  clientId: client.id,
  clientName: client.name.slice(0, 160),
  connectionId,
  scopes: [...scopes],
  permissions: permissionNames(scopes),
});

type ClientRow = typeof schema.mcpOAuthClient.$inferSelect;

const clientAndRedirect = (
  clientId: string | null,
  redirectUri: string | null,
): Effect.Effect<ClientRow | null, unknown, Db> =>
  Effect.gen(function* () {
    if (!clientId || !redirectUri) return null;
    const db = yield* Db;
    const client = yield* db.query.mcpOAuthClient.findFirst({ where: { id: clientId } });

    if (!client) return null;
    const uris = Array.isArray(client.redirectUris) ? client.redirectUris : [];

    return uris.includes(redirectUri) ? client : null;
  });

type McpSessionView = {
  readonly account: { readonly id: string; readonly name: string; readonly email: string };
  readonly tenants: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly permissions?: ReadonlyArray<string>;
  }>;
};

const resolveUser = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    // Consent must come from a browser session, never from an existing MCP
    // bearer token that is trying to mint another connection.
    if (!request.cookies[sessionCookie]) return null;
    const service = yield* EnterpriseService;

    const session: McpSessionView = yield* service.me(request);

    return session;
  }).pipe(
    catchCausePreservingInterrupts((cause) =>
      Effect.logWarning("MCP OAuth session lookup failed", cause).pipe(Effect.as(null)),
    ),
  );

const tokenResponse = (accessToken: string, refreshToken: string, expiresIn: number) =>
  json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope: "mcp",
  });

const issueTokens = (
  db: Pick<EnterpriseDb, "insert">,
  connectionId: string,
  clientId: string,
  now: Date,
): Effect.Effect<{ accessToken: string; refreshToken: string }, unknown> =>
  Effect.gen(function* () {
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

type ConsentGroup = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly permissions: ReadonlyArray<{
    readonly id: Permission;
    readonly label: string;
    readonly description: string;
    readonly level: "read" | "write";
  }>;
};

const buildConsentGroups = (available: ReadonlyArray<Permission>): ConsentGroup[] => {
  const allowed = new Set(available);

  return PERMISSION_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    description: group.description,
    permissions: group.permissions
      .filter((permission) => allowed.has(permission.id))
      .map((permission) => ({
        ...permission,
        level: permission.id.endsWith(".read") ? ("read" as const) : ("write" as const),
      })),
  })).filter((group) => group.permissions.length > 0);
};

const consentPage = (options: {
  requestUrl: URL;
  client: ClientRow;
  user: { name: string; email: string };
  tenants: ReadonlyArray<{ name: string; role: string }>;
  available: ReadonlyArray<Permission>;
  selected: ReadonlyArray<Permission>;
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

  const groups = buildConsentGroups(options.available);
  const selected = new Set(options.selected);

  const groupMarkup = groups
    .map((group) => {
      const permissions = group.permissions
        .map(
          (permission) => `<label class="perm">
            <input type="checkbox" name="permission" value="${escapeHtml(permission.id)}"
              data-group="${escapeHtml(group.id)}" data-level="${permission.level}"
              ${selected.has(permission.id) ? "checked" : ""} />
            <span><strong>${escapeHtml(permission.label)}</strong><small>${escapeHtml(
              permission.description,
            )}</small></span>
          </label>`,
        )
        .join("");

      const hasWrite = group.permissions.some((permission) => permission.level === "write");

      return `<details class="group">
        <summary>
          <span><span class="name">${escapeHtml(group.label)}</span>
            <span class="meta">${group.permissions.length} permission${
              group.permissions.length === 1 ? "" : "s"
            }</span></span>
          <span class="segmented" data-group-control="${escapeHtml(group.id)}">
            <button type="button" data-level="none">No access</button>
            <button type="button" data-level="read">Read</button>
            ${hasWrite ? '<button type="button" data-level="write">Write</button>' : ""}
          </span>
        </summary>
        <div class="permissions">${permissions}</div>
      </details>`;
    })
    .join("");

  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorise ${escapeHtml(options.client.name)} · Mattrax</title>
<style>
  :root { color-scheme: dark; --bg:#09090b; --card:#18181b; --border:#27272a; --fg:#fafafa; --muted:#a1a1aa; --brand:#fafafa; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:14px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif; padding:24px; }
  main { width:100%; max-width:600px; background:var(--card); border:1px solid var(--border); border-radius:14px; padding:24px; }
  h1 { margin:0 0 4px; font-size:19px; letter-spacing:-0.02em; }
  p { color:var(--muted); }
  ul { margin:12px 0; padding:14px 14px 14px 30px; border:1px solid var(--border); border-radius:10px; color:var(--muted); }
  li { margin:4px 0; }
  li span { color:#71717a; font-size:12px; text-transform:capitalize; }
  .who { font-size:12px; color:var(--muted); margin-bottom:18px; }
  .scope { border:1px solid var(--border); border-radius:10px; padding:12px; margin:16px 0; }
  .scope strong { display:block; color:var(--fg); margin-bottom:4px; }
  .warning { border:1px solid #a16207; background:#42200655; color:#fcd34d; border-radius:10px; padding:10px 12px; margin:14px 0; font-size:12px; }
  .toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin:18px 0 4px; }
  .toolbar h2 { margin:0; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); }
  .groups { border-top:1px solid var(--border); }
  .group { border-bottom:1px solid var(--border); }
  .group summary { display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; padding:10px 0; list-style:none; }
  .group summary::-webkit-details-marker { display:none; }
  .group .name { font-weight:600; }
  .group .meta { display:block; color:#71717a; font-size:11px; font-weight:400; }
  .segmented { display:inline-flex; flex:0 0 auto; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  .segmented button { border:0; background:transparent; color:var(--muted); padding:4px 8px; font:inherit; font-size:11px; cursor:pointer; }
  .segmented button.active { background:var(--brand); color:#09090b; font-weight:600; }
  .permissions { display:grid; gap:7px; padding:0 0 12px; }
  .perm { display:flex; gap:8px; align-items:flex-start; color:var(--muted); font-size:12px; }
  .perm input { margin-top:2px; accent-color:var(--brand); }
  .perm strong { display:block; color:var(--fg); font-weight:500; font-size:12px; }
  .perm small { display:block; color:#71717a; font-size:11px; }
  .actions { display:flex; gap:8px; margin-top:20px; }
  button { flex:1; border-radius:9px; border:1px solid var(--border); padding:9px 12px; font:inherit; cursor:pointer; }
  .approve { background:var(--brand); color:#09090b; border-color:var(--brand); font-weight:600; }
  .deny { background:transparent; color:var(--muted); }
  code { font-size:11.5px; color:var(--muted); }
</style></head>
<body><main>
  <h1>Authorise ${escapeHtml(options.client.name)}</h1>
  <p class="who">Signed in as ${escapeHtml(options.user.name)} &lt;${escapeHtml(options.user.email)}&gt;</p>
  <p>${escapeHtml(options.client.name)} wants to connect to Mattrax through the Model Context Protocol.</p>
  <div class="warning"><strong>Unverified application.</strong> This application has not been verified by Mattrax. Only continue if you recognise and trust it.</div>
  <div class="scope"><strong>Tenant access</strong>${tenantList}</div>
  <div class="toolbar">
    <h2>Permissions</h2>
    <span class="segmented" data-global-control>
      <button type="button" data-level="none">No access</button>
      <button type="button" data-level="read">Read</button>
      <button type="button" data-level="write">All access</button>
    </span>
  </div>
  <div class="groups">${groupMarkup}</div>
  <form method="post" action="/api/oauth/authorize">
    ${hidden("client_id", options.client.id)}
    ${hidden("redirect_uri", options.redirectUri)}
    ${hidden("response_type", "code")}
    ${hidden("scope", options.scope)}
    ${hidden("code_challenge", options.codeChallenge)}
    ${hidden("code_challenge_method", "S256")}
    ${hidden("permissions_field", "1")}
    ${options.state ? hidden("state", options.state) : ""}
    <div class="actions">
      <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="approve" type="submit" name="decision" value="approve">Authorise ${escapeHtml(
        options.client.name,
      )}</button>
    </div>
  </form>
  <p><code>${escapeHtml(options.redirectUri)}</code></p>
</main>
<script>
(function () {
  var boxes = function () { return Array.prototype.slice.call(document.querySelectorAll('input[name="permission"]')); };
  var groupBoxes = function (group) { return boxes().filter(function (box) { return box.dataset.group === group; }); };
  var mark = function (control, state) {
    Array.prototype.forEach.call(control.querySelectorAll('button'), function (button) {
      var active = button.dataset.level === state;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  var syncGroup = function (group) {
    var control = document.querySelector('[data-group-control="' + group + '"]');
    if (!control) return;
    var items = groupBoxes(group);
    var reads = items.filter(function (box) { return box.dataset.level === 'read'; });
    var writes = items.filter(function (box) { return box.dataset.level !== 'read'; });
    var state = items.every(function (box) { return box.checked; })
      ? 'write'
      : reads.every(function (box) { return box.checked; }) && writes.every(function (box) { return !box.checked; })
        ? 'read'
        : items.every(function (box) { return !box.checked; })
          ? 'none'
          : '';
    mark(control, state);
  };
  var syncGlobal = function () {
    var control = document.querySelector('[data-global-control]');
    if (!control) return;
    var items = boxes();
    var reads = items.filter(function (box) { return box.dataset.level === 'read'; });
    var writes = items.filter(function (box) { return box.dataset.level !== 'read'; });
    var state = items.every(function (box) { return box.checked; })
      ? 'write'
      : reads.every(function (box) { return box.checked; }) && writes.every(function (box) { return !box.checked; })
        ? 'read'
        : items.every(function (box) { return !box.checked; })
          ? 'none'
          : '';
    mark(control, state);
  };
  var setLevel = function (group, level) {
    groupBoxes(group).forEach(function (box) {
      box.checked = level === 'write' || (level === 'read' && box.dataset.level === 'read');
    });
    syncGroup(group);
    syncGlobal();
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-group-control]'), function (control) {
    var group = control.dataset.groupControl;
    control.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      setLevel(group, button.dataset.level);
    });
    groupBoxes(group).forEach(function (box) {
      box.addEventListener('change', function () { syncGroup(group); syncGlobal(); });
    });
    syncGroup(group);
  });
  var global = document.querySelector('[data-global-control]');
  if (global) {
    global.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      event.preventDefault();
      boxes().forEach(function (box) {
        box.checked = button.dataset.level === 'write' || (button.dataset.level === 'read' && box.dataset.level === 'read');
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-group-control]'), function (control) {
        syncGroup(control.dataset.groupControl);
      });
      syncGlobal();
    });
    syncGlobal();
  }
})();
</script></body></html>`);
};

export const mcpOAuthRoutes = (options: { origin: string }) => {
  const register = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const db = yield* Db;

      const registrationBody = Schema.Struct({
        client_name: Schema.optional(Schema.Json),
        redirect_uris: Schema.optional(Schema.Json),
        token_endpoint_auth_method: Schema.optional(Schema.Json),
      });

      let body: Schema.Schema.Type<typeof registrationBody>;

      try {
        const decoded = Schema.decodeUnknownOption(registrationBody)(
          JSON.parse((yield* request.text) || "{}"),
        );

        if (Option.isNone(decoded))
          return errorResponse("invalid_client_metadata", "Registration body must be JSON");
        body = decoded.value;
      } catch {
        return errorResponse("invalid_client_metadata", "Registration body must be JSON");
      }

      const requestedName = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.String)(body.client_name),
      )?.trim();

      const name = requestedName ? requestedName.slice(0, 120) : "MCP client";

      const redirectUris = Array.isArray(body.redirect_uris)
        ? body.redirect_uris.flatMap((value) => {
            const uri = Schema.decodeUnknownOption(Schema.String)(value);

            return Option.isSome(uri) ? [uri.value] : [];
          })
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
      const now = DateTime.toDate(yield* DateTime.now);
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
    }).pipe(catchCausePreservingInterrupts((cause) => internalError("registration", cause)));

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

      if (!validCodeChallenge(codeChallenge))
        return errorResponse("invalid_request", "PKCE with S256 is required");

      if (url.searchParams.get("code_challenge_method") !== "S256")
        return errorResponse("invalid_request", "PKCE with S256 is required");
      const me = yield* resolveUser(request);

      if (!me) {
        const returnTo = `${url.pathname}${url.search}`;

        return redirect(`${options.origin}/login?returnTo=${encodeURIComponent(returnTo)}`);
      }

      const availableSet = new Set(
        me.tenants.flatMap((tenant) => (tenant.permissions ?? []).filter(isPermission)),
      );

      const available = PERMISSIONS.filter((permission) => availableSet.has(permission));
      const db = yield* Db;

      const existing = yield* db.query.mcpOAuthConnection.findFirst({
        where: {
          accountId: me.account.id,
          clientId: client.id,
          revokedAt: { isNull: true },
        },
      });

      const selected =
        existing && Array.isArray(existing.scopes) && !existing.scopes.includes("mcp")
          ? available.filter((permission) => existing.scopes.includes(permission))
          : available;

      return consentPage({
        requestUrl: url,
        client,
        user: me.account,
        tenants: me.tenants,
        available,
        selected,
        redirectUri: redirectUri!,
        state: url.searchParams.get("state"),
        codeChallenge,
        scope: url.searchParams.get("scope")?.trim() || "mcp",
      });
    }).pipe(
      catchCausePreservingInterrupts((cause) => internalError("authorisation request", cause)),
    );

  const authorizePost = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      // A consent decision is state-changing. Browsers send Origin with the
      // form POST; reject a cross-origin one so another site cannot approve a
      // client with the user's cookie. Same-origin requests and non-browser
      // clients (no Origin) are unaffected.
      const origin = request.headers.origin;

      if (origin && origin !== options.origin)
        return errorResponse("invalid_request", "Cross-origin consent is not allowed", 403);

      const db = yield* Db;
      const form = parseForm(yield* request.text);
      const clientId = form.get("client_id");
      const redirectUri = form.get("redirect_uri");
      const state = form.get("state");
      const client = yield* clientAndRedirect(clientId, redirectUri);

      if (!client || !redirectUri)
        return errorResponse("invalid_request", "Unknown client or redirect URI");

      if (form.get("response_type") !== "code")
        return errorResponse("unsupported_response_type", "Only response_type=code is supported");
      const codeChallenge = form.get("code_challenge") ?? "";

      if (form.get("code_challenge_method") !== "S256" || !validCodeChallenge(codeChallenge))
        return errorResponse("invalid_request", "PKCE with S256 is required");

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

      // A new consent form sends one `permission` field per selected grant and
      // marks the field as present so "no access anywhere" is distinguishable
      // from an older client that never sent permissions at all.
      let scopes: string[] = ["mcp"];

      if (form.get("permissions_field") === "1") {
        const normalized = normalizeCredentialPermissions(form.getAll("permission"));

        if (!normalized)
          return errorResponse("invalid_request", "Unknown permission in the consent request");
        scopes = [...normalized];
      }

      const existing = yield* db.query.mcpOAuthConnection.findFirst({
        where: {
          accountId: me.account.id,
          clientId: client.id,
          revokedAt: { isNull: true },
        },
      });

      const connectionId = existing?.id ?? crypto.randomUUID();
      const code = randomToken("mcp_code_");
      const now = DateTime.toDate(yield* DateTime.now);
      const codeHash = yield* Effect.promise(() => sha256(code));

      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          if (existing) {
            let previousScopes = storedScopes(existing.scopes);
            const updated = yield* tx
              .update(schema.mcpOAuthConnection)
              .set({ scopes })
              .where(
                and(
                  eq(schema.mcpOAuthConnection.id, connectionId),
                  eq(schema.mcpOAuthConnection.accountId, me.account.id),
                  isNull(schema.mcpOAuthConnection.revokedAt),
                ),
              );

            // MySQL counts changed rows, so re-consenting to the same scopes
            // reports affectedRows: 0. Only a vanished or revoked connection
            // is a failure; an unchanged active row is a valid grant.
            if (!updated || updated.affectedRows === 0) {
              const active = yield* tx.query.mcpOAuthConnection.findFirst({
                where: {
                  id: connectionId,
                  accountId: me.account.id,
                  revokedAt: { isNull: true },
                },
              });

              if (!active)
                return yield* Effect.fail(new Error("MCP OAuth connection is no longer active"));
              previousScopes = storedScopes(active.scopes);

              if (previousScopes.join("\n") !== scopes.join("\n"))
                return yield* Effect.fail(
                  new Error("MCP OAuth connection scopes could not be updated"),
                );
            }

            const changed = previousScopes.join("\n") !== scopes.join("\n");

            yield* recordAccountAudit(tx, {
              subjectAccountId: me.account.id,
              subjectEmail: me.account.email,
              action: changed ? ACCOUNT_AUDIT.mcpOAuthScopesChanged : ACCOUNT_AUDIT.mcpOAuthGranted,
              targetType: "mcp_oauth_connection",
              targetId: connectionId,
              metadata: {
                ...oauthAuditMetadata(client, connectionId, scopes),
                ...(changed
                  ? {
                      previousScopes: [...previousScopes],
                      previousPermissions: permissionNames(previousScopes),
                    }
                  : {}),
              },
              at: now,
            });
          } else {
            yield* tx.insert(schema.mcpOAuthConnection).values({
              id: connectionId,
              accountId: me.account.id,
              clientId: client.id,
              scopes,
              requestCount: 0,
              createdAt: now,
            });
            yield* recordAccountAudit(tx, {
              subjectAccountId: me.account.id,
              subjectEmail: me.account.email,
              action: ACCOUNT_AUDIT.mcpOAuthGranted,
              targetType: "mcp_oauth_connection",
              targetId: connectionId,
              metadata: oauthAuditMetadata(client, connectionId, scopes),
              at: now,
            });
          }

          yield* tx.insert(schema.mcpOAuthCode).values({
            id: crypto.randomUUID(),
            connectionId,
            clientId: client.id,
            codeHash,
            redirectUri,
            codeChallenge,
            codeChallengeMethod: "S256",
            expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
            createdAt: now,
          });
        }),
      );
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);

      if (state) target.searchParams.set("state", state);

      return redirect(target.toString());
    }).pipe(
      catchCausePreservingInterrupts((cause) => internalError("authorisation decision", cause)),
    );

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

        if (!PKCE_VERIFIER.test(verifier))
          return errorResponse("invalid_grant", "PKCE verification failed");
        const now = DateTime.toDate(yield* DateTime.now);
        const codeHash = yield* Effect.promise(() => sha256(code));

        const row = yield* db.query.mcpOAuthCode.findFirst({
          where: {
            codeHash,
            clientId,
            consumedAt: { isNull: true },
          },
        });

        // Expiry is re-checked here rather than in the query so a malformed or
        // historical row cannot be treated as live by a different driver.
        if (!row || tokenExpired(row.expiresAt, now))
          return errorResponse("invalid_grant", "Invalid or expired authorization code");

        if (row.clientId !== client.id || row.redirectUri !== redirectUri)
          return errorResponse("invalid_grant", "Invalid or expired authorization code");

        if (row.codeChallengeMethod !== "S256")
          return errorResponse("invalid_grant", "PKCE verification failed");
        const expected = yield* Effect.promise(() => sha256(verifier));

        if (!equalChallenges(expected, row.codeChallenge))
          return errorResponse("invalid_grant", "PKCE verification failed");

        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const connection = yield* tx.query.mcpOAuthConnection.findFirst({
              where: {
                id: row.connectionId,
                revokedAt: { isNull: true },
              },
            });

            if (!connection || connection.clientId !== client.id)
              return errorResponse("invalid_grant", "This connection was revoked");

            // Consume the code and insert its replacement tokens together. A
            // failed insert must roll back the claim so the grant stays usable.
            const consumed = yield* tx
              .update(schema.mcpOAuthCode)
              .set({ consumedAt: now })
              .where(
                and(
                  eq(schema.mcpOAuthCode.id, row.id),
                  isNull(schema.mcpOAuthCode.consumedAt),
                  gt(schema.mcpOAuthCode.expiresAt, now),
                ),
              );

            if (consumed.affectedRows !== 1)
              return errorResponse("invalid_grant", "Invalid or expired authorization code");

            const tokens = yield* issueTokens(tx, connection.id, client.id, now);

            return tokenResponse(tokens.accessToken, tokens.refreshToken, 3600);
          }),
        );
      }

      if (grantType === "refresh_token") {
        const refreshToken = form.get("refresh_token");

        if (!refreshToken) return errorResponse("invalid_request", "refresh_token is required");
        const tokenHash = yield* Effect.promise(() => sha256(refreshToken));
        const now = DateTime.toDate(yield* DateTime.now);

        const row = yield* db.query.mcpOAuthToken.findFirst({
          where: {
            tokenHash,
            kind: "refresh",
            clientId,
            revokedAt: { isNull: true },
          },
        });

        if (!row || tokenExpired(row.expiresAt, now))
          return errorResponse("invalid_grant", "Invalid or expired refresh token");

        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const connection = yield* tx.query.mcpOAuthConnection.findFirst({
              where: { id: row.connectionId, revokedAt: { isNull: true } },
            });

            if (!connection || connection.clientId !== client.id)
              return errorResponse("invalid_grant", "This connection was revoked");

            // Revoke the old refresh token and insert its replacement together.
            // A failed insert leaves the presented token valid for a retry.
            const revoked = yield* tx
              .update(schema.mcpOAuthToken)
              .set({ revokedAt: now })
              .where(
                and(
                  eq(schema.mcpOAuthToken.id, row.id),
                  isNull(schema.mcpOAuthToken.revokedAt),
                  gt(schema.mcpOAuthToken.expiresAt, now),
                ),
              );

            if (revoked.affectedRows !== 1)
              return errorResponse("invalid_grant", "Invalid or expired refresh token");

            const tokens = yield* issueTokens(tx, connection.id, client.id, now);

            return tokenResponse(tokens.accessToken, tokens.refreshToken, 3600);
          }),
        );
      }

      return errorResponse("unsupported_grant_type", "Use authorization_code or refresh_token");
    }).pipe(catchCausePreservingInterrupts((cause) => internalError("token exchange", cause)));

  const revoke = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const db = yield* Db;
      const form = parseForm(yield* request.text);
      const token = form.get("token");

      if (!token) return json({}, 200);
      const tokenHash = yield* Effect.promise(() => sha256(token));
      const now = DateTime.toDate(yield* DateTime.now);
      yield* db
        .update(schema.mcpOAuthToken)
        .set({ revokedAt: now })
        .where(eq(schema.mcpOAuthToken.tokenHash, tokenHash));

      return json({}, 200);
    }).pipe(
      catchCausePreservingInterrupts((cause) =>
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
