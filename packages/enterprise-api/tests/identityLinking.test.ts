import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const now = new Date("2026-11-01T00:00:00.000Z");

type RowValue = string | number | boolean | Date | null | undefined;

type RowOverrides = Record<string, RowValue>;

const makeContext = (options: { role?: string; tenantIds?: ReadonlyArray<string> } = {}) => {
  const db = makeDb();
  const tenantIds = options.tenantIds ?? ["org-1"];
  const stepUps: string[] = [];

  const user = {
    id: "caller-1",
    name: "Caller",
    email: "caller@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);

  for (const tenantId of tenantIds) {
    db.store.organization.push({
      id: tenantId,
      name: tenantId,
      slug: tenantId,
      createdAt: now,
      updatedAt: now,
    });
    db.store.member.push({
      id: `member-${tenantId}`,
      organizationId: tenantId,
      accountId: user.id,
      role: options.role ?? "owner",
      createdAt: now,
      updatedAt: now,
    });
  }

  db.store.sso_config.push({
    organizationId: "org-1",
    enabled: true,
    azureTenantId: "entra-tenant",
    autoProvision: true,
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: () => Effect.succeed({ user }),
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: (_request: any, action: string) => {
      stepUps.push(action);

      return Effect.void;
    },
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods this path exercises.
    auth: auth as any,
    authSecret: "identity-linking-test-secret",
  });

  return { db, service, user, stepUps };
};

const seedDirectoryUser = (db: any, overrides: RowOverrides = {}) => {
  const row = {
    id: "directory-1",
    organizationId: "org-1",
    name: "Target Person",
    email: "target@example.com",
    externalId: "entra-object-1",
    disabled: false,
    source: "entra",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.store.user.push(row);

  return row;
};

const seedAccount = (db: any, overrides: RowOverrides = {}) => {
  const row = {
    id: "target-1",
    name: "Target",
    email: "target@example.com",
    emailVerified: true,
    image: null,
    stripeCustomerId: null,
    disabled: false,
    authRevision: "revision-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.store.account.push(row);

  return row;
};

const seedMembership = (db: any, organizationId: string, accountId = "target-1", role = "member") =>
  db.store.member.push({
    id: `member-${organizationId}-${accountId}`,
    organizationId,
    accountId,
    role,
    createdAt: now,
    updatedAt: now,
  });

const seedVerifiedDomain = (db: any, domain = "example.com", organizationId = "org-1") =>
  db.store.sso_domain.push({
    domain,
    organizationId,
    isVerified: true,
    source: "entra",
    verifiedAt: now,
  });

describe("linking an existing SSO identity to a directory user", () => {
  it("links the Entra object to the same-email account when the domain is verified", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);
    const target = seedAccount(context.db);

    seedVerifiedDomain(context.db);
    seedMembership(context.db, "org-1");
    // The account's other tenant is the reason the callback cannot auto-link.
    seedMembership(context.db, "org-2");

    const result = await runEffect(
      context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id),
    );

    expect(result).toEqual({ status: "ok" });
    expect(context.stepUps).toEqual(["sso-policy"]);
    expect(context.db.store.sso_identity).toEqual([
      {
        organizationId: "org-1",
        objectId: "entra-object-1",
        accountId: target.id,
        createdAt: expect.any(Date),
      },
    ]);
    expect(context.db.store.audit_log).toContainEqual(
      expect.objectContaining({
        organizationId: "org-1",
        action: "sso.identity_linked",
        targetType: "account",
        targetId: target.id,
      }),
    );
  });

  it("keeps the link inside the tenant in the URL", async () => {
    const context = makeContext({ tenantIds: ["org-1", "org-2"] });
    const directoryUser = seedDirectoryUser(context.db, { organizationId: "org-2" });

    seedAccount(context.db);
    seedMembership(context.db, "org-2");

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    expect(context.db.store.sso_identity).toEqual([]);
  });

  it("refuses a directory email whose domain is not verified for this tenant", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db, { email: "target@unverified.test" });
    seedAccount(context.db, { email: "target@unverified.test" });
    seedMembership(context.db, "org-1");

    // An unverified domain row is not proof of control.
    context.db.store.sso_domain.push({
      domain: "unverified.test",
      organizationId: "org-1",
      isVerified: false,
      source: "entra",
      verifiedAt: null,
    });

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(context.db.store.sso_identity).toEqual([]);
    expect(context.db.store.audit_log).toEqual([]);
  });

  it("does not accept a verified domain owned by another tenant", async () => {
    const context = makeContext({ tenantIds: ["org-1", "org-2"] });
    const directoryUser = seedDirectoryUser(context.db);
    seedAccount(context.db);
    seedVerifiedDomain(context.db, "example.com", "org-2");
    seedMembership(context.db, "org-1");

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);

    expect(context.db.store.sso_identity).toEqual([]);
  });

  it("requires the identity-write permission, not generic tenant write", () => {
    expect(permissionForMethod("linkDirectoryUserSso")).toBe("identity.write");
  });

  it("does not let a read-only role link identities", async () => {
    const context = makeContext({ role: "member" });
    const directoryUser = seedDirectoryUser(context.db);

    seedAccount(context.db);
    seedMembership(context.db, "org-1");

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    expect(context.db.store.sso_identity).toEqual([]);
  });

  it("rejects a directory user that did not come from Entra", async () => {
    const context = makeContext();

    const directoryUser = seedDirectoryUser(context.db, {
      source: "manual",
      externalId: null,
    });

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("requires an enabled Entra SSO configuration", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);
    seedAccount(context.db);
    seedMembership(context.db, "org-1");

    context.db.store.sso_config[0].enabled = false;

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("refuses an account that is not a member of the tenant", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);
    seedAccount(context.db);

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(context.db.store.sso_identity).toEqual([]);
  });

  it("refuses a disabled account", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);
    seedAccount(context.db, { disabled: true });
    seedMembership(context.db, "org-1");

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
  });

  it("reports a missing account instead of creating one", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    expect(context.db.store.account).toHaveLength(1);
  });

  it("does not overwrite an existing link for the object id", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);
    seedAccount(context.db, { id: "target-1", email: "target@example.com" });
    seedAccount(context.db, { id: "target-2", email: "other@example.com" });
    seedVerifiedDomain(context.db);
    seedMembership(context.db, "org-1", "target-1");
    seedMembership(context.db, "org-1", "target-2");
    context.db.store.sso_identity.push({
      organizationId: "org-1",
      objectId: "entra-object-1",
      accountId: "target-2",
      createdAt: now,
    });

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseConflict);

    expect(context.db.store.sso_identity).toHaveLength(1);
    expect(context.db.store.sso_identity[0].accountId).toBe("target-2");
  });

  it("is idempotent when the same account is already linked", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);
    seedAccount(context.db);
    seedVerifiedDomain(context.db);
    seedMembership(context.db, "org-1");
    context.db.store.sso_identity.push({
      organizationId: "org-1",
      objectId: "entra-object-1",
      accountId: "target-1",
      createdAt: now,
    });

    const result = await runEffect(
      context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id),
    );

    expect(result).toEqual({ status: "ok" });
    expect(context.db.store.sso_identity).toHaveLength(1);
    // No new grant happened, so the confirmation must not appear as one.
    expect(context.db.store.audit_log).toEqual([]);
  });

  it("refuses to move an account away from a different identity", async () => {
    const context = makeContext();
    const directoryUser = seedDirectoryUser(context.db);
    seedAccount(context.db);
    seedVerifiedDomain(context.db);
    seedMembership(context.db, "org-1");
    context.db.store.sso_identity.push({
      organizationId: "org-1",
      objectId: "another-object",
      accountId: "target-1",
      createdAt: now,
    });

    await expect(
      runEffect(context.service.linkDirectoryUserSso(request(headers), "org-1", directoryUser.id)),
    ).rejects.toBeInstanceOf(EnterpriseConflict);
  });

  it("reports which directory users already have a linked SSO identity", async () => {
    const context = makeContext();
    seedDirectoryUser(context.db);
    seedDirectoryUser(context.db, {
      id: "directory-2",
      name: "Another Person",
      email: "another@example.com",
      externalId: "entra-object-2",
    });
    context.db.store.sso_identity.push({
      organizationId: "org-1",
      objectId: "entra-object-1",
      accountId: "target-1",
      createdAt: now,
    });

    const directory = await runEffect(context.service.listDirectory(request(headers), "org-1"));

    expect(directory.users).toEqual([
      expect.objectContaining({
        id: "directory-2",
        externalId: "entra-object-2",
        linked: false,
      }),
      expect.objectContaining({
        id: "directory-1",
        externalId: "entra-object-1",
        linked: true,
      }),
    ]);
  });
});
