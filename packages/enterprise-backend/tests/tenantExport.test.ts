import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterprisePermissionDenied,
  EnterpriseUnauthorized,
  TENANT_IMPORT_MAX_BYTES,
  TenantImportRequest,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const headers = { cookie: "mattrax_session=test" };

const makeContext = () => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.user.push(user);

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return inputHeaders.cookie
        ? Effect.succeed({ user })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "tenant-export-test-secret",
  });

  return { db, service, user };
};

const seedTenant = async (context: ReturnType<typeof makeContext>) => {
  const { service } = context;

  const tenant = await runEffect(
    service.createTenant(request(headers), {
      name: "Acme",
      slug: "acme",
      displayName: "Acme Corp",
      logo: "https://cdn.example.com/acme.png",
      supportEmail: "help@acme.test",
      brandColor: "#2563eb",
      metadata: { tier: "pro" },
    }),
  );

  const policy = await runEffect(
    service.createPolicy(request(headers), tenant.id, {
      name: "Baseline",
      notes: "Managed settings",
    }),
  );

  await runEffect(
    service.patchPolicy(request(headers), tenant.id, policy.id, {
      configurations: { "mttx.apple.device": { camera: false } },
    }),
  );

  const group = await runEffect(
    service.createGroup(request(headers), tenant.id, {
      name: "Staff",
      notes: "Everyone",
      policies: [policy.id],
    }),
  );

  const application = await runEffect(
    service.createApplication(request(headers), tenant.id, {
      name: "Slack",
      platform: "apple",
      source: "store",
      storeId: "803453959",
      notes: "Chat",
    }),
  );

  await runEffect(
    service.patchApplicationAssignments(request(headers), tenant.id, application.id, {
      assign: { groups: [group.id] },
    }),
  );
  await runEffect(
    service.patchTenantEnrollment(request(headers), tenant.id, {
      code: "enroll-acme",
      enabledAssetTag: true,
      maxDevices: 42,
    }),
  );
  await runEffect(
    service.importDevicePreRegistrations(request(headers), tenant.id, {
      rows: [{ serial: "C02ACMEMAC", name: "Alice's Mac", groupName: "Staff" }],
    }),
  );

  return { tenant, policy, group, application };
};

const exportBundle = async (context: ReturnType<typeof makeContext>, tenantId: string) => {
  const result = await runEffect(
    context.service.exportTenant(request(headers), tenantId, { includeAudit: "true" }),
  );

  return {
    ...result,
    bundle: Schema.decodeUnknownSync(TenantImportRequest)(JSON.parse(result.body)),
  };
};

describe("tenant export", () => {
  it("exports the expected entities and excludes secrets", async () => {
    const context = makeContext();
    const { tenant, policy, group, application } = await seedTenant(context);

    // Rows that must never appear in a bundle, whatever their surface shape.
    const timestamp = new Date();
    context.db.store.apple_push_certificate.push({
      organizationId: tenant.id,
      email: "apns@example.com",
      topic: "com.apple.mgmt.External.acme",
      certPem: "SECRET-APNS-CERT",
      encryptedKey: "SECRET-APNS-KEY",
      updatedAt: timestamp,
    });
    context.db.store.apple_push_key.push({
      organizationId: tenant.id,
      encryptedPrivateKeyJwk: "SECRET-APNS-JWK",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    context.db.store.scim_token.push({
      id: "scim-1",
      organizationId: tenant.id,
      name: "SCIM",
      tokenHash: "SECRET-SCIM-HASH",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    context.db.store.account_api_token.push({
      id: "token-1",
      userId: context.user.id,
      name: "CLI",
      tokenPrefix: "mtt_",
      tokenHash: "SECRET-API-HASH",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    context.db.store.scep_ca.push({
      id: 1,
      organizationId: tenant.id,
      certPem: "SECRET-CA-CERT",
      privateKeyJwk: { private: "SECRET-CA-KEY" },
      source: "generated",
      createdAt: timestamp,
      rotatedAt: null,
    });
    context.db.store.scep_issued_certificate.push({
      serial: "cert-serial-1",
      organizationId: tenant.id,
      enrollmentId: tenant.id,
      deviceId: "device-1",
      notAfter: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      createdAt: timestamp,
    });

    const { bundle, filename, version } = await exportBundle(context, tenant.id);

    expect(version).toBe(1);
    expect(filename).toMatch(/^tenant-acme-\d{4}-\d{2}-\d{2}\.json$/);
    expect(bundle.version).toBe(1);
    expect(bundle.tenant).toMatchObject({
      name: "Acme",
      slug: "acme",
      displayName: "Acme Corp",
      logo: "https://cdn.example.com/acme.png",
      supportEmail: "help@acme.test",
      brandColor: "#2563eb",
      metadata: { tier: "pro" },
    });
    expect(bundle.members).toMatchObject([
      { email: "owner@example.com", name: "Owner", role: "owner" },
    ]);
    expect(bundle.policies).toHaveLength(1);
    expect(bundle.policies?.[0]).toMatchObject({
      key: policy.id,
      name: "Baseline",
      notes: "Managed settings",
      configurations: { "mttx.apple.device": { camera: false } },
    });
    expect(bundle.groups).toHaveLength(1);
    expect(bundle.groups?.[0]).toMatchObject({
      key: group.id,
      name: "Staff",
      notes: "Everyone",
      policyKeys: [policy.id],
    });
    expect(bundle.applications).toHaveLength(1);
    expect(bundle.applications?.[0]).toMatchObject({
      key: application.id,
      name: "Slack",
      platform: "apple",
      source: "store",
      storeId: "803453959",
      groupKeys: [group.id],
    });
    expect(bundle.enrollment).toMatchObject({
      code: "enroll-acme",
      enabledApple: true,
      enabledAssetTag: true,
      maxDevices: 42,
    });
    expect(bundle.preRegistrations).toMatchObject([
      {
        serial: "C02ACMEMAC",
        name: "Alice's Mac",
        groupKey: group.id,
      },
    ]);
    expect(bundle.scepCertificates).toMatchObject([
      { serial: "cert-serial-1", enrollmentId: tenant.id, deviceKey: null },
    ]);
    expect(bundle.auditLog?.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(bundle);

    for (const secret of [
      "SECRET-APNS-CERT",
      "SECRET-APNS-KEY",
      "SECRET-APNS-JWK",
      "SECRET-SCIM-HASH",
      "SECRET-API-HASH",
      "SECRET-CA-CERT",
      "SECRET-CA-KEY",
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("privateKeyJwk");
    expect(serialized).not.toContain("certPem");
  });

  it("exports direct device policy and application assignments", async () => {
    const context = makeContext();
    const { tenant, policy, application } = await seedTenant(context);
    const timestamp = new Date();

    context.db.store.device.push({
      id: "device-1",
      organizationId: tenant.id,
      proto: "apple",
      status: "enrolled",
      name: "Alice's Mac",
      serial: "C02ACMEMAC",
      enrolledAt: timestamp,
      lastSeenAt: timestamp,
    });
    context.db.store.device_policy.push({
      deviceId: "device-1",
      policyId: policy.id,
      mode: "exclude",
    });
    context.db.store.application_device.push({
      deviceId: "device-1",
      applicationId: application.id,
    });

    const { bundle } = await exportBundle(context, tenant.id);

    expect(bundle.deviceAssignments).toEqual([
      {
        deviceKey: "device-1",
        deviceSerial: "C02ACMEMAC",
        policyKeys: [],
        excludedPolicyKeys: [policy.id],
        applicationKeys: [application.id],
      },
    ]);
  });

  it("only exports rows belonging to the requested tenant", async () => {
    const context = makeContext();
    const first = await seedTenant(context);

    const second = await runEffect(
      context.service.createTenant(request(headers), { name: "Other", slug: "other" }),
    );

    const secondPolicy = await runEffect(
      context.service.createPolicy(request(headers), second.id, { name: "Other policy" }),
    );

    await runEffect(
      context.service.createGroup(request(headers), second.id, {
        name: "Other group",
        policies: [secondPolicy.id],
      }),
    );

    const { bundle } = await exportBundle(context, first.tenant.id);
    expect(bundle.policies?.map((policy: any) => policy.name)).toEqual(["Baseline"]);
    expect(bundle.groups?.map((group: any) => group.name)).toEqual(["Staff"]);
    expect(JSON.stringify(bundle)).not.toContain(second.id);
    expect(JSON.stringify(bundle)).not.toContain("Other group");
  });

  it("requires the owner role", async () => {
    const context = makeContext();
    const { tenant } = await seedTenant(context);

    const membership = context.db.store.member.find(
      (row: any) => row.organizationId === tenant.id && row.userId === context.user.id,
    );

    expect(membership).toBeDefined();
    membership!.role = "admin";

    await expect(
      runEffect(context.service.exportTenant(request(headers), tenant.id, {})),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });
});

describe("tenant import", () => {
  it("creates a tenant, remaps ids and preserves configuration", async () => {
    const context = makeContext();
    const source = await seedTenant(context);
    const { bundle } = await exportBundle(context, source.tenant.id);

    const result = await runEffect(context.service.importTenant(request(headers), bundle));

    expect(result.tenantId).not.toBe(source.tenant.id);
    // The source tenant still owns `acme`, so the import derives a free slug.
    expect(result.slug).toBe("acme-2");
    expect(result.counts).toEqual({
      groups: 1,
      policies: 1,
      applications: 1,
      preRegistrations: 1,
    });
    expect(result.skipped).toMatchObject({ members: 1, devices: 0, certificates: 0 });
    expect(result.applicationsWithoutFiles).toBe(0);

    const importedOrganization = context.db.store.organization.find(
      (row: any) => row.id === result.tenantId,
    );

    expect(importedOrganization).toMatchObject({
      name: "Acme",
      slug: "acme-2",
      displayName: "Acme Corp",
      logo: "https://cdn.example.com/acme.png",
      supportEmail: "help@acme.test",
      brandColor: "#2563eb",
      metadata: JSON.stringify({ tier: "pro" }),
    });

    // The caller owns the new tenant, and exported members are not re-added.
    const importedMembers = context.db.store.member.filter(
      (row: any) => row.organizationId === result.tenantId,
    );

    expect(importedMembers).toMatchObject([{ userId: context.user.id, role: "owner" }]);

    const importedPolicy = context.db.store.policy.find(
      (row: any) => row.organizationId === result.tenantId,
    )!;

    expect(importedPolicy.id).not.toBe(source.policy.id);
    expect(importedPolicy.name).toBe("Baseline");

    const importedConfiguration = context.db.store.configuration.find(
      (row: any) => row.policyId === importedPolicy.id,
    );

    expect(importedConfiguration).toMatchObject({
      kind: "mttx.apple.device",
      data: { camera: false },
    });

    const importedGroup = context.db.store.enterprise_group.find(
      (row: any) => row.organizationId === result.tenantId,
    )!;

    expect(importedGroup.id).not.toBe(source.group.id);
    expect(importedGroup.name).toBe("Staff");
    // Group/policy references now point at the new ids.
    expect(context.db.store.group_policy).toContainEqual({
      groupId: importedGroup.id,
      policyId: importedPolicy.id,
    });
    expect(
      context.db.store.group_policy.some(
        (row: any) => row.groupId === importedGroup.id && row.policyId === source.policy.id,
      ),
    ).toBe(false);

    const importedApplication = context.db.store.application.find(
      (row: any) => row.organizationId === result.tenantId,
    )!;

    expect(importedApplication.id).not.toBe(source.application.id);
    expect(importedApplication).toMatchObject({
      name: "Slack",
      platform: "apple",
      source: "store",
      storeId: "803453959",
      r2Key: null,
    });
    expect(context.db.store.application_group).toContainEqual({
      groupId: importedGroup.id,
      applicationId: importedApplication.id,
    });

    const importedEnrollment = context.db.store.enterprise_enrollment.find(
      (row: any) => row.organizationId === result.tenantId,
    )!;

    expect(importedEnrollment).toMatchObject({
      id: result.tenantId,
      code: "enroll-acme",
      enabledAssetTag: true,
      maxDevices: 42,
    });

    const importedPreRegistration = context.db.store.device_pre_registration.find(
      (row: any) => row.organizationId === result.tenantId,
    )!;

    expect(importedPreRegistration).toMatchObject({
      serial: "C02ACMEMAC",
      groupId: importedGroup.id,
    });

    // The import itself is audited in the new tenant.
    expect(
      context.db.store.audit_log.some(
        (row: any) => row.organizationId === result.tenantId && row.action === "tenant.imported",
      ),
    ).toBe(true);

    // The source tenant is untouched.
    expect(
      context.db.store.policy.filter((row: any) => row.organizationId === source.tenant.id),
    ).toHaveLength(1);
    expect(
      context.db.store.enterprise_group.filter(
        (row: any) => row.organizationId === source.tenant.id,
      ),
    ).toHaveLength(1);
  });

  it("derives further slugs when the same bundle is imported again", async () => {
    const context = makeContext();
    const source = await seedTenant(context);
    const { bundle } = await exportBundle(context, source.tenant.id);

    const first = await runEffect(context.service.importTenant(request(headers), bundle));
    const second = await runEffect(context.service.importTenant(request(headers), bundle));
    expect(first.slug).toBe("acme-2");
    expect(second.slug).toBe("acme-3");
  });

  it("rejects unsupported versions without writing anything", async () => {
    const context = makeContext();
    const source = await seedTenant(context);
    const { bundle } = await exportBundle(context, source.tenant.id);
    const before = context.db.store.organization.length;

    await expect(
      runEffect(
        context.service.importTenant(request(headers), {
          ...bundle,
          version: 2,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(context.db.store.organization).toHaveLength(before);
  });

  it("rejects oversized bundles without writing anything", async () => {
    const context = makeContext();
    const source = await seedTenant(context);
    const { bundle } = await exportBundle(context, source.tenant.id);
    const before = context.db.store.organization.length;

    await expect(
      runEffect(
        context.service.importTenant(request(headers), {
          ...bundle,
          groups: [
            {
              key: "huge",
              name: "Huge",
              notes: "x".repeat(TENANT_IMPORT_MAX_BYTES + 1),
              policyKeys: [],
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(context.db.store.organization).toHaveLength(before);
  });

  it("rejects unknown group and policy references", async () => {
    const context = makeContext();
    const source = await seedTenant(context);
    const { bundle } = await exportBundle(context, source.tenant.id);
    const before = context.db.store.organization.length;

    await expect(
      runEffect(
        context.service.importTenant(request(headers), {
          ...bundle,
          groups: [{ key: "g1", name: "Group", notes: null, devices: [], policyKeys: ["missing"] }],
          policies: [],
          applications: [],
          preRegistrations: [],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(context.db.store.organization).toHaveLength(before);
  });

  it("is all-or-nothing: a bad application does not create a tenant", async () => {
    const context = makeContext();
    const source = await seedTenant(context);
    const { bundle } = await exportBundle(context, source.tenant.id);
    const before = context.db.store.organization.length;

    await expect(
      runEffect(
        context.service.importTenant(request(headers), {
          ...bundle,
          applications: [
            {
              key: "app-1",
              name: "Broken",
              platform: "apple",
              source: "store",
              // A store application without a usable store id is invalid.
              storeId: "not-a-number",
              groupKeys: [],
            },
          ],
          preRegistrations: [],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(context.db.store.organization).toHaveLength(before);
    expect(context.db.store.policy).toHaveLength(1);
    expect(context.db.store.enterprise_group).toHaveLength(1);
  });
});
