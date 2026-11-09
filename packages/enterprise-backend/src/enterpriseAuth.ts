import { and, eq } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";
import {
  EnterpriseAuth,
  EnterpriseBadRequest,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { Db, schema } from "@mattrax/enterprise-core";
import { sessionCookie, type AppAuthService } from "./auth.ts";
import { provisionEmailCredential } from "./emailCredential.ts";
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
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  lastUsedAt: item.lastUsedAt ? item.lastUsedAt.toISOString() : null,
  expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
  revokedAt: item.revokedAt ? item.revokedAt.toISOString() : null,
});

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

      const createApiToken = (
        request: Request,
        body: { name: string; expiresAt?: string | null },
      ) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);
          const raw = randomToken("mtx_");
          const now = new Date();
          const tokenHash = yield* sha256(raw);
          const item = {
            id: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
            userId: user.id,
            name: body.name,
            tokenPrefix: raw.slice(0, 12),
            tokenHash,
            lastUsedAt: null,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          yield* db.insert(schema.accountApiToken).values(item);
          return { token: raw, item: tokenInfo(item) };
        });

      const revokeApiToken = (request: Request, tokenId: string) =>
        Effect.gen(function* () {
          const { user } = yield* requireUser(request);
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
          if (payload.exp <= Date.now())
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
          if (payload.exp <= Date.now())
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
