import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const timestamp = new Date("2026-11-20T00:00:00.000Z");

const owner = {
  id: "account-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  image: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const makeContext = (options: { role?: string } = {}) => {
  const db = makeDb();
  const state = { user: owner };

  db.store.account.push(owner);

  const auth = {
    requireUser: () => Effect.succeed({ user: state.user }),
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
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these paths exercise.
    auth: auth as any,
    authSecret: "user-merge-test-secret",
  });

  return { db, service, state, role: options.role ?? "owner" };
};

const makeTenant = async (context: ReturnType<typeof makeContext>, slug = "acme") =>
  runEffect(context.service.createTenant(request(headers), { name: "Acme", slug }));

const seedUser = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  id: string,
  overrides: Partial<{
    name: string;
    email: string;
    externalId: string | null;
    source: "manual" | "entra" | "scim";
    disabled: boolean;
  }> = {},
) =>
  context.db.store.user.push({
    id,
    organizationId: tenantId,
    name: id,
    email: `${id}@acme.test`,
    externalId: `${id}-object`,
    source: "entra",
    disabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });

describe("directory user merge endpoints", () => {
  it("maps the read endpoints to members.read and the merge to members.write", () => {
    expect(permissionForMethod("listUserMergeCandidates")).toBe("members.read");
    expect(permissionForMethod("previewDirectoryUserMerge")).toBe("members.read");
    expect(permissionForMethod("mergeDirectoryUsers")).toBe("members.write");
  });

  it("previews what moves without writing", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedUser(context, tenant.id, "target", { email: "ada@acme.test" });
    seedUser(context, tenant.id, "source", { email: "ada.old@acme.test" });

    context.db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Ada's Mac",
      enrolledAt: timestamp,
      lastSeenAt: timestamp,
    });
    context.db.store.device_user.push(
      {
        organizationId: tenant.id,
        deviceId: "device-1",
        userId: "target",
        source: "manual",
        createdAt: timestamp,
      },
      {
        organizationId: tenant.id,
        deviceId: "device-1",
        userId: "source",
        source: "directory",
        createdAt: timestamp,
      },
    );

    const preview = await runEffect(
      context.service.previewDirectoryUserMerge(request(headers), tenant.id, "target", {
        sourceIds: ["source"],
      }),
    );

    expect(preview.requiresExternalIdConfirmation).toBe(true);
    expect(preview.totals.deviceLinks).toBe(0);
    expect(preview.deduplicated.deviceLinks).toBe(1);
    expect(preview.sources[0].user.id).toBe("source");
    expect(context.db.store.user).toHaveLength(2);
  });

  it("merges the duplicate, then retries as unchanged with one audit entry", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedUser(context, tenant.id, "target", { email: "ada@acme.test" });
    seedUser(context, tenant.id, "source", {
      email: "ada.old@acme.test",
      externalId: "external-source",
      disabled: true,
    });

    const merged = await runEffect(
      context.service.mergeDirectoryUsers(request(headers), tenant.id, "target", {
        sourceIds: ["source"],
        confirmExternalIdMismatch: true,
      }),
    );

    expect(merged.status).toBe("merged");
    expect(merged.alreadyMerged).toEqual([]);
    expect(context.db.store.user.map((row) => row.id)).toEqual(["target"]);

    const audits = context.db.store.audit_log.filter(
      (row) => row.action === "directory.users_merged",
    );

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: tenant.id,
      targetType: "directoryUser",
      targetId: "target",
    });
    expect(audits[0]!.metadata).toMatchObject({
      target: { id: "target", email: "ada@acme.test", externalId: "target-object" },
      sources: [
        {
          id: "source",
          name: "source",
          email: "ada.old@acme.test",
          externalId: "external-source",
          source: "entra",
          disabled: true,
        },
      ],
      moved: {
        deviceLinks: 0,
        groupMemberships: 0,
        directPolicies: 0,
        groupExclusions: 0,
        appleUserChannels: 0,
      },
      deduplicated: {
        deviceLinks: 0,
        groupMemberships: 0,
        directPolicies: 0,
        groupExclusions: 0,
        appleUserChannels: 0,
      },
      ssoIdentitiesRetained: 0,
      alreadyMerged: [],
    });

    const retry = await runEffect(
      context.service.mergeDirectoryUsers(request(headers), tenant.id, "target", {
        sourceIds: ["source"],
        confirmExternalIdMismatch: true,
      }),
    );

    expect(retry.status).toBe("unchanged");
    expect(retry.alreadyMerged).toEqual(["source"]);
    expect(
      context.db.store.audit_log.filter((row) => row.action === "directory.users_merged"),
    ).toHaveLength(1);
  });

  it("suggests the duplicate again when sync recreates it", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedUser(context, tenant.id, "target", { email: "ada@acme.test" });
    seedUser(context, tenant.id, "source", {
      email: "ada.old@acme.test",
      externalId: "recreated-object",
    });

    await runEffect(
      context.service.mergeDirectoryUsers(request(headers), tenant.id, "target", {
        sourceIds: ["source"],
        confirmExternalIdMismatch: true,
      }),
    );

    // Entra recreates the object with the same provider id after a delta reset.
    seedUser(context, tenant.id, "recreated", {
      name: "Ada (recreated)",
      email: "ada.new@acme.test",
      externalId: "recreated-object",
    });

    const candidates = await runEffect(
      context.service.listUserMergeCandidates(request(headers), tenant.id, "target"),
    );

    expect(candidates.candidates).toHaveLength(1);
    expect(candidates.candidates[0]).toMatchObject({
      user: { id: "recreated", email: "ada.new@acme.test" },
      reasons: ["previously-merged"],
    });
  });

  it("refuses a differing object id without the confirmation flag", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    seedUser(context, tenant.id, "target");
    seedUser(context, tenant.id, "source");

    await expect(
      runEffect(
        context.service.mergeDirectoryUsers(request(headers), tenant.id, "target", {
          sourceIds: ["source"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(context.db.store.user).toHaveLength(2);
    expect(
      context.db.store.audit_log.filter((row) => row.action === "directory.users_merged"),
    ).toEqual([]);
  });

  it("rejects a source from another tenant", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const other = await makeTenant(context, "other");
    seedUser(context, tenant.id, "target");
    seedUser(context, other.id, "other-user");

    await expect(
      runEffect(
        context.service.mergeDirectoryUsers(request(headers), tenant.id, "target", {
          sourceIds: ["other-user"],
          confirmExternalIdMismatch: true,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(context.db.store.user).toHaveLength(2);
  });

  it("reports another tenant's target as missing", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);
    const other = await makeTenant(context, "other");
    seedUser(context, other.id, "other-user");

    await expect(
      runEffect(context.service.listUserMergeCandidates(request(headers), tenant.id, "other-user")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("requires members.write, not a read-only membership", async () => {
    const context = makeContext();
    const tenant = await makeTenant(context);

    // The creating account is the owner; downgrade the same membership so the
    // merge is denied for its permission rather than for a missing member.
    for (const member of context.db.store.member)
      if (member.organizationId === tenant.id) member.role = "member";

    seedUser(context, tenant.id, "target");
    seedUser(context, tenant.id, "source", { externalId: null });

    await expect(
      runEffect(
        context.service.mergeDirectoryUsers(request(headers), tenant.id, "target", {
          sourceIds: ["source"],
          confirmExternalIdMismatch: true,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    expect(context.db.store.user).toHaveLength(2);
    expect(
      context.db.store.audit_log.filter((row) => row.action === "directory.users_merged"),
    ).toEqual([]);
  });
});
