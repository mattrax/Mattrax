import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import {
  EnterpriseBadRequest,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";

export type EnterpriseAuthConfig = {
  readonly db: any;
  readonly schema: any;
  readonly origin: string;
};

const sessionCookie = "mattrax_session";
const sessionDays = 30;
const passwordIterations = 210_000;
const ok = { status: "ok" as const };

const now = () => new Date();
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const iso = (date: Date | null | undefined) => date ? date.toISOString() : null;

const bytesToBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const base64UrlToBytes = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
const randomToken = (prefix = "") => `${prefix}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;

export const sha256 = (value: string) => Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
  Effect.map((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")),
);

const importPasswordKey = (password: string) => crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);

export const hashPassword = (password: string) => Effect.gen(function* () {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = yield* Effect.promise(() => importPasswordKey(password));
  const bits = yield* Effect.promise(() => crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: passwordIterations }, key, 256));
  return `pbkdf2-sha256$${passwordIterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
});

export const verifyPassword = (password: string, stored: string | null | undefined) => Effect.gen(function* () {
  if (!stored) return false;
  const [kind, iterations, saltValue, hashValue] = stored.split("$");
  if (kind !== "pbkdf2-sha256" || !iterations || !saltValue || !hashValue) return false;
  const key = yield* Effect.promise(() => importPasswordKey(password));
  const bits = yield* Effect.promise(() => crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(saltValue), iterations: Number(iterations) }, key, 256));
  const actual = bytesToBase64Url(new Uint8Array(bits));
  return actual === hashValue;
});

const parseCookies = (header: string | null | undefined) => Object.fromEntries((header ?? "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
  const index = part.indexOf("=");
  return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
}));

const cookieHeader = (token: string) => {
  const maxAge = sessionDays * 24 * 60 * 60;
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
};

const clearCookieHeader = () => `${sessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export const userInfo = (user: any) => ({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, image: user.image });

export const createEnterpriseAuth = ({ db, schema, origin }: EnterpriseAuthConfig) => {
  const createSession = (request: Request, userId: string) => Effect.gen(function* () {
    const token = randomToken();
    const createdAt = now();
    const tokenHash = yield* sha256(token);
    yield* db.insert(schema.session).values({
      id: id(),
      tokenHash,
      userId,
      expiresAt: new Date(createdAt.getTime() + sessionDays * 24 * 60 * 60 * 1000),
      ipAddress: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
      createdAt,
      updatedAt: createdAt,
    });
    return token;
  });

  const resolveSession = (request: Request) => Effect.gen(function* () {
    const token = parseCookies(request.headers.get("cookie"))[sessionCookie];
    if (!token) return undefined;
    const tokenHash = yield* sha256(token);
    const session = yield* db.query.session.findFirst({ where: eq(schema.session.tokenHash, tokenHash) });
    if (!session || session.expiresAt <= now()) return undefined;
    const user = yield* db.query.user.findFirst({ where: eq(schema.user.id, session.userId) });
    return user ? { session, user } : undefined;
  });

  const resolveApiToken = (request: Request) => Effect.gen(function* () {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return undefined;
    const tokenHash = yield* sha256(match[1]);
    const item = yield* db.query.accountApiToken.findFirst({ where: and(eq(schema.accountApiToken.tokenHash, tokenHash), isNull(schema.accountApiToken.revokedAt)) });
    if (!item || item.expiresAt && item.expiresAt <= now()) return undefined;
    yield* db.update(schema.accountApiToken).set({ lastUsedAt: now(), updatedAt: now() }).where(eq(schema.accountApiToken.id, item.id));
    const user = yield* db.query.user.findFirst({ where: eq(schema.user.id, item.userId) });
    return user ? { apiToken: item, user } : undefined;
  });

  const requireUser = (requestLike: Request | { headers: Record<string, string | string[] | undefined> }) => Effect.gen(function* () {
    const request = requestLike instanceof Request ? requestLike : new Request(origin, { headers: requestLike.headers as any });
    const session = yield* resolveSession(request);
    const resolved = session ?? (yield* resolveApiToken(request));
    if (!resolved?.user) return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    return resolved;
  });

  const issueVerification = (identifier: string, kind: string, metadata?: unknown) => Effect.gen(function* () {
    const token = randomToken("vrf_");
    const createdAt = now();
    const valueHash = yield* sha256(token);
    yield* db.insert(schema.verification).values({ id: id(), identifier, kind, valueHash, metadata, expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000), createdAt, updatedAt: createdAt });
    return token;
  });

  const tokenInfo = (item: any) => ({ id: item.id, name: item.name, tokenPrefix: item.tokenPrefix, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), lastUsedAt: iso(item.lastUsedAt), expiresAt: iso(item.expiresAt), revokedAt: iso(item.revokedAt) });

  const listApiTokens = (request: Request) => Effect.gen(function* () {
    const { user } = yield* requireUser(request);
    const rows = yield* db.select().from(schema.accountApiToken).where(eq(schema.accountApiToken.userId, user.id));
    return { tokens: rows.map(tokenInfo) };
  });

  const createApiToken = (request: Request, body: any) => Effect.gen(function* () {
    const { user } = yield* requireUser(request);
    const raw = randomToken("mtx_");
    const createdAt = now();
    const tokenHash = yield* sha256(raw);
    const item = { id: id(), userId: user.id, name: body.name, tokenPrefix: raw.slice(0, 12), tokenHash, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, createdAt, updatedAt: createdAt };
    yield* db.insert(schema.accountApiToken).values(item);
    return { token: raw, item: tokenInfo(item) };
  });

  const revokeApiToken = (request: Request, tokenId: string) => Effect.gen(function* () {
    const { user } = yield* requireUser(request);
    yield* db.update(schema.accountApiToken).set({ revokedAt: now(), updatedAt: now() }).where(and(eq(schema.accountApiToken.id, tokenId), eq(schema.accountApiToken.userId, user.id)));
    return ok;
  });

  const authSession = (request: Request) => Effect.gen(function* () {
    const resolved = yield* resolveSession(request);
    return { user: resolved?.user ? userInfo(resolved.user) : undefined };
  });

  const authRegister = (request: Request, body: any) => Effect.gen(function* () {
    const email = normalizeEmail(body.email);
    const createdAt = now();
    const user = { id: id(), name: body.name, email, emailVerified: false, createdAt, updatedAt: createdAt };
    yield* db.insert(schema.user).values(user);
    const password = yield* hashPassword(body.password);
    yield* db.insert(schema.account).values({ id: id(), accountId: email, providerId: "credential", userId: user.id, password, createdAt, updatedAt: createdAt });
    const sessionToken = yield* createSession(request, user.id);
    return yield* HttpServerResponse.json({ user: userInfo(user) }, { headers: { "set-cookie": cookieHeader(sessionToken) } });
  });

  const authLogin = (request: Request, body: any) => Effect.gen(function* () {
    const email = normalizeEmail(body.email);
    const account = yield* db.query.account.findFirst({ where: and(eq(schema.account.providerId, "credential"), eq(schema.account.accountId, email)) });
    const valid = account ? yield* verifyPassword(body.password, account.password) : false;
    if (!account || !valid) {
      return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Invalid email or password" }));
    }
    const user = yield* db.query.user.findFirst({ where: eq(schema.user.id, account.userId) });
    const sessionToken = yield* createSession(request, user.id);
    return yield* HttpServerResponse.json({ user: userInfo(user) }, { headers: { "set-cookie": cookieHeader(sessionToken) } });
  });

  const authLogout = (request: Request) => Effect.gen(function* () {
    const token = parseCookies(request.headers.get("cookie"))[sessionCookie];
    if (token) {
      const tokenHash = yield* sha256(token);
      yield* db.delete(schema.session).where(eq(schema.session.tokenHash, tokenHash));
    }
    return yield* HttpServerResponse.json(ok, { headers: { "set-cookie": clearCookieHeader() } });
  });

  const authForgotPassword = (body: any) => Effect.gen(function* () {
    const email = normalizeEmail(body.email);
    const user = yield* db.query.user.findFirst({ where: eq(schema.user.email, email) });
    if (user) {
      const token = yield* issueVerification(email, "password-reset");
      console.log("RESET EMAIL", email, `${origin}${body.redirectTo ?? "/reset-password"}?token=${token}`);
    }
    return ok;
  });

  const authResetPassword = (body: any) => Effect.gen(function* () {
    const tokenHash = yield* sha256(body.token);
    const verification = yield* db.query.verification.findFirst({ where: and(eq(schema.verification.kind, "password-reset"), eq(schema.verification.valueHash, tokenHash)) });
    if (!verification || verification.expiresAt <= now()) {
      return yield* Effect.fail(new EnterpriseBadRequest({ message: "Invalid or expired token" }));
    }
    const password = yield* hashPassword(body.newPassword);
    yield* db.update(schema.account).set({ password, updatedAt: now() }).where(and(eq(schema.account.providerId, "credential"), eq(schema.account.accountId, verification.identifier)));
    yield* db.delete(schema.verification).where(eq(schema.verification.id, verification.id));
    return ok;
  });

  const authChangePassword = (request: Request, body: any) => Effect.gen(function* () {
    const { user } = yield* requireUser(request);
    const account = yield* db.query.account.findFirst({ where: and(eq(schema.account.providerId, "credential"), eq(schema.account.userId, user.id)) });
    const valid = account ? yield* verifyPassword(body.currentPassword, account.password) : false;
    if (!account || !valid) {
      return yield* Effect.fail(new EnterpriseBadRequest({ message: "Current password is incorrect" }));
    }
    const password = yield* hashPassword(body.newPassword);
    yield* db.update(schema.account).set({ password, updatedAt: now() }).where(eq(schema.account.id, account.id));
    if (body.revokeOtherSessions) yield* db.delete(schema.session).where(eq(schema.session.userId, user.id));
    return ok;
  });

  const authChangeEmail = (request: Request, body: any) => Effect.gen(function* () {
    const { user } = yield* requireUser(request);
    const newEmail = normalizeEmail(body.newEmail);
    const token = yield* issueVerification(user.id, "email-change", { newEmail });
    console.log("CHANGE EMAIL VERIFICATION", user.email, "->", newEmail, `${origin}${body.callbackURL ?? "/account"}?token=${token}`);
    return ok;
  });

  const authVerifyEmailChange = (body: any) => Effect.gen(function* () {
    const tokenHash = yield* sha256(body.token);
    const verification = yield* db.query.verification.findFirst({ where: and(eq(schema.verification.kind, "email-change"), eq(schema.verification.valueHash, tokenHash)) });
    if (!verification || verification.expiresAt <= now()) {
      return yield* Effect.fail(new EnterpriseBadRequest({ message: "Invalid or expired token" }));
    }
    const newEmail = (verification.metadata as any)?.newEmail;
    yield* db.update(schema.user).set({ email: newEmail, emailVerified: true, updatedAt: now() }).where(eq(schema.user.id, verification.identifier));
    yield* db.update(schema.account).set({ accountId: newEmail, updatedAt: now() }).where(and(eq(schema.account.providerId, "credential"), eq(schema.account.userId, verification.identifier)));
    yield* db.delete(schema.verification).where(eq(schema.verification.id, verification.id));
    return ok;
  });

  return { requireUser, authSession, authRegister, authLogin, authLogout, authForgotPassword, authResetPassword, authChangePassword, authChangeEmail, authVerifyEmailChange, listApiTokens, createApiToken, revokeApiToken };
};
