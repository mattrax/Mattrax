import { describe, expect, it } from "vitest";
import { sealSecret } from "@mattrax/crypto";
import { makeEmailTransport } from "@mattrax/email";
import {
  markAndroidRestrictedSoftwarePolicyDelivered,
  reconcileRestrictedSoftwareForDevice,
  reconcileRestrictedSoftwareForOrganization,
  recordRestrictedSoftwareEnforcement,
  replaceDeviceApplications,
} from "@mattrax/enterprise-core";
import {
  createRestrictedSoftware,
  listRestrictedSoftware,
  listRestrictedSoftwareViolations,
} from "../src/Policy/restrictedSoftware.ts";
import { notifyRestrictedSoftwareViolations } from "../src/Mail/restrictedSoftwareNotifications.ts";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { makeDb, runEffect, schema } from "./helpers.js";

const now = new Date("2026-11-24T10:00:00.000Z");

const organization = (id: string, name: string) => ({
  id,
  name,
  displayName: name,
  supportEmail: null,
});

const device = (id: string, organizationId: string) => ({
  id,
  organizationId,
  proto: "apple" as const,
  status: "enrolled" as const,
  name: "MacBook",
  osEdition: "macOS",
});

const ruleBase = {
  id: "rule-1",
  organizationId: "org-1",
  name: "Block example",
  platform: "apple",
  matchType: "bundle-id",
  matchValue: "com.example.Banned",
  matchKey: "com.example.banned",
  action: "kill-process",
  message: "Not allowed",
  notificationEmails: ["security@example.com"],
  enabled: true,
  createdByAccountId: null,
  createdAt: now,
  updatedAt: now,
};

const rule = (overrides: Partial<typeof ruleBase> = {}) => ({ ...ruleBase, ...overrides });

const assignmentBase = {
  restrictedSoftwareId: "rule-1",
  organizationId: "org-1",
  targetType: "device",
  targetId: "device-1",
  mode: "include",
  createdAt: now,
};

const assignment = (overrides: Partial<typeof assignmentBase> = {}) => ({
  ...assignmentBase,
  ...overrides,
});

const applicationBase = {
  deviceId: "device-1",
  organizationId: "org-1",
  bundleId: "com.example.Banned",
  name: "Banned App",
  version: "1.0",
  shortVersion: null,
  publisher: null,
  bundleSize: null,
  dynamicSize: null,
  hasUpdateAvailable: false,
  isManaged: false,
  lastReportedAt: now,
};

const application = (overrides: Partial<typeof applicationBase> = {}) => ({
  ...applicationBase,
  ...overrides,
});

const violationBase = {
  id: "violation-1",
  organizationId: "org-1",
  restrictedSoftwareId: "rule-1",
  deviceId: "device-1",
  platform: "apple",
  action: "kill-process",
  matchType: "bundle-id",
  matchKey: "com.example.banned",
  matchedBundleId: "com.example.Banned",
  applicationName: "Banned App",
  applicationVersion: "1.0",
  status: "open",
  enforcementState: "pending",
  enforcementDetail: null,
  occurrenceCount: 1,
  firstDetectedAt: now,
  lastDetectedAt: now,
  lastEnforcedAt: null as Date | null,
  resolvedAt: null,
  notifiedAt: null,
  createdAt: now,
  updatedAt: now,
};

const violation = (overrides: Partial<typeof violationBase> = {}) => ({
  ...violationBase,
  ...overrides,
});

const trackSelectedTables = (db: ReturnType<typeof makeDb>) => {
  const tables: unknown[] = [];
  const select = db.select.bind(db);

  db.select = ((...args: Parameters<typeof db.select>) => {
    // The fake's select builder is untyped; only its table name is observed.
    const query: any = select(...args);
    const from = query.from.bind(query);

    query.from = (table: unknown) => {
      tables.push(table);

      return from(table);
    };

    return query;
  }) as typeof db.select;

  return tables;
};

describe("restricted software detection", () => {
  it.each([
    { scope: "no rules", rules: [], assignments: [] },
    {
      scope: "no applicable rules",
      rules: [rule()],
      assignments: [assignment({ mode: "exclude" })],
    },
  ])(
    "does not reread applications or violations for a report with $scope",
    async ({ rules, assignments }) => {
      const db = makeDb({
        organization: [organization("org-1", "Acme")],
        device: [device("device-1", "org-1")],
        restricted_software: rules,
        restricted_software_assignment: assignments,
        device_application: [application({ bundleId: "com.example.Stale" })],
      });
      const tables = trackSelectedTables(db);

      const count = await runEffect(
        replaceDeviceApplications(db, {
          deviceId: "device-1",
          organizationId: "org-1",
          applications: [{ bundleId: "com.example.Banned", name: "Banned App" }],
          reportedAt: now,
        }),
      );

      expect(count).toBe(1);
      // Replacement reads the previous rows once to diff them; reconciliation
      // must not read applications or violations back.
      expect(tables.filter((table) => table === schema.deviceApplication)).toHaveLength(1);
      expect(tables.filter((table) => table === schema.restrictedSoftwareViolation)).toHaveLength(
        0,
      );
      expect(db.store.restricted_software_violation).toHaveLength(0);
    },
  );

  it("resolves excluded violations during an organization rescan without reading applications", async () => {
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [device("device-1", "org-1")],
      restricted_software: [rule()],
      restricted_software_assignment: [assignment({ mode: "exclude" })],
      device_application: [application()],
      restricted_software_violation: [violation()],
    });
    const tables = trackSelectedTables(db);

    const result = await runEffect(
      reconcileRestrictedSoftwareForOrganization(db, {
        organizationId: "org-1",
        at: now,
      }),
    );

    expect(result).toEqual({ devices: 1 });
    expect(tables).not.toContain(schema.deviceApplication);
    expect(tables.filter((table) => table === schema.restrictedSoftwareViolation)).toHaveLength(1);
    expect(db.store.restricted_software_violation![0]).toMatchObject({
      status: "resolved",
      resolvedAt: now,
      enforcementDetail: "No restricted-software rules currently apply to this device.",
    });
    expect(
      db.store.audit_log!.filter((row) => row.action === "restricted_software.violation_resolved"),
    ).toHaveLength(1);
  });

  it.each([
    { change: "disabled", rules: [rule({ enabled: false })], assignments: [assignment()] },
    { change: "unassigned", rules: [rule()], assignments: [] },
  ])("resolves an open violation when the last rule is $change", async ({ rules, assignments }) => {
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [device("device-1", "org-1")],
      restricted_software: rules,
      restricted_software_assignment: assignments,
      device_application: [application()],
      restricted_software_violation: [violation()],
    });
    const tables = trackSelectedTables(db);

    const result = await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: now,
        rescan: true,
      }),
    );

    expect(result).toEqual({ detected: 0, reopened: 0, refreshed: 0, resolved: 1 });
    expect(tables).not.toContain(schema.deviceApplication);
    expect(tables.filter((table) => table === schema.restrictedSoftwareViolation)).toHaveLength(1);
    expect(db.store.restricted_software_violation![0]).toMatchObject({
      status: "resolved",
      resolvedAt: now,
      enforcementDetail: "No restricted-software rules currently apply to this device.",
    });
    expect(
      db.store.audit_log!.filter((row) => row.action === "restricted_software.violation_resolved"),
    ).toHaveLength(1);
  });

  it("resolves an open violation from fresh empty inventory without rereading applications", async () => {
    const later = new Date(now.getTime() + 60_000);
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [device("device-1", "org-1")],
      restricted_software: [rule()],
      restricted_software_assignment: [assignment()],
      device_application: [application()],
      restricted_software_violation: [violation()],
    });
    const tables = trackSelectedTables(db);

    const count = await runEffect(
      replaceDeviceApplications(db, {
        deviceId: "device-1",
        organizationId: "org-1",
        applications: [],
        reportedAt: later,
      }),
    );

    expect(count).toBe(0);
    expect(tables.filter((table) => table === schema.deviceApplication)).toHaveLength(1);
    expect(tables.filter((table) => table === schema.restrictedSoftwareViolation)).toHaveLength(1);
    expect(db.store.restricted_software_violation![0]).toMatchObject({
      status: "resolved",
      resolvedAt: later,
      enforcementDetail: "The application is no longer present in the device inventory.",
    });
    expect(
      db.store.audit_log!.filter((row) => row.action === "restricted_software.violation_resolved"),
    ).toHaveLength(1);
  });

  it.each([
    {
      platform: "apple",
      proto: "apple",
      matchType: "bundle-id",
      matchValue: "com.example.Banned",
      matchKey: "com.example.banned",
      action: "kill-process",
      bundleId: "com.example.Banned",
    },
    {
      platform: "android",
      proto: "android",
      matchType: "android-package",
      matchValue: "com.example.banned",
      matchKey: "com.example.banned",
      action: "block-install",
      bundleId: "com.example.banned",
    },
    {
      platform: "win",
      proto: "win",
      matchType: "msi-product-code",
      matchValue: "{12345678-1234-1234-1234-123456789ABC}",
      matchKey: "12345678-1234-1234-1234-123456789abc",
      action: "delete-app",
      bundleId: "{12345678-1234-1234-1234-123456789ABC}",
    },
  ])(
    "reconciles fresh $platform inventory without rereading stored applications",
    async ({ platform, proto, matchType, matchValue, matchKey, action, bundleId }) => {
      const db = makeDb({
        organization: [organization("org-1", "Acme")],
        device: [
          {
            ...device("device-1", "org-1"),
            proto,
            osEdition: platform === "apple" ? "macOS" : null,
          },
        ],
        restricted_software: [rule({ platform, matchType, matchValue, matchKey, action })],
        restricted_software_assignment: [assignment()],
      });
      const tables = trackSelectedTables(db);

      const count = await runEffect(
        replaceDeviceApplications(db, {
          deviceId: "device-1",
          organizationId: "org-1",
          applications: [{ bundleId, name: "  Banned App  ", version: "  1.0  " }],
          reportedAt: now,
        }),
      );

      expect(count).toBe(1);
      expect(tables.filter((table) => table === schema.deviceApplication)).toHaveLength(1);
      expect(tables.filter((table) => table === schema.restrictedSoftwareViolation)).toHaveLength(
        1,
      );
      expect(db.store.restricted_software_violation).toHaveLength(1);
      expect(db.store.restricted_software_violation![0]).toMatchObject({
        platform,
        status: "open",
        matchedBundleId: bundleId,
        applicationName: "Banned App",
        applicationVersion: "1.0",
      });
      expect(
        db.store.audit_log!.filter(
          (row) => row.action === "restricted_software.violation_detected",
        ),
      ).toHaveLength(1);
    },
  );

  it("records one violation, deduplicates repeated reports and resolves removal", async () => {
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [device("device-1", "org-1")],
      restricted_software: [rule()],
      restricted_software_assignment: [assignment()],
      device_application: [application()],
    });

    const first = await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: now,
      }),
    );

    expect(first).toMatchObject({ detected: 1, reopened: 0, refreshed: 0, resolved: 0 });

    const afterFirst = db.store.restricted_software_violation!;
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      status: "open",
      matchedBundleId: "com.example.Banned",
      enforcementState: "pending",
    });
    expect(
      db.store.audit_log!.filter((row) => row.action === "restricted_software.violation_detected"),
    ).toHaveLength(1);

    const later = new Date(now.getTime() + 60 * 60 * 1000);

    const second = await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: later,
      }),
    );

    expect(second).toMatchObject({ detected: 0, reopened: 0, refreshed: 1, resolved: 0 });
    expect(db.store.restricted_software_violation).toHaveLength(1);
    expect(db.store.restricted_software_violation![0]).toMatchObject({ occurrenceCount: 2 });
    expect(
      db.store.audit_log!.filter((row) => row.action === "restricted_software.violation_detected"),
    ).toHaveLength(1);

    db.store.device_application = [];

    const third = await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: new Date(later.getTime() + 60 * 60 * 1000),
      }),
    );

    expect(third).toMatchObject({ detected: 0, resolved: 1 });
    expect(db.store.restricted_software_violation![0]).toMatchObject({
      status: "resolved",
    });
    expect(
      db.store.audit_log!.filter((row) => row.action === "restricted_software.violation_resolved"),
    ).toHaveLength(1);
  });

  it("does not match a rule from another tenant", async () => {
    const db = makeDb({
      organization: [organization("org-1", "Acme"), organization("org-2", "Other")],
      device: [device("device-1", "org-1")],
      restricted_software: [rule({ organizationId: "org-2" })],
      restricted_software_assignment: [assignment({ organizationId: "org-2" })],
      device_application: [application()],
    });

    const result = await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: now,
      }),
    );

    expect(result.detected).toBe(0);
    expect(db.store.restricted_software_violation ?? []).toHaveLength(0);
  });

  it("marks an Android block rule as enforced rather than detection-only", async () => {
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [{ ...device("device-1", "org-1"), proto: "android" }],
      restricted_software: [
        rule({
          platform: "android",
          matchType: "android-package",
          matchValue: "com.example.banned",
          matchKey: "com.example.banned",
          action: "block-install",
        }),
      ],
      restricted_software_assignment: [assignment()],
      device_application: [application({ bundleId: "com.example.banned" })],
    });

    await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: now,
      }),
    );

    // Detection cannot know whether Google accepted the policy, so it starts
    // pending rather than claiming enforcement.
    expect(db.store.restricted_software_violation![0]).toMatchObject({
      enforcementState: "pending",
    });
    expect(db.store.audit_log!.some((row) => row.action === "restricted_software.enforced")).toBe(
      false,
    );

    const marked = await runEffect(
      markAndroidRestrictedSoftwarePolicyDelivered(db, {
        organizationId: "org-1",
        deviceIds: ["device-1"],
        at: now,
      }),
    );

    expect(marked).toBe(1);
    expect(db.store.restricted_software_violation![0]).toMatchObject({
      enforcementState: "enforced",
      enforcementDetail: expect.stringContaining("BLOCKED"),
    });
    expect(db.store.audit_log!.some((row) => row.action === "restricted_software.enforced")).toBe(
      true,
    );
  });

  it("recomputes enforcement and clears lastEnforcedAt when the action changes", async () => {
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [device("device-1", "org-1")],
      restricted_software: [rule({ action: "delete-app" })],
      restricted_software_assignment: [assignment()],
      device_application: [application()],
      restricted_software_violation: [
        violation({ action: "kill-process", enforcementState: "enforced", lastEnforcedAt: now }),
      ],
    });

    await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: new Date(now.getTime() + 60_000),
      }),
    );

    expect(db.store.restricted_software_violation![0]).toMatchObject({
      action: "delete-app",
      enforcementState: "pending",
      lastEnforcedAt: null,
    });
  });

  it("does not claim agent enforcement on iOS", async () => {
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [{ ...device("device-1", "org-1"), osEdition: "iOS" }],
      restricted_software: [rule()],
      restricted_software_assignment: [assignment()],
      device_application: [application()],
    });

    await runEffect(
      reconcileRestrictedSoftwareForDevice(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        at: now,
      }),
    );

    expect(db.store.restricted_software_violation![0]).toMatchObject({
      enforcementState: "detection-only",
    });
    expect(db.store.audit_log!.some((row) => row.action === "restricted_software.enforced")).toBe(
      false,
    );
  });

  it("records an agent enforcement result and audits it", async () => {
    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [device("device-1", "org-1")],
      restricted_software: [rule()],
      restricted_software_violation: [violation()],
    });

    await runEffect(
      recordRestrictedSoftwareEnforcement(db, {
        organizationId: "org-1",
        deviceId: "device-1",
        platform: "apple",
        ruleId: "rule-1",
        action: "kill-process",
        status: "succeeded",
        detail: "Terminated 1 matching process.",
        at: now,
      }),
    );

    expect(db.store.restricted_software_violation![0]).toMatchObject({
      enforcementState: "enforced",
      enforcementDetail: "Terminated 1 matching process.",
      lastEnforcedAt: now,
    });
    expect(
      db.store.audit_log!.some(
        (row) => row.action === "restricted_software.enforced" && row.protocol === "apple",
      ),
    ).toBe(true);
  });
});

describe("restricted software configuration", () => {
  it("lists only the caller's tenant", async () => {
    const db = makeDb({
      restricted_software: [
        rule(),
        rule({ id: "rule-2", organizationId: "org-2", name: "Other tenant" }),
      ],
    });

    const result = await runEffect(listRestrictedSoftware(db, "org-1"));

    expect(result.rules.map((row) => row.id)).toEqual(["rule-1"]);
  });

  it("rejects a duplicate identifier on the same platform", async () => {
    const db = makeDb({ restricted_software: [rule()] });

    const result = await runEffect(
      createRestrictedSoftware(
        db,
        "org-1",
        "account-1",
        {
          name: "Duplicate",
          platform: "apple",
          matchType: "bundle-id",
          matchValue: "COM.EXAMPLE.BANNED",
          action: "delete-app",
          enabled: true,
        },
        now,
      ),
    );

    expect(result).toMatchObject({ problem: expect.stringContaining("already exists") });
  });

  it("treats MSI GUID brace variants as the same identifier", async () => {
    const db = makeDb({
      restricted_software: [
        rule({
          id: "rule-msi",
          platform: "win",
          matchType: "msi-product-code",
          matchValue: "{12345678-1234-1234-1234-123456789ABC}",
          matchKey: "12345678-1234-1234-1234-123456789abc",
          action: "delete-app",
        }),
      ],
    });

    const result = await runEffect(
      createRestrictedSoftware(
        db,
        "org-1",
        "account-1",
        {
          name: "Duplicate GUID",
          platform: "win",
          matchType: "msi-product-code",
          matchValue: "12345678-1234-1234-1234-123456789abc",
          action: "kill-process",
          enabled: true,
        },
        now,
      ),
    );

    expect(result).toMatchObject({ problem: expect.stringContaining("already exists") });
  });

  it("counts only devices that survive include/exclude scope", async () => {
    const db = makeDb({
      restricted_software: [rule(), rule({ id: "rule-2", name: "Group rule" })],
      device: [device("device-1", "org-1"), device("device-2", "org-1")],
      enterprise_group: [{ id: "group-1", organizationId: "org-1", name: "Group" }],
      restricted_software_assignment: [
        assignment({ mode: "exclude" }),
        assignment({ restrictedSoftwareId: "rule-2", targetType: "group", targetId: "group-1" }),
        assignment({
          restrictedSoftwareId: "rule-2",
          targetType: "device",
          targetId: "device-1",
          mode: "exclude",
        }),
      ],
      group_device: [
        { groupId: "group-1", deviceId: "device-1", source: "manual" },
        { groupId: "group-1", deviceId: "device-2", source: "manual" },
      ],
    });

    const result = await runEffect(listRestrictedSoftware(db, "org-1"));
    const byId = new Map(result.rules.map((row) => [row.id, row]));

    expect(byId.get("rule-1")?.assignedDeviceCount).toBe(0);
    expect(byId.get("rule-2")?.assignedDeviceCount).toBe(1);
  });

  it("computes the violation summary from the whole set, not the capped page", async () => {
    const db = makeDb({
      restricted_software: [rule()],
      device: [device("device-1", "org-1"), device("device-2", "org-1")],
      restricted_software_violation: [
        violation(),
        violation({ id: "violation-2", deviceId: "device-2" }),
      ],
    });

    const result = await runEffect(listRestrictedSoftwareViolations(db, "org-1", { limit: 1 }));

    expect(result.violations).toHaveLength(1);
    expect(result.summary.open).toBe(2);
  });

  it("returns violations scoped to the tenant", async () => {
    const db = makeDb({
      restricted_software: [rule(), rule({ id: "rule-2", organizationId: "org-2" })],
      device: [device("device-1", "org-1"), device("device-2", "org-2")],
      restricted_software_violation: [
        violation(),
        violation({
          id: "violation-2",
          organizationId: "org-2",
          deviceId: "device-2",
          restrictedSoftwareId: "rule-2",
        }),
      ],
    });

    const result = await runEffect(
      listRestrictedSoftwareViolations(db, "org-1", { status: "open" }),
    );

    expect(result.violations.map((row) => row.id)).toEqual(["violation-1"]);
  });
});

describe("restricted software permissions", () => {
  it("maps every restricted software method to a permission", () => {
    expect(permissionForMethod("listRestrictedSoftware")).toBe("restricted_software.read");
    expect(permissionForMethod("getDeviceRestrictedSoftware")).toBe("restricted_software.read");
    expect(permissionForMethod("createRestrictedSoftware")).toBe("restricted_software.write");
    expect(permissionForMethod("patchRestrictedSoftwareAssignments")).toBe(
      "restricted_software.write",
    );
  });
});

describe("restricted software notifications", () => {
  it("sends the webhook and queues optional email, then marks the violation notified", async () => {
    const authSecret = "restricted-software-test-secret";
    const deliveries: Array<{ url: string; body: string }> = [];
    const emails: Array<{ to: unknown; subject: string }> = [];

    const db = makeDb({
      organization: [organization("org-1", "Acme")],
      device: [device("device-1", "org-1")],
      restricted_software: [rule()],
      restricted_software_violation: [violation()],
      webhook_endpoint: [
        {
          id: "wh-1",
          organizationId: "org-1",
          url: "https://hooks.example.com/mattrax",
          secret: await sealSecret(authSecret, "whsec_test"),
          secretPrefix: "test",
          description: null,
          eventFilters: ["restricted_software.violation"],
          enabled: true,
          lastDeliveryAt: null,
          lastDeliveryStatus: null,
          consecutiveFailures: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      deliveries.push({
        url: String(input),
        body: String(init?.body ?? ""),
      });

      return new Response("ok", { status: 200 });
    }) as typeof globalThis.fetch;

    const result = await runEffect(
      notifyRestrictedSoftwareViolations({
        db,
        authSecret,
        fetch: fakeFetch,
        email: makeEmailTransport(async (message) => {
          emails.push({ to: message.to, subject: message.subject });
        }),
        now,
      }),
    );

    expect(result).toEqual({ due: 1, notified: 1 });
    expect(deliveries).toHaveLength(1);
    expect(JSON.parse(deliveries[0]!.body).type).toBe("restricted_software.violation");
    expect(db.store.restricted_software_violation![0]).toMatchObject({ notifiedAt: now });
    expect(db.store.email_outbox).toHaveLength(1);
    expect(db.store.email_outbox![0]).toMatchObject({
      recipient: "security@example.com",
      template: "restricted_software_violation",
    });
    // The outbox delivers asynchronously; the test transport is not called by
    // the sweep itself.
    expect(emails).toHaveLength(0);

    // A second sweep sees nothing pending, so a retried cron cannot duplicate.
    const second = await runEffect(
      notifyRestrictedSoftwareViolations({
        db,
        authSecret,
        fetch: fakeFetch,
        email: makeEmailTransport(async () => {}),
        now,
      }),
    );

    expect(second).toEqual({ due: 0, notified: 0 });
    expect(deliveries).toHaveLength(1);
  });
});
