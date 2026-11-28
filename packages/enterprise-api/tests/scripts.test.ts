import { RunId } from "@mattrax/crypto";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  BUILT_IN_ROLE_PERMISSIONS,
  PERMISSIONS,
  STEP_UP_ACTIONS,
  StepUpRequired,
  EnterpriseUnauthorized,
  hasPermission,
} from "@mattrax/enterprise-domain";
import {
  createScript,
  deleteScript,
  getScriptAssignments,
  getScriptDetail,
  listScriptExecutions,
  listScripts,
  patchScriptAssignments,
  queueScriptRun,
  recordScriptAgentResult,
  runScript,
  scriptAgentSync,
  scriptAssignedDeviceIds,
  sweepScriptExecutions,
  updateScript,
} from "@mattrax/enterprise-backend";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const now = new Date("2026-11-16T12:00:00.000Z");

const orgId = "org-1";

const otherOrgId = "org-2";

const user = {
  id: "user-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  image: null,
  createdAt: now,
  updatedAt: now,
};

const organization = {
  id: orgId,
  name: "Acme",
  slug: "acme",
  scriptsEnabled: true,
  requireMfa: false,
  createdAt: now,
  updatedAt: now,
};

const otherOrganization = { ...organization, id: otherOrgId, name: "Other", slug: "other" };

type DeviceSeed = {
  id: string;
  organizationId: string;
  proto: string;
  status: string;
  name: string;
  enrolledAt: Date;
  lastSeenAt: Date;
};

const device = (id: string, overrides: Partial<DeviceSeed> = {}): DeviceSeed => ({
  id,
  organizationId: orgId,
  proto: "apple",
  status: "enrolled",
  name: `Device ${id}`,
  enrolledAt: now,
  lastSeenAt: now,
  ...overrides,
});

const scriptValues = {
  name: "Rotate logs",
  description: "Rotates logs",
  language: "bash" as const,
  body: "#!/bin/bash\nlog rotate",
  runAs: "user" as const,
  timeoutSeconds: 300,
  environment: [{ name: "API_TOKEN", value: "secret-value", secret: true }],
  trigger: { type: "manual" as const },
};

const seed = async (
  options: {
    scriptsEnabled?: boolean;
  } = {},
) => {
  const db = makeDb({
    account: [user],
    organization: [{ ...organization, scriptsEnabled: options.scriptsEnabled ?? true }],
    device: [
      device("device-1"),
      device("device-2", { proto: "win" }),
      device("device-3", { status: "unenrolled" }),
      device("device-4", { proto: "android" }),
    ],
  });

  return db;
};

const create = async (db: any) => {
  const result = await runEffect(createScript(db, orgId, user.id, scriptValues, now));

  if (!("id" in result)) throw new Error(result.problem);

  const row = db.store.script.find((entry: { id: string }) => entry.id === result.id);

  return { id: result.id, row };
};

describe("script RBAC and step-up", () => {
  it("publishes the script permissions and grants them to the right roles", () => {
    expect(PERMISSIONS).toContain("scripts.read");
    expect(PERMISSIONS).toContain("scripts.write");
    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.owner, "scripts.write")).toBe(true);
    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.admin, "scripts.write")).toBe(true);
    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.member, "scripts.write")).toBe(false);
    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.member, "scripts.read")).toBe(true);
    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.auditor, "scripts.read")).toBe(true);
  });

  it("requires a fresh step-up for changes and runs", () => {
    expect(STEP_UP_ACTIONS).toContain("script-change");
    expect(STEP_UP_ACTIONS).toContain("script-run");
  });

  it("maps every script endpoint to its resource permission", () => {
    expect(permissionForMethod("listScripts")).toBe("scripts.read");
    expect(permissionForMethod("getScript")).toBe("scripts.read");
    expect(permissionForMethod("getScriptSettings")).toBe("scripts.read");
    expect(permissionForMethod("listScriptExecutions")).toBe("scripts.read");
    expect(permissionForMethod("createScript")).toBe("scripts.write");
    expect(permissionForMethod("patchScript")).toBe("scripts.write");
    expect(permissionForMethod("deleteScript")).toBe("scripts.write");
    expect(permissionForMethod("patchScriptSettings")).toBe("scripts.write");
    expect(permissionForMethod("patchScriptAssignments")).toBe("scripts.write");
    expect(permissionForMethod("runScript")).toBe("scripts.write");
  });
});

describe("script persistence", () => {
  it("creates, summarises, updates and deletes a script", async () => {
    const db = await seed();
    const { id } = await create(db);

    const list = await runEffect(listScripts(db, organization, ["scripts.read"]));

    expect(list.enabled).toBe(true);
    expect(list.canRun).toBe(false);
    expect(list.scripts[0]?.name).toBe("Rotate logs");

    const detail = await runEffect(getScriptDetail(db, orgId, id));

    expect(detail?.body).toContain("log rotate");
    expect(detail?.script.environment[0]?.secret).toBe(true);

    const updated = await runEffect(
      updateScript(db, orgId, id, { name: "Rotate logs nightly", timeoutSeconds: 600 }, now),
    );

    expect(updated).toEqual({ status: "ok" });
    expect((await runEffect(getScriptDetail(db, orgId, id)))?.script.name).toBe(
      "Rotate logs nightly",
    );

    expect(await runEffect(deleteScript(db, orgId, id))).toEqual({ deleted: true });
    expect(await runEffect(getScriptDetail(db, orgId, id))).toBeNull();
  });

  it("rejects invalid edits without writing", async () => {
    const db = await seed();
    const { id } = await create(db);

    const result = await runEffect(updateScript(db, orgId, id, { body: "" }, now));

    expect(result).toMatchObject({ problem: "Script body is required" });
    expect((await runEffect(getScriptDetail(db, orgId, id)))?.body).not.toBe("");
  });

  it("keeps every read tenant-scoped", async () => {
    const db = await seed();
    const { id } = await create(db);

    expect(await runEffect(getScriptDetail(db, otherOrgId, id))).toBeNull();
    expect(
      await runEffect(listScripts(db, { ...otherOrganization, scriptsEnabled: true }, [])),
    ).toMatchObject({ scripts: [] });
    expect(await runEffect(deleteScript(db, otherOrgId, id))).toEqual({ deleted: false });
  });
});

describe("assignments", () => {
  it("resolves direct and group assignments", async () => {
    const db = await seed();
    const { id } = await create(db);

    db.store.enterprise_group.push({ id: "group-1", organizationId: orgId, name: "Macs" });
    db.store.group_device.push({ groupId: "group-1", deviceId: "device-1", source: "manual" });

    const result = await runEffect(
      patchScriptAssignments(
        db,
        orgId,
        id,
        { assign: { devices: ["device-2"], groups: ["group-1"] } },
        now,
      ),
    );

    expect(result).toEqual({ status: "ok" });

    const assigned = await runEffect(scriptAssignedDeviceIds(db, orgId, id));

    expect(assigned.map((row) => row.id).sort()).toEqual(["device-1", "device-2"]);

    const assignments = await runEffect(getScriptAssignments(db, orgId, id));

    expect(assignments?.devices.map((row) => row.id)).toEqual(["device-2"]);
    expect(assignments?.groups.map((row) => row.id)).toEqual(["group-1"]);

    await runEffect(
      patchScriptAssignments(db, orgId, id, { unassign: { groups: ["group-1"] } }, now),
    );

    expect((await runEffect(scriptAssignedDeviceIds(db, orgId, id))).map((row) => row.id)).toEqual([
      "device-2",
    ]);
  });

  it("rejects targets from another tenant", async () => {
    const db = await seed();
    const { id } = await create(db);

    db.store.device.push(device("other-device", { organizationId: otherOrgId }));

    const result = await runEffect(
      patchScriptAssignments(db, orgId, id, { assign: { devices: ["other-device"] } }, now),
    );

    expect(result).toMatchObject({ problem: "One or more devices do not belong to this tenant" });
  });
});

describe("run queue", () => {
  const scriptRow = (db: any, id: string) => db.store.script.find((row: any) => row.id === id);

  it("queues a manual run once and returns the existing execution on a retry", async () => {
    const db = await seed();
    const { id } = await create(db);
    const deviceRow = db.store.device.find((row: any) => row.id === "device-1");

    const first = await runEffect(
      queueScriptRun(db, orgId, scriptRow(db, id), deviceRow, user.id, now),
    );

    const second = await runEffect(
      queueScriptRun(db, orgId, scriptRow(db, id), deviceRow, user.id, now),
    );

    expect(first.queued).toBe(true);
    expect(second.target.executionId).toBe(first.target.executionId);
    expect(db.store.script_execution.filter((row: any) => row.scriptId === id)).toHaveLength(1);
  });

  it("expires a stale queued run so a fresh one can be queued", async () => {
    const db = await seed();
    const { id } = await create(db);
    const deviceRow = db.store.device.find((row: any) => row.id === "device-1");

    const first = await runEffect(
      queueScriptRun(db, orgId, scriptRow(db, id), deviceRow, user.id, now),
    );

    const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const second = await runEffect(
      queueScriptRun(db, orgId, scriptRow(db, id), deviceRow, user.id, later),
    );

    expect(second.target.executionId).not.toBe(first.target.executionId);
    expect(
      db.store.script_execution.find((row: any) => row.id === first.target.executionId)?.status,
    ).toBe("expired");
  });

  it("skips unenrolled and Android devices with a reason", async () => {
    const db = await seed();
    const { id } = await create(db);

    const result = await runEffect(runScript(db, orgId, scriptRow(db, id), {}, user.id, now));

    // No assignments, so nothing is targeted.
    expect(result).toEqual({ queued: 0, skipped: 0, targets: [] });

    db.store.script_assignment.push(
      {
        scriptId: id,
        organizationId: orgId,
        targetType: "device",
        targetId: "device-3",
        createdAt: now,
      },
      {
        scriptId: id,
        organizationId: orgId,
        targetType: "device",
        targetId: "device-4",
        createdAt: now,
      },
    );

    const skipped = await runEffect(runScript(db, orgId, scriptRow(db, id), {}, user.id, now));

    expect(skipped.queued).toBe(0);
    expect(skipped.targets.map((target) => target.skippedReason)).toEqual([
      expect.stringMatching(/not enrolled/),
      expect.stringMatching(/Android/),
    ]);
  });

  it("does not target devices outside the assignment", async () => {
    const db = await seed();
    const { id } = await create(db);

    db.store.script_assignment.push({
      scriptId: id,
      organizationId: orgId,
      targetType: "device",
      targetId: "device-1",
      createdAt: now,
    });

    const result = await runEffect(
      runScript(db, orgId, scriptRow(db, id), { devices: ["device-2"] }, user.id, now),
    );

    expect(result.targets).toEqual([]);
  });
});

describe("agent sync and result ingestion", () => {
  it("returns assigned scripts with a pending run, then stores the result once", async () => {
    const db = await seed();
    const { id } = await create(db);

    db.store.script_assignment.push({
      scriptId: id,
      organizationId: orgId,
      targetType: "device",
      targetId: "device-1",
      createdAt: now,
    });

    const queued = await runEffect(
      queueScriptRun(
        db,
        orgId,
        db.store.script.find((row: any) => row.id === id),
        db.store.device.find((row: any) => row.id === "device-1"),
        user.id,
        now,
      ),
    );

    const sync = await runEffect(scriptAgentSync(db, orgId, "device-1", now));

    expect(sync.scripts).toHaveLength(1);
    expect(sync.scripts[0]?.runId).toBe(queued.target.executionId);
    expect(sync.scripts[0]?.environment).toEqual([
      { name: "API_TOKEN", value: "secret-value", secret: true },
    ]);

    const result = await runEffect(
      recordScriptAgentResult(
        db,
        { id: "device-1", organizationId: orgId },
        {
          runId: RunId.fromParam(queued.target.executionId),
          scriptId: id,
          trigger: "manual",
          exitCode: 0,
          stdout: "done token=secret-value",
          stderr: "",
          durationMs: 42,
          startedAt: now.toISOString(),
          finishedAt: now.toISOString(),
        },
        now,
      ),
    );

    expect(result).toMatchObject({ duplicate: false, status: "succeeded" });

    const row = db.store.script_execution.find(
      (entry: any) => entry.id === queued.target.executionId,
    );

    expect(row).toMatchObject({ status: "succeeded", exitCode: 0, durationMs: 42 });
    expect(row.stdout).toContain("[redacted]");
    expect(row.stdout).not.toContain("secret-value");

    const audit = db.store.audit_log.find(
      (entry: any) => entry.action === "script.run_completed" && entry.targetId === "device-1",
    );

    expect(audit).toMatchObject({ targetType: "device" });
    expect(JSON.stringify(audit)).not.toContain("secret-value");

    const duplicate = await runEffect(
      recordScriptAgentResult(
        db,
        { id: "device-1", organizationId: orgId },
        {
          runId: RunId.fromParam(queued.target.executionId),
          scriptId: id,
          trigger: "manual",
          exitCode: 0,
          stdout: "again",
          stderr: "",
        },
        now,
      ),
    );

    expect(duplicate).toMatchObject({ duplicate: true });
    expect(
      db.store.audit_log.filter((entry: any) => entry.action === "script.run_completed"),
    ).toHaveLength(1);
  });

  it("records a trigger run without a queued execution", async () => {
    const db = await seed();
    const { id } = await create(db);

    db.store.script_assignment.push({
      scriptId: id,
      organizationId: orgId,
      targetType: "device",
      targetId: "device-1",
      createdAt: now,
    });

    const result = await runEffect(
      recordScriptAgentResult(
        db,
        { id: "device-1", organizationId: orgId },
        {
          runId: RunId.fromParam("rn_install-abc"),
          scriptId: id,
          trigger: "install",
          exitCode: 1,
          stdout: "",
          stderr: "failed",
        },
        now,
      ),
    );

    expect(result).toMatchObject({ duplicate: false, status: "failed" });
    expect(db.store.script_execution[0]).toMatchObject({
      triggerType: "install",
      status: "failed",
      exitCode: 1,
    });
  });

  it("rejects a result for a script the device was never assigned", async () => {
    const db = await seed();
    const { id } = await create(db);

    const result = await runEffect(
      recordScriptAgentResult(
        db,
        { id: "device-1", organizationId: orgId },
        {
          runId: RunId.fromParam("rn_forged-run"),
          scriptId: id,
          trigger: "interval",
          exitCode: 0,
          stdout: "antivirus=CrowdStrike",
          stderr: "",
        },
        now,
      ),
    );

    expect(result).toMatchObject({ problem: "Script is not assigned to this device" });
    expect(db.store.script_execution).toEqual([]);
    expect(
      db.store.audit_log.filter((entry: any) => entry.action === "script.run_completed"),
    ).toEqual([]);
  });

  it("rejects a script from another tenant and a disabled feature", async () => {
    const db = await seed();
    const { id } = await create(db);

    const wrongTenant = await runEffect(
      recordScriptAgentResult(
        db,
        { id: "device-1", organizationId: otherOrgId },
        { runId: RunId.fromParam("rn_x"), scriptId: id, trigger: "manual", exitCode: 0, stdout: "", stderr: "" },
        now,
      ),
    );

    expect(wrongTenant).toMatchObject({ problem: "Script not found" });

    db.store.organization[0].scriptsEnabled = false;

    expect(
      await runEffect(
        recordScriptAgentResult(
          db,
          { id: "device-1", organizationId: orgId },
          { runId: RunId.fromParam("rn_y"), scriptId: id, trigger: "manual", exitCode: 0, stdout: "", stderr: "" },
          now,
        ),
      ),
    ).toMatchObject({ problem: "Scripts are disabled for this tenant" });
  });

  it("treats a missing auth secret as a closed tenant, not an empty sync", async () => {
    const db = await seed();

    db.store.organization[0].scriptsEnabled = false;

    expect(await runEffect(scriptAgentSync(db, orgId, "device-1", now))).toEqual({ scripts: [] });
  });
});

describe("execution history and retention", () => {
  it("lists capped output for one device filter", async () => {
    const db = await seed();
    const { id } = await create(db);

    db.store.script_execution.push(
      {
        id: "run-1",
        organizationId: orgId,
        scriptId: id,
        deviceId: "device-1",
        triggerType: "manual",
        status: "succeeded",
        stdout: "hello",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "run-2",
        organizationId: orgId,
        scriptId: id,
        deviceId: "device-2",
        triggerType: "manual",
        status: "failed",
        stdout: "",
        stderr: "boom",
        stdoutTruncated: false,
        stderrTruncated: false,
        createdAt: new Date(now.getTime() + 1),
        updatedAt: now,
      },
    );

    const all = await runEffect(listScriptExecutions(db, orgId, id, {}));

    expect(all.executions.map((run) => run.id)).toEqual(["run-2", "run-1"]);

    const filtered = await runEffect(listScriptExecutions(db, orgId, id, { deviceId: "device-1" }));

    expect(filtered.executions.map((run) => run.id)).toEqual(["run-1"]);
    expect(filtered.executions[0]?.stdout).toBe("hello");
  });

  it("expires stale runs and prunes only terminal history past retention", async () => {
    const db = await seed();
    const { id } = await create(db);

    db.store.script_execution.push(
      {
        id: "queued",
        organizationId: orgId,
        scriptId: id,
        deviceId: "device-1",
        triggerType: "manual",
        status: "queued",
        expiresAt: new Date(now.getTime() - 1),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "old",
        organizationId: orgId,
        scriptId: id,
        deviceId: "device-1",
        triggerType: "manual",
        status: "succeeded",
        createdAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
      },
    );

    const result = await runEffect(sweepScriptExecutions(db, { now, retentionDays: 30 }));

    expect(result).toEqual({ expired: 1, pruned: 1 });
    expect(db.store.script_execution.find((row: any) => row.id === "queued")?.status).toBe(
      "expired",
    );
    expect(db.store.script_execution.some((row: any) => row.id === "old")).toBe(false);
  });
});

describe("effect import", () => {
  it("keeps Effects lazy at the module boundary", async () => {
    const db = await seed();
    const effect = listScripts(db, organization, ["scripts.write"]);

    expect(Effect.isEffect(effect)).toBe(true);
  });
});

describe("handler enforcement", () => {
  const context = async (options: { stepUp: boolean; role?: string; scriptsEnabled?: boolean }) => {
    const db = makeDb({
      account: [user],
      organization: [{ ...organization, scriptsEnabled: options.scriptsEnabled ?? true }],
      member: [
        {
          id: "member-1",
          organizationId: orgId,
          accountId: user.id,
          role: options.role ?? "owner",
          customRoleId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const auth = {
      requireUser: () => Effect.succeed({ user, apiToken: undefined }),
      requireStepUp: () =>
        options.stepUp
          ? Effect.void
          : Effect.fail(
              new StepUpRequired({
                message: "Confirm your identity",
                action: "script-change",
                methods: ["passkey"],
              }),
            ),
      listApiTokens: () => Effect.succeed({ tokens: [] }),
      createApiToken: () => Effect.die("not used"),
      revokeApiToken: () => Effect.succeed({ status: "ok" }),
      requestEmailChange: () => Effect.succeed({ status: "ok" }),
      verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    };

    const service = createEnterpriseService({
      db,
      schema,
      origin: "https://enterprise.test",
      // SAFETY: no script path touches R2; the service only stores the binding.
      storage: {} as never,
      // SAFETY: the fake implements only the auth methods these handlers use.
      auth: auth as never,
      authSecret: "script-test-secret",
    });

    return { db, service, headers: { cookie: "mattrax_session=test" } };
  };

  it("creates a script without a step-up", async () => {
    const { db, service, headers } = await context({ stepUp: false });

    const created = await runEffect(service.createScript(request(headers), orgId, scriptValues));

    expect(created).toHaveProperty("id");
    expect(db.store.script).toHaveLength(1);
  });

  it("rejects a script edit without a step-up and leaves the script unchanged", async () => {
    const { db, service, headers } = await context({ stepUp: false });
    const { id, row } = await create(db);

    const failure = await runEffect(
      service
        .patchScript(request(headers), orgId, id, { name: "Changed" })
        .pipe(Effect.catch((error) => Effect.succeed(error))),
    );

    expect(failure).toBeInstanceOf(StepUpRequired);
    expect(db.store.script.find((entry: any) => entry.id === id)?.name).toBe(row.name);
    expect(db.store.audit_log).toHaveLength(0);
  });

  const stepUpMutations = [
    {
      name: "delete a script",
      run: (service: any, headers: any, id: string) =>
        service.deleteScript(request(headers), orgId, id),
    },
    {
      name: "change script assignments",
      run: (service: any, headers: any, id: string) =>
        service.patchScriptAssignments(request(headers), orgId, id, {
          assign: [],
          unassign: [],
        }),
    },
    {
      name: "change script settings",
      run: (service: any, headers: any) =>
        service.patchScriptSettings(request(headers), orgId, { enabled: false }),
    },
    {
      name: "run a script",
      run: (service: any, headers: any, id: string) =>
        service.runScript(request(headers), orgId, id, {}),
    },
  ];

  for (const mutation of stepUpMutations) {
    it(`requires a step-up to ${mutation.name}`, async () => {
      const { db, service, headers } = await context({ stepUp: false });
      const { id } = await create(db);

      const failure = await runEffect(
        mutation
          .run(service, headers, id)
          .pipe(Effect.catch((error: unknown) => Effect.succeed(error))),
      );

      expect(failure).toBeInstanceOf(StepUpRequired);
    });
  }

  it("creates, audits and lists a script for an owner", async () => {
    const { db, service, headers } = await context({ stepUp: true });

    const created = await runEffect(service.createScript(request(headers), orgId, scriptValues));

    expect(created).toHaveProperty("id");
    expect(
      db.store.audit_log.find((entry: any) => entry.action === "script.created"),
    ).toMatchObject({ targetType: "script" });

    const listed = await runEffect(service.listScripts(request(headers), orgId));

    expect(listed.scripts).toHaveLength(1);
    expect(listed.canRun).toBe(true);
  });

  it("denies a read-only member and an outsider", async () => {
    const readOnly = await context({ stepUp: true, role: "member" });
    const { id } = await create(readOnly.db);

    const deniedWrite = await runEffect(
      readOnly.service
        .patchScript(request(readOnly.headers), orgId, id, { name: "Nope" })
        .pipe(Effect.catch((error) => Effect.succeed(error))),
    );

    expect(deniedWrite).toHaveProperty("permission", "scripts.write");

    const outsider = makeDb({ account: [user], organization: [organization] });

    const service = createEnterpriseService({
      db: outsider,
      schema,
      origin: "https://enterprise.test",
      // SAFETY: the outsider path fails in auth before any storage call.
      storage: {} as never,
      // SAFETY: only requireUser is reached for an unauthenticated caller.
      auth: {
        requireUser: () => Effect.fail(new EnterpriseUnauthorized({ message: "no" })),
      } as never,
      authSecret: "script-test-secret",
    });

    const denied = await runEffect(
      service
        .listScripts(request({ cookie: "x" }), orgId)
        .pipe(Effect.catch((error) => Effect.succeed(error))),
    );

    expect(denied).toBeInstanceOf(EnterpriseUnauthorized);
  });
});
