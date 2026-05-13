import { and, eq, isNull } from "drizzle-orm";
import { HttpServerResponse } from "effect/unstable/http";

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

export const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const importPasswordKey = (password: string) => crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);

export const hashPassword = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await importPasswordKey(password);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: passwordIterations }, key, 256);
  return `pbkdf2-sha256$${passwordIterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
};

export const verifyPassword = async (password: string, stored: string | null | undefined) => {
  if (!stored) return false;
  const [kind, iterations, saltValue, hashValue] = stored.split("$");
  if (kind !== "pbkdf2-sha256" || !iterations || !saltValue || !hashValue) return false;
  const key = await importPasswordKey(password);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(saltValue), iterations: Number(iterations) }, key, 256);
  const actual = bytesToBase64Url(new Uint8Array(bits));
  return actual === hashValue;
};

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

export const createEnterpriseAuth = ({ db, schema, origin }: EnterpriseAuthConfig): any => {
  const createSession = async (request: Request, userId: string) => {
    const token = randomToken();
    const createdAt = now();
    await db.insert(schema.session).values({
      id: id(),
      tokenHash: await sha256(token),
      userId,
      expiresAt: new Date(createdAt.getTime() + sessionDays * 24 * 60 * 60 * 1000),
      ipAddress: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
      createdAt,
      updatedAt: createdAt,
    });
    return token;
  };

  const resolveSession = async (request: Request) => {
    const token = parseCookies(request.headers.get("cookie"))[sessionCookie];
    if (!token) return undefined;
    const session = await db.query.session.findFirst({ where: eq(schema.session.tokenHash, await sha256(token)) });
    if (!session || session.expiresAt <= now()) return undefined;
    const user = await db.query.user.findFirst({ where: eq(schema.user.id, session.userId) });
    return user ? { session, user } : undefined;
  };

  const resolveApiToken = async (request: Request) => {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return undefined;
    const item = await db.query.accountApiToken.findFirst({ where: and(eq(schema.accountApiToken.tokenHash, await sha256(match[1])), isNull(schema.accountApiToken.revokedAt)) });
    if (!item || item.expiresAt && item.expiresAt <= now()) return undefined;
    await db.update(schema.accountApiToken).set({ lastUsedAt: now(), updatedAt: now() }).where(eq(schema.accountApiToken.id, item.id));
    const user = await db.query.user.findFirst({ where: eq(schema.user.id, item.userId) });
    return user ? { apiToken: item, user } : undefined;
  };

  const requireUser = async (requestLike: Request | { headers: Record<string, string | string[] | undefined> }) => {
    const request = requestLike instanceof Request ? requestLike : new Request(origin, { headers: requestLike.headers as any });
    const resolved = await resolveSession(request) ?? await resolveApiToken(request);
    if (!resolved?.user) throw new Error("Unauthenticated");
    return resolved;
  };

  const issueVerification = async (identifier: string, kind: string, metadata?: unknown) => {
    const token = randomToken("vrf_");
    const createdAt = now();
    await db.insert(schema.verification).values({ id: id(), identifier, kind, valueHash: await sha256(token), metadata, expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000), createdAt, updatedAt: createdAt });
    return token;
  };

  const listApiTokens = async (request: Request) => {
    const { user } = await requireUser(request);
    const rows = await db.select().from(schema.accountApiToken).where(eq(schema.accountApiToken.userId, user.id));
    return { tokens: rows.map(tokenInfo) };
  };

  const tokenInfo = (item: any) => ({ id: item.id, name: item.name, tokenPrefix: item.tokenPrefix, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), lastUsedAt: iso(item.lastUsedAt), expiresAt: iso(item.expiresAt), revokedAt: iso(item.revokedAt) });

  const createApiToken = async (request: Request, body: any) => {
    const { user } = await requireUser(request);
    const raw = randomToken("mtx_");
    const createdAt = now();
    const item = { id: id(), userId: user.id, name: body.name, tokenPrefix: raw.slice(0, 12), tokenHash: await sha256(raw), expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, createdAt, updatedAt: createdAt };
    await db.insert(schema.accountApiToken).values(item);
    return { token: raw, item: tokenInfo(item) };
  };

  const revokeApiToken = async (request: Request, tokenId: string) => {
    const { user } = await requireUser(request);
    await db.update(schema.accountApiToken).set({ revokedAt: now(), updatedAt: now() }).where(and(eq(schema.accountApiToken.id, tokenId), eq(schema.accountApiToken.userId, user.id)));
    return ok;
  };

  const authSession = async (request: Request) => {
    const resolved = await resolveSession(request);
    return { user: resolved?.user ? userInfo(resolved.user) : undefined };
  };

  const authRegister = async (request: Request, body: any) => {
    const email = normalizeEmail(body.email);
    const createdAt = now();
    const user = { id: id(), name: body.name, email, emailVerified: false, createdAt, updatedAt: createdAt };
    await db.insert(schema.user).values(user);
    await db.insert(schema.account).values({ id: id(), accountId: email, providerId: "credential", userId: user.id, password: await hashPassword(body.password), createdAt, updatedAt: createdAt });
    const sessionToken = await createSession(request, user.id);
    return HttpServerResponse.json({ user: userInfo(user) }, { headers: { "set-cookie": cookieHeader(sessionToken) } });
  };

  const authLogin = async (request: Request, body: any) => {
    const email = normalizeEmail(body.email);
    const account = await db.query.account.findFirst({ where: and(eq(schema.account.providerId, "credential"), eq(schema.account.accountId, email)) });
    if (!account || !await verifyPassword(body.password, account.password)) throw new Error("Invalid email or password");
    const user = await db.query.user.findFirst({ where: eq(schema.user.id, account.userId) });
    const sessionToken = await createSession(request, user.id);
    return HttpServerResponse.json({ user: userInfo(user) }, { headers: { "set-cookie": cookieHeader(sessionToken) } });
  };

  const authLogout = async (request: Request) => {
    const token = parseCookies(request.headers.get("cookie"))[sessionCookie];
    if (token) await db.delete(schema.session).where(eq(schema.session.tokenHash, await sha256(token)));
    return HttpServerResponse.json(ok, { headers: { "set-cookie": clearCookieHeader() } });
  };

  const authForgotPassword = async (body: any) => {
    const email = normalizeEmail(body.email);
    const user = await db.query.user.findFirst({ where: eq(schema.user.email, email) });
    if (user) console.log("RESET EMAIL", email, `${origin}${body.redirectTo ?? "/reset-password"}?token=${await issueVerification(email, "password-reset")}`);
    return ok;
  };

  const authResetPassword = async (body: any) => {
    const verification = await db.query.verification.findFirst({ where: and(eq(schema.verification.kind, "password-reset"), eq(schema.verification.valueHash, await sha256(body.token))) });
    if (!verification || verification.expiresAt <= now()) throw new Error("Invalid or expired token");
    await db.update(schema.account).set({ password: await hashPassword(body.newPassword), updatedAt: now() }).where(and(eq(schema.account.providerId, "credential"), eq(schema.account.accountId, verification.identifier)));
    await db.delete(schema.verification).where(eq(schema.verification.id, verification.id));
    return ok;
  };

  const authChangePassword = async (request: Request, body: any) => {
    const { user } = await requireUser(request);
    const account = await db.query.account.findFirst({ where: and(eq(schema.account.providerId, "credential"), eq(schema.account.userId, user.id)) });
    if (!account || !await verifyPassword(body.currentPassword, account.password)) throw new Error("Current password is incorrect");
    await db.update(schema.account).set({ password: await hashPassword(body.newPassword), updatedAt: now() }).where(eq(schema.account.id, account.id));
    if (body.revokeOtherSessions) await db.delete(schema.session).where(eq(schema.session.userId, user.id));
    return ok;
  };

  const authChangeEmail = async (request: Request, body: any) => {
    const { user } = await requireUser(request);
    const newEmail = normalizeEmail(body.newEmail);
    console.log("CHANGE EMAIL VERIFICATION", user.email, "->", newEmail, `${origin}${body.callbackURL ?? "/account"}?token=${await issueVerification(user.id, "email-change", { newEmail })}`);
    return ok;
  };

  const authVerifyEmailChange = async (body: any) => {
    const verification = await db.query.verification.findFirst({ where: and(eq(schema.verification.kind, "email-change"), eq(schema.verification.valueHash, await sha256(body.token))) });
    if (!verification || verification.expiresAt <= now()) throw new Error("Invalid or expired token");
    const newEmail = (verification.metadata as any)?.newEmail;
    await db.update(schema.user).set({ email: newEmail, emailVerified: true, updatedAt: now() }).where(eq(schema.user.id, verification.identifier));
    await db.update(schema.account).set({ accountId: newEmail, updatedAt: now() }).where(and(eq(schema.account.providerId, "credential"), eq(schema.account.userId, verification.identifier)));
    await db.delete(schema.verification).where(eq(schema.verification.id, verification.id));
    return ok;
  };

  return { requireUser, authSession, authRegister, authLogin, authLogout, authForgotPassword, authResetPassword, authChangePassword, authChangeEmail, authVerifyEmailChange, listApiTokens, createApiToken, revokeApiToken };
};
