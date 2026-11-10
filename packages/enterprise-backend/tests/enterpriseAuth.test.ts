import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { EnterpriseAuth } from "@mattrax/enterprise-domain";
import { makeEnterpriseAuthLive } from "../src/enterpriseAuth.js";
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
  };
  const Live = makeEnterpriseAuthLive({
    appAuth: Effect.succeed(appAuth) as any,
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

const session = () =>
  new Request(`${origin}/api/v1/account/api-tokens`, {
    headers: { cookie: "__Host-mattrax_session=test" },
  });

describe("enterprise API tokens", () => {
  it("creates read-only and tenant-bound tokens and lists their scope", async () => {
    const { db, run } = makeContext(seedUserAndTenant());

    const created = await run((auth) =>
      auth.createApiToken(session(), {
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

    const created = await run((auth) =>
      auth.createApiToken(session(), { name: "Legacy-compatible" }),
    );
    expect(created.item.scopes).toEqual(["read", "write"]);
    expect(created.item.tenantId).toBeNull();
    expect(db.store.account_api_token[0]).toMatchObject({
      scopes: ["read", "write"],
      tenantId: null,
    });

    // `write` implies `read`, matching the documented read-and-write scope.
    const writeOnly = await run((auth) =>
      auth.createApiToken(session(), { name: "Write", scopes: ["write"] }),
    );
    expect(writeOnly.item.scopes).toEqual(["read", "write"]);
  });

  it("rejects tenant bindings the user does not belong to and invalid scopes", async () => {
    const { run } = makeContext(seedUserAndTenant());

    await expect(
      run((auth) =>
        auth.createApiToken(session(), {
          name: "Other tenant",
          scopes: ["read"],
          tenantId: "tenant-2",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    await expect(
      run((auth) => auth.createApiToken(session(), { name: "Empty", scopes: [] })),
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });

    await expect(
      run((auth) =>
        auth.createApiToken(session(), {
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
