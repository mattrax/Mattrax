import { Effect } from "effect";
import {
  BUILT_IN_ROLE_PERMISSIONS,
  PERMISSIONS,
  SSR_TOKEN_MAX_LENGTH,
  SSR_TOKEN_TTL_MILLIS,
  ssrSessionFingerprint,
  ssrTenantPermissions,
} from "@mattrax/enterprise-domain";
import { describe, expect, it } from "vitest";
import { signSsrToken, verifySsrToken, type SignSsrTokenInput } from "../src/Account/ssrToken.ts";
import { signToken } from "@mattrax/enterprise-tokens";

const secret = "ssr-test-secret-that-is-long-enough-for-hmac";

const input = (overrides: Partial<SignSsrTokenInput> = {}): SignSsrTokenInput => ({
  subjectId: "user-1",
  sessionId: "session-1",
  sessionCookie: "opaque-session-cookie",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  authRevision: "revision-1",
  user: {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    mfaEnabled: false,
    totpEnabled: false,
    passkeyEnabled: false,
    mfaRequired: false,
  },
  tenants: [
    {
      id: "tenant-1",
      name: "Acme",
      slug: "acme",
      role: "owner",
      roleId: null,
      roleName: "Owner",
      roleKind: "built-in",
      permissions: ["tenant.read", "devices.read", "devices.write"],
      logo: null,
      displayName: "Acme Inc",
      brandColor: "#112233",
    },
  ],
  ...overrides,
});

const run = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(effect);

describe("SSR bootstrap token", () => {
  it("round-trips the shell payload with a five-minute expiry", async () => {
    const now = 1_700_000_000_000;
    const signed = await run(signSsrToken(secret, input({ now })));

    expect(signed?.expiresAt).toBe(now + SSR_TOKEN_TTL_MILLIS);
    expect(signed?.includesTenants).toBe(true);

    const payload = await run(verifySsrToken(secret, signed!.token, now));

    expect(payload).toMatchObject({
      purpose: "ssr",
      sub: "user-1",
      sid: "session-1",
      email: "owner@example.com",
      emailVerified: true,
      name: "Owner",
      ver: "revision-1",
      exp: now + SSR_TOKEN_TTL_MILLIS,
      ch: await ssrSessionFingerprint(secret, "opaque-session-cookie"),
    });
    expect(payload.tenants?.map((tenant) => tenant.id)).toEqual(["tenant-1"]);
    expect(payload.tenants?.[0]?.permissions).toBeUndefined();
    expect([...ssrTenantPermissions(payload.tenants![0]!)]).toEqual([
      ...BUILT_IN_ROLE_PERMISSIONS.owner,
    ]);
  });

  it("round-trips the account default tenant", async () => {
    const signed = await run(
      signSsrToken(
        secret,
        input({ user: { ...input().user, defaultTenantId: "tenant-1" } }),
      ),
    );

    const payload = await run(verifySsrToken(secret, signed!.token));

    expect(payload.user.defaultTenantId).toBe("tenant-1");
  });

  it("accepts tokens minted before the default tenant existed", async () => {
    const legacyUser = { ...input().user };
    delete legacyUser.defaultTenantId;

    const signed = await run(signSsrToken(secret, input({ user: legacyUser })));
    const payload = await run(verifySsrToken(secret, signed!.token));

    expect(payload.user).not.toHaveProperty("defaultTenantId");
  });

  it("signs no token for an unverified account", async () => {
    const signed = await run(signSsrToken(secret, input({ emailVerified: false })));

    expect(signed).toBeUndefined();
  });

  it("rejects an expired token", async () => {
    const signed = await run(signSsrToken(secret, input()));

    await expect(
      run(verifySsrToken(secret, signed!.token, Date.now() + SSR_TOKEN_TTL_MILLIS + 1)),
    ).rejects.toThrow(/Expired/);
  });

  it("rejects a tampered signature", async () => {
    const signed = await run(signSsrToken(secret, input()));
    const [body, signature] = signed!.token.split(".");
    const tampered = `${body}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;

    await expect(run(verifySsrToken(secret, tampered))).rejects.toThrow();
  });

  it("rejects a token minted for another purpose", async () => {
    const token = await run(
      signToken(secret, {
        sub: "user-1",
        email: "owner@example.com",
        exp: Date.now() + 60_000,
        purpose: "password-reset",
      }),
    );

    await expect(run(verifySsrToken(secret, token))).rejects.toThrow(/Invalid/);
  });

  it("signs no token when the tenant list exceeds the cookie budget", async () => {
    const tenants = Array.from({ length: 20 }, (_, index) => ({
      ...input().tenants[0]!,
      id: `tenant-${index}`,
      name: `Tenant ${index}`,
      permissions: PERMISSIONS,
    }));

    const signed = await run(signSsrToken(secret, input({ tenants })));

    // A tenant-less token would be a miss on every navigation, so the API
    // returns none instead of a cookie the browser can never use.
    expect(signed).toBeUndefined();
  });

  it("keeps three owner tenants warm by omitting built-in permissions", async () => {
    const tenants = Array.from({ length: 3 }, (_, index) => ({
      ...input().tenants[0]!,
      id: `tenant-${index}`,
      name: `Tenant ${index}`,
      slug: `tenant-${index}`,
      permissions: PERMISSIONS,
    }));

    const signed = await run(signSsrToken(secret, input({ tenants })));

    expect(signed).toBeDefined();
    expect(signed!.includesTenants).toBe(true);
    expect(signed!.token.length).toBeLessThanOrEqual(SSR_TOKEN_MAX_LENGTH);

    const payload = await run(verifySsrToken(secret, signed!.token));

    expect(payload.tenants).toHaveLength(3);

    for (const tenant of payload.tenants ?? []) {
      // The explicit 34-permission array is what made the token oversize.
      expect(tenant.permissions).toBeUndefined();
      expect([...ssrTenantPermissions(tenant)]).toEqual([...PERMISSIONS]);
    }
  });

  it("keeps explicit permissions for a custom role", async () => {
    const custom = {
      ...input().tenants[0]!,
      role: "custom",
      roleId: "role-1",
      roleName: "Auditor plus devices",
      roleKind: "custom" as const,
      permissions: ["tenant.read", "devices.read"] as const,
    };

    const signed = await run(signSsrToken(secret, input({ tenants: [custom] })));
    const payload = await run(verifySsrToken(secret, signed!.token));

    expect([...(payload.tenants?.[0]?.permissions ?? [])]).toEqual(["tenant.read", "devices.read"]);
    expect([...ssrTenantPermissions(payload.tenants![0]!)]).toEqual([
      "tenant.read",
      "devices.read",
    ]);
  });

  it("signs no token when even the tenant-bearing payload is over budget", async () => {
    // The account name is capped at 120 characters at the API boundary; this
    // test forces the budget guard itself so a future field addition cannot
    // silently emit an oversized cookie.
    const oversized = "x".repeat(SSR_TOKEN_MAX_LENGTH * 2);

    const signed = await run(
      signSsrToken(
        secret,
        input({
          name: oversized,
          user: { ...input().user, name: oversized },
        }),
      ),
    );

    expect(signed).toBeUndefined();
  });
});
