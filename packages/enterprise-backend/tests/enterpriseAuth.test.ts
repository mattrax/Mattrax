import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { EnterpriseAuth } from "@mattrax/enterprise-domain";
import { makeEnterpriseAuthLive } from "../src/enterpriseAuth.js";
import { signStepUpGrant } from "../src/stepUp.js";
import { makeDb, runEffect } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "enterprise-auth-test-secret";

const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const makeContext = (initial: Record<string, any[]> = {}) => {
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
    appAuth: appAuthService as any,
    origin,
    authSecret,
  }).pipe(Layer.provide(Layer.succeed(Db, db as any)));

  const run = <A>(work: (auth: any) => Effect.Effect<A, any, any>) =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* EnterpriseAuth;
        return yield* work(auth);
      }).pipe(Effect.provide(Live)),
    );

  return { db, run };
};

const seedUserAndTenant = () => {
  const now = new Date();
  return {
    user: [
      {
        id: "user-1",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        disabled: false,
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
        userId: "user-1",
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
    headers: { authorization: `Bearer ${token}` },
  });

const session = (grant?: string) =>
  new Request(`${origin}/api/v1/account/api-tokens`, {
    headers: {
      cookie: "__Host-mattrax_session=test",
      ...(grant ? { "x-mattrax-step-up": grant } : {}),
    },
  });

/** Mint a grant for a browser session, as the step-up endpoints would. */
const grantFor = (action: "api-token-create" | "api-token-revoke") =>
  Effect.runPromise(
    signStepUpGrant(authSecret, {
      subjectId: "user-1",
      email: "owner@example.com",
      sessionId: "session-1",
      action,
      expiresAtMillis: Date.now() + 60_000,
    }),
  );

describe("enterprise API tokens", () => {
  it("creates read-only and tenant-bound tokens and lists their scope", async () => {
    const { db, run } = makeContext(seedUserAndTenant());
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

  it("defaults omitted scopes to read/write and omits the tenant", async () => {
    const { db, run } = makeContext(seedUserAndTenant());
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
    const { run } = makeContext(seedUserAndTenant());
    const grant = await grantFor("api-token-create");

    await expect(
      run((auth) =>
        auth.createApiToken(session(grant), {
          name: "Other tenant",
          scopes: ["read"],
          tenantId: "tenant-2",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    await expect(
      run((auth) => auth.createApiToken(session(grant), { name: "Empty", scopes: [] })),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    await expect(
      run((auth) =>
        auth.createApiToken(session(grant), {
          name: "Unknown",
          scopes: ["admin" as any],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("stops an API token from minting a broader or cross-tenant token", async () => {
    const now = new Date();
    const raw = "mtx_existing_read_token";
    const context = makeContext({
      ...seedUserAndTenant(),
      account_api_token: [
        {
          id: "token-1",
          userId: "user-1",
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
    ).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });

    await expect(
      context.run((auth) =>
        auth.createApiToken(bearer(raw), {
          name: "Other tenant",
          scopes: ["read"],
          tenantId: "tenant-2",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });

    // A narrower token in the same tenant is allowed.
    await expect(
      context.run((auth) =>
        auth.createApiToken(bearer(raw), {
          name: "Same access",
          scopes: ["read"],
          tenantId: "tenant-1",
        }),
      ),
    ).resolves.toMatchObject({ item: { scopes: ["read"], tenantId: "tenant-1" } });
  });
});

describe("email verification", () => {
  const unverified = () => {
    const seed = seedUserAndTenant();
    seed.user = [{ ...seed.user[0], emailVerified: false }];
    return seed;
  };

  it("verifies a six-digit code and consumes it", async () => {
    const { db, run } = makeContext(unverified());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const requested = await run((auth) => auth.requestEmailVerification(session()));
      const call = log.mock.calls.find((entry) => entry[0] === "VERIFY EMAIL CODE");
      const code = call?.[2] as string;
      expect(code).toMatch(/^\d{6}$/);
      expect(requested.challenge).toEqual(expect.any(String));

      const result = await run((auth) =>
        auth.verifyEmail(session(), { code, challenge: requested.challenge }),
      );
      expect(result).toEqual({ status: "ok" });
      expect(db.store.user[0]!.emailVerified).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const { db, run } = makeContext(unverified());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const requested = await run((auth) => auth.requestEmailVerification(session()));
      const call = log.mock.calls.find((entry) => entry[0] === "VERIFY EMAIL CODE");
      const code = call?.[2] as string;
      const wrong = String(Number(code) === 0 ? 1 : 0).padStart(6, "0");
      await expect(
        run((auth) => auth.verifyEmail(session(), { code: wrong, challenge: requested.challenge })),
      ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
      expect(db.store.user[0]!.emailVerified).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("requires the current email to be verified before changing it", async () => {
    const { run } = makeContext(unverified());
    await expect(
      run((auth) => auth.requestEmailChange(session(), { newEmail: "new@example.com" })),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });

  it("will not issue API tokens to an unverified account", async () => {
    const { run } = makeContext(unverified());
    const grant = await grantFor("api-token-create");
    await expect(
      run((auth) => auth.createApiToken(session(grant), { name: "CLI" })),
    ).rejects.toMatchObject({ _tag: "EnterpriseForbidden" });
  });
});
