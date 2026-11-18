import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseNotConfigured,
  StepUpRequired,
} from "@mattrax/enterprise-domain";
import { makeEnterpriseAuthLive } from "../src/Identity/enterpriseAuth.ts";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import { signStepUpGrant } from "../src/Account/stepUp.ts";
import { makeDb, runEffect } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-auth-test-secret";

const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const makeContext = (
  initial: Record<string, any[]> = {},
  options: { readonly email?: any } = {},
) => {
  const db = makeDb(initial);

  const appAuth = {
    verifySession: () => Effect.succeed({ subjectId: "user-1", sessionId: "session-1" }),
    strategies: { email: { persistence: { moduleId: "email" } } },
  };

  // The production value is the auth definition itself, which is both
  // Effect-like and carries the strategy metadata used when provisioning.
  const appAuthService = Object.assign(Effect.succeed(appAuth), {
    strategies: appAuth.strategies,
  });

  const Live = makeEnterpriseAuthLive({
    // SAFETY: the fake carries only `verifySession` and the strategy metadata the
    // provisioning path reads, not the full auth definition.
    appAuth: appAuthService as any,
    origin,
    authSecret,
    email: options.email,
  }).pipe(Layer.provide(Layer.succeed(Db, db)));

  const run = <A>(work: (auth: EnterpriseAuth["Service"]) => Effect.Effect<A, any, any>) =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* EnterpriseAuth;

        return yield* work(auth);
      }).pipe(Effect.provide(Live)),
    );

  return { db, run };
};

const seedAccountAndTenant = () => {
  const now = new Date();

  return {
    account: [
      {
        id: "user-1",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        disabled: false,
        source: "manual",
        welcomeEmailSentAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    organization: [
      { id: "tenant-1", name: "First", slug: "first", createdAt: now, updatedAt: now },
      { id: "tenant-2", name: "Second", slug: "second", createdAt: now, updatedAt: now },
    ],
    member: [
      {
        id: "member-1",
        organizationId: "tenant-1",
        accountId: "user-1",
        role: "owner",
        createdAt: now,
        updatedAt: now,
      },
    ],
    account_api_token: [],
  };
};

const bearer = (token: string) =>
  new Request(`${origin}/api/v1/account/api-tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

const session = (grant?: string) => {
  const headers = new Headers({ cookie: "__Host-mattrax_session=test" });

  if (grant !== undefined) headers.set("x-mattrax-step-up", grant);

  return new Request(`${origin}/api/v1/account/api-tokens`, { headers });
};

/** Mint a grant for a browser session, as the step-up endpoints would. */
const grantFor = (action: "api-token-create" | "api-token-revoke" | "email-change") =>
  Effect.runPromise(
    signStepUpGrant(authSecret, {
      subjectId: "user-1",
      email: "owner@example.com",
      sessionId: "session-1",
      action,
      method: "totp",
      expiresAtMillis: Date.now() + 60_000,
    }),
  );

describe("enterprise API tokens", () => {
  it("creates read-only and tenant-bound tokens and lists their scope", async () => {
    const { db, run } = makeContext(seedAccountAndTenant());
    const grant = await grantFor("api-token-create");

    const created = await run((auth) =>
      auth.createApiToken(session(grant), {
        name: "Auditor CLI",
        scopes: ["read"],
        tenantId: "tenant-1",
      }),
    );

    expect(created.token).toMatch(/^mtx_/);
    expect(created.item).toMatchObject({
      name: "Auditor CLI",
      scopes: ["read"],
      tenantId: "tenant-1",
    });
    expect(db.store.account_api_token[0]).toMatchObject({
      scopes: ["read"],
      tenantId: "tenant-1",
    });

    const listed = await run((auth) => auth.listApiTokens(session()));
    expect(listed.tokens).toEqual([
      expect.objectContaining({
        id: created.item.id,
        name: "Auditor CLI",
        scopes: ["read"],
        tenantId: "tenant-1",
      }),
    ]);
  });

  it("creates a permission-scoped token and reports its effective grant", async () => {
    const { db, run } = makeContext(seedAccountAndTenant());
    const grant = await grantFor("api-token-create");

    const created = await run((auth) =>
      auth.createApiToken(session(grant), {
        name: "Fleet reader",
        permissions: ["devices.read", "policies.write"],
      }),
    );

    // A write permission carries its read companion.
    expect(created.item.scopes).toEqual([
      "devices.read",
      "policies.read",
      "policies.write",
    ]);
    expect(created.item.permissions).toEqual([
      "devices.read",
      "policies.read",
      "policies.write",
    ]);
    expect(db.store.account_api_token[0]).toMatchObject({
      scopes: ["devices.read", "policies.read", "policies.write"],
    });

    await expect(
      run((auth) =>
        auth.createApiToken(session(grant), { name: "Unknown", permissions: ["devices.explode"] }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      run((auth) => auth.createApiToken(session(grant), { name: "Empty", permissions: [] })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("defaults omitted scopes to read/write and omits the tenant", async () => {
    const { db, run } = makeContext(seedAccountAndTenant());
    const grant = await grantFor("api-token-create");

    const created = await run((auth) =>
      auth.createApiToken(session(grant), { name: "Legacy-compatible" }),
    );

    expect(created.item.scopes).toEqual(["read", "write"]);
    expect(created.item.tenantId).toBeNull();
    expect(db.store.account_api_token[0]).toMatchObject({
      scopes: ["read", "write"],
      tenantId: null,
    });

    // `write` implies `read`, matching the documented read-and-write scope.
    const writeOnly = await run((auth) =>
      auth.createApiToken(session(grant), { name: "Write", scopes: ["write"] }),
    );

    expect(writeOnly.item.scopes).toEqual(["read", "write"]);
  });

  it("rejects tenant bindings the user does not belong to and invalid scopes", async () => {
    const { run } = makeContext(seedAccountAndTenant());
    const grant = await grantFor("api-token-create");

    await expect(
      run((auth) =>
        auth.createApiToken(session(grant), {
          name: "Other tenant",
          scopes: ["read"],
          tenantId: "tenant-2",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      run((auth) => auth.createApiToken(session(grant), { name: "Empty", scopes: [] })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      run((auth) =>
        auth.createApiToken(session(grant), {
          name: "Unknown",
          scopes: ["admin"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("stops a read-scoped token from mutating account security", async () => {
    const now = new Date();
    const raw = "mtx_read_only_mutation";

    const context = makeContext(
      {
        ...seedAccountAndTenant(),
        account_api_token: [
          {
            id: "token-read",
            accountId: "user-1",
            name: "Monitor",
            tokenPrefix: raw.slice(0, 12),
            tokenHash: await sha256(raw),
            scopes: ["read"],
            tenantId: null,
            lastUsedAt: null,
            expiresAt: null,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      { email: makeEmailTransport(async () => {}) },
    );

    await expect(
      context.run((auth) =>
        auth.requestEmailChange(bearer(raw), { newEmail: "attacker@example.com" }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    // A write token is still a bearer credential and reaches the handler.
    const writeRaw = "mtx_write_can_mutate";
    context.db.store.account_api_token.push({
      id: "token-write",
      accountId: "user-1",
      name: "Writer",
      tokenPrefix: writeRaw.slice(0, 12),
      tokenHash: await sha256(writeRaw),
      scopes: ["read", "write"],
      tenantId: null,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      context.run((auth) =>
        auth.requestEmailChange(bearer(writeRaw), { newEmail: "next@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("refreshes a bearer token's last-used time at most once per window", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000);
    const stale = new Date(now.getTime() - 60 * 60_000);

    const context = makeContext({
      ...seedAccountAndTenant(),
      account_api_token: [
        {
          id: "token-recent",
          accountId: "user-1",
          name: "Recent",
          tokenPrefix: "mtx_recent",
          tokenHash: await sha256("mtx_recent_usage"),
          scopes: ["read"],
          tenantId: null,
          lastUsedAt: recent,
          expiresAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "token-stale",
          accountId: "user-1",
          name: "Stale",
          tokenPrefix: "mtx_stale",
          tokenHash: await sha256("mtx_stale_usage"),
          scopes: ["read"],
          tenantId: null,
          lastUsedAt: stale,
          expiresAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const getBearer = (token: string) =>
      new Request(`${origin}/api/v1/account/api-tokens`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });

    await context.run((auth) => auth.listApiTokens(getBearer("mtx_recent_usage")));
    await context.run((auth) => auth.listApiTokens(getBearer("mtx_stale_usage")));

    const byId = new Map(context.db.store.account_api_token.map((row) => [row.id, row]));

    // A dashboard fans out several calls with the same token; a recent use is
    // not rewritten on every one of them.
    expect(byId.get("token-recent")!.lastUsedAt).toEqual(recent);
    // Once the window has passed the usage is recorded.
    expect(byId.get("token-stale")!.lastUsedAt!.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("stops an API token from minting a broader or cross-tenant token", async () => {
    const now = new Date();
    const raw = "mtx_existing_read_token";

    const context = makeContext({
      ...seedAccountAndTenant(),
      account_api_token: [
        {
          id: "token-1",
          accountId: "user-1",
          name: "Existing",
          tokenPrefix: raw.slice(0, 12),
          tokenHash: await sha256(raw),
          scopes: ["read"],
          tenantId: "tenant-1",
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    await expect(
      context.run((auth) =>
        auth.createApiToken(bearer(raw), {
          name: "Escalated",
          scopes: ["read", "write"],
          tenantId: "tenant-1",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    await expect(
      context.run((auth) =>
        auth.createApiToken(bearer(raw), {
          name: "Other tenant",
          scopes: ["read"],
          tenantId: "tenant-2",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    // Read tokens are monitoring credentials: they cannot mint tokens at all,
    // even at the same scope.
    await expect(
      context.run((auth) =>
        auth.createApiToken(bearer(raw), {
          name: "Same access",
          scopes: ["read"],
          tenantId: "tenant-1",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });
});

describe("email verification", () => {
  const unverified = () => {
    const seed = seedAccountAndTenant();
    seed.account = [{ ...seed.account[0], emailVerified: false }];

    return seed;
  };

  it("verifies a six-digit code and consumes it", async () => {
    const sent: Array<{ text: string }> = [];

    const { db, run } = makeContext(unverified(), {
      email: makeEmailTransport(async (message: any) => void sent.push(message), { local: true }),
    });

    const requested = await run((auth) => auth.requestEmailVerification(session()));
    const code = sent[0]!.text.match(/code is (\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(requested.challenge).toEqual(expect.any(String));

    const result = await run((auth) =>
      auth.verifyEmail(session(), { code, challenge: requested.challenge }),
    );

    expect(result).toEqual({ status: "ok" });
    expect(db.store.account[0]!.emailVerified).toBe(true);
  });

  it("queues the code in the outbox for a provider transport", async () => {
    const sent: Array<unknown> = [];

    const { db, run } = makeContext(unverified(), {
      email: makeEmailTransport(async (message: any) => {
        sent.push(message);

        throw new Error("provider down");
      }),
    });

    await run((auth) => auth.requestEmailVerification(session()));

    // The provider is never called from the request; one row is queued.
    expect(sent).toHaveLength(0);
    expect(db.store.email_outbox).toHaveLength(1);
    expect(db.store.email_outbox[0]).toMatchObject({
      recipient: "owner@example.com",
      template: "email_verification",
      subjectAccountId: "user-1",
      status: "pending",
    });
  });

  it("refuses to claim a verification code was sent without a mailer", async () => {
    const { db, run } = makeContext(unverified());

    await expect(run((auth) => auth.requestEmailVerification(session()))).rejects.toBeInstanceOf(
      EnterpriseNotConfigured,
    );
    expect(db.store.account[0]!.emailVerified).toBe(false);
  });

  it("sends one welcome email after code verification", async () => {
    const sent: Array<{
      to: string;
      from: { name: string; email: string };
      replyTo?: string;
      subject: string;
      text: string;
    }> = [];

    const { db, run } = makeContext(unverified(), {
      email: makeEmailTransport(async (message: any) => void sent.push(message), { local: true }),
    });

    const requested = await run((auth) => auth.requestEmailVerification(session()));
    const code = sent[0]!.text.match(/code is (\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);

    await run((auth) => auth.verifyEmail(session(), { code, challenge: requested.challenge }));

    const welcome = sent.filter((message) => message.subject === "Welcome to Mattrax");
    expect(welcome).toHaveLength(1);
    expect(welcome[0]).toMatchObject({
      to: "owner@example.com",
      from: { name: "Oscar from Mattrax", email: "hello@mattrax.cloud" },
      replyTo: "oscar@otbeaumont.me",
    });
    expect(welcome[0]!.text).toContain("Hey Owner,");
    expect(db.store.account[0]!.welcomeEmailSentAt).toBeInstanceOf(Date);

    // A retried verification (or a duplicate hook) must not send again.
    await run((auth) => auth.verifyEmail(session(), { code, challenge: requested.challenge }));

    expect(sent.filter((message) => message.subject === "Welcome to Mattrax")).toHaveLength(1);
  });

  it("sends one welcome email after link verification", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];

    const { run } = makeContext(unverified(), {
      email: makeEmailTransport(async (message: any) => void sent.push(message), { local: true }),
    });

    await run((auth) => auth.requestEmailVerification(session()));
    const token = sent[0]!.text.match(/verify-email\?token=([^\s]+)/)?.[1];
    expect(token).toBeTruthy();

    await run((auth) => auth.verifyEmail(session(), { token: decodeURIComponent(token!) }));
    await run((auth) => auth.verifyEmail(session(), { token: decodeURIComponent(token!) }));

    expect(sent.filter((message) => message.subject === "Welcome to Mattrax")).toHaveLength(1);
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const sent: Array<{ text: string }> = [];

    const { db, run } = makeContext(unverified(), {
      email: makeEmailTransport(async (message: any) => void sent.push(message), { local: true }),
    });

    const requested = await run((auth) => auth.requestEmailVerification(session()));
    const code = sent[0]!.text.match(/code is (\d{6})/)?.[1];
    const wrong = String(Number(code) === 0 ? 1 : 0).padStart(6, "0");
    await expect(
      run((auth) => auth.verifyEmail(session(), { code: wrong, challenge: requested.challenge })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(db.store.account[0]!.emailVerified).toBe(false);
  });

  it("requires the current email to be verified before changing it", async () => {
    const { run } = makeContext(unverified());
    const grant = await grantFor("email-change");

    await expect(
      run((auth) => auth.requestEmailChange(session(grant), { newEmail: "new@example.com" })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("will not issue API tokens to an unverified account", async () => {
    const { run } = makeContext(unverified());
    const grant = await grantFor("api-token-create");
    await expect(
      run((auth) => auth.createApiToken(session(grant), { name: "CLI" })),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });
});

describe("email change ceremony", () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];

  const makeEmailContext = (initial = seedAccountAndTenant()) => {
    sent.length = 0;

    return makeContext(initial, {
      email: makeEmailTransport(async (message: any) => void sent.push(message), { local: true }),
    });
  };

  /** The confirmation and cancellation links the two emails carried. */
  const linksFrom = () => {
    const confirm = sent.find((message) => message.to.startsWith("new@"))?.text;
    const cancel = sent.find((message) => message.text.includes("emailCancelToken"))?.text;

    return {
      confirm: decodeURIComponent(confirm?.match(/emailToken=([^\s]+)/)?.[1] ?? ""),
      cancel: decodeURIComponent(cancel?.match(/emailCancelToken=([^\s]+)/)?.[1] ?? ""),
    };
  };

  it("requires a step-up grant before it will start a change", async () => {
    const { run } = makeEmailContext();

    await expect(
      run((auth) => auth.requestEmailChange(session(), { newEmail: "new@example.com" })),
    ).rejects.toBeInstanceOf(StepUpRequired);
    expect(sent).toHaveLength(0);
  });

  it("refuses an email change when the deployment cannot send email", async () => {
    const { db, run } = makeContext(seedAccountAndTenant());
    const grant = await grantFor("email-change");

    await expect(
      run((auth) => auth.requestEmailChange(session(grant), { newEmail: "new@example.com" })),
    ).rejects.toBeInstanceOf(EnterpriseNotConfigured);
    expect(db.store.account_email_change).toHaveLength(0);
  });

  it("notifies the new address and the old address with a cancel link", async () => {
    const { db, run } = makeEmailContext();
    const grant = await grantFor("email-change");

    await run((auth) => auth.requestEmailChange(session(grant), { newEmail: "new@example.com" }));

    expect(sent).toHaveLength(2);
    expect(sent.map((message) => message.to).sort()).toEqual([
      "new@example.com",
      "owner@example.com",
    ]);
    expect(sent.find((message) => message.to === "owner@example.com")?.subject).toBe(
      "Your Mattrax email address is being changed",
    );
    expect(linksFrom().confirm).toEqual(expect.any(String));
    expect(linksFrom().cancel).toEqual(expect.any(String));
    expect(db.store.account_email_change).toHaveLength(1);
    expect(db.store.account_audit_log.map((row: any) => row.action)).toContain(
      "account.email_change_requested",
    );
  });

  it("bumps the security revision and consumes the token once", async () => {
    const { db, run } = makeEmailContext();
    const grant = await grantFor("email-change");

    await run((auth) => auth.requestEmailChange(session(grant), { newEmail: "new@example.com" }));

    const { confirm } = linksFrom();
    const revisionBefore = db.store.account[0]!.authRevision;
    expect(revisionBefore).toBeUndefined();

    await expect(run((auth) => auth.verifyEmailChange({ token: confirm }))).resolves.toEqual({
      status: "ok",
    });

    expect(db.store.account[0]).toMatchObject({
      email: "new@example.com",
      emailVerified: true,
    });
    expect(db.store.account[0]!.authRevision).toMatch(/^[a-f0-9]{24}$/);
    expect(db.store.account_email_change[0]!.consumedAt).toBeInstanceOf(Date);
    expect(db.store.account_audit_log.map((row: any) => row.action)).toContain(
      "account.email_change_completed",
    );

    await expect(run((auth) => auth.verifyEmailChange({ token: confirm }))).rejects.toBeInstanceOf(
      EnterpriseBadRequest,
    );
    expect(db.store.account[0]!.email).toBe("new@example.com");
  });

  it("returns a conflict when the address is registered during the hour", async () => {
    const { db, run } = makeEmailContext();
    const grant = await grantFor("email-change");

    await run((auth) => auth.requestEmailChange(session(grant), { newEmail: "new@example.com" }));

    // Someone else registers the target address after the request was made.
    const now = new Date();

    db.store.account.push({
      id: "user-2",
      name: "Other",
      email: "new@example.com",
      emailVerified: true,
      disabled: false,
      source: "manual",
      totpEnabled: false,
      passkeyEnabled: true,
      authRevision: "revision-other",
      welcomeEmailSentAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const { confirm } = linksFrom();

    await expect(run((auth) => auth.verifyEmailChange({ token: confirm }))).rejects.toBeInstanceOf(
      EnterpriseConflict,
    );
    expect(db.store.account[0]!.email).toBe("owner@example.com");
  });

  it("cancels from the old address's link and records it", async () => {
    const { db, run } = makeEmailContext();
    const grant = await grantFor("email-change");

    await run((auth) => auth.requestEmailChange(session(grant), { newEmail: "new@example.com" }));

    const { confirm, cancel } = linksFrom();

    await expect(run((auth) => auth.cancelEmailChange({ token: cancel }))).resolves.toEqual({
      status: "ok",
    });
    expect(db.store.account_email_change[0]!.cancelledAt).toBeInstanceOf(Date);
    expect(db.store.account_audit_log.map((row: any) => row.action)).toContain(
      "account.email_change_cancelled",
    );

    // The confirmation link no longer applies.
    await expect(run((auth) => auth.verifyEmailChange({ token: confirm }))).rejects.toBeInstanceOf(
      EnterpriseBadRequest,
    );
    expect(db.store.account[0]!.email).toBe("owner@example.com");
  });

  it("supersedes an unanswered request when a new one starts", async () => {
    const { db, run } = makeEmailContext();
    const grant = await grantFor("email-change");

    await run((auth) => auth.requestEmailChange(session(grant), { newEmail: "first@example.com" }));
    const first = linksFrom().confirm;

    await run((auth) =>
      auth.requestEmailChange(session(grant), { newEmail: "second@example.com" }),
    );

    expect(db.store.account_email_change).toHaveLength(2);
    await expect(run((auth) => auth.verifyEmailChange({ token: first }))).rejects.toBeInstanceOf(
      EnterpriseBadRequest,
    );
  });
});

describe("account audit stream", () => {
  it("records the first authenticated use of a session with its client descriptor", async () => {
    const { db, run } = makeContext(seedAccountAndTenant());

    const request = new Request(`${origin}/api/v1/me`, {
      headers: {
        cookie: "__Host-mattrax_session=test",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "cf-connecting-ip": "203.0.113.9",
      },
    });

    await run((auth) => auth.requireUser(request));

    expect(db.store.account_session_context).toHaveLength(1);
    expect(db.store.account_session_context[0]).toMatchObject({
      sessionId: "session-1",
      accountId: "user-1",
      browser: "Chrome",
      platform: "macOS",
      deviceType: "desktop",
    });
    // The raw address is never stored; the digest is a bounded prefix.
    expect(db.store.account_session_context[0]!.ipHash).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(db.store.account_session_context)).not.toContain("203.0.113.9");

    expect(db.store.account_audit_log).toMatchObject([
      { action: "account.sign_in", targetType: "session", targetId: "session-1" },
    ]);

    // A second request refreshes nothing and does not duplicate the sign-in.
    await run((auth) => auth.requireUser(request));
    expect(db.store.account_audit_log).toHaveLength(1);
  });

  it("records a failed step-up without revealing the factor to the client", async () => {
    const { db, run } = makeContext(seedAccountAndTenant());

    await expect(
      run((auth) => auth.stepUpTotp(session(), { code: "000000", action: "api-token-create" })),
    ).rejects.toBeInstanceOf(StepUpRequired);

    expect(
      db.store.account_audit_log.filter((row: any) => row.action === "account.step_up_failed"),
    ).toMatchObject([
      {
        action: "account.step_up_failed",
        targetType: "step_up",
        targetId: "api-token-create",
      },
    ]);
  });

  it("records API token creation and revocation", async () => {
    const { db, run } = makeContext(seedAccountAndTenant());
    const createGrant = await grantFor("api-token-create");

    const created = await run((auth) =>
      auth.createApiToken(session(createGrant), { name: "CLI", scopes: ["read"] }),
    );

    const revokeGrant = await grantFor("api-token-revoke");

    await run((auth) => auth.revokeApiToken(session(revokeGrant), created.item.id));

    expect(
      db.store.account_audit_log
        .map((row: any) => row.action)
        .filter((action: string) => action.startsWith("account.api_token")),
    ).toEqual(["account.api_token_created", "account.api_token_revoked"]);
  });
});
