import { Effect } from "effect";
import { ssrSessionFingerprint, ssrTenantPermissions } from "@mattrax/enterprise-domain";
import { describe, expect, it } from "vitest";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { isAccountMethod, permissionForMethod } from "@mattrax/enterprise-identity";
import { verifySsrRevision, verifySsrToken } from "@mattrax/enterprise-backend";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "bootstrap-test-secret-that-is-long-enough";

const now = new Date();

const user = {
  id: "user-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  image: null,
  disabled: false,
  source: "manual",
  totpEnabled: false,
  passkeyEnabled: false,
  authRevision: "revision-1",
  createdAt: now,
  updatedAt: now,
};

const organization = (id: string, name: string) => ({
  id,
  name,
  slug: id,
  logo: null,
  displayName: null,
  supportEmail: null,
  brandColor: null,
  createdAt: now,
  updatedAt: now,
});

const member = (id: string, organizationId: string, role: string) => ({
  id,
  organizationId,
  accountId: user.id,
  role,
  customRoleId: null,
  createdAt: now,
  updatedAt: now,
});

const makeContext = () => {
  const db = makeDb();

  db.store.account.push(user);
  db.store.organization.push(organization("tenant-a", "Acme"), organization("tenant-b", "Beta"));
  db.store.member.push(
    member("member-a", "tenant-a", "owner"),
    member("member-b", "tenant-b", "member"),
  );

  const session = {
    sessionId: "session-1",
    subjectId: user.id,
    claims: { name: user.name, email: user.email, emailVerified: true },
  };

  let requireUserCalls = 0;

  const auth = {
    requireUser: () => {
      requireUserCalls++;

      return Effect.succeed({ user, session });
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods bootstrap and `me` use.
    auth: auth as any,
    authSecret,
  });

  return {
    service,
    requireUserCalls: () => requireUserCalls,
    headers: { cookie: "__Host-mattrax_session=test", "cf-connecting-ip": "203.0.113.7" },
  };
};

describe("GET /api/v1/bootstrap", () => {
  it("is mapped account-scoped rather than to a tenant permission", () => {
    expect(isAccountMethod("bootstrap")).toBe(true);
    expect(permissionForMethod("bootstrap")).toBeUndefined();
    // The tenant endpoints keep their existing mappings.
    expect(permissionForMethod("listDevices")).toBe("devices.read");
    expect(permissionForMethod("getSoftwareUpdateSummary")).toBe("devices.read");
    expect(permissionForMethod("patchTenant")).toBe("tenant.write");
    // Reverse scope reads enumerate devices, groups and linked users, so they
    // must not fall through to the tenant-wide read permission.
    expect(permissionForMethod("getPolicyScope")).toBe("policies.read");
    expect(permissionForMethod("getGroupScope")).toBe("groups.read");
    // Directory people are member data, not a tenant-wide read.
    expect(permissionForMethod("listUsers")).toBe("members.read");
    expect(permissionForMethod("getUser")).toBe("members.read");
    // Device secrets are not ordinary reads: a read-only role must not reveal
    // the managed local-admin password or Activation Lock bypass code.
    expect(permissionForMethod("getDeviceLocalAdmin")).toBe("devices.recovery_key");
    expect(permissionForMethod("getDeviceActivationLockBypassCode")).toBe("devices.recovery_key");
    // Handing over every escrowed secret is its own permission, while the
    // delete-warning check returns presence metadata only.
    expect(permissionForMethod("createDeviceHandover")).toBe("devices.handover");
    expect(permissionForMethod("downloadDeviceHandover")).toBe("devices.handover");
    expect(permissionForMethod("deviceHandoverImpact")).toBe("devices.read");
  });

  it("returns the session, me shell and a verifiable token after one requireUser", async () => {
    const context = makeContext();
    const result = await runEffect(context.service.bootstrap(request(context.headers)));

    expect(context.requireUserCalls()).toBe(1);
    expect(result.session).toEqual({
      sessionId: "session-1",
      subjectId: "user-1",
      claims: {
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
      },
    });
    expect(result.me.account).toMatchObject({
      id: "user-1",
      email: "owner@example.com",
      emailVerified: true,
      mfaEnabled: false,
    });
    expect(result.me.tenants.map((tenant) => tenant.id)).toEqual(["tenant-a", "tenant-b"]);

    expect(result.ssrToken).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/));
    expect(result.ssrTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(result.ssrRevision).toEqual(
      expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/),
    );
    expect(result.ssrRevisionExpiresAt).toBeGreaterThan(Date.now());

    const payload = await runEffect(verifySsrToken(authSecret, result.ssrToken!));

    expect(payload.sub).toBe("user-1");
    expect(payload.sid).toBe("session-1");
    expect(payload.ver).toBe("revision-1");
    expect(payload.ch).toBe(await ssrSessionFingerprint(authSecret, "test"));
    expect(payload.tenants?.map((tenant) => tenant.id)).toEqual(["tenant-a", "tenant-b"]);

    // The revision cookie names the same session and auth revision the token
    // carries; the edge compares these two values before using a warm token.
    const revision = await runEffect(verifySsrRevision(authSecret, result.ssrRevision!));

    expect(revision).toMatchObject({ sid: payload.sid, ver: payload.ver });
  });

  it("redacts the SSR snapshot for a request that arrived through the edge", async () => {
    const context = makeContext();

    const result = await runEffect(
      context.service.bootstrap(request({ ...context.headers, "cf-ray": "8f2f3c1d0e4a5b6c-PER" })),
    );

    // The browser still receives its own session and shell...
    expect(result.session?.sessionId).toBe("session-1");
    expect(result.me.account.id).toBe("user-1");

    // ...but never the token the website Worker keeps for warm renders.
    expect(result.ssrToken).toBeNull();
    expect(result.ssrTokenExpiresAt).toBeNull();
    expect(result.ssrRevision).toBeNull();
    expect(result.ssrRevisionExpiresAt).toBeNull();
  });

  it("keeps each tenant's permissions scoped to that membership", async () => {
    const context = makeContext();
    const result = await runEffect(context.service.bootstrap(request(context.headers)));
    const payload = await runEffect(verifySsrToken(authSecret, result.ssrToken!));

    const owner = payload.tenants?.find((tenant) => tenant.id === "tenant-a");
    const member = payload.tenants?.find((tenant) => tenant.id === "tenant-b");

    // The owner holds write authority in Acme...
    expect(owner?.roleKind).toBe("built-in");
    expect(owner?.permissions).toBeUndefined();
    expect([...ssrTenantPermissions(owner!)]).toContain("devices.write");

    // ...but Beta's read-only membership neither inherits it nor the owner role.
    expect(member?.roleName).toBe("Member");
    expect(member?.permissions).toBeUndefined();
    expect([...ssrTenantPermissions(member!)]).toContain("devices.read");
    expect([...ssrTenantPermissions(member!)]).not.toContain("devices.write");
    expect([...ssrTenantPermissions(member!)]).not.toContain("tenant.delete");

    // The token mirrors the `/me` shell without redundant contact fields; no
    // extra tenant data leaks into it. Built-in permissions are derived from
    // the role key instead of being repeated in the cookie.
    expect(
      payload.tenants?.map((tenant) => ({
        id: tenant.id,
        role: tenant.role,
        permissions: [...ssrTenantPermissions(tenant)],
        roleName: tenant.roleName,
        roleKind: tenant.roleKind,
      })),
    ).toEqual(
      result.me.tenants.map(({ id, role, permissions, roleName, roleKind }) => ({
        id,
        role,
        permissions,
        roleName,
        roleKind,
      })),
    );
  });

  it("has no token or session for a caller without a browser session", async () => {
    const context = makeContext();

    // SAFETY: the fake auth resolves a user from headers; this override models
    // a bearer caller by returning no session snapshot.
    const service = createEnterpriseService({
      db: makeDb(),
      schema,
      origin,
      storage: {} as any,
      auth: {
        requireUser: () => Effect.succeed({ user, session: undefined }),
        listApiTokens: () => Effect.succeed({ tokens: [] }),
        createApiToken: () => Effect.die("not used"),
        revokeApiToken: () => Effect.succeed({ status: "ok" }),
        requestEmailChange: () => Effect.succeed({ status: "ok" }),
        verifyEmailChange: () => Effect.succeed({ status: "ok" }),
        requireStepUp: () => Effect.void,
      } as any,
      authSecret,
    });

    const result = await runEffect(service.bootstrap(request(context.headers)));

    expect(result.session).toBeNull();
    expect(result.ssrToken).toBeNull();
    expect(result.ssrTokenExpiresAt).toBeNull();
    expect(result.ssrRevision).toBeNull();
    expect(result.ssrRevisionExpiresAt).toBeNull();
    expect(result.me.account.id).toBe("user-1");
  });
});
