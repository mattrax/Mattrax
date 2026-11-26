import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { ScriptAgentResultRequest } from "@mattrax/enterprise-domain";
import { StepUpRequired, substitutePolicyVariables } from "@mattrax/enterprise-domain";
import { recordScriptAgentResult } from "@mattrax/enterprise-backend";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const now = new Date("2026-11-20T10:00:00.000Z");

const orgId = "org-1";

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

const script = {
  id: "script-1",
  organizationId: orgId,
  name: "Security inventory",
  description: null,
  language: "bash",
  body: 'echo \'{"antivirus":"CrowdStrike"}\'',
  runAs: "user",
  timeoutSeconds: 300,
  environment: null,
  triggerType: "manual",
  intervalSeconds: null,
  cronExpression: null,
  enabled: true,
  createdByAccountId: null,
  createdAt: now,
  updatedAt: now,
};

type AttributeSeed = {
  id: string;
  organizationId: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  required: boolean;
  visibility: string;
  source: string;
  scriptId: string | null;
  scriptOutputKey: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

const attribute = (
  id: string,
  key: string,
  overrides: Partial<AttributeSeed> = {},
): AttributeSeed => ({
  id,
  organizationId: orgId,
  key,
  label: key,
  type: "text",
  options: null,
  required: false,
  visibility: "visible",
  source: "script",
  scriptId: script.id,
  scriptOutputKey: null,
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const device = {
  id: "device-1",
  organizationId: orgId,
  proto: "apple",
  status: "enrolled",
  name: "MacBook",
  serial: "C02XYZ",
  enrolledAt: now,
  lastSeenAt: now,
};

type ScriptSeed = typeof script;

type DeviceAttributeSeed = {
  deviceId: string;
  attributeId: string;
  organizationId: string;
  value: string;
  updatedByAccountId: string | null;
  updatedAt: Date;
};

type AttributeCollectionSeed = {
  deviceId: string;
  attributeId: string;
  organizationId: string;
  source: string;
  scriptId: string | null;
  lastCollectedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  updatedAt: Date;
};

type EnrollmentQuestionSeed = {
  id: string;
  organizationId: string;
  attributeId: string;
  prompt: string | null;
  required: boolean | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Per-test rows layered on top of the default fixture. */
type SeedExtras = {
  readonly scripts?: ReadonlyArray<ScriptSeed>;
  readonly deviceAttributes?: ReadonlyArray<DeviceAttributeSeed>;
  readonly collections?: ReadonlyArray<AttributeCollectionSeed>;
  readonly questions?: ReadonlyArray<EnrollmentQuestionSeed>;
};

const seed = (extras: SeedExtras = {}) =>
  makeDb({
    account: [user],
    organization: [organization],
    member: [
      {
        id: "member-1",
        organizationId: orgId,
        accountId: user.id,
        role: "owner",
        customRoleId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    script: extras.scripts ? [...extras.scripts] : [script],
    script_assignment: [
      {
        scriptId: script.id,
        organizationId: orgId,
        targetType: "device",
        targetId: device.id,
        createdAt: now,
      },
    ],
    device: [device],
    device_attribute: extras.deviceAttributes ? [...extras.deviceAttributes] : [],
    attribute_collection: extras.collections ? [...extras.collections] : [],
    attribute_definition: [
      attribute("attr-antivirus", "antivirus", { sortOrder: 0 }),
      attribute("attr-version", "agent_version", { type: "number", sortOrder: 1 }),
      attribute("attr-note", "note", { source: "manual", scriptId: null, sortOrder: 2 }),
    ],
    ...(extras.questions ? { enrollment_question: [...extras.questions] } : {}),
  });

const context = async (options: { stepUp?: boolean; extras?: SeedExtras } = {}) => {
  const db = seed(options.extras);

  const auth = {
    requireUser: () => Effect.succeed({ user, apiToken: undefined }),
    requireStepUp: () =>
      options.stepUp === false
        ? Effect.fail(
            new StepUpRequired({
              message: "Confirm your identity",
              action: "script-run",
              methods: ["passkey"],
            }),
          )
        : Effect.void,
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
    // SAFETY: no attribute path touches R2; the service only stores the binding.
    storage: {} as never,
    // SAFETY: the fake implements only the auth methods these handlers use.
    auth: auth as never,
    authSecret: "attribute-test-secret",
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const report = (db: any, stdout: string, overrides: Partial<ScriptAgentResultRequest> = {}) =>
  runEffect(
    recordScriptAgentResult(
      db,
      device,
      {
        runId: "run-1",
        scriptId: script.id,
        trigger: "manual",
        exitCode: 0,
        stdout,
        stderr: "",
        durationMs: 120,
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        ...overrides,
      },
      now,
    ),
  );

describe("attribute permissions", () => {
  it("maps collection reads to devices.read and Collect now to scripts.write", () => {
    expect(permissionForMethod("listDeviceAttributeCollection")).toBe("devices.read");
    // "Collect now" queues a run, exactly like runScript.
    expect(permissionForMethod("collectDeviceAttribute")).toBe("scripts.write");
  });
});

describe("script attribute collection", () => {
  it("writes the declared values from the agent result and audits the run", async () => {
    const { db, service, headers } = await context();

    const result = await report(
      db,
      JSON.stringify({ antivirus: "CrowdStrike", agent_version: 7.12 }),
    );

    expect(result).toMatchObject({ duplicate: false, status: "succeeded" });

    expect(db.store.device_attribute).toEqual([
      expect.objectContaining({
        deviceId: device.id,
        attributeId: "attr-antivirus",
        value: "CrowdStrike",
      }),
      expect.objectContaining({ deviceId: device.id, attributeId: "attr-version", value: "7.12" }),
    ]);

    const audit = db.store.audit_log.find(
      (entry: any) => entry.action === "device.attributes_updated",
    );

    expect(audit.metadata).toMatchObject({
      source: "script",
      scriptId: script.id,
      executionId: result.executionId,
      written: ["agent_version", "antivirus"],
    });

    // The value is visible to the same reads search, CSV export and policy
    // variables use.
    const detail = await runEffect(service.getDevice(request(headers), orgId, device.id));

    expect(detail.attributes).toMatchObject({ antivirus: "CrowdStrike", agent_version: "7.12" });

    const search = await runEffect(
      service.searchDevices(request(headers), orgId, {
        attributes: JSON.stringify({ antivirus: "CrowdStrike" }),
      }),
    );

    expect(search.devices.map((row: any) => row.id)).toEqual([device.id]);

    const exported = await runEffect(service.exportDevices(request(headers), orgId, {}));

    expect(exported.csv).toContain("attribute:antivirus");
    expect(exported.csv).toContain("CrowdStrike");

    const collection = await runEffect(
      service.listDeviceAttributeCollection(request(headers), orgId, device.id),
    );

    expect(collection.collection.antivirus).toMatchObject({
      source: "script",
      lastCollectedAt: now.toISOString(),
      lastError: null,
    });

    // A policy variable reads the same keyed map the resolver builds.
    expect(
      substitutePolicyVariables(
        { Label: "Antivirus: ${attribute.antivirus}" },
        {
          attributes: Object.fromEntries(
            db.store.device_attribute.map((row: any) => [
              row.attributeId === "attr-antivirus" ? "antivirus" : "agent_version",
              row.value,
            ]),
          ),
        },
      ),
    ).toEqual({ Label: "Antivirus: CrowdStrike" });
  });

  it("records a type error per attribute and leaves the value out", async () => {
    const { db, service, headers } = await context();

    await report(db, JSON.stringify({ antivirus: "CrowdStrike", agent_version: "seven" }));

    expect(db.store.device_attribute.map((row: any) => row.attributeId)).toEqual([
      "attr-antivirus",
    ]);

    const collection = await runEffect(
      service.listDeviceAttributeCollection(request(headers), orgId, device.id),
    );

    expect(collection.collection.agent_version).toMatchObject({ lastCollectedAt: null });
    expect(collection.collection.agent_version.lastError).toMatch(/must be a number/);
  });

  it("does not collect from a failed run", async () => {
    const { db, service, headers } = await context();

    await report(db, "", { exitCode: 2 });

    expect(db.store.device_attribute).toEqual([]);

    const collection = await runEffect(
      service.listDeviceAttributeCollection(request(headers), orgId, device.id),
    );

    expect(collection.collection.antivirus.lastError).toMatch(/exited with code 2/);
  });

  it("keeps script-sourced attributes read-only in the API", async () => {
    const { service, headers } = await context();

    const failure = await runEffect(
      service
        .setDeviceAttributes(request(headers), orgId, device.id, {
          values: { antivirus: "Manual" },
        })
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(failure).toHaveProperty("message", expect.stringContaining("cannot be edited manually"));
  });

  it("saves a binding on create and unlinks it when the script is deleted", async () => {
    const { service, headers } = await context();

    const created = await runEffect(
      service.createAttribute(request(headers), orgId, {
        key: "disk_encryption",
        label: "Disk encryption",
        type: "boolean",
        options: null,
        source: "script",
        scriptId: script.id,
        scriptOutputKey: "filevault",
      }),
    );

    expect(created).toMatchObject({
      source: "script",
      scriptId: script.id,
      scriptOutputKey: "filevault",
      scriptName: "Security inventory",
    });

    await runEffect(service.deleteScript(request(headers), orgId, script.id));

    const listed = await runEffect(service.listAttributes(request(headers), orgId));

    expect(listed.rows.find((row: any) => row.key === "disk_encryption")).toMatchObject({
      source: "manual",
      scriptId: null,
      scriptOutputKey: null,
    });
  });

  it("lists the source and binding for the settings page", async () => {
    const { service, headers } = await context();

    const listed = await runEffect(service.listAttributes(request(headers), orgId));
    const antivirus = listed.rows.find((row: any) => row.key === "antivirus");
    const note = listed.rows.find((row: any) => row.key === "note");

    expect(antivirus).toMatchObject({
      source: "script",
      scriptId: script.id,
      scriptName: "Security inventory",
    });
    expect(note).toMatchObject({ source: "manual", scriptId: null });
  });
});

describe("collect now", () => {
  it("queues the bound script through the manual-run path", async () => {
    const { db, service, headers } = await context();

    const result = await runEffect(
      service.collectDeviceAttribute(request(headers), orgId, device.id, "attr-antivirus"),
    );

    expect(result.status).toBe("ok");
    expect(result.executionId).toBeTruthy();
    expect(db.store.script_execution).toHaveLength(1);
    expect(db.store.script_execution[0]).toMatchObject({
      scriptId: script.id,
      deviceId: device.id,
      triggerType: "manual",
      status: "queued",
      requestedByAccountId: user.id,
    });
  });

  it("is gated by a script.run approval policy", async () => {
    const { db, service, headers } = await context();

    db.store.approval_policy.push({
      id: "policy-script-run",
      organizationId: orgId,
      action: "script.run",
      scopeType: "tenant",
      scopeId: null,
      approverPermission: null,
      approverRole: "admin",
      approvalsRequired: 1,
      createdByAccountId: user.id,
      createdAt: now,
      updatedAt: now,
    });

    const blocked = await runEffect(
      service
        .collectDeviceAttribute(request(headers), orgId, device.id, "attr-antivirus")
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(blocked).toMatchObject({
      code: "approval_required",
      requestId: expect.stringMatching(/^[0-9a-f]{24}$/),
    });
    expect(db.store.script_execution).toHaveLength(0);
    expect(db.store.approval_request).toHaveLength(1);
  });

  it("rejects a manual attribute, a step-up-less caller and unsupported platforms", async () => {
    const { service, headers } = await context();

    const notScripted = await runEffect(
      service
        .collectDeviceAttribute(request(headers), orgId, device.id, "attr-note")
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(notScripted).toHaveProperty(
      "message",
      expect.stringContaining("not collected by a script"),
    );

    const noStepUp = await context({ stepUp: false });
    const stepUpError = await runEffect(
      noStepUp.service
        .collectDeviceAttribute(request(headers), orgId, device.id, "attr-antivirus")
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(stepUpError).toBeInstanceOf(StepUpRequired);

    const windows = await context();
    windows.db.store.device[0] = { ...windows.db.store.device[0], proto: "win" };

    const unsupported = await runEffect(
      windows.service
        .collectDeviceAttribute(request(headers), orgId, device.id, "attr-antivirus")
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(unsupported).toHaveProperty(
      "message",
      expect.stringContaining("not supported on Windows"),
    );
    expect(windows.db.store.script_execution).toEqual([]);

    const unassigned = await context();
    unassigned.db.store.script_assignment = [];

    const notAssigned = await runEffect(
      unassigned.service
        .collectDeviceAttribute(request(headers), orgId, device.id, "attr-antivirus")
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(notAssigned).toHaveProperty("message", expect.stringContaining("not assigned"));
    expect(unassigned.db.store.script_execution).toEqual([]);
  });
});

describe("attribute binding edits", () => {
  const scriptRow = (overrides: Partial<typeof script> = {}) => ({ ...script, ...overrides });

  it("does not rewrite or claim ownership of a script value on a manual save", async () => {
    const old = new Date("2026-11-01T00:00:00.000Z");

    const { db, service, headers } = await context({
      extras: {
        deviceAttributes: [
          {
            deviceId: device.id,
            attributeId: "attr-antivirus",
            organizationId: orgId,
            value: "CrowdStrike",
            updatedByAccountId: null,
            updatedAt: old,
          },
        ],
      },
    });

    await runEffect(
      service.setDeviceAttributes(request(headers), orgId, device.id, {
        values: { note: "hello" },
      }),
    );

    // Only the manual key is written; the script-owned row keeps its value and
    // its (absent) author, and the audit says so.
    expect(
      db.store.device_attribute.find((row: any) => row.attributeId === "attr-antivirus"),
    ).toMatchObject({ value: "CrowdStrike", updatedByAccountId: null, updatedAt: old });

    const audit = db.store.audit_log.find(
      (entry: any) => entry.action === "device.attributes_updated",
    );

    expect(audit.metadata).toMatchObject({ written: ["note"], cleared: [] });
  });

  it("unbinds a script attribute when the source is changed to manual", async () => {
    const { db, service, headers } = await context({
      extras: {
        collections: [
          {
            deviceId: device.id,
            attributeId: "attr-antivirus",
            organizationId: orgId,
            source: "script",
            scriptId: script.id,
            lastCollectedAt: now,
            lastError: null,
            lastErrorAt: null,
            updatedAt: now,
          },
        ],
      },
    });

    const patched = await runEffect(
      service.patchAttribute(request(headers), orgId, "attr-antivirus", { source: "manual" }),
    );

    expect(patched).toMatchObject({
      source: "manual",
      scriptId: null,
      scriptOutputKey: null,
      scriptName: null,
    });
    expect(db.store.attribute_collection).toEqual([]);
  });

  it("refuses to convert an attribute that is an enrollment question", async () => {
    const { service, headers } = await context({
      extras: {
        questions: [
          {
            id: "question-1",
            organizationId: orgId,
            attributeId: "attr-note",
            prompt: null,
            required: null,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });

    const failure = await runEffect(
      service
        .patchAttribute(request(headers), orgId, "attr-note", {
          source: "script",
          scriptId: script.id,
        })
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(failure).toHaveProperty("message", expect.stringContaining("enrollment question"));
  });

  it("refuses a new binding to a disabled script but keeps an existing one editable", async () => {
    const { service, headers } = await context({
      extras: { scripts: [scriptRow({ enabled: false })] },
    });

    const rejected = await runEffect(
      service
        .createAttribute(request(headers), orgId, {
          key: "disk_encryption",
          label: "Disk encryption",
          type: "boolean",
          options: null,
          source: "script",
          scriptId: script.id,
        })
        .pipe(Effect.catch((error: any) => Effect.succeed(error))),
    );

    expect(rejected).toHaveProperty("message", expect.stringContaining("disabled"));

    // Editing an attribute that is already bound stays possible: the binding is
    // not new, so a paused script does not lock the whole definition.
    const patched = await runEffect(
      service.patchAttribute(request(headers), orgId, "attr-antivirus", {
        label: "Endpoint protection",
      }),
    );

    expect(patched).toMatchObject({ label: "Endpoint protection", source: "script" });
  });
});
