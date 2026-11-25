import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { Cause, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import {
  EnterpriseAuth,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseInternal,
  EnterpriseErrorDiagnostics,
  makeEnterpriseErrorDiagnostics,
  EnterpriseNotConfigured,
  EnterpriseNotFound,
  EnterpriseUnauthorized,
  STEP_UP_WINDOW_MILLIS,
  StepUpRequired,
  StepUpService,
  StepUpUnavailable,
  credentialPermissions,
  hasAnyWritePermission,
  hasUnrestrictedCredential,
  normalisePath,
  normalizeCredentialPermissions,
  permissionLabel,
} from "@mattrax/enterprise-domain";
import type {
  EnterpriseAuthFailure,
  Permission,
  StepUpAction,
  StepUpMethod,
} from "@mattrax/enterprise-domain";
import { Db, authIdentifiers, schema } from "@mattrax/enterprise-core";
import { ACCOUNT_AUDIT, clientDescriptor, recordAccountAudit } from "../Account/accountAudit.ts";
import { sessionCookie } from "../Account/auth.ts";
import type { AppAuthService } from "../Account/auth.ts";
import {
  DEFAULT_ONBOARDING_REPLY_TO,
  ONBOARDING_SUPPORT_EMAIL,
  OnboardingEmailWarnings,
  sendWelcomeEmailOnce,
} from "../Tenant/onboardingEmails.ts";
import type { OnboardingEmailBranding } from "../Tenant/onboardingEmail.ts";
import type { EmailAddress, EmailReplyTo, EmailTransport } from "@mattrax/email";
import { DEFAULT_EMAIL_FROM } from "@mattrax/email";
import { sendTransactionalEmail } from "../Mail/emailOutbox.ts";
import {
  emailButton,
  emailCode,
  emailDocument,
  emailFootnote,
  emailHeading,
  emailIsolate,
  emailParagraph,
  emailTextLink,
  resolveEmailBrand,
} from "../Mail/emailLayout.ts";
import { escapeHtml } from "../Mail/emailTemplate.ts";
import {
  signStepUpFlow,
  signStepUpGrant,
  verifyAnyStepUpFlow,
  verifyStepUpGrant,
} from "../Account/stepUp.ts";
import { captureSessionContext } from "../Account/sessions.ts";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";

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

type AccountApiTokenRow = typeof schema.accountApiToken.$inferSelect;

const tokenInfo = (item: AccountApiTokenRow) => {
  const scopes = parseStoredCredentialScopes(item.scopes);

  return {
    id: item.id,
    name: item.name,
    tokenPrefix: item.tokenPrefix,
    scopes: scopes ?? ["read", "write"],
    permissions: [...credentialPermissions(scopes)],
    tenantId: item.tenantId ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    lastUsedAt: item.lastUsedAt ? item.lastUsedAt.toISOString() : null,
    expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
    revokedAt: item.revokedAt ? item.revokedAt.toISOString() : null,
  };
};

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

/**
 * Stored scopes as a list; `null` is a credential created before scopes were
 * introduced and therefore unrestricted. Malformed values fail closed.
 */
export const parseStoredCredentialScopes = (value: Schema.Json | undefined): string[] | null => {
  if (value == null) return null;

  const raw = Schema.is(Schema.String)(value)
    ? parseScopeList(value)
    : Schema.is(Schema.Array(Schema.Json))(value)
      ? value
      : [];

  return raw.flatMap((scope) => (Schema.is(Schema.String)(scope) ? [scope] : []));
};

/** The broad legacy scopes remain valid input for older clients. */
const LEGACY_SCOPES = new Set(["read", "write"]);

/**
 * Normalise a requested grant. Fine-grained permissions are canonicalised and
 * get their read companion; `write` still means every role-allowed permission.
 */
export const normalizeCredentialScopes = (
  permissions: ReadonlyArray<string> | undefined,
  scopes: ReadonlyArray<string> | undefined,
): string[] | undefined => {
  if (permissions !== undefined) {
    const normalized = normalizeCredentialPermissions(permissions);

    return normalized && normalized.length > 0 ? [...normalized] : undefined;
  }

  if (scopes !== undefined) {
    if (scopes.length === 0) return undefined;

    if (scopes.every((scope) => LEGACY_SCOPES.has(scope))) {
      if (scopes.includes("write")) return ["read", "write"];

      return ["read"];
    }

    const normalized = normalizeCredentialPermissions(
      scopes.filter((scope) => scope !== "read" && scope !== "write"),
    );

    if (!normalized) return undefined;

    const base = scopes.includes("write")
      ? ["read" as const, "write" as const]
      : scopes.includes("read")
        ? ["read" as const]
        : [];

    const combined = [...new Set([...base, ...normalized])];

    return combined.length > 0 ? combined : undefined;
  }

  return ["read", "write"];
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

export const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * How often a bearer token's `last_used_at` is refreshed. A dashboard load can
 * fan out several SSR calls with the same token; writing on each one adds a
 * round trip to every request for metadata nobody reads at that resolution.
 */
export const API_TOKEN_USED_REFRESH_MILLIS = 5 * 60 * 1000;

/** An email change must complete within the hour, like a password reset link. */
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

const emailChangeLinkFor = (origin: string, token: string) =>
  `${origin}/account?emailToken=${encodeURIComponent(token)}`;

const emailChangeCancelLinkFor = (origin: string, token: string) =>
  `${origin}/account?emailCancelToken=${encodeURIComponent(token)}`;

/** Six digits, zero padded. Randomness comes from the platform CSPRNG. */
export const generateEmailCode = () => {
  const bytes = crypto.getRandomValues(new Uint32Array(1));

  return String(bytes[0] % 1_000_000).padStart(6, "0");
};

export const emailCodeHash = (authSecret: string, subjectId: string, code: string) =>
  sha256(`${authSecret}:email-code:${subjectId}:${code}`);

const verified = Effect.succeed({ status: "ok" as const });

const authFailure = (cause: Cause.Cause<unknown>): EnterpriseAuthFailure => {
  const error = Cause.squash(cause);

  return error instanceof Error || Schema.is(Schema.Json)(error)
    ? error
    : new EnterpriseInternal({ message: "Authentication failed unexpectedly." });
};

/** Keep upstream auth/Drizzle failures inside the bounded backend contract. */
const bindAuthFailure = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, EnterpriseAuthFailure> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? (Effect.failCause(cause) as Effect.Effect<never, EnterpriseAuthFailure>)
        : Effect.fail(authFailure(cause)),
    ),
  ) as Effect.Effect<A, EnterpriseAuthFailure>;

export type EnterpriseAuthOptions = {
  readonly appAuth: AppAuthService;
  readonly origin: string;
  readonly authSecret: string;
  readonly email?: EmailTransport;
  /** Envelope sender for verification and email-change mail. */
  readonly emailFrom?: EmailAddress;
  /** Reply-To for the one-time welcome email. Defaults to the documented address. */
  readonly onboardingReplyTo?: EmailReplyTo;
  /** Support address in the welcome footer. Defaults to the sender address. */
  readonly onboardingSupportEmail?: string | null;
  /**
   * Deployment-level branding for the welcome email. A new account has no
   * tenant yet, so this is the only branding available at verification time.
   */
  readonly onboardingBranding?: OnboardingEmailBranding | null;
  /** Extra origins allowed to make cookie-authenticated writes. */
  readonly trustedOrigins?: ReadonlyArray<string>;
};

export const makeEnterpriseAuthLive = (options: EnterpriseAuthOptions) =>
  Layer.effect(
    EnterpriseAuth,
    Effect.gen(function* () {
      const db = yield* Db;
      const diagnostics =
        Option.getOrUndefined(yield* Effect.serviceOption(EnterpriseErrorDiagnostics)) ??
        makeEnterpriseErrorDiagnostics();
      const diagnoseError = diagnostics.diagnose;
      const auth = yield* options.appAuth;
      // The real auth runtime always provides step-up. A stub that omits it
      // (tests, or an embedding that only uses bearer tokens) fails closed for
      // every interactive factor instead of skipping the check.
      const stepUpOption = yield* Effect.serviceOption(StepUpService);
      const onboardingWarnings = Option.getOrUndefined(
        yield* Effect.serviceOption(OnboardingEmailWarnings),
      );

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

      /** Normalise an Origin header so trailing slashes or default ports match. */
      const sameOrigin = (left: string, right: string) => {
        try {
          return new URL(left).origin === new URL(right).origin;
        } catch {
          return false;
        }
      };

      const allowedWriteOrigins = [origin, ...(options.trustedOrigins ?? [])];

      const emailFrom = options.emailFrom ?? DEFAULT_EMAIL_FROM;

      const accountBrand = resolveEmailBrand({
        name: options.onboardingBranding?.brandName,
        logoUrl: options.onboardingBranding?.logoUrl,
        brandColor: options.onboardingBranding?.brandColor,
        origin,
      });

      /** Queue one account email, or deliver it through the local mailbox. */
      const deliver = (
        input: {
          readonly template: "email_verification" | "email_change_confirm" | "email_change_notice";
          readonly dedupeKey?: string;
          /** Send within the request; used for codes, which cannot wait. */
          readonly deliverNow?: boolean;
          readonly message: {
            readonly to: string;
            readonly subject: string;
            readonly text: string;
            readonly html: string;
            /** Extra MIME headers (for example `OTP-Token`). */
            readonly headers?: Readonly<Record<string, string>>;
          };
        },
        recipient: string,
        accountId: string,
      ) =>
        sendTransactionalEmail({
          db,
          email,
          template: input.template,
          recipient,
          subjectAccountId: accountId,
          dedupeKey: input.dedupeKey,
          deliverNow: input.deliverNow,
          message: { from: emailFrom, ...input.message },
        });

      /**
       * The welcome email is a best-effort side effect of proving an address.
       * The claim inside `sendWelcomeEmailOnce` makes it once-only and a
       * provider failure can never turn a successful verification into an
       * error response.
       *
       * A deployment that configured `MAIL_FROM` must send from that verified
       * address; the hosted default keeps the founder persona in the From name.
       */
      const onboardingFrom = emailFrom.email === DEFAULT_EMAIL_FROM.email ? undefined : emailFrom;

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
          branding: options.onboardingBranding,
          from: onboardingFrom,
          warnings: onboardingWarnings,
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
            accountId: reference.subjectId,
            descriptor,
          });

          if (!captured.created) return;

          const user = yield* db.query.account.findFirst({ where: { id: reference.subjectId } });

          yield* recordAccountAudit(db, {
            subjectAccountId: reference.subjectId,
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
          const now = DateTime.toDate(yield* DateTime.now);
          const tokenHash = yield* sha256(match[1]);

          const item = yield* db.query.accountApiToken.findFirst({
            where: { tokenHash, revokedAt: { isNull: true } },
          });

          if (!item || (item.expiresAt && item.expiresAt <= now)) return undefined;

          // `last_used_at` is operator metadata, not an authorization input.
          // Refreshing it on every request costs a write round trip on every
          // bearer-authenticated call (SSR and MCP traffic), so it follows the
          // same five-minute floor as the session context.
          const usedAt = item.lastUsedAt;
          const at = now;

          if (!usedAt || at.getTime() - usedAt.getTime() >= API_TOKEN_USED_REFRESH_MILLIS)
            yield* db
              .update(schema.accountApiToken)
              .set({ lastUsedAt: at, updatedAt: at })
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
          const now = DateTime.toDate(yield* DateTime.now);
          const tokenHash = yield* sha256Base64Url(match[1]);

          const [row] = yield* db
            .select({
              tokenId: schema.mcpOAuthToken.id,
              accountId: schema.mcpOAuthConnection.accountId,
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
                gt(schema.mcpOAuthToken.expiresAt, now),
                isNull(schema.mcpOAuthConnection.revokedAt),
              ),
            )
            .limit(1);

          if (!row) return undefined;
          yield* db
            .update(schema.mcpOAuthToken)
            .set({ lastUsedAt: now })
            .where(eq(schema.mcpOAuthToken.id, row.tokenId));
          yield* db
            .update(schema.mcpOAuthConnection)
            .set({ lastUsedAt: now })
            .where(eq(schema.mcpOAuthConnection.id, row.connectionId));

          return {
            accountId: row.accountId,
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

          // Cookie-authenticated mutations need the same Origin + CSRF guard
          // the library applies to its own routes. Bearer tokens are exempt:
          // they are not attached automatically by a browser.
          if (
            session &&
            request.method.toUpperCase() !== "GET" &&
            request.method.toUpperCase() !== "HEAD"
          ) {
            const requestOrigin = request.headers.get("origin");

            if (
              request.headers.get("x-effect-auth-csrf") !== "1" ||
              !requestOrigin ||
              !allowedWriteOrigins.some((allowed) => sameOrigin(allowed, requestOrigin))
            )
              return yield* Effect.fail(
                diagnoseError(
                  new EnterpriseForbidden({ message: "Request origin could not be verified." }),
                  { code: "csrf", reason: "origin_mismatch" },
                ),
              );
          }

          // Authorize the same canonical path the router matched, not the raw
          // URL spelling. Static-segment escapes, case, duplicate slashes,
          // trailing slashes and matrix parameters are router-equivalent.
          const path = normalisePath(new URL(request.url).pathname);
          const method = request.method.toUpperCase();

          const accountPath =
            path === "/api/v1/account" ||
            path.startsWith("/api/v1/account/") ||
            (path === "/api/v1/me" && method !== "GET") ||
            path.includes("email-change") ||
            path.includes("email-verification") ||
            path === "/api/v1/verify-email";

          if (oauth && accountPath)
            return yield* Effect.fail(
              diagnoseError(
                new EnterpriseForbidden({
                  message: "MCP tokens cannot manage account settings.",
                }),
                { code: "mcp_account_scope" },
              ),
            );

          // A narrowed token is a delegated credential: reject mutations
          // before the handler runs. Tenant methods also get the precise
          // per-permission check in `requireTenant`; this guard covers account
          // endpoints, which have no tenant permission of their own.
          if (apiToken && method !== "GET" && method !== "HEAD") {
            const scopes = parseStoredCredentialScopes(apiToken.scopes);

            if (!hasUnrestrictedCredential(scopes)) {
              if (accountPath)
                return yield* Effect.fail(
                  diagnoseError(
                    new EnterpriseForbidden({
                      message: "This API token cannot manage account settings.",
                    }),
                    { code: "token_scope", reason: "account_scope" },
                  ),
                );

              if (!hasAnyWritePermission(credentialPermissions(scopes)))
                return yield* Effect.fail(
                  diagnoseError(
                    new EnterpriseForbidden({
                      message: "This API token only has read access.",
                    }),
                    { code: "token_scope", reason: "write_required" },
                  ),
                );
            }
          }

          const accountId = session?.subjectId ?? apiToken?.accountId ?? oauth?.accountId;

          if (!accountId)
            return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
          const user = yield* db.query.account.findFirst({ where: { id: accountId } });

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
            .where(eq(schema.mcpOAuthConnection.accountId, user.id))
            .orderBy(desc(schema.mcpOAuthConnection.createdAt));

          return {
            connections: rows.map((row) => {
              const scopes = Array.isArray(row.scopes) ? row.scopes : ["mcp"];

              return {
                id: row.id,
                clientId: row.clientId,
                clientName: row.clientName,
                scopes,
                permissions: [...credentialPermissions(scopes)],
                requestCount: row.requestCount,
                lastAction: row.lastAction,
                lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
                revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
                createdAt: row.createdAt.toISOString(),
              };
            }),
          };
        });

      const revokeMcpConnection = (request: Request, connectionId: string) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);

          const connection = yield* db.query.mcpOAuthConnection.findFirst({
            where: { id: connectionId, accountId: user.id },
          });

          if (!connection)
            return yield* Effect.fail(
              diagnoseError(new EnterpriseNotFound({ message: "MCP connection not found" }), {
                code: "mcp_connection_revoked",
              }),
            );
          const revokedAt = DateTime.toDate(yield* DateTime.now);

          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const revoked = yield* tx
                .update(schema.mcpOAuthConnection)
                .set({ revokedAt })
                .where(
                  and(
                    eq(schema.mcpOAuthConnection.id, connection.id),
                    eq(schema.mcpOAuthConnection.accountId, user.id),
                    isNull(schema.mcpOAuthConnection.revokedAt),
                  ),
                );

              if (!revoked || revoked.affectedRows === 0) return;

              yield* tx
                .update(schema.mcpOAuthToken)
                .set({ revokedAt })
                .where(eq(schema.mcpOAuthToken.connectionId, connection.id));
              yield* tx
                .update(schema.mcpOAuthCode)
                .set({ consumedAt: revokedAt })
                .where(eq(schema.mcpOAuthCode.connectionId, connection.id));

              const client = yield* tx.query.mcpOAuthClient.findFirst({
                where: { id: connection.clientId },
              });
              const scopes = (parseStoredCredentialScopes(connection.scopes) ?? ["mcp"]).slice(
                0,
                64,
              );

              yield* recordAccountAudit(tx, {
                subjectAccountId: user.id,
                subjectEmail: user.email,
                action: ACCOUNT_AUDIT.mcpOAuthRevoked,
                targetType: "mcp_oauth_connection",
                targetId: connection.id,
                metadata: {
                  clientId: connection.clientId,
                  clientName: client?.name.slice(0, 160) ?? connection.clientId,
                  connectionId: connection.id,
                  scopes: [...scopes],
                  // Legacy `mcp` is an unrestricted grant; expanding it into
                  // every permission label would bloat the audit row without
                  // making the grant clearer.
                  permissions: scopes.includes("mcp")
                    ? ["mcp"]
                    : [...credentialPermissions(scopes)].map(permissionLabel),
                },
                at: revokedAt,
              });
            }),
          );

          return { status: "ok" as const };
        });

      const listApiTokens = (request: Request) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);

          const rows = yield* db
            .select()
            .from(schema.accountApiToken)
            .where(eq(schema.accountApiToken.accountId, user.id));

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
          const expiresAtMillis =
            DateTime.toEpochMillis(yield* DateTime.now) + STEP_UP_WINDOW_MILLIS;

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
            subjectAccountId: user.id,
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
          scopes?: string[];
          permissions?: Permission[];
          tenantId?: string | null;
        },
      ) =>
        Effect.gen(function* () {
          const { user, apiToken, oauth } = yield* requireStepUp(request, "api-token-create");

          // This invariant does not depend on request spelling or on a caller
          // remembering the account-path guard: MCP OAuth can never mint an
          // independently revocable account API token.
          if (oauth)
            return yield* Effect.fail(
              diagnoseError(
                new EnterpriseForbidden({
                  message: "MCP tokens cannot manage account settings.",
                }),
                { code: "mcp_account_scope", reason: "api_token_create" },
              ),
            );

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

          const scopes = normalizeCredentialScopes(body.permissions, body.scopes);

          if (!scopes)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Choose valid token permissions" }),
            );

          // A token must not be able to mint a token with more access than it
          // already has, otherwise read-only tenants could be bypassed.
          if (apiToken) {
            const ownScopes = credentialPermissions(parseStoredCredentialScopes(apiToken.scopes));

            if ([...credentialPermissions(scopes)].some((permission) => !ownScopes.has(permission)))
              return yield* Effect.fail(
                diagnoseError(
                  new EnterpriseForbidden({
                    message: "An API token cannot create a token with broader permissions",
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
              where: { accountId: user.id, organizationId: tenantId },
            });

            if (!member)
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "Choose a tenant you belong to" }),
              );
          }

          const now = DateTime.toDate(yield* DateTime.now);
          let expiresAt: Date | null = null;

          if (body.expiresAt) {
            const parsed = new Date(body.expiresAt);

            if (Number.isNaN(parsed.getTime()))
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "Choose a valid expiry date" }),
              );

            if (parsed <= now)
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "The expiry date must be in the future" }),
              );
            expiresAt = parsed;
          }

          const raw = randomToken("mtx_");
          const tokenHash = yield* sha256(raw);

          const item = {
            id: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
            accountId: user.id,
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
            subjectAccountId: user.id,
            subjectEmail: user.email,
            action: ACCOUNT_AUDIT.apiTokenCreated,
            targetType: "api_token",
            targetId: item.id,
            metadata: {
              name,
              scopes,
              permissions: [...credentialPermissions(scopes)],
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
          const now = DateTime.toDate(yield* DateTime.now);

          const revoked = yield* db
            .update(schema.accountApiToken)
            .set({ revokedAt: now, updatedAt: now })
            .where(
              and(
                eq(schema.accountApiToken.id, tokenId),
                eq(schema.accountApiToken.accountId, user.id),
                isNull(schema.accountApiToken.revokedAt),
              ),
            );

          if (revoked && revoked.affectedRows > 0)
            yield* recordAccountAudit(db, {
              subjectAccountId: user.id,
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

          const existing = yield* db.query.account.findFirst({ where: { email: newEmail } });

          if (existing && existing.id !== user.id)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "That email address is already in use" }),
            );

          // Both addresses must be reachable: the new one confirms the change
          // and the old one can cancel it. Without a mailer there is no safe
          // way to run the ceremony, so say so instead of logging a link.
          if (!email)
            return yield* Effect.fail(
              new EnterpriseNotConfigured({
                message: "This deployment cannot send email, so the address cannot be changed",
              }),
            );

          const now = DateTime.toDate(yield* DateTime.now);
          const confirmToken = randomToken();
          const cancelToken = randomToken();
          const changeId = newId();

          // One live request per account: a new request supersedes any pending
          // one, which also invalidates its links.
          yield* db
            .update(schema.accountEmailChange)
            .set({ cancelledAt: now, updatedAt: now })
            .where(
              and(
                eq(schema.accountEmailChange.accountId, user.id),
                isNull(schema.accountEmailChange.consumedAt),
                isNull(schema.accountEmailChange.cancelledAt),
              ),
            );

          yield* db.insert(schema.accountEmailChange).values({
            id: changeId,
            accountId: user.id,
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

          /** Abort the ceremony and drop every live link for this account. */
          const abort = (message: string) =>
            Effect.gen(function* () {
              const now = DateTime.toDate(yield* DateTime.now);
              yield* db
                .update(schema.accountEmailChange)
                .set({ cancelledAt: now, updatedAt: now })
                .where(
                  and(
                    eq(schema.accountEmailChange.accountId, user.id),
                    isNull(schema.accountEmailChange.consumedAt),
                  ),
                );

              return yield* Effect.fail(new EnterpriseBadRequest({ message }));
            });

          const confirmationHtml = emailDocument({
            subject: "Confirm your new Mattrax email address",
            preheader: "Confirm the new address for your Mattrax account.",
            brand: accountBrand,
            content: [
              emailHeading("Confirm your new email address"),
              emailParagraph(
                "Confirm the new address for your Mattrax account by opening this link:",
              ),
              emailButton(confirmLink, "Confirm email address", accountBrand),
              emailFootnote(
                `Or paste this link into your browser:<br /><span style="word-break:break-all;">${escapeHtml(
                  confirmLink,
                )}</span>`,
                16,
              ),
              emailParagraph("The link works once and expires in one hour.", { muted: true }),
            ].join("\n"),
            footer: emailFootnote("If you weren't expecting this, ignore this email."),
          });

          const confirmation = yield* deliver(
            {
              template: "email_change_confirm",
              // The address cannot be confirmed until this link arrives.
              deliverNow: true,
              dedupeKey: `email_change_confirm:${changeId}`,
              message: {
                to: newEmail,
                subject: "Confirm your new Mattrax email address",
                text: `Confirm your new Mattrax email address by opening this link:\n\n${confirmLink}\n\nThe link works once and expires in one hour.`,
                html: confirmationHtml,
              },
            },
            newEmail,
            user.id,
          );

          if (confirmation === "failed")
            return yield* abort("Could not send the verification email");

          // The old address is the account's recovery channel, so it is told
          // about the attempt and can stop it without signing in.
          const cancelLink = emailChangeCancelLinkFor(origin, cancelToken);

          const noticeHtml = emailDocument({
            subject: "Your Mattrax email address is being changed",
            preheader: "A change to your Mattrax email address was requested.",
            brand: accountBrand,
            content: [
              emailHeading("Your email address is being changed"),
              emailParagraph(
                `Someone signed in to your Mattrax account and asked to change its email address to <strong>${emailIsolate(
                  newEmail,
                )}</strong>.`,
              ),
              emailParagraph(
                "If this was you, no action is needed: the change completes only after the new address confirms it.",
              ),
              emailParagraph(
                `If this was not you, ${emailTextLink(
                  cancelLink,
                  "cancel the change",
                )}. The link works once and expires in one hour. Then review your active sessions in Account settings.`,
              ),
            ].join("\n"),
            footer: emailFootnote(
              "If you did not request this change, cancel it and review your active sessions.",
            ),
          });

          const notice = yield* deliver(
            {
              template: "email_change_notice",
              dedupeKey: `email_change_notice:${changeId}`,
              message: {
                to: user.email,
                subject: "Your Mattrax email address is being changed",
                text: `Someone signed in to your Mattrax account and asked to change its email address to ${newEmail}.\n\nIf this was you, no action is needed: the change completes only after the new address confirms it.\n\nIf this was not you, cancel the change here:\n\n${cancelLink}\n\nThe link works once and expires in one hour. Then review your active sessions in Account settings.`,
                html: noticeHtml,
              },
            },
            user.email,
            user.id,
          );

          // A failure to queue the notice must not leave the new address
          // holding a live confirmation link.
          if (notice === "failed") return yield* abort("Could not notify your current address");

          yield* recordAccountAudit(db, {
            subjectAccountId: user.id,
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

          if (user.emailVerified) {
            // The account may have been created by a guest sign-up that proved
            // its address before the passkey existed; that path never ran the
            // token verification, so greet the account on its first request.
            yield* sendWelcomeAfterVerification(user);

            return yield* verified;
          }

          const code = generateEmailCode();
          const now = DateTime.toEpochMillis(yield* DateTime.now);

          const challenge = yield* signToken(authSecret, {
            sub: user.id,
            email: user.email,
            exp: now + EMAIL_CODE_TTL_MS,
            purpose: "email-verify-code",
            codeHash: yield* emailCodeHash(authSecret, user.id, code),
          });

          const token = yield* signToken(authSecret, {
            sub: user.id,
            email: user.email,
            exp: now + 24 * 60 * 60 * 1000,
            purpose: "email-verify",
          });

          const link = `${origin}/verify-email?token=${encodeURIComponent(token)}`;

          // Verification gates API-token creation and invitation acceptance,
          // so it must not claim success when no message can be delivered.
          if (!email)
            return yield* Effect.fail(
              new EnterpriseNotConfigured({
                message:
                  "This deployment cannot send email. Ask an administrator to configure a mailer, then request a new code.",
              }),
            );

          const verificationHtml = emailDocument({
            subject: "Your Mattrax verification code",
            preheader: "Use this code to verify your email address.",
            brand: accountBrand,
            content: [
              emailHeading("Verify your email address"),
              emailParagraph("Enter this code on the verification page:"),
              emailCode(code),
              emailParagraph("It expires in 15 minutes.", { muted: true }),
              emailParagraph(
                `You can also verify by opening ${emailTextLink(
                  link,
                  "this link",
                )}. The link expires in 24 hours.`,
              ),
            ].join("\n"),
            footer: emailFootnote("If you weren't expecting this, ignore this email."),
          });

          const delivered = yield* deliver(
            {
              template: "email_verification",
              // A code the person is staring at a form for must not wait for the
              // outbox sweep.
              deliverNow: true,
              message: {
                to: user.email,
                subject: "Your Mattrax verification code",
                // Keep the digits alone on a line for "Copy code" heuristics.
                text: `Your Mattrax verification code is:\n\n${code}\n\nIt expires in 15 minutes. You can also verify by opening this link:\n\n${link}\n\nThe link expires in 24 hours.`,
                html: verificationHtml,
                headers: { "OTP-Token": code },
              },
            },
            user.email,
            user.id,
          );

          return {
            status: "ok" as const,
            challenge,
            emailSent:
              delivered === "queued" || delivered === "duplicate" || delivered === "delivered",
          };
        });

      const verifyEmail = (
        request: Request,
        body: { token?: string; code?: string; challenge?: string },
      ) =>
        Effect.gen(function* () {
          if (body.code !== undefined) {
            const { user } = yield* requireUser(request);

            if (user.emailVerified) {
              // The account may have been created by a guest sign-up that
              // proved its address before the passkey existed; that path never
              // ran the token verification, so greet it on the first request.
              yield* sendWelcomeAfterVerification(user);

              return yield* verified;
            }

            const code = body.code.trim();
            const now = DateTime.toEpochMillis(yield* DateTime.now);

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
              challenge.exp <= now ||
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
              .update(schema.account)
              .set({ emailVerified: true, updatedAt: new Date(now) })
              .where(eq(schema.account.id, user.id));
            yield* db
              .update(authIdentifiers)
              .set({ verifiedAt: now })
              .where(
                and(eq(authIdentifiers.subjectId, user.id), eq(authIdentifiers.namespace, "email")),
              );
            yield* sendWelcomeAfterVerification(user);

            return { status: "ok" as const };
          }

          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const payload = yield* verifyToken(authSecret, body.token ?? "").pipe(
            Effect.catch(() =>
              Effect.fail(new EnterpriseBadRequest({ message: "Invalid or expired token" })),
            ),
          );

          if (payload.exp <= now || payload.purpose !== "email-verify")
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Invalid or expired token" }),
            );
          const user = yield* db.query.account.findFirst({ where: { id: payload.sub } });

          if (!user || user.email.toLowerCase() !== payload.email.toLowerCase())
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Invalid or expired token" }),
            );
          yield* db
            .update(schema.account)
            .set({ emailVerified: true, updatedAt: new Date(now) })
            .where(eq(schema.account.id, user.id));
          yield* db
            .update(authIdentifiers)
            .set({ verifiedAt: now })
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

          const now = DateTime.toDate(yield* DateTime.now);
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

          const user = yield* db.query.account.findFirst({ where: { id: pending.accountId } });

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
                  .select({ id: schema.account.id, email: schema.account.email })
                  .from(schema.account)
                  .where(eq(schema.account.email, pending.newEmail))
                  .limit(1);

                if (clash.some((row) => row.id !== user.id))
                  return yield* Effect.fail(
                    new EnterpriseConflict({
                      message: "That email address was registered by someone else. Try another.",
                    }),
                  );

                // Recovery proves control of the address stored at issuance.
                // Rotating the recovery channel invalidates every live
                // ceremony atomically with the account update.
                yield* tx
                  .update(schema.accountRecovery)
                  .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
                  .where(
                    and(
                      eq(schema.accountRecovery.accountId, user.id),
                      inArray(schema.accountRecovery.status, [
                        "pending_proof",
                        "pending_approval",
                        "ready",
                      ]),
                    ),
                  );

                yield* tx
                  .update(schema.account)
                  .set({
                    email: pending.newEmail,
                    emailVerified: true,
                    // Invalidate every other session: their claims still carry
                    // the old address.
                    authRevision: revision,
                    updatedAt: now,
                  })
                  .where(eq(schema.account.id, user.id));

                yield* tx
                  .update(authIdentifiers)
                  .set({ value: pending.newEmail, verifiedAt: now.getTime() })
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
                Cause.hasInterrupts(cause)
                  ? Effect.failCause(cause)
                  : Effect.gen(function* () {
                      const taken = yield* db
                        .select({ id: schema.account.id })
                        .from(schema.account)
                        .where(eq(schema.account.email, pending.newEmail))
                        .limit(1);

                      if (taken.some((row) => row.id !== user.id))
                        return yield* Effect.fail(
                          new EnterpriseConflict({
                            message:
                              "That email address was registered by someone else. Try another.",
                          }),
                        );

                      return yield* Effect.failCause(cause);
                    }),
              ),
            );

          yield* recordAccountAudit(db, {
            subjectAccountId: user.id,
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
          const now = DateTime.toDate(yield* DateTime.now);
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
            subjectAccountId: pending.accountId,
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
        requireUser: (...args: Parameters<typeof requireUser>) =>
          bindAuthFailure(requireUser(...args)),
        requireStepUp: (...args: Parameters<typeof requireStepUp>) =>
          bindAuthFailure(requireStepUp(...args)),
        stepUpMethods: (...args: Parameters<typeof stepUpMethods>) =>
          bindAuthFailure(stepUpMethods(...args)),
        stepUpTotp: (...args: Parameters<typeof stepUpTotp>) =>
          bindAuthFailure(stepUpTotp(...args)),
        beginStepUpPasskey: (...args: Parameters<typeof beginStepUpPasskey>) =>
          bindAuthFailure(beginStepUpPasskey(...args)),
        completeStepUpPasskey: (...args: Parameters<typeof completeStepUpPasskey>) =>
          bindAuthFailure(completeStepUpPasskey(...args)),
        listMcpConnections: (...args: Parameters<typeof listMcpConnections>) =>
          bindAuthFailure(listMcpConnections(...args)),
        revokeMcpConnection: (...args: Parameters<typeof revokeMcpConnection>) =>
          bindAuthFailure(revokeMcpConnection(...args)),
        listApiTokens: (...args: Parameters<typeof listApiTokens>) =>
          bindAuthFailure(listApiTokens(...args)),
        createApiToken: (...args: Parameters<typeof createApiToken>) =>
          bindAuthFailure(createApiToken(...args)),
        revokeApiToken: (...args: Parameters<typeof revokeApiToken>) =>
          bindAuthFailure(revokeApiToken(...args)),
        requestEmailChange: (...args: Parameters<typeof requestEmailChange>) =>
          bindAuthFailure(requestEmailChange(...args)),
        cancelEmailChange: (...args: Parameters<typeof cancelEmailChange>) =>
          bindAuthFailure(cancelEmailChange(...args)),
        requestEmailVerification: (...args: Parameters<typeof requestEmailVerification>) =>
          bindAuthFailure(requestEmailVerification(...args)),
        verifyEmail: (...args: Parameters<typeof verifyEmail>) =>
          bindAuthFailure(verifyEmail(...args)),
        verifyEmailChange: (...args: Parameters<typeof verifyEmailChange>) =>
          bindAuthFailure(verifyEmailChange(...args)),
      });
    }),
  );
