import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";
const authSecret = "approval-test-secret";
const timestamp = new Date("2026-11-23T09:00:00.000Z");

type AccountKey = "owner" | "admin" | "admin2" | "member" | "custom";

const accounts: Record<AccountKey, { id: string; name: string; email: string }> = {
  owner: { id: "owner-1", name: "Olive Owner", email: "owner@example.com" },
  admin: { id: "admin-1", name: "Adam Admin", email: "admin@example.com" },
  admin2: { id: "admin-2", name: "Bea Boss", email: "bea@example.com" },
  member: { id: "member-1", name: "Mia Member", email: "member@example.com" },
  custom: { id: "custom-1", name: "Cass Custom", email: "custom@example.com" },
};

const cookie = (key: AccountKey) => ({ cookie: "mattrax_session=" + key });

const headers = (key: AccountKey, extra: Record<string, string> = {}) => ({
  ...cookie(key),
  ...extra,
});

const submit = <A, E>(effect: Effect.Effect<A, E, any>) => Effect.runPromise(Effect.result(effect));

const isFailure = (outcome: any) => outcome._tag === "Failure";

const makeContext = (options: { solo?: boolean } = {}) => {
  const db = makeDb();

  for (const key of Object.keys(accounts) as AccountKey[]) {
    const account = accounts[key];

    db.store.account.push({
      id: account.id,
      name: account.name,
      email: account.email,
      emailVerified: true,
      image: null,
      disabled: false,
      totpEnabled: false,
      authRevision: "rev-" + account.id,
      defaultTenantId: "org-1",
      superadmin: false,
      source: "manual",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  db.store.organization.push({
    id: "org-1",
    name: "Acme",
    displayName: "Acme Corp",
    slug: "acme",
    logo: null,
    supportEmail: null,
    brandColor: null,
    metadata: null,
    stripeCustomerId: null,
    requireMfa: false,
    scriptsEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const memberships: Array<[AccountKey, string, string | null]> = options.solo
    ? [["owner", "owner", null]]
    : [
        ["owner", "owner", null],
        ["admin", "admin", null],
        ["admin2", "admin", null],
        ["member", "member", null],
        ["custom", "admin", "role-custom"],
      ];

  db.store.tenant_role.push({
    id: "role-custom",
    organizationId: "org-1",
    name: "Approval desk",
    description: null,
    permissions: ["tenant.read", "approvals.read", "approvals.write"],
    createdByAccountId: "owner-1",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  for (const [key, role, customRoleId] of memberships) {
    db.store.member.push({
      id: "member-" + key,
      organizationId: "org-1",
      accountId: accounts[key].id,
      role,
      customRoleId,
      onboardingDismissedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const auth = {
    requireUser: (input: any) => {
      const inputHeaders =
        input instanceof Request ? Object.fromEntries(input.headers) : input.headers;
      const session = String(inputHeaders.cookie ?? "");
      const sessionToken = session.slice(session.indexOf("=") + 1);
      const key = (Object.keys(accounts) as AccountKey[]).find(
        (candidate) => sessionToken === candidate || sessionToken.startsWith(candidate + "-"),
      );

      if (!key) return Effect.die("Unauthenticated test request");

      const apiToken = sessionToken.endsWith("-token-admin")
        ? { id: "token-1", name: "CI", scopes: ["write"], tenantId: "org-1" }
        : undefined;

      const stored = db.store.account.find((row: any) => row.id === accounts[key].id);

      return Effect.succeed({
        user: stored ?? { ...accounts[key], emailVerified: true },
        apiToken,
      });
    },
    requireStepUp: (input: any) => auth.requireUser(input),
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () =>
      Effect.succeed({ token: "mtx_test", item: { id: "token-1", name: "CI" } }),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: no test reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
  });

  return { db, service };
};

type Context = ReturnType<typeof makeContext>;

const seedPolicy = (
  context: Context,
  overrides: {
    action?: string;
    scopeType?: "tenant" | "group" | "device";
    scopeId?: string | null;
    approverPermission?: string | null;
    approverRole?: string | null;
    approvalsRequired?: number;
  } = {},
) => {
  const row = {
    id: "policy-" + Math.random().toString(36).slice(2, 10),
    organizationId: "org-1",
    action: overrides.action ?? "policy.delete",
    scopeType: overrides.scopeType ?? "tenant",
    scopeId: overrides.scopeId ?? null,
    approverPermission: overrides.approverPermission ?? null,
    approverRole: overrides.approverRole ?? "admin",
    approvalsRequired: overrides.approvalsRequired ?? 1,
    createdByAccountId: "owner-1",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  context.db.store.approval_policy.push(row);

  return row;
};

const seedScript = (context: Context, id = "script-1") => {
  context.db.store.script.push({
    id,
    organizationId: "org-1",
    name: "Rotate logs",
    description: null,
    language: "sh",
    body: "echo rotate",
    runAs: "user",
    timeoutSeconds: 300,
    environment: null,
    triggerType: "manual",
    intervalSeconds: null,
    cronExpression: null,
    enabled: true,
    createdByAccountId: "owner-1",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return id;
};

const pendingRequest = (context: Context) => {
  const rows = context.db.store.approval_request.filter((row: any) => row.status === "pending");

  expect(rows).toHaveLength(1);

  return rows[0] as any;
};

const approve = (context: Context, key: AccountKey, requestId: string, note?: string) =>
  submit(
    context.service.approveApprovalRequest(
      request(headers(key)),
      "org-1",
      requestId,
      note === undefined ? {} : { note },
    ),
  );

const runScriptPayload = {
  name: "Rotate logs",
  language: "sh",
  body: "echo rotate",
  runAs: "user",
  timeoutSeconds: 300,
  trigger: { type: "manual" },
};

describe("approval policies", () => {
  it("creates, lists, edits and deletes a policy with effective RBAC", async () => {
    const context = makeContext();

    const created = await runEffect(
      context.service.createApprovalPolicy(request(headers("owner")), "org-1", {
        action: "script.run",
        scopeType: "tenant",
        approverRole: "admin",
        approvalsRequired: 2,
      }),
    );

    expect(created.id).toBeTruthy();

    const listed = await runEffect(
      context.service.listApprovalPolicies(request(headers("owner")), "org-1"),
    );

    expect(listed.policies).toHaveLength(1);
    expect(listed.policies[0]).toMatchObject({
      action: "script.run",
      approverRole: "admin",
      approvalsRequired: 2,
    });

    await runEffect(
      context.service.patchApprovalPolicy(request(headers("owner")), "org-1", created.id, {
        approverPermission: "devices.command",
        approverRole: null,
        approvalsRequired: 1,
      }),
    );

    const patched = await runEffect(
      context.service.listApprovalPolicies(request(headers("owner")), "org-1"),
    );

    expect(patched.policies[0]).toMatchObject({
      approverPermission: "devices.command",
      approverRole: null,
      approvalsRequired: 1,
    });

    await runEffect(
      context.service.deleteApprovalPolicy(request(headers("owner")), "org-1", created.id),
    );

    expect(context.db.store.approval_policy).toHaveLength(0);
    expect(context.db.store.audit_log.map((row: any) => row.action)).toEqual(
      expect.arrayContaining([
        "approval.policy_created",
        "approval.policy_updated",
        "approval.policy_deleted",
      ]),
    );
  });

  it("refuses a malformed policy and a non-approver", async () => {
    const context = makeContext();

    const both = await submit(
      context.service.createApprovalPolicy(request(headers("owner")), "org-1", {
        action: "script.run",
        approverRole: "admin",
        approverPermission: "devices.command",
      }),
    );

    expect(isFailure(both)).toBe(true);

    const invalidPermission = await submit(
      context.service.createApprovalPolicy(request(headers("owner")), "org-1", {
        action: "script.run",
        approverPermission: "devices.explode",
      }),
    );

    expect(isFailure(invalidPermission)).toBe(true);

    const denied = await submit(
      context.service.createApprovalPolicy(request(headers("member")), "org-1", {
        action: "script.run",
        approverRole: "admin",
      }),
    );

    expect(isFailure(denied)).toBe(true);
    expect((denied as any).failure._tag).toBe("EnterprisePermissionDenied");
  });
});

describe("gated destructive endpoints", () => {
  it("does not delete policies and returns one pending request", async () => {
    const context = makeContext();
    seedPolicy(context, { action: "policy.delete" });
    context.db.store.policy.push({
      id: "policy-target",
      organizationId: "org-1",
      name: "Baseline",
      notes: null,
      priority: 0,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const outcome = await submit(
      context.service.deletePolicies(request(headers("owner")), "org-1", ["policy-target"]),
    );

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("ApprovalRequired");
    expect((outcome as any).failure.requestId).toBeTruthy();
    expect((outcome as any).failure.status).toBe("pending");
    expect((outcome as any).failure.message).toContain("Approval request");

    const requestRow = pendingRequest(context);

    expect(requestRow.organizationId).toBe("org-1");
    expect(requestRow.action).toBe("policy.delete");
    expect(requestRow.requestedByAccountId).toBe("owner-1");
    // Nothing was executed.
    expect(context.db.store.policy).toHaveLength(1);

    const approved = await approve(context, "admin", requestRow.id, "Looks fine");

    expect(isFailure(approved)).toBe(false);
    expect((approved as any).success.status).toBe("approved");
    expect(context.db.store.approval_decision[0]).toMatchObject({
      decision: "approve",
      note: "Looks fine",
      approverAccountId: "admin-1",
    });

    const executed = await runEffect(
      context.service.deletePolicies(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-1",
        ["policy-target"],
      ),
    );

    expect(executed.deleted).toEqual(["policy-target"]);
    expect(context.db.store.policy).toHaveLength(0);
    expect(
      context.db.store.approval_request.find((row: any) => row.id === requestRow.id),
    ).toMatchObject({
      status: "approved",
      consumedAt: expect.any(Date),
    });

    // Single use: the same id cannot run the action twice.
    const replay = await submit(
      context.service.deletePolicies(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-1",
        [],
      ),
    );

    expect(isFailure(replay)).toBe(true);
    expect((replay as any).failure._tag).toBe("EnterpriseConflict");
  });

  it("requires N distinct approvals and never lets the requester approve", async () => {
    const context = makeContext();
    seedPolicy(context, { action: "script.run", approvalsRequired: 2 });
    const scriptId = seedScript(context);

    const first = await submit(
      context.service.runScript(request(headers("owner")), "org-1", scriptId, {}),
    );

    expect(isFailure(first)).toBe(true);
    const requestRow = pendingRequest(context);

    const own = await approve(context, "owner", requestRow.id);

    expect(isFailure(own)).toBe(true);
    expect((own as any).failure._tag).toBe("EnterpriseForbidden");
    expect((own as any).failure.message).toContain("cannot approve your own");

    const oneOfTwo = await approve(context, "admin", requestRow.id);

    expect(isFailure(oneOfTwo)).toBe(false);
    expect((oneOfTwo as any).success.status).toBe("pending");
    expect((oneOfTwo as any).success.approvalsReceived).toBe(1);

    const stillGated = await submit(
      context.service.runScript(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-1",
        scriptId,
        {},
      ),
    );

    expect(isFailure(stillGated)).toBe(true);

    const twoOfTwo = await approve(context, "admin2", requestRow.id);

    expect(isFailure(twoOfTwo)).toBe(false);
    expect((twoOfTwo as any).success.status).toBe("approved");

    const executed = await runEffect(
      context.service.runScript(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-1",
        scriptId,
        {},
      ),
    );

    expect(executed.queued).toBe(0);
    expect(context.db.store.approval_request[0].consumedAt).toBeInstanceOf(Date);
  });

  it("flips to approved when the final approvals arrive concurrently", async () => {
    const context = makeContext();

    seedPolicy(context, { action: "script.run", approvalsRequired: 2 });
    const scriptId = seedScript(context);

    await submit(context.service.runScript(request(headers("owner")), "org-1", scriptId, {}));
    const requestRow = pendingRequest(context);

    const [first, second] = await Promise.all([
      approve(context, "admin", requestRow.id),
      approve(context, "admin2", requestRow.id),
    ]);

    expect(isFailure(first)).toBe(false);
    expect(isFailure(second)).toBe(false);
    expect(context.db.store.approval_decision).toHaveLength(2);
    expect(context.db.store.approval_request[0].status).toBe("approved");
  });

  it("rejects an approval from an administrator without the configured permission", async () => {
    const context = makeContext();
    seedPolicy(context, {
      action: "script.run",
      approverPermission: "devices.command",
      approverRole: null,
    });
    const scriptId = seedScript(context);

    await submit(context.service.runScript(request(headers("owner")), "org-1", scriptId, {}));
    const requestRow = pendingRequest(context);

    // The custom role has approvals.write but not devices.command.
    const outcome = await approve(context, "custom", requestRow.id);

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("EnterpriseForbidden");
    expect((outcome as any).failure.message).toContain("devices.command");
    expect(context.db.store.approval_decision).toHaveLength(0);
  });

  it("never lets an API token approve a request", async () => {
    const context = makeContext();
    seedPolicy(context, { action: "policy.delete" });
    context.db.store.policy.push({
      id: "policy-target",
      organizationId: "org-1",
      name: "Baseline",
      notes: null,
      priority: 0,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await submit(
      context.service.deletePolicies(request(headers("owner")), "org-1", ["policy-target"]),
    );
    const requestRow = pendingRequest(context);

    const outcome = await approve(context, "admin2", requestRow.id);
    // The ordinary admin cookie first, then the token-bearing one.
    const tokenOutcome = await submit(
      context.service.approveApprovalRequest(
        request({ ...headers("admin2"), cookie: "mattrax_session=admin2-token-admin" }),
        "org-1",
        requestRow.id,
        { note: "token" },
      ),
    );

    expect(isFailure(outcome)).toBe(false);
    expect(isFailure(tokenOutcome)).toBe(true);
    expect((tokenOutcome as any).failure.message).toContain("API tokens cannot approve");
  });

  it("enforces expiry on read and on execution", async () => {
    const context = makeContext();
    seedPolicy(context, { action: "policy.delete" });
    context.db.store.policy.push({
      id: "policy-target",
      organizationId: "org-1",
      name: "Baseline",
      notes: null,
      priority: 0,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await submit(
      context.service.deletePolicies(request(headers("owner")), "org-1", ["policy-target"]),
    );
    const requestRow = pendingRequest(context);

    requestRow.expiresAt = new Date(Date.now() - 1_000);

    const listed = await runEffect(
      context.service.listApprovalRequests(request(headers("owner")), "org-1", {
        status: "all",
      }),
    );

    expect(listed.requests[0].status).toBe("expired");
    expect(context.db.store.approval_request[0].status).toBe("expired");
    expect(
      context.db.store.audit_log.filter((row: any) => row.action === "approval.expired"),
    ).toHaveLength(1);

    const outcome = await submit(
      context.service.deletePolicies(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-1",
        ["policy-target"],
      ),
    );

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure.message).toContain("expired");
    expect(context.db.store.policy).toHaveLength(1);
  });

  it("rejects a payload that does not match the approved request", async () => {
    const context = makeContext();
    seedPolicy(context, { action: "script.run" });
    const scriptId = seedScript(context);

    await submit(
      context.service.runScript(request(headers("owner")), "org-1", scriptId, {
        devices: ["device-a"],
      }),
    );
    const requestRow = pendingRequest(context);
    const approved = await approve(context, "admin", requestRow.id);

    expect(isFailure(approved)).toBe(false);

    const mismatch = await submit(
      context.service.runScript(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-1",
        scriptId,
        { devices: ["device-b"] },
      ),
    );

    expect(isFailure(mismatch)).toBe(true);
    expect((mismatch as any).failure._tag).toBe("EnterpriseBadRequest");
    expect((mismatch as any).failure.message).toContain("different request");

    // The mismatched attempt did not consume the approval: the original
    // payload can still use it.
    const executed = await runEffect(
      context.service.runScript(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-1",
        scriptId,
        { devices: ["device-a"] },
      ),
    );

    expect(executed.queued).toBe(0);
    expect(context.db.store.approval_request[0].consumedAt).toBeInstanceOf(Date);
  });

  it("allows an owner break-glass with a reason and audits it prominently", async () => {
    const context = makeContext();
    seedPolicy(context, { action: "policy.delete" });
    context.db.store.policy.push({
      id: "policy-target",
      organizationId: "org-1",
      name: "Baseline",
      notes: null,
      priority: 0,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const executed = await runEffect(
      context.service.deletePolicies(
        request(
          headers("owner", {
            "x-mattrax-approval-break-glass": "Owner locked out during incident",
          }),
        ),
        "org-1",
        ["policy-target"],
      ),
    );

    expect(executed.deleted).toEqual(["policy-target"]);

    const row = context.db.store.approval_request[0] as any;

    expect(row).toMatchObject({
      breakGlass: true,
      breakGlassReason: "Owner locked out during incident",
      approvalsRequired: 0,
      status: "approved",
    });
    expect(row.consumedAt).toBeInstanceOf(Date);

    const audit = context.db.store.audit_log.find(
      (entry: any) => entry.action === "approval.break_glass_used",
    ) as any;

    expect(audit).toBeTruthy();
    expect(audit.metadata).toMatchObject({
      action: "policy.delete",
      reason: "Owner locked out during incident",
    });
  });

  it("refuses break-glass to a non-owner and to a bearer credential", async () => {
    const context = makeContext();
    seedPolicy(context, { action: "policy.delete" });
    context.db.store.policy.push({
      id: "policy-target",
      organizationId: "org-1",
      name: "Baseline",
      notes: null,
      priority: 0,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const admin = await submit(
      context.service.deletePolicies(
        request(headers("admin", { "x-mattrax-approval-break-glass": "need it" })),
        "org-1",
        ["policy-target"],
      ),
    );

    expect(isFailure(admin)).toBe(true);
    expect((admin as any).failure.message).toContain("built-in owner");

    const token = await submit(
      context.service.deletePolicies(
        request({
          ...headers("owner", { "x-mattrax-approval-break-glass": "need it" }),
          cookie: "mattrax_session=owner-token-admin",
        }),
        "org-1",
        ["policy-target"],
      ),
    );

    expect(isFailure(token)).toBe(true);
    expect((token as any).failure.message).toContain("signed-in owner");
    expect(context.db.store.policy).toHaveLength(1);
  });
});

describe("every gated endpoint asks for approval", () => {
  const cases: Array<{
    name: string;
    action: string;
    prepare?: (context: Context) => void;
    run: (context: Context) => Effect.Effect<unknown, unknown, any>;
  }> = [
    {
      name: "tenant.export",
      action: "tenant.export",
      run: (context) => context.service.exportTenant(request(headers("owner")), "org-1", {}),
    },
    {
      name: "tenant.export cutover",
      action: "tenant.export",
      run: (context) =>
        context.service.exportTenantCutover(request(headers("owner")), "org-1", {
          passphrase: "archive-passphrase",
        }),
    },
    {
      name: "backup.download",
      action: "backup.download",
      prepare: (context) =>
        context.db.store.backup_run.push({
          id: "backup-1",
          organizationId: "org-1",
          status: "succeeded",
          r2Key: "backups/org-1/backup-1.json",
          sizeBytes: 10,
          startedAt: timestamp,
          completedAt: timestamp,
          error: null,
          trigger: "manual",
          retention: "default",
        }),
      run: (context) =>
        context.service.downloadTenantBackup(request(headers("owner")), "org-1", "backup-1"),
    },
    {
      name: "device.wipe",
      action: "device.wipe",
      prepare: (context) =>
        context.db.store.device.push({
          id: "device-1",
          organizationId: "org-1",
          proto: "apple",
          status: "enrolled",
          name: "Mac",
          serial: "SERIAL-1",
          model: "MacBookPro18,3",
          dmIdentifier: "udid-1",
          enrolledAt: timestamp,
          lastSeenAt: timestamp,
        }),
      run: (context) =>
        context.service.deviceAction(request(headers("owner")), "org-1", "device-1", {
          action: "wipe",
        }),
    },
    {
      name: "device.return-to-service",
      action: "device.wipe",
      prepare: (context) =>
        context.db.store.device.push({
          id: "device-1",
          organizationId: "org-1",
          proto: "apple",
          status: "enrolled",
          name: "iPhone",
          serial: "SERIAL-1",
          model: "iPhone15,2",
          dmIdentifier: "udid-1",
          osEdition: "iOS",
          osVersion: "17.0",
          enrolledAt: timestamp,
          lastSeenAt: timestamp,
        }),
      run: (context) =>
        context.service.deviceAction(request(headers("owner")), "org-1", "device-1", {
          action: "return-to-service",
        }),
    },
    {
      name: "backup.restore",
      action: "policy.delete",
      prepare: (context) =>
        context.db.store.backup_run.push({
          id: "backup-1",
          organizationId: "org-1",
          status: "succeeded",
          r2Key: "backups/org-1/backup-1.json",
          sizeBytes: 10,
          startedAt: timestamp,
          completedAt: timestamp,
          error: null,
          trigger: "manual",
          retention: "default",
        }),
      run: (context) =>
        context.service.restoreTenantBackup(request(headers("owner")), "org-1", "backup-1", {
          confirm: "acme",
        }),
    },
    {
      name: "script.write",
      action: "script.write",
      run: (context) =>
        context.service.createScript(request(headers("owner")), "org-1", runScriptPayload),
    },
    {
      name: "api-token.create",
      action: "api-token.create",
      run: (context) =>
        context.service.createApiToken(request(headers("owner")), {
          name: "CI",
          tenantId: "org-1",
          permissions: ["devices.read"],
        }),
    },
  ];

  for (const testCase of cases) {
    it("gates " + testCase.name, async () => {
      const context = makeContext();

      seedPolicy(context, { action: testCase.action });
      testCase.prepare?.(context);

      const outcome = await submit(testCase.run(context));

      expect(isFailure(outcome)).toBe(true);
      expect((outcome as any).failure._tag).toBe("ApprovalRequired");
      expect((outcome as any).failure.requestId).toBeTruthy();
      expect((outcome as any).failure.message).toContain("Approval request");

      const row = pendingRequest(context);

      expect(row.action).toBe(testCase.action);
    });
  }

  it("gates the explicit delete only after the solo-member check", async () => {
    const context = makeContext({ solo: true });

    seedPolicy(context, { action: "tenant.delete" });

    const blocked = await submit(context.service.deleteTenant(request(headers("owner")), "org-1"));

    expect(isFailure(blocked)).toBe(true);
    expect((blocked as any).failure._tag).toBe("ApprovalRequired");
    expect(context.db.store.organization).toHaveLength(1);
    expect(context.db.store.organization[0].id).toBe("org-1");

    const requestRow = pendingRequest(context);
    const breakGlass = await submit(
      context.service.deleteTenant(
        request(
          headers("owner", {
            "x-mattrax-approval-break-glass": "Solo tenant owner removing the workspace",
          }),
        ),
        "org-1",
      ),
    );

    // Teardown may fail later, but the owner override must get past approval
    // and consume the request.
    expect(isFailure(breakGlass) ? (breakGlass as any).failure._tag : "ok").not.toBe(
      "ApprovalRequired",
    );
    const breakGlassRow = context.db.store.approval_request.find(
      (row: any) => row.breakGlass === true,
    );

    expect(breakGlassRow).toMatchObject({
      breakGlass: true,
      consumedAt: expect.any(Date),
    });
    expect(context.db.store.approval_request.some((row: any) => row.id === requestRow.id)).toBe(
      true,
    );
  });
});

describe("an approved request allows the original action", () => {
  const withApproval = (approvalId: string) =>
    headers("owner", { "x-mattrax-approval": approvalId });

  const mac = (context: Context) =>
    context.db.store.device.push({
      id: "device-1",
      organizationId: "org-1",
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      serial: "SERIAL-1",
      model: "MacBookPro18,3",
      dmIdentifier: "udid-1",
      osEdition: "macOS 15",
      enrolledAt: timestamp,
      lastSeenAt: timestamp,
    });

  const backup = (context: Context) =>
    context.db.store.backup_run.push({
      id: "backup-1",
      organizationId: "org-1",
      status: "succeeded",
      r2Key: "backups/org-1/backup-1.json",
      sizeBytes: 10,
      startedAt: timestamp,
      completedAt: timestamp,
      error: null,
      trigger: "manual",
      retention: "default",
    });

  const targetPolicy = (context: Context) =>
    context.db.store.policy.push({
      id: "policy-target",
      organizationId: "org-1",
      name: "Baseline",
      notes: null,
      priority: 0,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

  const cases: Array<{
    name: string;
    action: string;
    prepare?: (context: Context) => void;
    run: (context: Context, approvalId?: string) => Effect.Effect<unknown, unknown, any>;
  }> = [
    {
      name: "tenant.export",
      action: "tenant.export",
      run: (context, approvalId) =>
        context.service.exportTenant(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          {},
        ),
    },
    {
      name: "tenant.export cutover",
      action: "tenant.export",
      run: (context, approvalId) =>
        context.service.exportTenantCutover(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          { passphrase: "archive-passphrase" },
        ),
    },
    {
      name: "policy.delete",
      action: "policy.delete",
      prepare: targetPolicy,
      run: (context, approvalId) =>
        context.service.deletePolicies(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          ["policy-target"],
        ),
    },
    {
      name: "script.run",
      action: "script.run",
      prepare: (context) => void seedScript(context),
      run: (context, approvalId) =>
        context.service.runScript(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          "script-1",
          {},
        ),
    },
    {
      name: "script.write",
      action: "script.write",
      run: (context, approvalId) =>
        context.service.createScript(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          runScriptPayload,
        ),
    },
    {
      name: "backup.restore",
      action: "policy.delete",
      prepare: backup,
      run: (context, approvalId) =>
        context.service.restoreTenantBackup(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          "backup-1",
          { confirm: "acme" },
        ),
    },
    {
      name: "backup.download",
      action: "backup.download",
      prepare: backup,
      run: (context, approvalId) =>
        context.service.downloadTenantBackup(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          "backup-1",
        ),
    },
    {
      name: "device.wipe",
      action: "device.wipe",
      prepare: mac,
      run: (context, approvalId) =>
        context.service.deviceAction(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          "device-1",
          { action: "wipe" },
        ),
    },
    {
      name: "device.return-to-service",
      action: "device.wipe",
      prepare: (context) =>
        context.db.store.device.push({
          id: "device-1",
          organizationId: "org-1",
          proto: "apple",
          status: "enrolled",
          name: "iPhone",
          serial: "SERIAL-1",
          model: "iPhone15,2",
          dmIdentifier: "udid-1",
          osEdition: "iOS",
          osVersion: "17.0",
          enrolledAt: timestamp,
          lastSeenAt: timestamp,
        }),
      run: (context, approvalId) =>
        context.service.deviceAction(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          "org-1",
          "device-1",
          { action: "return-to-service" },
        ),
    },
    {
      name: "api-token.create",
      action: "api-token.create",
      run: (context, approvalId) =>
        context.service.createApiToken(
          request(approvalId ? withApproval(approvalId) : headers("owner")),
          { name: "CI", tenantId: "org-1", permissions: ["devices.read"] },
        ),
    },
  ];

  for (const testCase of cases) {
    it("runs " + testCase.name + " after approval", async () => {
      const context = makeContext();

      seedPolicy(context, { action: testCase.action });
      testCase.prepare?.(context);

      const blocked = await submit(testCase.run(context));

      expect(isFailure(blocked)).toBe(true);
      expect((blocked as any).failure._tag).toBe("ApprovalRequired");

      const requestRow = pendingRequest(context);
      const approved = await approve(context, "admin", requestRow.id);

      expect(isFailure(approved)).toBe(false);
      expect((approved as any).success.status).toBe("approved");

      const allowed = await submit(testCase.run(context, requestRow.id));

      expect(isFailure(allowed) ? (allowed as any).failure._tag : "ok").not.toBe(
        "ApprovalRequired",
      );
      expect(
        context.db.store.approval_request.find((row: any) => row.id === requestRow.id),
      ).toMatchObject({ consumedAt: expect.any(Date) });
    });
  }
});

describe("account deletion cannot bypass tenant.delete approval", () => {
  it("refuses to tear down a solo tenant that has a delete policy", async () => {
    const context = makeContext({ solo: true });

    seedPolicy(context, { action: "tenant.delete" });

    const outcome = await submit(context.service.deleteMe(request(headers("owner"))));

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("EnterpriseForbidden");
    expect((outcome as any).failure.message).toContain("delete the tenant explicitly");
    expect(context.db.store.organization).toHaveLength(1);
    expect(context.db.store.account.some((row: any) => row.id === "owner-1")).toBe(true);
  });

  it("requires the built-in owner role for solo tenant teardown", async () => {
    const context = makeContext({ solo: true });

    context.db.store.member[0].role = "admin";

    const outcome = await submit(context.service.deleteMe(request(headers("owner"))));

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("EnterpriseForbidden");
    expect(context.db.store.organization).toHaveLength(1);
  });
});

describe("account-wide API tokens", () => {
  it("are restricted to platform administrators", async () => {
    const context = makeContext();

    const outcome = await submit(
      context.service.createApiToken(request(headers("owner")), {
        name: "Global CI",
        permissions: ["devices.read"],
      }),
    );

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("EnterpriseForbidden");
    expect((outcome as any).failure.message).toContain("platform administrators");
    expect(context.db.store.account_api_token).toHaveLength(0);
  });

  it("allows a platform administrator to create one", async () => {
    const context = makeContext();

    context.db.store.account[0].superadmin = true;

    const outcome = await submit(
      context.service.createApiToken(request(headers("owner")), {
        name: "Global CI",
        permissions: ["devices.read"],
      }),
    );

    expect(isFailure(outcome)).toBe(false);
  });
});

describe("tenant isolation", () => {
  const addSecondTenant = (context: Context) => {
    context.db.store.organization.push({
      id: "org-2",
      name: "Other",
      displayName: "Other",
      slug: "other",
      logo: null,
      supportEmail: null,
      brandColor: null,
      metadata: null,
      stripeCustomerId: null,
      requireMfa: false,
      scriptsEnabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    context.db.store.member.push({
      id: "member-org-2",
      organizationId: "org-2",
      accountId: "owner-1",
      role: "owner",
      customRoleId: null,
      onboardingDismissedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    context.db.store.approval_policy.push({
      id: "policy-org-2",
      organizationId: "org-2",
      action: "policy.delete",
      scopeType: "tenant",
      scopeId: null,
      approverPermission: null,
      approverRole: "admin",
      approvalsRequired: 1,
      createdByAccountId: "owner-1",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };

  it("does not accept an approval id from another tenant", async () => {
    const context = makeContext();

    addSecondTenant(context);
    seedPolicy(context, { action: "policy.delete" });

    await submit(
      context.service.deletePolicies(request(headers("owner")), "org-1", ["policy-target"]),
    );
    const requestRow = pendingRequest(context);

    const outcome = await submit(
      context.service.deletePolicies(
        request(headers("owner", { "x-mattrax-approval": requestRow.id })),
        "org-2",
        ["policy-target"],
      ),
    );

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("EnterpriseNotFound");
  });

  it("does not let an administrator from another tenant decide a request", async () => {
    const context = makeContext();

    addSecondTenant(context);
    seedPolicy(context, { action: "policy.delete" });

    await submit(
      context.service.deletePolicies(request(headers("owner")), "org-1", ["policy-target"]),
    );
    const requestRow = pendingRequest(context);

    const outcome = await submit(
      context.service.approveApprovalRequest(request(headers("admin")), "org-2", requestRow.id, {}),
    );

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("EnterpriseNotFound");
  });
});

describe("approval request edge cases", () => {
  it("normalises script write payloads when binding approval", async () => {
    const context = makeContext();

    seedPolicy(context, { action: "script.write" });

    const first = await submit(
      context.service.patchScript(request(headers("owner")), "org-1", "script-1", {
        name: "Rotate logs",
        body: "echo rotate",
        expectedUpdatedAt: "2026-11-23T09:00:00.000Z",
      }),
    );
    const second = await submit(
      context.service.patchScript(request(headers("owner")), "org-1", "script-1", {
        body: "echo rotate",
        name: "Rotate logs",
      }),
    );

    expect(isFailure(first)).toBe(true);
    expect(isFailure(second)).toBe(true);
    expect((first as any).failure._tag).toBe("ApprovalRequired");
    expect((second as any).failure._tag).toBe("ApprovalRequired");
    expect((first as any).failure.requestId).toBe((second as any).failure.requestId);
    expect(context.db.store.approval_request).toHaveLength(1);
  });

  it("lets a requester without approvals.read list and cancel their own request", async () => {
    const context = makeContext();

    // The member built-in role has tenant.read but not approvals.read.
    seedPolicy(context, { action: "api-token.create" });

    const blocked = await submit(
      context.service.createApiToken(request(headers("member")), {
        name: "Member token",
        tenantId: "org-1",
        permissions: ["devices.read"],
      }),
    );

    expect(isFailure(blocked)).toBe(true);
    expect((blocked as any).failure._tag).toBe("ApprovalRequired");

    const mine = await runEffect(
      context.service.listApprovalRequests(request(headers("member")), "org-1", {
        status: "all",
        mine: "true",
      }),
    );

    expect(mine.requests).toHaveLength(1);
    expect(mine.requests[0].requestedByMe).toBe(true);

    const cancelled = await runEffect(
      context.service.cancelApprovalRequest(
        request(headers("member")),
        "org-1",
        mine.requests[0].id,
      ),
    );

    expect(cancelled.status).toBe("cancelled");

    const queue = await submit(
      context.service.listApprovalRequests(request(headers("member")), "org-1", {
        status: "pending",
      }),
    );

    expect(isFailure(queue)).toBe(true);
    expect((queue as any).failure._tag).toBe("EnterprisePermissionDenied");
  });

  it("does not let a member read someone else's request", async () => {
    const context = makeContext();

    seedPolicy(context, { action: "policy.delete" });
    await submit(
      context.service.deletePolicies(request(headers("owner")), "org-1", ["policy-target"]),
    );
    const requestRow = pendingRequest(context);

    const outcome = await submit(
      context.service.getApprovalRequest(request(headers("member")), "org-1", requestRow.id),
    );

    expect(isFailure(outcome)).toBe(true);
    expect((outcome as any).failure._tag).toBe("EnterprisePermissionDenied");
  });
});
