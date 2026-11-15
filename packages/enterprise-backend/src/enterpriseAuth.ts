import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import {
  EnterpriseAuth,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseNotFound,
  EnterpriseUnauthorized,
  STEP_UP_WINDOW_MILLIS,
  StepUpRequired,
  StepUpService,
  StepUpUnavailable,
  diagnoseError,
  type StepUpAction,
  type StepUpMethod,
} from "@mattrax/enterprise-domain";
import { Db, authIdentifiers, schema } from "@mattrax/enterprise-core";
import { ACCOUNT_AUDIT, clientDescriptor, recordAccountAudit } from "./accountAudit.ts";
import { sessionCookie, type AppAuthService } from "./auth.ts";
import {
  DEFAULT_ONBOARDING_REPLY_TO,
  ONBOARDING_SUPPORT_EMAIL,
  sendWelcomeEmailOnce,
} from "./onboardingEmails.ts";
import type { EmailReplyTo, EmailTransport } from "./email.ts";
import {
  signStepUpFlow,
  signStepUpGrant,
  verifyAnyStepUpFlow,
  verifyStepUpGrant,
} from "./stepUp.ts";
import { captureSessionContext } from "./sessions.ts";
import { signToken, verifyToken } from "./tokens.ts";

type HeadersRecord = Record<string, string | string[] | undefined>;

const SessionReference = Schema.Struct({ sessionId: Schema.optional(Schema.String) });

const sessionIdOf = (session: Schema.Json | undefined) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(SessionReference)(session))?.sessionId;

const StepUpMethods = Schema.Struct({
  totp: Schema.Boolean,
  passkey: Schema.Boolean,
});

const enabledStepUpMethods = (value: Schema.Json | undefined): Array<StepUpMethod> => {
  const methods = Option.getOrElse(Schema.decodeUnknownOption(StepUpMethods)(value), () => ({
    totp: false,
    passkey: false,
  }));

  return (["totp", "passkey"] as const).filter((name) => methods[name]);
};

const SessionAssurance = Schema.Struct({
  assurance: Schema.optional(Schema.Struct({ method: Schema.optional(Schema.String) })),
});

/** Human sign-in method recorded on the session ("passkey", "sso-oidc", …). */
const sessionMethod = (session: Schema.Json | undefined): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(SessionAssurance)(session))?.assurance?.method;

const parseCookies = (header: string | null | undefined) =>
  Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");

        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );

const headersFromRecord = (record: HeadersRecord) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
};

const requestFrom = (request: Request | { headers: HeadersRecord }) =>
  request instanceof Request
    ? request
    : new Request("https://auth.invalid", { headers: headersFromRecord(request.headers) });

const tokenInfo = (item: any) => ({
  id: item.id,
  name: item.name,
  tokenPrefix: item.tokenPrefix,
  scopes: Array.isArray(item.scopes) ? item.scopes : ["read", "write"],
  tenantId: item.tenantId ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  lastUsedAt: item.lastUsedAt ? item.lastUsedAt.toISOString() : null,
  expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
  revokedAt: item.revokedAt ? item.revokedAt.toISOString() : null,
});

export const API_TOKEN_SCOPES = ["read", "write"] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

const ApiTokenScopeSchema = Schema.Literals(API_TOKEN_SCOPES);

/**
 * Resolve the scopes stored on a token. Tokens created before scoping existed
 * have no scopes and keep full access. Malformed values fail closed.
 */
const parseScopeList = (value: string): ReadonlyArray<Schema.Json> => {
  try {
    return (
      Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Array(Schema.Json))(JSON.parse(value)),
      ) ?? []
    );
  } catch {
    return [];
  }
};

export const tokenScopes = (value: Schema.Json | undefined): Set<ApiTokenScope> => {
  if (value == null) return new Set(API_TOKEN_SCOPES);

  const raw = Schema.is(Schema.String)(value)
    ? parseScopeList(value)
    : Schema.is(Schema.Array(Schema.Json))(value)
      ? value
      : [];

  return new Set(
    raw.flatMap((scope) => {
      const decoded = Schema.decodeUnknownOption(ApiTokenScopeSchema)(scope);

      return Option.isSome(decoded) ? [decoded.value] : [];
    }),
  );
};

/** Normalise requested scopes into the canonical order, or reject unknowns. */
const normalizeTokenScopes = (scopes: readonly string[] | undefined) => {
  if (scopes === undefined) return [...API_TOKEN_SCOPES];
  const requested = new Set(scopes);

  if (requested.size === 0) return undefined;

  if ([...requested].some((scope) => !API_TOKEN_SCOPES.some((known) => known === scope)))
    return undefined;

  // `write` means read + mutate, so a write token always carries `read`.
  if (requested.has("write")) requested.add("read");

  return API_TOKEN_SCOPES.filter((scope) => requested.has(scope));
};

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const randomToken = (prefix = "") =>
  `${prefix}${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`;

const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );

/** MCP OAuth tokens use the same unpadded base64url digest as issuance. */
const sha256Base64Url = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
    Effect.map((digest) =>
      btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", ""),
    ),
  );

const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;

/** An email change must complete within the hour, like a password reset link. */
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

const emailChangeLinkFor = (origin: string, token: string) =>
  `${origin}/account?emailToken=${encodeURIComponent(token)}`;

const emailChangeCancelLinkFor = (origin: string, token: string) =>
  `${origin}/account?emailCancelToken=${encodeURIComponent(token)}`;

/** Six digits, zero padded. Randomness comes from the platform CSPRNG. */
const generateEmailCode = () => {
  const bytes = crypto.getRandomValues(new Uint32Array(1));

  return String(bytes[0]! % 1_000_000).padStart(6, "0");
};

const emailCodeHash = (authSecret: string, subjectId: string, code: string) =>
  sha256(`${authSecret}:email-code:${subjectId}:${code}`);

const verified = Effect.succeed({ status: "ok" as const });

export type EnterpriseAuthOptions = {
  readonly appAuth: AppAuthService;
  readonly origin: string;
  readonly authSecret: string;
  readonly email?: EmailTransport;
  /** Reply-To for the one-time welcome email. Defaults to the documented address. */
  readonly onboardingReplyTo?: EmailReplyTo;
  /** Support address in the welcome footer. Defaults to the sender address. */
  readonly onboardingSupportEmail?: string | null;
};

export const makeEnterpriseAuthLive = (options: EnterpriseAuthOptions) =>
  Layer.effect(
    EnterpriseAuth,
    Effect.gen(function* () {
      const db = yield* Db;
      const auth = yield* options.appAuth;
      // The real auth runtime always provides step-up. A stub that omits it
      // (tests, or an embedding that only uses bearer tokens) fails closed for
      // every interactive factor instead of skipping the check.
      const stepUpOption = yield* Effect.serviceOption(StepUpService);

      const stepUp: StepUpService["Service"] = Option.isSome(stepUpOption)
        ? stepUpOption.value
        : {
            methods: () => Effect.succeed({ totp: false, passkey: false }),
            verifyTotp: () => Effect.succeed(false),
            beginPasskey: () =>
              Effect.fail(
                new StepUpUnavailable({
                  message: "Step-up is not available on this deployment",
                }),
              ),
            completePasskey: () => Effect.succeed(undefined),
          };

      const { origin, authSecret, email } = options;

      /**
       * The welcome email is a best-effort side effect of proving an address.
       * The claim inside `sendWelcomeEmailOnce` makes it once-only and a
       * provider failure can never turn a successful verification into an
       * error response.
       */
      const sendWelcomeAfterVerification = (user: {
        readonly id: string;
        readonly name: string | null;
        readonly email: string;
        readonly disabled: boolean;
        readonly source: string;
      }) =>
        sendWelcomeEmailOnce({
          db,
          user: { ...user, emailVerified: true },
          email,
          origin,
          replyTo: options.onboardingReplyTo ?? DEFAULT_ONBOARDING_REPLY_TO,
          supportEmail: options.onboardingSupportEmail ?? ONBOARDING_SUPPORT_EMAIL,
        }).pipe(Effect.catchCause(() => Effect.void));

      /**
       * Record the client descriptor for this session and, the first time the
       * session authenticates a request, the sign-in event itself.
       *
       * The auth library owns session creation, so first authenticated use is
       * the earliest point that both the session id and the request headers
       * exist. Failure to record is never allowed to fail authentication: a
       * descriptor is metadata, not a security decision.
       */
      const captureSession = (request: Request, session: Schema.Json | undefined) =>
        Effect.gen(function* () {
          const reference = Option.getOrUndefined(
            Schema.decodeUnknownOption(
              Schema.Struct({
                sessionId: Schema.optional(Schema.String),
                subjectId: Schema.optional(Schema.String),
              }),
            )(session),
          );

          if (!reference?.sessionId || !reference.subjectId) return;

          // Every field below is metadata; nothing here can decide access.
          const descriptor = yield* clientDescriptor(request.headers, authSecret);

          const captured = yield* captureSessionContext(db, {
            sessionId: reference.sessionId,
            userId: reference.subjectId,
            descriptor,
          });

          if (!captured.created) return;

          const user = yield* db.query.user.findFirst({ where: { id: reference.subjectId } });

          yield* recordAccountAudit(db, {
            subjectUserId: reference.subjectId,
            subjectEmail: user?.email ?? null,
            action: ACCOUNT_AUDIT.signIn,
            targetType: "session",
            targetId: reference.sessionId,
            metadata: {
              method: sessionMethod(session) ?? null,
              browser: descriptor.browser,
              platform: descriptor.platform,
              deviceType: descriptor.deviceType,
            },
          });
        }).pipe(Effect.catchCause(() => Effect.void));

      const resolveSession = (request: Request) =>
        Effect.gen(function* () {
          const cookie = parseCookies(request.headers.get("cookie"))[sessionCookie];

          if (!cookie) return undefined;

          const session = yield* auth
            .verifySession(Redacted.make(cookie))
            .pipe(Effect.catch(() => Effect.succeed(undefined)));

          if (!session) return undefined;

          yield* captureSession(request, session);

          return session;
        });

      const resolveApiToken = (request: Request) =>
        Effect.gen(function* () {
          const authorization =
            request.headers.get("authorization") ??
            request.headers.get("x-mattrax-mcp-authorization") ??
            "";

          const match = authorization.match(/^Bearer\s+(.+)$/i);

          if (!match) return undefined;
          const tokenHash = yield* sha256(match[1]);

          const item = yield* db.query.accountApiToken.findFirst({
            where: { tokenHash, revokedAt: { isNull: true } },
          });

          if (!item || (item.expiresAt && item.expiresAt <= new Date())) return undefined;
          yield* db
            .update(schema.accountApiToken)
            .set({ lastUsedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.accountApiToken.id, item.id));

          return item;
        });

      /**
       * MCP OAuth access tokens are opaque and hashed at rest. Resolving one
       * yields the user and the consented client so tenant checks and audit
       * attribution work exactly like they do for an account API token.
       */
      const resolveOAuthToken = (request: Request) =>
        Effect.gen(function* () {
          const authorization =
            request.headers.get("authorization") ??
            request.headers.get("x-mattrax-mcp-authorization") ??
            "";

          const match = authorization.match(/^Bearer\s+(.+)$/i);

          if (!match) return undefined;
          const tokenHash = yield* sha256Base64Url(match[1]);

          const [row] = yield* db
            .select({
              tokenId: schema.mcpOAuthToken.id,
              userId: schema.mcpOAuthConnection.userId,
              connectionId: schema.mcpOAuthConnection.id,
              clientId: schema.mcpOAuthClient.id,
              clientName: schema.mcpOAuthClient.name,
              scopes: schema.mcpOAuthConnection.scopes,
            })
            .from(schema.mcpOAuthToken)
            .innerJoin(
              schema.mcpOAuthConnection,
              eq(schema.mcpOAuthToken.connectionId, schema.mcpOAuthConnection.id),
            )
            .innerJoin(
              schema.mcpOAuthClient,
              eq(schema.mcpOAuthConnection.clientId, schema.mcpOAuthClient.id),
            )
            .where(
              and(
                eq(schema.mcpOAuthToken.tokenHash, tokenHash),
                eq(schema.mcpOAuthToken.kind, "access"),
                isNull(schema.mcpOAuthToken.revokedAt),
                gt(schema.mcpOAuthToken.expiresAt, new Date()),
                isNull(schema.mcpOAuthConnection.revokedAt),
              ),
            )
            .limit(1);

          if (!row) return undefined;
          const now = new Date();
          yield* db
            .update(schema.mcpOAuthToken)
            .set({ lastUsedAt: now })
            .where(eq(schema.mcpOAuthToken.id, row.tokenId));
          yield* db
            .update(schema.mcpOAuthConnection)
            .set({ lastUsedAt: now })
            .where(eq(schema.mcpOAuthConnection.id, row.connectionId));

          return {
            userId: row.userId,
            connectionId: row.connectionId,
            clientId: row.clientId,
            clientName: row.clientName,
            scopes: Array.isArray(row.scopes) ? row.scopes : ["mcp"],
          };
        });

      const requireUser = (requestLike: Request | { headers: HeadersRecord }) =>
        Effect.gen(function* () {
          const request = requestFrom(requestLike);
          const session = yield* resolveSession(request);
          const apiToken = session ? undefined : yield* resolveApiToken(request);
          const oauth = session || apiToken ? undefined : yield* resolveOAuthToken(request);

          if (oauth) {
            const path = new URL(request.url).pathname;
            const method = request.method.toUpperCase();

            const accountPath =
              path.startsWith("/api/v1/account") ||
              (path === "/api/v1/me" && method !== "GET") ||
              path.includes("email-change") ||
              path.includes("email-verification") ||
              path === "/api/v1/verify-email";

            if (accountPath)
              return yield* Effect.fail(
                diagnoseError(
                  new EnterpriseForbidden({
                    message: "MCP tokens cannot manage account settings.",
                  }),
                  { code: "mcp_account_scope" },
                ),
              );
          }

          const userId = session?.subjectId ?? apiToken?.userId ?? oauth?.userId;

          if (!userId)
            return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
          const user = yield* db.query.user.findFirst({ where: { id: userId } });

          if (!user || user.disabled)
            return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));

          return { user, session, apiToken, oauth };
        });

      const listMcpConnections = (request: Request) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);

          const rows = yield* db
            .select({
              id: schema.mcpOAuthConnection.id,
              clientId: schema.mcpOAuthClient.id,
              clientName: schema.mcpOAuthClient.name,
              scopes: schema.mcpOAuthConnection.scopes,
              lastUsedAt: schema.mcpOAuthConnection.lastUsedAt,
              lastAction: schema.mcpOAuthConnection.lastAction,
              requestCount: schema.mcpOAuthConnection.requestCount,
              revokedAt: schema.mcpOAuthConnection.revokedAt,
              createdAt: schema.mcpOAuthConnection.createdAt,
            })
            .from(schema.mcpOAuthConnection)
            .innerJoin(
              schema.mcpOAuthClient,
              eq(schema.mcpOAuthConnection.clientId, schema.mcpOAuthClient.id),
            )
            .where(eq(schema.mcpOAuthConnection.userId, user.id))
            .orderBy(desc(schema.mcpOAuthConnection.createdAt));

          return {
            connections: rows.map((row) => ({
              id: row.id,
              clientId: row.clientId,
              clientName: row.clientName,
              scopes: Array.isArray(row.scopes) ? row.scopes : ["mcp"],
              requestCount: row.requestCount,
              lastAction: row.lastAction,
              lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
              revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
              createdAt: row.createdAt.toISOString(),
            })),
          };
        });

      const revokeMcpConnection = (request: Request, connectionId: string) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);

          const connection = yield* db.query.mcpOAuthConnection.findFirst({
            where: { id: connectionId, userId: user.id },
          });

          if (!connection)
            return yield* Effect.fail(
              diagnoseError(new EnterpriseNotFound({ message: "MCP connection not found" }), {
                code: "mcp_connection_revoked",
              }),
            );
          const revokedAt = new Date();
          yield* db
            .update(schema.mcpOAuthConnection)
            .set({ revokedAt })
            .where(eq(schema.mcpOAuthConnection.id, connection.id));
          yield* db
            .update(schema.mcpOAuthToken)
            .set({ revokedAt })
            .where(eq(schema.mcpOAuthToken.connectionId, connection.id));
          yield* db
            .update(schema.mcpOAuthCode)
            .set({ consumedAt: revokedAt })
            .where(eq(schema.mcpOAuthCode.connectionId, connection.id));

          return { status: "ok" as const };
        });

      const listApiTokens = (request: Request) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);

          const rows = yield* db
            .select()
            .from(schema.accountApiToken)
            .where(eq(schema.accountApiToken.userId, user.id));

          return { tokens: rows.map(tokenInfo) };
        });

      /**
       * Browser sessions must prove recent possession for sensitive actions.
       * Bearer tokens are exempt: they are already an explicitly issued,
       * scoped credential, and a CLI cannot complete an interactive ceremony.
       */
      const requireStepUp = (
        requestLike: Request | { headers: HeadersRecord },
        action: StepUpAction,
      ) =>
        Effect.gen(function* () {
          const request = requestFrom(requestLike);
          const resolved = yield* requireUser(request);

          if (resolved.apiToken || resolved.oauth) return resolved;

          const sessionId = sessionIdOf(resolved.session);
          const grant = request.headers.get("x-mattrax-step-up");

          if (grant && sessionId) {
            const valid = yield* verifyStepUpGrant(authSecret, grant, {
              subjectId: resolved.user.id,
              sessionId,
              action,
            });

            if (valid) return resolved;
          }

          const methods = yield* stepUp.methods(resolved.user.id);

          return yield* Effect.fail(
            new StepUpRequired({
              message: "Confirm this action with your authenticator or passkey.",
              action,
              methods: enabledStepUpMethods(methods),
            }),
          );
        });

      const grant = (
        user: { readonly id: string; readonly email: string },
        sessionId: string,
        action: StepUpAction,
        method: StepUpMethod,
        credentialId?: string,
      ) =>
        Effect.gen(function* () {
          const expiresAtMillis = Date.now() + STEP_UP_WINDOW_MILLIS;

          const token = yield* signStepUpGrant(authSecret, {
            subjectId: user.id,
            email: user.email,
            sessionId,
            action,
            method,
            credentialId,
            expiresAtMillis,
          });

          return { grant: token, expiresAtMillis, method };
        });

      const stepUpMethods = (requestLike: Request | { headers: HeadersRecord }) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(requestFrom(requestLike));

          return yield* stepUp.methods(user.id);
        });

      /** Require a real session (not a bearer token) for interactive step-up. */
      const stepUpSession = (request: Request) =>
        Effect.gen(function* () {
          const resolved = yield* requireUser(request);

          const sessionId = sessionIdOf(resolved.session);

          if (!sessionId)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Step-up is only available for browser sessions",
              }),
            );

          return { user: resolved.user, sessionId };
        });

      const stepUpTotp = (request: Request, body: { code: string; action: StepUpAction }) =>
        Effect.gen(function* () {
          const { user, sessionId } = yield* stepUpSession(request);
          const verified = yield* stepUp.verifyTotp(user.id, body.code);

          if (!verified) {
            const error = yield* invalidStepUp(user, body.action, "totp");

            return yield* Effect.fail(error);
          }

          return yield* grant(user, sessionId, body.action, "totp");
        });

      const beginStepUpPasskey = (request: Request, body: { action: StepUpAction }) =>
        Effect.gen(function* () {
          const { user, sessionId } = yield* stepUpSession(request);
          const started = yield* stepUp.beginPasskey(user.id);

          const stepUpToken = yield* signStepUpFlow(authSecret, {
            subjectId: user.id,
            email: user.email,
            sessionId,
            action: body.action,
            flowId: started.flowId,
            requestBindingVerifier: started.requestBindingVerifier,
            requestBindingExpiresAtMillis: started.requestBindingExpiresAtMillis,
          });

          return {
            stepUpToken,
            expiresAtMillis: started.expiresAtMillis,
            options: started.options,
          };
        });

      const completeStepUpPasskey = (
        request: Request,
        body: { stepUpToken: string; response: string },
      ) =>
        Effect.gen(function* () {
          const { user, sessionId } = yield* stepUpSession(request);

          // The action is carried inside the signed flow token, so a caller
          // cannot complete one action's ceremony to authorise another.
          const bound = yield* verifyAnyStepUpFlow(authSecret, body.stepUpToken, {
            subjectId: user.id,
            sessionId,
          });

          if (!bound)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "This confirmation expired. Start again.",
              }),
            );

          const verified = yield* stepUp.completePasskey({
            subjectId: user.id,
            flowId: bound.flowId,
            requestBindingVerifier: bound.requestBindingVerifier,
            requestBindingExpiresAtMillis: bound.requestBindingExpiresAtMillis,
            response: body.response,
          });

          if (verified === undefined) {
            const error = yield* invalidStepUp(user, bound.action, "passkey");

            return yield* Effect.fail(error);
          }

          return yield* grant(user, sessionId, bound.action, "passkey", verified);
        });

      /**
       * Reject a bad factor without revealing which accounts have one. The
       * failure is auditable here because the account is already known: a
       * first-factor passkey rejection carries no identity, so it cannot be
       * attributed to an account at all.
       */
      const invalidStepUp = (
        user: { readonly id: string; readonly email: string },
        action: StepUpAction,
        method: StepUpMethod,
      ) =>
        Effect.gen(function* () {
          const methods = yield* stepUp.methods(user.id);

          yield* recordAccountAudit(db, {
            subjectUserId: user.id,
            subjectEmail: user.email,
            action: ACCOUNT_AUDIT.stepUpFailed,
            targetType: "step_up",
            targetId: action,
            metadata: { action, method },
          }).pipe(Effect.catchCause(() => Effect.void));

          return new StepUpRequired({
            message: "That confirmation was not accepted. Try again.",
            action,
            methods: enabledStepUpMethods(methods),
          });
        });

      const createApiToken = (
        request: Request,
        body: {
          name: string;
          expiresAt?: string | null;
          scopes?: ApiTokenScope[];
          tenantId?: string | null;
        },
      ) =>
        Effect.gen(function* () {
          const { user, apiToken } = yield* requireStepUp(request, "api-token-create");

          if (!user.emailVerified)
            return yield* Effect.fail(
              new EnterpriseForbidden({
                message: "Verify your email address before creating API tokens.",
              }),
            );
          const name = body.name?.trim();

          if (!name)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Enter a name for the token" }),
            );

          const scopes = normalizeTokenScopes(body.scopes);

          if (!scopes)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Choose valid token scopes" }),
            );

          // A token must not be able to mint a token with more access than it
          // already has, otherwise read-only tenants could be bypassed.
          if (apiToken) {
            const ownScopes = tokenScopes(apiToken.scopes);

            if (!scopes.every((scope) => ownScopes.has(scope)))
              return yield* Effect.fail(
                diagnoseError(
                  new EnterpriseForbidden({
                    message: "An API token cannot create a token with broader scopes",
                  }),
                  { code: "token_scope", reason: "scope_escalation" },
                ),
              );
            const tokenTenantId = body.tenantId ?? null;

            if (apiToken.tenantId && apiToken.tenantId !== tokenTenantId)
              return yield* Effect.fail(
                diagnoseError(
                  new EnterpriseForbidden({
                    message: "A tenant-bound API token can only create tokens for that tenant",
                  }),
                  { code: "token_scope", reason: "tenant_scope_escalation" },
                ),
              );
          }

          const tenantId = body.tenantId ?? null;

          if (tenantId) {
            const member = yield* db.query.member.findFirst({
              where: { userId: user.id, organizationId: tenantId },
            });

            if (!member)
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "Choose a tenant you belong to" }),
              );
          }

          let expiresAt: Date | null = null;

          if (body.expiresAt) {
            const parsed = new Date(body.expiresAt);

            if (Number.isNaN(parsed.getTime()))
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "Choose a valid expiry date" }),
              );

            if (parsed <= new Date())
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "The expiry date must be in the future" }),
              );
            expiresAt = parsed;
          }

          const raw = randomToken("mtx_");
          const now = new Date();
          const tokenHash = yield* sha256(raw);

          const item = {
            id: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
            userId: user.id,
            name,
            tokenPrefix: raw.slice(0, 12),
            tokenHash,
            scopes,
            tenantId,
            lastUsedAt: null,
            expiresAt,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
          };

          yield* db.insert(schema.accountApiToken).values(item);

          yield* recordAccountAudit(db, {
            subjectUserId: user.id,
            subjectEmail: user.email,
            action: ACCOUNT_AUDIT.apiTokenCreated,
            targetType: "api_token",
            targetId: item.id,
            metadata: {
              name,
              scopes,
              tenantId,
              expiresAt: expiresAt ? expiresAt.toISOString() : null,
              // The display prefix only: enough to correlate the row, never the
              // token itself.
              tokenPrefix: item.tokenPrefix,
            },
          }).pipe(Effect.catchCause(() => Effect.void));

          return { token: raw, item: tokenInfo(item) };
        });

      const revokeApiToken = (request: Request, tokenId: string) =>
        Effect.gen(function* () {
          const { user } = yield* requireStepUp(request, "api-token-revoke");

          const revoked = yield* db
            .update(schema.accountApiToken)
            .set({ revokedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(schema.accountApiToken.id, tokenId),
                eq(schema.accountApiToken.userId, user.id),
                isNull(schema.accountApiToken.revokedAt),
              ),
            );

          if (revoked && revoked.affectedRows > 0)
            yield* recordAccountAudit(db, {
              subjectUserId: user.id,
              subjectEmail: user.email,
              action: ACCOUNT_AUDIT.apiTokenRevoked,
              targetType: "api_token",
              targetId: tokenId,
            }).pipe(Effect.catchCause(() => Effect.void));

          return { status: "ok" as const };
        });

      /**
       * Start an email-address change.
       *
       * Possession of the session is not enough: the change needs a step-up
       * grant, because the address is the account's recovery channel. The new
       * address receives the confirmation link and the *old* address receives a
       * cancellation link, so the current owner sees the attempt even if they
       * never clicked anything.
       */
      const requestEmailChange = (request: Request, body: { newEmail: string }) =>
        Effect.gen(function* () {
          const { user } = yield* requireStepUp(request, "email-change");

          if (!user.emailVerified)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Verify your current email address before changing it",
              }),
            );
          const newEmail = body.newEmail.trim().toLowerCase();

          if (!newEmail || !newEmail.includes("@"))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Enter a valid email address" }),
            );

          if (newEmail === user.email.toLowerCase())
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "That is already your email address" }),
            );

          const existing = yield* db.query.user.findFirst({ where: { email: newEmail } });

          if (existing && existing.id !== user.id)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "That email address is already in use" }),
            );

          const now = new Date();
          const confirmToken = randomToken();
          const cancelToken = randomToken();

          // One live request per account: a new request supersedes any pending
          // one, which also invalidates its links.
          yield* db
            .update(schema.accountEmailChange)
            .set({ cancelledAt: now, updatedAt: now })
            .where(
              and(
                eq(schema.accountEmailChange.userId, user.id),
                isNull(schema.accountEmailChange.consumedAt),
                isNull(schema.accountEmailChange.cancelledAt),
              ),
            );

          yield* db.insert(schema.accountEmailChange).values({
            id: newId(),
            userId: user.id,
            oldEmail: user.email,
            newEmail,
            confirmTokenHash: yield* sha256(confirmToken),
            cancelTokenHash: yield* sha256(cancelToken),
            expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS),
            consumedAt: null,
            cancelledAt: null,
            createdAt: now,
            updatedAt: now,
          });

          const confirmLink = emailChangeLinkFor(origin, confirmToken);

          if (email) {
            yield* Effect.tryPromise({
              try: () =>
                email.send({
                  to: newEmail,
                  from: { name: "Mattrax", email: "hello@mattrax.cloud" },
                  subject: "Confirm your new Mattrax email address",
                  text: `Confirm your new Mattrax email address by opening this link:\n\n${confirmLink}\n\nThe link works once and expires in one hour.`,
                  html: `<p>Confirm your new Mattrax email address by opening this link:</p><p><a href="${confirmLink}">${confirmLink}</a></p><p>The link works once and expires in one hour.</p>`,
                }),
              catch: () =>
                new EnterpriseBadRequest({ message: "Could not send the verification email" }),
            });
          } else {
            console.log("CHANGE EMAIL VERIFICATION", user.email, "->", newEmail, confirmLink);
          }

          // The old address is the account's recovery channel, so it is told
          // about the attempt and can stop it without signing in.
          const cancelLink = emailChangeCancelLinkFor(origin, cancelToken);

          if (email) {
            yield* Effect.tryPromise({
              try: () =>
                email.send({
                  to: user.email,
                  from: { name: "Mattrax", email: "hello@mattrax.cloud" },
                  subject: "Your Mattrax email address is being changed",
                  text: `Someone signed in to your Mattrax account and asked to change its email address to ${newEmail}.\n\nIf this was you, no action is needed: the change completes only after the new address confirms it.\n\nIf this was not you, cancel the change here:\n\n${cancelLink}\n\nThe link works once and expires in one hour. Then review your active sessions in Account settings.`,
                  html: `<p>Someone signed in to your Mattrax account and asked to change its email address to <strong>${newEmail}</strong>.</p><p>If this was you, no action is needed: the change completes only after the new address confirms it.</p><p>If this was not you, <a href="${cancelLink}">cancel the change</a>. The link works once and expires in one hour. Then review your active sessions in Account settings.</p>`,
                }),
              // A failure here must not leave the new address holding a live
              // confirmation link, so the request is cancelled below.
              catch: () =>
                new EnterpriseBadRequest({ message: "Could not notify your current address" }),
            }).pipe(
              Effect.catch(() =>
                Effect.gen(function* () {
                  yield* db
                    .update(schema.accountEmailChange)
                    .set({ cancelledAt: new Date(), updatedAt: new Date() })
                    .where(
                      and(
                        eq(schema.accountEmailChange.userId, user.id),
                        isNull(schema.accountEmailChange.consumedAt),
                      ),
                    );

                  return yield* Effect.fail(
                    new EnterpriseBadRequest({ message: "Could not notify your current address" }),
                  );
                }),
              ),
            );
          } else {
            console.log("EMAIL CHANGE NOTICE", user.email, "->", newEmail, cancelLink);
          }

          yield* recordAccountAudit(db, {
            subjectUserId: user.id,
            subjectEmail: user.email,
            action: ACCOUNT_AUDIT.emailChangeRequested,
            targetType: "email",
            targetId: newEmail,
            metadata: { from: user.email, to: newEmail },
          }).pipe(Effect.catchCause(() => Effect.void));

          return { status: "ok" as const };
        });

      const requestEmailVerification = (request: Request) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);

          if (user.emailVerified) return verified;

          const code = generateEmailCode();

          const challenge = yield* signToken(authSecret, {
            sub: user.id,
            email: user.email,
            exp: Date.now() + EMAIL_CODE_TTL_MS,
            purpose: "email-verify-code",
            codeHash: yield* emailCodeHash(authSecret, user.id, code),
          });

          const token = yield* signToken(authSecret, {
            sub: user.id,
            email: user.email,
            exp: Date.now() + 24 * 60 * 60 * 1000,
            purpose: "email-verify",
          });

          const link = `${origin}/verify-email?token=${encodeURIComponent(token)}`;

          if (email) {
            yield* Effect.tryPromise({
              try: () =>
                email.send({
                  to: user.email,
                  from: { name: "Mattrax", email: "hello@mattrax.cloud" },
                  subject: "Your Mattrax verification code",
                  text: `Your Mattrax verification code is ${code}.\n\nIt expires in 15 minutes. You can also verify by opening this link:\n\n${link}\n\nThe link expires in 24 hours.`,
                  html: `<p>Your Mattrax verification code is:</p><p style="font-size:24px;letter-spacing:6px;font-weight:600">${code}</p><p>It expires in 15 minutes.</p><p>You can also verify by opening <a href="${link}">this link</a>. The link expires in 24 hours.</p>`,
                }),
              catch: () =>
                new EnterpriseBadRequest({ message: "Could not send the verification email" }),
            });
          } else {
            console.log("VERIFY EMAIL CODE", user.email, code, link);
          }

          return { status: "ok" as const, challenge };
        });

      const verifyEmail = (
        request: Request,
        body: { token?: string; code?: string; challenge?: string },
      ) =>
        Effect.gen(function* () {
          if (body.code !== undefined) {
            const { user } = yield* requireUser(request);

            if (user.emailVerified) return verified;
            const code = body.code.trim();

            if (!/^\d{6}$/.test(code))
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "Enter the six-digit code" }),
              );

            const challenge = yield* verifyToken(authSecret, body.challenge ?? "").pipe(
              Effect.catch(() =>
                Effect.fail(
                  new EnterpriseBadRequest({
                    message: "Request a new code and try again.",
                  }),
                ),
              ),
            );

            const codeHash = challenge.codeHash;

            if (
              challenge.exp <= Date.now() ||
              challenge.purpose !== "email-verify-code" ||
              codeHash === undefined ||
              challenge.sub !== user.id ||
              challenge.email.toLowerCase() !== user.email.toLowerCase()
            )
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: "That code is invalid or has expired. Request a new one.",
                }),
              );
            const hash = yield* emailCodeHash(authSecret, user.id, code);

            if (hash !== codeHash)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: "That code is invalid or has expired. Request a new one.",
                }),
              );
            yield* db
              .update(schema.user)
              .set({ emailVerified: true, updatedAt: new Date() })
              .where(eq(schema.user.id, user.id));
            yield* db
              .update(authIdentifiers)
              .set({ verifiedAt: Date.now() })
              .where(
                and(eq(authIdentifiers.subjectId, user.id), eq(authIdentifiers.namespace, "email")),
              );
            yield* sendWelcomeAfterVerification(user);

            return { status: "ok" as const };
          }

          const payload = yield* verifyToken(authSecret, body.token ?? "").pipe(
            Effect.catch(() =>
              Effect.fail(new EnterpriseBadRequest({ message: "Invalid or expired token" })),
            ),
          );

          if (payload.exp <= Date.now() || payload.purpose !== "email-verify")
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Invalid or expired token" }),
            );
          const user = yield* db.query.user.findFirst({ where: { id: payload.sub } });

          if (!user || user.email.toLowerCase() !== payload.email.toLowerCase())
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Invalid or expired token" }),
            );
          yield* db
            .update(schema.user)
            .set({ emailVerified: true, updatedAt: new Date() })
            .where(eq(schema.user.id, user.id));
          yield* db
            .update(authIdentifiers)
            .set({ verifiedAt: Date.now() })
            .where(
              and(eq(authIdentifiers.subjectId, user.id), eq(authIdentifiers.namespace, "email")),
            );
          yield* sendWelcomeAfterVerification(user);

          return { status: "ok" as const };
        });

      /**
       * Complete a pending address change.
       *
       * The token is consumed with a conditional update first, so a replay can
       * never apply a second time. Uniqueness is re-checked inside the
       * transaction and a unique-index violation is translated to a 409: the
       * address may have been registered in the hour since the request.
       */
      const verifyEmailChange = (body: { token: string }) =>
        Effect.gen(function* () {
          const invalid = new EnterpriseBadRequest({
            message: "That email change link is invalid or has expired.",
          });

          if (!body.token) return yield* Effect.fail(invalid);

          const now = new Date();
          const tokenHash = yield* sha256(body.token);

          const pending = yield* db.query.accountEmailChange.findFirst({
            where: { confirmTokenHash: tokenHash },
          });

          if (
            !pending ||
            pending.consumedAt != null ||
            pending.cancelledAt != null ||
            new Date(pending.expiresAt).getTime() <= now.getTime()
          )
            return yield* Effect.fail(invalid);

          const user = yield* db.query.user.findFirst({ where: { id: pending.userId } });

          if (!user) return yield* Effect.fail(invalid);

          // The account moved on (a different change completed or the address
          // was changed elsewhere) since the request was made.
          if (user.email.toLowerCase() !== pending.oldEmail.toLowerCase())
            return yield* Effect.fail(invalid);

          const revision = newId();

          yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                const consumed = yield* tx
                  .update(schema.accountEmailChange)
                  .set({ consumedAt: now, updatedAt: now })
                  .where(
                    and(
                      eq(schema.accountEmailChange.id, pending.id),
                      isNull(schema.accountEmailChange.consumedAt),
                      isNull(schema.accountEmailChange.cancelledAt),
                    ),
                  );

                if (!consumed || consumed.affectedRows === 0) return yield* Effect.fail(invalid);

                const clash = yield* tx
                  .select({ id: schema.user.id, email: schema.user.email })
                  .from(schema.user)
                  .where(eq(schema.user.email, pending.newEmail))
                  .limit(1);

                if (clash.some((row: any) => row.id !== user.id))
                  return yield* Effect.fail(
                    new EnterpriseConflict({
                      message: "That email address was registered by someone else. Try another.",
                    }),
                  );

                yield* tx
                  .update(schema.user)
                  .set({
                    email: pending.newEmail,
                    emailVerified: true,
                    // Invalidate every other session: their claims still carry
                    // the old address.
                    authRevision: revision,
                    updatedAt: now,
                  })
                  .where(eq(schema.user.id, user.id));

                yield* tx
                  .update(authIdentifiers)
                  .set({ value: pending.newEmail, verifiedAt: Date.now() })
                  .where(
                    and(
                      eq(authIdentifiers.subjectId, user.id),
                      eq(authIdentifiers.namespace, "email"),
                    ),
                  );

                return true;
              }),
            )
            .pipe(
              // The pre-check inside the transaction can still lose a race with
              // a concurrent registration. Re-read the address on any failure:
              // if it is now taken the request is a conflict, otherwise the
              // original cause (a database fault) is re-raised unchanged.
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  const taken = yield* db
                    .select({ id: schema.user.id })
                    .from(schema.user)
                    .where(eq(schema.user.email, pending.newEmail))
                    .limit(1);

                  if (taken.some((row: any) => row.id !== user.id))
                    return yield* Effect.fail(
                      new EnterpriseConflict({
                        message: "That email address was registered by someone else. Try another.",
                      }),
                    );

                  return yield* Effect.failCause(cause);
                }),
              ),
            );

          yield* recordAccountAudit(db, {
            subjectUserId: user.id,
            subjectEmail: pending.newEmail,
            action: ACCOUNT_AUDIT.emailChangeCompleted,
            targetType: "email",
            targetId: pending.newEmail,
            metadata: { from: pending.oldEmail, to: pending.newEmail },
          }).pipe(Effect.catchCause(() => Effect.void));

          return { status: "ok" as const };
        });

      /**
       * Cancel a pending change from the old address's link. The link is single
       * use and needs no session, because it exists precisely for the case
       * where the account owner is not the one who started the change.
       */
      const cancelEmailChange = (body: { token: string }) =>
        Effect.gen(function* () {
          const now = new Date();
          const tokenHash = yield* sha256(body.token ?? "");

          const pending = yield* db.query.accountEmailChange.findFirst({
            where: { cancelTokenHash: tokenHash },
          });

          if (
            !pending ||
            pending.consumedAt != null ||
            pending.cancelledAt != null ||
            new Date(pending.expiresAt).getTime() <= now.getTime()
          )
            return { status: "ok" as const };

          const cancelled = yield* db
            .update(schema.accountEmailChange)
            .set({ cancelledAt: now, updatedAt: now })
            .where(
              and(
                eq(schema.accountEmailChange.id, pending.id),
                isNull(schema.accountEmailChange.consumedAt),
                isNull(schema.accountEmailChange.cancelledAt),
              ),
            );

          if (!cancelled || cancelled.affectedRows === 0) return { status: "ok" as const };

          yield* recordAccountAudit(db, {
            subjectUserId: pending.userId,
            subjectEmail: pending.oldEmail,
            action: ACCOUNT_AUDIT.emailChangeCancelled,
            targetType: "email",
            targetId: pending.newEmail,
            metadata: {
              from: pending.oldEmail,
              to: pending.newEmail,
              reason: "cancelled_by_owner",
            },
          }).pipe(Effect.catchCause(() => Effect.void));

          return { status: "ok" as const };
        });

      return EnterpriseAuth.of({
        requireUser,
        requireStepUp,
        stepUpMethods,
        stepUpTotp,
        beginStepUpPasskey,
        completeStepUpPasskey,
        listMcpConnections,
        revokeMcpConnection,
        listApiTokens,
        createApiToken,
        revokeApiToken,
        requestEmailChange,
        cancelEmailChange,
        requestEmailVerification,
        verifyEmail,
        verifyEmailChange,
      });
    }),
  );
