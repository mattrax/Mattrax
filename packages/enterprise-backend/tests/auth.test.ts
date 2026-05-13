import { describe, expect, it, vi } from "vitest";
import { createEnterpriseAuth, hashPassword, sha256, verifyPassword } from "../src/auth.js";
import { cookieFrom, header, makeDb, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const makeAuth = () => {
  const db = makeDb();
  return { db, auth: createEnterpriseAuth({ db, schema, origin }) };
};

describe("enterprise auth", () => {
  it("hashes and verifies passwords", async () => {
    const stored = await hashPassword("secret-password");
    expect(stored).toMatch(/^pbkdf2-sha256\$/);
    expect(await verifyPassword("secret-password", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("registers a user, normalizes email, and creates a secure session cookie", async () => {
    const { db, auth } = makeAuth();
    const response = await runEffect(auth.authRegister(new Request(origin, { headers: { "user-agent": "vitest" } }), {
      name: "Test User",
      email: " Test@Example.COM ",
      password: "password-1",
    }));

    expect(db.store.user).toMatchObject([{ name: "Test User", email: "test@example.com", emailVerified: false }]);
    expect(db.store.account[0]).toMatchObject({ accountId: "test@example.com", providerId: "credential", userId: db.store.user[0].id });
    expect(await verifyPassword("password-1", db.store.account[0].password)).toBe(true);
    expect(db.store.session).toHaveLength(1);
    expect(header(response, "set-cookie")).toContain("mattrax_session=");
    expect(header(response, "set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
  });

  it("resolves a valid session and ignores an expired session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    const { auth } = makeAuth();
    const response = await runEffect(auth.authRegister(new Request(origin), { name: "Test", email: "t@example.com", password: "password" }));
    const cookie = cookieFrom(response);

    await expect(runEffect(auth.requireUser(new Request(origin, { headers: { cookie } })))).resolves.toMatchObject({ user: { email: "t@example.com" } });

    vi.setSystemTime(new Date("2025-02-01T00:00:00.000Z"));
    await expect(runEffect(auth.requireUser(new Request(origin, { headers: { cookie } })))).rejects.toThrow("Unauthenticated");
    vi.useRealTimers();
  });

  it("logs in with normalized email and rejects bad credentials", async () => {
    const { auth } = makeAuth();
    await runEffect(auth.authRegister(new Request(origin), { name: "Test", email: "test@example.com", password: "password" }));

    const response = await runEffect(auth.authLogin(new Request(origin), { email: " TEST@example.com ", password: "password" }));
    expect(header(response, "set-cookie")).toContain("mattrax_session=");
    await expect(runEffect(auth.authLogin(new Request(origin), { email: "test@example.com", password: "bad" }))).rejects.toThrow("Invalid email or password");
  });

  it("logs out by deleting the session and clearing the cookie", async () => {
    const { db, auth } = makeAuth();
    const response = await runEffect(auth.authRegister(new Request(origin), { name: "Test", email: "test@example.com", password: "password" }));
    const logout = await runEffect(auth.authLogout(new Request(origin, { headers: { cookie: cookieFrom(response) } })));

    expect(db.store.session).toHaveLength(0);
    expect(header(logout, "set-cookie")).toContain("Max-Age=0");
  });

  it("resets passwords only for valid, unexpired verification tokens", async () => {
    const { db, auth } = makeAuth();
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    db.store.user.push({ id: "user-1", name: "Test", email: "test@example.com", emailVerified: false, createdAt, updatedAt: createdAt });
    db.store.account.push({ id: "account-1", providerId: "credential", accountId: "test@example.com", userId: "user-1", password: await hashPassword("old"), createdAt, updatedAt: createdAt });
    db.store.verification.push({ id: "verification-1", identifier: "test@example.com", kind: "password-reset", valueHash: await sha256("reset-token"), expiresAt: new Date("2025-01-01T01:00:00.000Z"), createdAt, updatedAt: createdAt });

    vi.useFakeTimers();
    vi.setSystemTime(createdAt);
    await expect(runEffect(auth.authResetPassword({ token: "wrong", newPassword: "new" }))).rejects.toThrow("Invalid or expired token");
    await runEffect(auth.authResetPassword({ token: "reset-token", newPassword: "new" }));
    expect(await verifyPassword("new", db.store.account[0].password)).toBe(true);
    expect(db.store.verification).toHaveLength(0);
    vi.useRealTimers();
  });

  it("changes passwords and can revoke other sessions", async () => {
    const { db, auth } = makeAuth();
    const response = await runEffect(auth.authRegister(new Request(origin), { name: "Test", email: "test@example.com", password: "old" }));
    await runEffect(auth.authLogin(new Request(origin), { email: "test@example.com", password: "old" }));
    expect(db.store.session).toHaveLength(2);

    await expect(runEffect(auth.authChangePassword(new Request(origin, { headers: { cookie: cookieFrom(response) } }), { currentPassword: "bad", newPassword: "new" }))).rejects.toThrow("Current password is incorrect");
    await runEffect(auth.authChangePassword(new Request(origin, { headers: { cookie: cookieFrom(response) } }), { currentPassword: "old", newPassword: "new", revokeOtherSessions: true }));

    expect(await verifyPassword("new", db.store.account[0].password)).toBe(true);
    expect(db.store.session).toHaveLength(0);
  });

  it("verifies email change tokens and updates user/account email", async () => {
    const { db, auth } = makeAuth();
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    db.store.user.push({ id: "user-1", name: "Test", email: "old@example.com", emailVerified: false, createdAt, updatedAt: createdAt });
    db.store.account.push({ id: "account-1", providerId: "credential", accountId: "old@example.com", userId: "user-1", password: await hashPassword("password"), createdAt, updatedAt: createdAt });
    db.store.verification.push({ id: "verification-1", identifier: "user-1", kind: "email-change", valueHash: await sha256("email-token"), metadata: { newEmail: "new@example.com" }, expiresAt: new Date("2025-01-01T01:00:00.000Z"), createdAt, updatedAt: createdAt });

    vi.useFakeTimers();
    vi.setSystemTime(createdAt);
    await runEffect(auth.authVerifyEmailChange({ token: "email-token" }));
    expect(db.store.user[0]).toMatchObject({ email: "new@example.com", emailVerified: true });
    expect(db.store.account[0]).toMatchObject({ accountId: "new@example.com" });
    expect(db.store.verification).toHaveLength(0);
    vi.useRealTimers();
  });

  it("supports API tokens with expiry and revocation", async () => {
    const { db, auth } = makeAuth();
    const response = await runEffect(auth.authRegister(new Request(origin), { name: "Test", email: "test@example.com", password: "password" }));
    const { token, item } = await runEffect(auth.createApiToken(new Request(origin, { headers: { cookie: cookieFrom(response) } }), { name: "CI" }));

    expect(item.tokenPrefix).toBe(token.slice(0, 12));
    await expect(runEffect(auth.requireUser(new Request(origin, { headers: { authorization: `Bearer ${token}` } })))).resolves.toMatchObject({ user: { email: "test@example.com" } });
    expect(db.store.account_api_token[0].lastUsedAt).toBeInstanceOf(Date);

    await runEffect(auth.revokeApiToken(new Request(origin, { headers: { cookie: cookieFrom(response) } }), item.id));
    await expect(runEffect(auth.requireUser(new Request(origin, { headers: { authorization: `Bearer ${token}` } })))).rejects.toThrow("Unauthenticated");
  });
});
