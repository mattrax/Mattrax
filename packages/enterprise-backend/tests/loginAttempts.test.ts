import { describe, expect, it } from "vitest";
import {
  LOGIN_ATTEMPT_USER_AGENT_LIMIT,
  PENDING_PROOF_COOKIE,
  approximateNetwork,
  decodeLoginAttemptOutcome,
  listLoginAttempts,
  loginAttemptClient,
  loginAttemptEntry,
  pendingCredentialDigest,
  pruneLoginAttempts,
  recordLoginAttempt,
  recordObservedLoginAttempt,
  signInFactorForPath,
} from "../src/Account/loginAttempts.ts";
import { makeDb, runEffect } from "./helpers.js";

const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const authenticated = (input: { subjectId?: string; email?: string; method?: string }) =>
  JSON.stringify({
    _tag: "Success",
    value: {
      _tag: "Authenticated",
      session: {
        subjectId: input.subjectId ?? "account-1",
        claims: { email: input.email ?? "Owner@Example.com" },
        assurance: { method: input.method ?? "passkey" },
      },
    },
  });

describe("login attempt recording", () => {
  it("records a completed sign-in with the account and method", async () => {
    const db = makeDb();

    await runEffect(
      recordObservedLoginAttempt(db, {
        path: "/api/v1/completePasskeySignIn",
        headers: {
          "user-agent": chrome,
          "x-mattrax-client-address": "203.0.113.77",
        },
        body: authenticated({}),
      }),
    );

    expect(db.store.login_attempt).toMatchObject([
      {
        accountId: "account-1",
        email: "owner@example.com",
        success: true,
        method: "passkey",
        factor: "passkey",
        failureReason: null,
        ip: "203.0.113.0/24",
        userAgent: chrome,
      },
    ]);
  });

  it("drops a rejection that no account can read", async () => {
    const db = makeDb();

    await runEffect(
      recordObservedLoginAttempt(db, {
        path: "/api/v1/completePasskeySignIn",
        headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1", "user-agent": chrome },
        body: JSON.stringify({ _tag: "Failure", error: { _tag: "PasskeyRejected" } }),
      }),
    );

    expect(db.store.login_attempt).toEqual([]);
  });

  it("attributes a rejected TOTP step to the pending account only", async () => {
    const db = makeDb();
    const credential = "a".repeat(43);
    const digest = await runEffect(pendingCredentialDigest(credential));

    db.store.auth_pending.push({
      digest,
      subjectId: "account-1",
      moduleId: "effect-auth/sessions",
      consumed: false,
    });

    await runEffect(
      recordObservedLoginAttempt(db, {
        path: "/api/v1/verifytotppending",
        headers: {
          cookie: `${PENDING_PROOF_COOKIE}=${credential}`,
          "x-mattrax-client-address": "198.51.100.4",
          "user-agent": chrome,
        },
        body: JSON.stringify({ _tag: "Failure", error: { _tag: "TotpRejected" } }),
      }),
    );

    expect(db.store.login_attempt).toMatchObject([
      {
        accountId: "account-1",
        success: false,
        method: "totp",
        factor: "totp",
        failureReason: "mfa_failed",
        ip: "198.51.100.0/24",
      },
    ]);

    const own = await runEffect(listLoginAttempts(db, "account-1"));
    const other = await runEffect(listLoginAttempts(db, "account-2"));

    expect(own).toHaveLength(1);
    expect(other).toEqual([]);
  });

  it("records a passkey sign-in completed with a recovery code", async () => {
    const db = makeDb();

    await runEffect(
      recordObservedLoginAttempt(db, {
        path: "/api/v1/recovertotppending",
        headers: {},
        body: authenticated({ method: "passkey" }),
      }),
    );

    expect(db.store.login_attempt[0]).toMatchObject({
      success: true,
      method: "passkey",
      factor: "recovery",
    });
    // SAFETY: `recordLoginAttempt` inserted the row through the same schema.
    expect(loginAttemptEntry(db.store.login_attempt[0] as never)).toMatchObject({
      method: "passkey",
      factor: "recovery",
    });
  });

  it("does not treat a pending MFA step as a completed login", async () => {
    const db = makeDb();

    await runEffect(
      recordObservedLoginAttempt(db, {
        path: "/api/v1/verifyTotpPending",
        headers: {},
        body: JSON.stringify({
          _tag: "Success",
          value: { _tag: "PendingAuthentication", expiresAt: Date.now() + 60_000 },
        }),
      }),
    );

    expect(db.store.login_attempt).toEqual([]);
  });

  it("keeps only bounded client metadata and never a credential", async () => {
    const db = makeDb();

    await runEffect(
      recordLoginAttempt(db, {
        accountId: "account-1",
        email: "  Owner@Example.com  ",
        success: false,
        method: "totp",
        failureReason: "mfa_failed",
        ip: "2001:db8:abcd:1234:ffff:ffff:ffff:ffff",
        userAgent: "x".repeat(LOGIN_ATTEMPT_USER_AGENT_LIMIT * 2),
      }),
    );

    const row = db.store.login_attempt[0]!;

    expect(row.email).toBe("owner@example.com");
    expect(row.userAgent).toHaveLength(LOGIN_ATTEMPT_USER_AGENT_LIMIT);
    // A caller cannot smuggle a host address past the recorder.
    expect(row.ip).toBe("2001:db8:abcd:1234::/64");
    // The row is exactly the documented columns: no code, token or credential.
    expect(JSON.stringify(row)).not.toContain("123456");
    expect(Object.keys(row).sort()).toEqual(
      [
        "accountId",
        "createdAt",
        "email",
        "factor",
        "failureReason",
        "id",
        "ip",
        "method",
        "success",
        "userAgent",
      ].sort(),
    );
  });

  it("scopes reads to the account and orders newest first", async () => {
    const db = makeDb();

    for (let index = 0; index < 3; index++)
      await runEffect(
        recordLoginAttempt(db, {
          accountId: "account-1",
          success: true,
          method: "passkey",
          at: new Date(2026, 0, 1 + index),
        }),
      );

    await runEffect(
      recordLoginAttempt(db, {
        accountId: "account-2",
        success: true,
        method: "sso",
        at: new Date(2026, 0, 2),
      }),
    );

    // An unattributed discovery rejection belongs to no account and is never
    // returned by a per-account read.
    await runEffect(
      recordLoginAttempt(db, {
        success: false,
        method: "passkey",
        failureReason: "passkey_rejected",
        at: new Date(2026, 0, 3),
      }),
    );

    const rows = await runEffect(listLoginAttempts(db, "account-1"));

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.accountId === "account-1")).toBe(true);
    expect(rows.map((row) => row.createdAt.getDate())).toEqual([3, 2, 1]);
  });

  it("bounds the page even when more rows exist", async () => {
    const db = makeDb();

    for (let index = 0; index < 60; index++)
      await runEffect(
        recordLoginAttempt(db, {
          accountId: "account-1",
          success: true,
          method: "passkey",
          at: new Date(2026, 0, 1, 0, 0, index),
        }),
      );

    const rows = await runEffect(listLoginAttempts(db, "account-1"));

    expect(rows).toHaveLength(50);
    expect(rows[0].createdAt.getSeconds()).toBe(59);
  });

  it("prunes only attempts older than the cutoff", async () => {
    const db = makeDb();

    await runEffect(
      recordLoginAttempt(db, {
        accountId: "account-1",
        success: true,
        method: "passkey",
        at: new Date(2025, 0, 1),
      }),
    );
    await runEffect(
      recordLoginAttempt(db, {
        accountId: "account-1",
        success: false,
        method: "passkey",
        failureReason: "passkey_rejected",
        at: new Date(2026, 0, 1),
      }),
    );

    const pruned = await runEffect(pruneLoginAttempts(db, new Date(2025, 6, 1)));

    expect(pruned).toBe(1);
    expect(db.store.login_attempt).toHaveLength(1);
    expect(db.store.login_attempt[0]!.success).toBe(false);
  });

  it("swallows a storage failure so a sign-in cannot fail because of the log", async () => {
    const db = makeDb();
    db.insert = () => {
      throw new Error("database unavailable");
    };

    await expect(
      runEffect(
        recordLoginAttempt(db, { accountId: "account-1", success: true, method: "passkey" }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("login attempt presentation", () => {
  it("reduces the user agent to a device summary", async () => {
    const db = makeDb();

    await runEffect(
      recordLoginAttempt(db, {
        accountId: "account-1",
        email: "owner@example.com",
        success: true,
        method: "passkey",
        ip: "203.0.113.0/24",
        userAgent: chrome,
      }),
    );

    // SAFETY: `recordLoginAttempt` just inserted this row through the same
    // schema, so it has the select shape `loginAttemptEntry` accepts.
    expect(loginAttemptEntry(db.store.login_attempt[0] as never)).toMatchObject({
      success: true,
      method: "passkey",
      ip: "203.0.113.0/24",
      browser: "Chrome",
      platform: "macOS",
      deviceType: "desktop",
    });
  });

  it("maps auth failures to short documented reasons", () => {
    expect(
      decodeLoginAttemptOutcome(
        JSON.stringify({ _tag: "Failure", error: { _tag: "TotpRejected" } }),
      ),
    ).toEqual({
      status: "failure",
      failureReason: "mfa_failed",
    });
    expect(
      decodeLoginAttemptOutcome(
        JSON.stringify({ _tag: "Failure", error: { _tag: "PendingAuthenticationInvalid" } }),
      ),
    ).toEqual({ status: "failure", failureReason: "expired" });
    expect(decodeLoginAttemptOutcome("not json")).toEqual({ status: "ignored" });
  });

  it("stores an approximate network rather than a host address", () => {
    expect(approximateNetwork("203.0.113.77")).toBe("203.0.113.0/24");
    expect(approximateNetwork("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(approximateNetwork("::ffff:203.0.113.77")).toBe("203.0.113.0/24");
    expect(approximateNetwork("::ffff:cb00:7107")).toBe("203.0.113.0/24");
    expect(approximateNetwork("2001:db8:abcd:1234::1")).toBe("2001:db8:abcd:1234::/64");
    expect(approximateNetwork("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(approximateNetwork("not-an-address")).toBeNull();
    expect(approximateNetwork(null)).toBeNull();
  });

  it("maps normalised completion paths to the completing factor", () => {
    expect(signInFactorForPath("/api/v1/completepasskeysignin")).toBe("passkey");
    expect(signInFactorForPath("/api/v1/verifytotppending")).toBe("totp");
    expect(signInFactorForPath("/api/v1/recovertotppending")).toBe("recovery");
    expect(signInFactorForPath("/api/v1/ssosignin")).toBe("sso");
    expect(signInFactorForPath("/api/v1/recoverysignin")).toBe("recovery");
    expect(signInFactorForPath("/api/v1/beginpasskeysignin")).toBeUndefined();
  });

  it("prefers the assurance method over the completing endpoint", async () => {
    const db = makeDb();

    await runEffect(
      recordObservedLoginAttempt(db, {
        path: "/api/v1/verifyTotpPending",
        headers: {},
        body: authenticated({ method: "passkey" }),
      }),
    );

    expect(db.store.login_attempt[0]!.method).toBe("passkey");
  });

  it("falls back to the endpoint when there is no parsed client header", () => {
    expect(loginAttemptClient({})).toEqual({ ip: null, userAgent: null });
  });

  it("ignores spoofable forwarding headers and the transport peer", () => {
    expect(
      loginAttemptClient(
        {
          "cf-connecting-ip": "203.0.113.7",
          "x-forwarded-for": "203.0.113.7, 198.51.100.9",
          "x-real-ip": "203.0.113.7",
        },
        "198.51.100.9",
      ),
    ).toEqual({ ip: null, userAgent: null });
    expect(loginAttemptClient({ "x-mattrax-client-address": "not-an-ip" }, "198.51.100.9")).toEqual(
      { ip: null, userAgent: null },
    );
  });
});
