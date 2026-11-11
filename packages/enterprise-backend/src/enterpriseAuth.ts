import { and, eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted } from "effect";
import {
  EnterpriseAuth,
  EnterpriseBadRequest,
  EnterpriseForbidden,
  EnterpriseUnauthorized,
  STEP_UP_WINDOW_MILLIS,
  StepUpRequired,
  StepUpService,
  StepUpUnavailable,
  type StepUpAction,
} from "@mattrax/enterprise-domain";
import { Db, schema } from "@mattrax/enterprise-core";
import { sessionCookie, type AppAuthService } from "./auth.ts";
import { provisionEmailCredential } from "./emailCredential.ts";
import {
  signStepUpFlow,
  signStepUpGrant,
  verifyAnyStepUpFlow,
  verifyStepUpGrant,
} from "./stepUp.ts";
import { signToken, verifyToken } from "./tokens.ts";

type HeadersRecord = Record<string, string | string[] | undefined>;

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

/**
 * Resolve the scopes stored on a token. Tokens created before scoping existed
 * have no scopes and keep full access. Malformed values fail closed.
 */
export const tokenScopes = (value: unknown): Set<ApiTokenScope> => {
  if (value == null) return new Set(API_TOKEN_SCOPES);
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return new Set(
    raw.filter((scope): scope is ApiTokenScope =>
      (API_TOKEN_SCOPES as readonly string[]).includes(scope),
    ),
  );
};

/** Normalise requested scopes into the canonical order, or reject unknowns. */
const normalizeTokenScopes = (scopes: readonly string[] | undefined) => {
  if (scopes === undefined) return [...API_TOKEN_SCOPES] as ApiTokenScope[];
  const requested = new Set(scopes);
  if (requested.size === 0) return undefined;
  if ([...requested].some((scope) => !(API_TOKEN_SCOPES as readonly string[]).includes(scope)))
    return undefined;
  // `write` means read + mutate, so a write token always carries `read`.
  if (requested.has("write")) requested.add("read");
  return API_TOKEN_SCOPES.filter((scope) => requested.has(scope));
};

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

export type EnterpriseAuthOptions = {
  readonly appAuth: AppAuthService;
  readonly origin: string;
  readonly authSecret: string;
  readonly email?: {
    send(message: {
      to: string;
      from: { name: string; email: string };
      subject: string;
      text?: string;
      html?: string;
    }): Promise<unknown>;
  };
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
            methods: () => Effect.succeed({ password: false, totp: false, passkey: false }),
            verifyPassword: () => Effect.succeed(false),
            verifyTotp: () => Effect.succeed(false),
            beginPasskey: () =>
              Effect.fail(
                new StepUpUnavailable({
                  message: "Step-up is not available on this deployment",
                }),
              ),
            completePasskey: () => Effect.succeed(false),
          };
      const { origin, authSecret, email } = options;

      const resolveSession = (request: Request) =>
        Effect.gen(function* () {
          const cookie = parseCookies(request.headers.get("cookie"))[sessionCookie];
          if (!cookie) return undefined;
          return yield* auth
            .verifySession(Redacted.make(cookie))
            .pipe(Effect.catch(() => Effect.succeed(undefined)));
        });

      const resolveApiToken = (request: Request) =>
        Effect.gen(function* () {
          const authorization = request.headers.get("authorization") ?? "";
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

      const requireUser = (requestLike: Request | { headers: HeadersRecord }) =>
        Effect.gen(function* () {
          const request = requestFrom(requestLike);
          const session = yield* resolveSession(request);
          const apiToken = session ? undefined : yield* resolveApiToken(request);
          const userId = session?.subjectId ?? apiToken?.userId;
          if (!userId)
            return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
          const user = yield* db.query.user.findFirst({ where: { id: userId } });
          if (!user || user.disabled)
            return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
          return { user, session, apiToken };
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
          if (resolved.apiToken) return resolved;
          const sessionId = resolved.session?.sessionId as string | undefined;
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
              message: "Confirm this action with your password, authenticator or passkey.",
              action,
              methods: (Object.entries(methods) as Array<[string, boolean]>)
                .filter(([, enabled]) => enabled)
                .map(([name]) => name as "password" | "totp" | "passkey"),
            }),
          );
        });

      const grant = (
        user: { readonly id: string; readonly email: string },
        sessionId: string,
        action: StepUpAction,
        method: "password" | "totp" | "passkey",
      ) =>
        Effect.gen(function* () {
          const expiresAtMillis = Date.now() + STEP_UP_WINDOW_MILLIS;
          const token = yield* signStepUpGrant(authSecret, {
            subjectId: user.id,
            email: user.email,
            sessionId,
            action,
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
          const sessionId = resolved.session?.sessionId as string | undefined;
          if (!sessionId)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Step-up is only available for browser sessions",
              }),
            );
          return { user: resolved.user, sessionId };
        });

      const stepUpPassword = (request: Request, body: { password: string; action: StepUpAction }) =>
        Effect.gen(function* () {
          const { user, sessionId } = yield* stepUpSession(request);
          const verified = yield* stepUp.verifyPassword(user.id, body.password);
          if (!verified) {
            const error = yield* invalidStepUp(user.id, body.action);
            return yield* Effect.fail(error);
          }
          return yield* grant(user, sessionId, body.action, "password");
        });

      const stepUpTotp = (request: Request, body: { code: string; action: StepUpAction }) =>
        Effect.gen(function* () {
          const { user, sessionId } = yield* stepUpSession(request);
          const verified = yield* stepUp.verifyTotp(user.id, body.code);
          if (!verified) {
            const error = yield* invalidStepUp(user.id, body.action);
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
          if (!verified) {
            const error = yield* invalidStepUp(user.id, bound.action);
            return yield* Effect.fail(error);
          }
          return yield* grant(user, sessionId, bound.action, "passkey");
        });

      /** Reject a bad factor without revealing which accounts have one. */
      const invalidStepUp = (subjectId: string, action: StepUpAction) =>
        Effect.gen(function* () {
          const methods = yield* stepUp.methods(subjectId);
          return new StepUpRequired({
            message: "That confirmation was not accepted. Try again.",
            action,
            methods: (Object.entries(methods) as Array<[string, boolean]>)
              .filter(([, enabled]) => enabled)
              .map(([name]) => name as "password" | "totp" | "passkey"),
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
                new EnterpriseForbidden({
                  message: "An API token cannot create a token with broader scopes",
                }),
              );
            const tokenTenantId = body.tenantId ?? null;
            if (apiToken.tenantId && apiToken.tenantId !== tokenTenantId)
              return yield* Effect.fail(
                new EnterpriseForbidden({
                  message: "A tenant-bound API token can only create tokens for that tenant",
                }),
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
          return { token: raw, item: tokenInfo(item) };
        });

      const revokeApiToken = (request: Request, tokenId: string) =>
        Effect.gen(function* () {
          const { user } = yield* requireStepUp(request, "api-token-revoke");
          yield* db
            .update(schema.accountApiToken)
            .set({ revokedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(schema.accountApiToken.id, tokenId),
                eq(schema.accountApiToken.userId, user.id),
              ),
            );
          return { status: "ok" as const };
        });

      const requestEmailChange = (request: Request, body: { newEmail: string }) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);
          const newEmail = body.newEmail.trim().toLowerCase();
          if (!newEmail || !newEmail.includes("@"))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Enter a valid email address" }),
            );
          const existing = yield* db.query.user.findFirst({ where: { email: newEmail } });
          if (existing && existing.id !== user.id)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "That email address is already in use" }),
            );

          const token = yield* signToken(authSecret, {
            sub: user.id,
            email: newEmail,
            exp: Date.now() + 60 * 60 * 1000,
            purpose: "email-change",
          });
          const link = `${origin}/account?emailToken=${encodeURIComponent(token)}`;
          if (email) {
            yield* Effect.tryPromise({
              try: () =>
                email.send({
                  to: newEmail,
                  from: { name: "Mattrax", email: "hello@mattrax.cloud" },
                  subject: "Confirm your new Mattrax email address",
                  text: `Confirm your new Mattrax email address by opening this link:\n\n${link}`,
                  html: `<p>Confirm your new Mattrax email address by opening this link:</p><p><a href="${link}">${link}</a></p>`,
                }),
              catch: () =>
                new EnterpriseBadRequest({ message: "Could not send the verification email" }),
            });
          } else {
            console.log("CHANGE EMAIL VERIFICATION", user.email, "->", newEmail, link);
          }
          return { status: "ok" as const };
        });

      const requestEmailVerification = (request: Request) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);
          if (user.emailVerified) return { status: "ok" as const };
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
                  subject: "Verify your Mattrax email address",
                  text: `Verify your Mattrax email address by opening this link:\n\n${link}\n\nThis link expires in 24 hours.`,
                  html: `<p>Verify your Mattrax email address by opening this link:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
                }),
              catch: () =>
                new EnterpriseBadRequest({ message: "Could not send the verification email" }),
            });
          } else {
            console.log("VERIFY EMAIL", user.email, link);
          }
          return { status: "ok" as const };
        });

      const verifyEmail = (body: { token: string }) =>
        Effect.gen(function* () {
          const payload = yield* verifyToken(authSecret, body.token).pipe(
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
            .update((schema as any).authIdentifiers)
            .set({ verifiedAt: Date.now() })
            .where(
              and(
                eq((schema as any).authIdentifiers.subjectId, user.id),
                eq((schema as any).authIdentifiers.namespace, "email"),
              ),
            );
          yield* provisionEmailCredential(
            db,
            options.appAuth.strategies.email.persistence.moduleId as string,
            user.id,
          );
          return { status: "ok" as const };
        });

      const verifyEmailChange = (body: { token: string }) =>
        Effect.gen(function* () {
          const payload = yield* verifyToken(authSecret, body.token).pipe(
            Effect.catch(() =>
              Effect.fail(new EnterpriseBadRequest({ message: "Invalid or expired token" })),
            ),
          );
          if (payload.exp <= Date.now() || payload.purpose !== "email-change")
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Invalid or expired token" }),
            );

          const user = yield* db.query.user.findFirst({ where: { id: payload.sub } });
          if (!user)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Invalid or expired token" }),
            );

          yield* db
            .update(schema.user)
            .set({ email: payload.email, emailVerified: true, updatedAt: new Date() })
            .where(eq(schema.user.id, user.id));
          yield* db
            .update((schema as any).authIdentifiers)
            .set({ value: payload.email, verifiedAt: Date.now() })
            .where(
              and(
                eq((schema as any).authIdentifiers.subjectId, user.id),
                eq((schema as any).authIdentifiers.namespace, "email"),
              ),
            );
          yield* db
            .update(schema.authEmailCredentials)
            .set({ identifierValue: payload.email })
            .where(eq(schema.authEmailCredentials.subjectId, user.id));
          return { status: "ok" as const };
        });

      return EnterpriseAuth.of({
        requireUser,
        requireStepUp,
        stepUpMethods,
        stepUpPassword,
        stepUpTotp,
        beginStepUpPasskey,
        completeStepUpPasskey,
        listApiTokens,
        createApiToken,
        revokeApiToken,
        requestEmailChange,
        requestEmailVerification,
        verifyEmail,
        verifyEmailChange,
      });
    }),
  );
