import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

type TestUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const userRow = (overrides: Partial<TestUser> = {}): TestUser => {
  const now = new Date();

  return {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

const makeContext = (options: { db?: any; user?: Partial<TestUser> } = {}) => {
  const db = options.db ?? makeDb();
  const user = userRow(options.user);

  if (!db.store.account.some((row: any) => row.id === user.id)) db.store.account.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie ? Effect.succeed({ user }) : Effect.fail(new Error("unauthenticated"));
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
    stripeClient: makeStripeClient(),
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret: "policy-deployment-test-secret",
  });

  return { db, service, user, headers: { cookie: "mattrax_session=test" } };
};

const tenantFor = async (context: ReturnType<typeof makeContext>, slug = "acme") =>
  runEffect(
    context.service.createTenant(request(context.headers), {
      name: slug === "acme" ? "Acme" : "Globex",
      slug,
    }),
  );

const seedDevice = (
  db: any,
  organizationId: string,
  id: string,
  options: { proto?: "apple" | "win" | "android"; declarationMode?: "ddm" | "legacy" } = {},
) => {
  const now = new Date();

  db.store.device.push({
    id,
    organizationId,
    proto: options.proto ?? "apple",
    status: "enrolled",
    name: id,
    enrolledAt: now,
    lastSeenAt: now,
  });

  if (options.proto === undefined || options.proto === "apple")
    db.store.device_apple.push({
      deviceId: id,
      declarationMode: options.declarationMode ?? "ddm",
    });
};

const seedDeclaration = (
  db: any,
  deviceId: string,
  identifier: string,
  options: { valid?: string; active?: boolean; serverToken?: string | null } = {},
) => {
  db.store.device_declaration.push({
    deviceId,
    identifier,
    declarationType: "configurations",
    active: options.active ?? true,
    valid: options.valid ?? "valid",
    serverToken: options.serverToken ?? null,
    reasons: null,
    updatedAt: new Date("2026-11-20T10:00:00.000Z"),
  });
};

/** Replace the version-1 snapshot createPolicy wrote with an explicit shape. */
const setSnapshot = (db: any, policyId: string, snapshot: Schema.JsonObject) => {
  const deployment = db.store.policy_deployment.find((row: any) => row.policyId === policyId);

  if (!deployment) throw new Error("policy deployment missing");

  deployment.snapshot = snapshot;

  return deployment;
};

describe("getPolicyDeploymentDevices", () => {
  it("returns counts and a stable page ordered action-first", async () => {
    const context = makeContext();
    const tenant = await tenantFor(context);

    const policy = await runEffect(
      context.service.createPolicy(request(context.headers), tenant.id, { name: "Baseline" }),
    );

    setSnapshot(context.db, policy.id, { "mttx.apple.declaration.files": { files: [] } });

    for (const id of ["device-1", "device-2", "device-3"]) seedDevice(context.db, tenant.id, id);

    seedDevice(context.db, tenant.id, "win-1", { proto: "win" });

    for (const id of ["device-1", "device-2", "device-3", "win-1"])
      context.db.store.device_policy.push({
        deviceId: id,
        policyId: policy.id,
        mode: "include",
        createdAt: new Date(),
      });

    seedDeclaration(context.db, "device-1", policy.id + ":mttx.apple.declaration.files");
    seedDeclaration(context.db, "device-2", policy.id + ":mttx.apple.declaration.files", {
      valid: "invalid",
    });

    const first = await runEffect(
      context.service.getPolicyDeploymentDevices(
        request(context.headers),
        tenant.id,
        policy.id,
        "latest",
        { limit: 2, offset: 0 },
      ),
    );

    expect(first).toMatchObject({
      policyId: policy.id,
      version: 1,
      state: "partial",
      offset: 0,
      nextOffset: 2,
      counts: {
        total: 4,
        scoped: 4,
        delivered: 1,
        pending: 1,
        failed: 1,
        notApplicable: 0,
        untracked: 1,
        notInScope: 0,
      },
    });
    expect(first.devices.map((device) => [device.deviceId, device.status])).toEqual([
      ["device-2", "failed"],
      ["device-3", "pending"],
    ]);

    const second = await runEffect(
      context.service.getPolicyDeploymentDevices(
        request(context.headers),
        tenant.id,
        policy.id,
        "1",
        { limit: 2, offset: 2 },
      ),
    );

    expect(second.devices.map((device) => [device.deviceId, device.status])).toEqual([
      ["device-1", "delivered"],
      ["win-1", "untracked"],
    ]);
    expect(second.nextOffset).toBeNull();

    const all = await runEffect(
      context.service.getPolicyDeploymentDevices(
        request(context.headers),
        tenant.id,
        policy.id,
        "latest",
        { limit: 100, offset: 0 },
      ),
    );

    expect(all.devices.find((device) => device.deviceId === "win-1")).toMatchObject({
      status: "untracked",
      reason: "Windows does not report declaration status.",
    });
  });

  it("judges each version by its own snapshot", async () => {
    const context = makeContext();
    const tenant = await tenantFor(context);

    const policy = await runEffect(
      context.service.createPolicy(request(context.headers), tenant.id, { name: "Versioned" }),
    );

    setSnapshot(context.db, policy.id, { "mttx.apple.declaration.files": { files: [] } });
    context.db.store.policy_deployment.push({
      id: "deployment-2",
      organizationId: tenant.id,
      policyId: policy.id,
      version: 2,
      snapshot: { "mttx.apple.declaration.passcode": { minimumLength: 12 } },
      createdByAccountId: null,
      createdAt: new Date(),
    });

    seedDevice(context.db, tenant.id, "device-1");
    context.db.store.device_policy.push({
      deviceId: "device-1",
      policyId: policy.id,
      mode: "include",
      createdAt: new Date(),
    });
    seedDeclaration(context.db, "device-1", policy.id + ":mttx.apple.declaration.files");

    const versionOne = await runEffect(
      context.service.getPolicyDeploymentDevices(
        request(context.headers),
        tenant.id,
        policy.id,
        "1",
        {},
      ),
    );

    const versionTwo = await runEffect(
      context.service.getPolicyDeploymentDevices(
        request(context.headers),
        tenant.id,
        policy.id,
        "2",
        {},
      ),
    );

    expect(versionOne.state).toBe("delivered");
    expect(versionOne.devices[0]).toMatchObject({ status: "delivered", applicableKinds: 1 });
    expect(versionTwo.state).toBe("pending");
    expect(versionTwo.devices[0]).toMatchObject({ status: "pending", applicableKinds: 1 });
  });

  it("surfaces a device that still reports the version but left scope", async () => {
    const context = makeContext();
    const tenant = await tenantFor(context);

    const policy = await runEffect(
      context.service.createPolicy(request(context.headers), tenant.id, { name: "Grouped" }),
    );

    setSnapshot(context.db, policy.id, { "mttx.apple.declaration.files": { files: [] } });

    const group = await runEffect(
      context.service.createGroup(request(context.headers), tenant.id, { name: "Fleet" }),
    );

    seedDevice(context.db, tenant.id, "device-old");
    seedDevice(context.db, tenant.id, "device-new");

    const now = new Date();

    context.db.store.group_policy.push({
      groupId: group.id,
      policyId: policy.id,
      mode: "include",
      createdAt: now,
    });
    context.db.store.group_device.push(
      { groupId: group.id, deviceId: "device-old", source: "manual" },
      { groupId: group.id, deviceId: "device-new", source: "manual" },
    );
    context.db.store.device_policy.push({
      deviceId: "device-old",
      policyId: policy.id,
      mode: "exclude",
      createdAt: now,
    });
    seedDeclaration(context.db, "device-old", policy.id + ":mttx.apple.declaration.files");

    const result = await runEffect(
      context.service.getPolicyDeploymentDevices(
        request(context.headers),
        tenant.id,
        policy.id,
        "latest",
        {},
      ),
    );

    expect(result.counts).toMatchObject({
      total: 2,
      scoped: 1,
      pending: 1,
      notInScope: 1,
    });
    expect(result.devices.find((device) => device.deviceId === "device-old")).toMatchObject({
      status: "not-in-scope",
      reason: "No longer in the policy's scope, but still reports this version's declarations.",
    });
  });

  it("does not reveal another tenant's deployment", async () => {
    const context = makeContext();
    const first = await tenantFor(context, "acme");
    const second = await tenantFor(context, "globex");

    const policy = await runEffect(
      context.service.createPolicy(request(context.headers), first.id, { name: "Owned" }),
    );

    await expect(
      runEffect(
        context.service.getPolicyDeploymentDevices(
          request(context.headers),
          second.id,
          policy.id,
          "latest",
          {},
        ),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("requires policies.read", async () => {
    const owner = makeContext();
    const tenant = await tenantFor(owner);

    const policy = await runEffect(
      owner.service.createPolicy(request(owner.headers), tenant.id, { name: "Read-only" }),
    );

    const role = await runEffect(
      owner.service.createTenantRole(request(owner.headers), tenant.id, {
        name: "Devices only",
        permissions: ["devices.read"],
      }),
    );

    const member = makeContext({
      db: owner.db,
      user: { id: "user-2", name: "Member", email: "member@example.com" },
    });

    owner.db.store.member.push({
      id: "member-2",
      organizationId: tenant.id,
      accountId: "user-2",
      role: "member",
      customRoleId: role.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      runEffect(
        member.service.getPolicyDeploymentDevices(
          request(member.headers),
          tenant.id,
          policy.id,
          "latest",
          {},
        ),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("rejects a malformed version and a missing deployment", async () => {
    const context = makeContext();
    const tenant = await tenantFor(context);

    const policy = await runEffect(
      context.service.createPolicy(request(context.headers), tenant.id, { name: "Baseline" }),
    );

    await expect(
      runEffect(
        context.service.getPolicyDeploymentDevices(
          request(context.headers),
          tenant.id,
          policy.id,
          "newest",
          {},
        ),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        context.service.getPolicyDeploymentDevices(
          request(context.headers),
          tenant.id,
          policy.id,
          "7",
          {},
        ),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("never reports a legacy Apple device as delivered", async () => {
    const context = makeContext();
    const tenant = await tenantFor(context);

    const policy = await runEffect(
      context.service.createPolicy(request(context.headers), tenant.id, { name: "Legacy" }),
    );

    setSnapshot(context.db, policy.id, { "mttx.apple.device": { camera: false } });

    seedDevice(context.db, tenant.id, "device-1", { declarationMode: "legacy" });
    context.db.store.device_policy.push({
      deviceId: "device-1",
      policyId: policy.id,
      mode: "include",
      createdAt: new Date(),
    });
    context.db.store.device_command.push({
      id: "command-1",
      organizationId: tenant.id,
      deviceId: "device-1",
      requestType: "InstallProfile",
      status: "succeeded",
      createdAt: new Date("2026-11-20T09:00:00.000Z"),
      updatedAt: new Date("2026-11-20T09:00:00.000Z"),
    });

    const result = await runEffect(
      context.service.getPolicyDeploymentDevices(
        request(context.headers),
        tenant.id,
        policy.id,
        "latest",
        {},
      ),
    );

    expect(result.state).toBe("not-tracked");
    expect(result.devices[0]).toMatchObject({
      deviceId: "device-1",
      status: "untracked",
      lastEvidenceAt: "2026-11-20T09:00:00.000Z",
    });
  });
});
