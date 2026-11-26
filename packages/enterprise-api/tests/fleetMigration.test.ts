import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterprisePermissionDenied,
  hasPermission,
  BUILT_IN_ROLE_PERMISSIONS,
} from "@mattrax/enterprise-domain";
import {
  confirmFleetMigrationEntry,
  createFleetMigration,
  deleteFleetMigration,
  exportFleetMigration,
  getFleetMigration,
  issueFleetMigrationUnenrol,
  listFleetMigrations,
  markFleetMigrationUnenrolled,
  sweepFleetMigrations,
} from "@mattrax/enterprise-backend";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const orgId = "org-1";

const otherOrgId = "org-2";

const origin = "https://mattrax.test";

const now = new Date("2026-11-20T12:00:00.000Z");

const day = 24 * 60 * 60 * 1000;

const organization = {
  id: orgId,
  name: "Acme",
  slug: "acme",
  scriptsEnabled: true,
  requireMfa: false,
  createdAt: now,
  updatedAt: now,
};

const device = (
  id: string,
  overrides: {
    serial?: string;
    status?: string;
    proto?: string;
    organizationId?: string;
  } = {},
) => ({
  id,
  organizationId: overrides.organizationId ?? orgId,
  proto: overrides.proto ?? "apple",
  status: overrides.status ?? "unenrolled",
  name: "Device " + id,
  serial: overrides.serial ?? null,
  enrolledAt: now,
  lastSeenAt: now,
});

const cohort = (
  db: ReturnType<typeof makeDb>,
  input: {
    name?: string;
    serials?: ReadonlyArray<string>;
    platforms?: ReadonlyArray<"apple" | "win" | "android">;
    groupId?: string | null;
    stuckAfterDays?: number;
    organizationId?: string;
  } = {},
) =>
  runEffect(
    createFleetMigration(
      db,
      input.organizationId ?? orgId,
      "user-1",
      {
        name: input.name ?? "Leave Jamf",
        sourceMdm: "jamf",
        platforms: [...(input.platforms ?? ["apple"])],
        groupId: input.groupId ?? null,
        serials: [...(input.serials ?? ["C02NEW"])],
        stuckAfterDays: input.stuckAfterDays,
      },
      now,
    ),
  );

const entryFor = (db: ReturnType<typeof makeDb>, migrationId: string, serial: string) =>
  db.store.fleet_migration_device.find(
    (row: any) => row.migrationId === migrationId && row.serial === serial,
  );

const seed = () =>
  makeDb({
    organization: [organization],
    enterprise_group: [{ id: "group-1", organizationId: orgId, name: "Macs" }],
    group_device: [{ groupId: "group-1", deviceId: "device-2", source: "manual" }],
    device: [
      device("device-1", { serial: "C02ENROLLED", status: "enrolled" }),
      device("device-2", { serial: "C02GROUP" }),
    ],
  });

describe("creating a cohort", () => {
  it("seeds serials, drops duplicates and skips devices Mattrax already manages", async () => {
    const db = seed();

    const result = await cohort(db, {
      serials: ["C02NEW", "c02new", "C02ENROLLED"],
      groupId: "group-1",
    });

    if ("problem" in result) throw new Error(result.problem ?? "cohort failed");

    expect(result.added).toBe(2);
    expect(result.duplicates).toEqual(["C02NEW"]);
    expect(result.skipped).toEqual([
      {
        serial: "C02ENROLLED",
        reason: "A device with this serial is already enrolled in Mattrax",
      },
    ]);

    expect(
      db.store.fleet_migration_device
        .filter((row: any) => row.migrationId === result.id)
        .map((row: any) => row.serial)
        .sort(),
    ).toEqual(["C02GROUP", "C02NEW"]);

    const list = await runEffect(listFleetMigrations(db, orgId, now));

    expect(list.migrations[0]).toMatchObject({
      name: "Leave Jamf",
      sourceMdm: "jamf",
      groupName: "Macs",
      platforms: ["apple"],
      counts: { total: 2, pending: 2, stuck: 0 },
    });
  });

  it("rejects a group from another tenant", async () => {
    const db = seed();

    db.store.enterprise_group.push({
      id: "other-group",
      organizationId: otherOrgId,
      name: "Theirs",
    });

    const result = await cohort(db, { serials: [], groupId: "other-group" });

    expect(result).toEqual({ problem: "The selected group does not belong to this tenant" });
    expect(db.store.fleet_migration).toHaveLength(0);
  });

  it("allows the same serial in two cohorts but only within the tenant", async () => {
    const db = seed();

    const first = await cohort(db, { name: "Wave one", serials: ["C02SHARED"] });
    const second = await cohort(db, { name: "Wave two", serials: ["C02SHARED"] });

    expect("id" in first && "id" in second).toBe(true);

    // The same serial is unique per cohort, which is what the unique index says.
    expect(
      db.store.fleet_migration_device.filter((row: any) => row.serial === "C02SHARED"),
    ).toHaveLength(2);
  });

  it("validates the name and platform selection", async () => {
    const db = seed();

    expect(await cohort(db, { name: "  ", serials: ["C02NEW"] })).toEqual({
      problem: "Name is required",
    });
    expect(await cohort(db, { serials: ["C02NEW"], platforms: [] })).toEqual({
      problem: "Choose at least one target platform for the cohort",
    });
    expect(await cohort(db, { serials: [] })).toEqual({
      problem: "Add at least one device serial, or seed the cohort from a group",
    });
  });
});

describe("unenrol handoff", () => {
  it("issues a bounded batch and reports what is left", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02A", "C02B", "C02C"] });

    if ("problem" in created) throw new Error(created.problem);

    const first = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", { limit: 2 }, now),
    );

    expect(first).toMatchObject({ issued: 2, skipped: 0, remaining: 1, soleCopies: [] });
    expect(first!.results!).toHaveLength(2);
    // The serials are not enrolled, so there is no execution to watch; the
    // handoff is the script the operator deploys through the incumbent.
    expect(first!.results![0]!).toMatchObject({
      delivery: "script",
      executionId: null,
      status: "unenrol-issued",
    });

    const second = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", { limit: 50 }, now),
    );

    expect(second).toMatchObject({ issued: 1, remaining: 0 });

    const third = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now),
    );

    // Every entry is already issued, so nothing else is queued.
    expect(third).toMatchObject({ issued: 0, remaining: 0 });
    expect(third!.results).toEqual([]);
  });

  it("never queues a batch above the documented bound", async () => {
    const db = seed();

    const serials = Array.from(
      { length: 60 },
      (_, index) => "C02B" + String(index).padStart(3, "0"),
    );

    const created = await cohort(db, { serials });

    if ("problem" in created) throw new Error(created.problem);

    const result = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", { limit: 10_000 }, now),
    );

    expect(result!.issued).toBe(50);
    expect(result!.remaining).toBe(10);
  });

  it("requires confirmation before unenrolling Mattrax's only managed copy", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02MANAGED"] });

    if ("problem" in created) throw new Error(created.problem);

    // The device enrols into Mattrax after the cohort was created, so it is
    // both the only managed copy and a migration target.
    db.store.device.push(device("device-3", { serial: "C02MANAGED", status: "enrolled" }));

    const blocked = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now),
    );

    expect(blocked).toMatchObject({ soleCopies: ["C02MANAGED"] });
    expect("problem" in blocked!).toBe(true);
    expect(entryFor(db, created.id, "C02MANAGED").status).toBe("pending");
    expect(db.store.script_execution).toHaveLength(0);

    const confirmed = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", { confirmSoleCopy: true }, now),
    );

    expect(confirmed).toMatchObject({ issued: 1, soleCopies: ["C02MANAGED"] });

    const script = db.store.script.find((row: any) => row.id === "mig-" + created.id + "-apple");

    expect(script).toMatchObject({ runAs: "root", language: "bash" });
    expect(script.body).toContain("profiles -D");

    // Delivery needs an assignment: the agent only receives assigned scripts.
    expect(db.store.script_assignment).toEqual([
      expect.objectContaining({
        scriptId: script.id,
        targetType: "device",
        targetId: "device-3",
      }),
    ]);

    const execution = db.store.script_execution[0];

    expect(execution).toMatchObject({ deviceId: "device-3", status: "queued" });
    expect(entryFor(db, created.id, "C02MANAGED")).toMatchObject({
      status: "unenrol-issued",
      deviceId: "device-3",
      executionId: execution.id,
    });

    // Re-issuing reuses the same script instead of creating a second one.
    await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", { confirmSoleCopy: true }, now),
    );

    expect(db.store.script.filter((row: any) => row.id.startsWith("mig-"))).toHaveLength(1);
  });

  it("falls back to the manual step when scripts are disabled", async () => {
    const db = seed();

    db.store.organization[0].scriptsEnabled = false;

    const created = await cohort(db, { serials: ["C02NOSCRIPT"] });

    if ("problem" in created) throw new Error(created.problem ?? "cohort failed");

    db.store.device.push(device("device-5", { serial: "C02NOSCRIPT", status: "enrolled" }));

    const result = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", { confirmSoleCopy: true }, now),
    );

    expect(result!.results![0]!).toMatchObject({ delivery: "script", executionId: null });
    expect(db.store.script_execution).toHaveLength(0);
    expect(entryFor(db, created.id, "C02NOSCRIPT").lastEvidence).toContain(
      "deploy the cohort script",
    );
  });

  it("documents a manual step for platforms with no script primitive", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["WIN123"], platforms: ["win"] });

    if ("problem" in created) throw new Error(created.problem);

    const result = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now),
    );

    expect(result!.results![0]!).toMatchObject({ delivery: "manual", executionId: null });
    expect(result!.results![0]!.instructions).toContain("Access work or school");
    expect(entryFor(db, created.id, "WIN123").lastEvidence).toContain("Manual unenrol required");
  });
});

describe("return detection", () => {
  it("matches the returning device by serial and lets an operator confirm it", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02RETURN"] });

    if ("problem" in created) throw new Error(created.problem);

    await runEffect(issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now));

    expect(
      (await runEffect(getFleetMigration(db, orgId, created.id, origin, now)))!.entries[0],
    ).toMatchObject({ status: "unenrol-issued" });

    db.store.device.push({
      ...device("device-returned", {
        serial: "C02RETURN",
        status: "enrolled",
      }),
      // Enrolled after the handoff was issued: this is the return.
      enrolledAt: new Date(now.getTime() + 60_000),
    });

    const detail = await runEffect(getFleetMigration(db, orgId, created.id, origin, now));

    expect(detail!.entries[0]).toMatchObject({
      status: "enrolled",
      deviceId: "device-returned",
      deviceName: "Device device-returned",
      actions: ["unenrol", "confirm"],
    });
    expect(detail!.entries[0].lastEvidence).toContain("(C02RETURN)");

    const confirmed = await runEffect(
      confirmFleetMigrationEntry(db, orgId, created.id, detail!.entries[0].id, "user-1", now),
    );

    expect(confirmed).toEqual({
      status: "confirmed",
      lastEvidence: "Operator confirmed the device is enrolled and the user accepted the profile.",
    });
    expect(entryFor(db, created.id, "C02RETURN")).toMatchObject({
      status: "confirmed",
      confirmedByAccountId: "user-1",
    });

    // A confirmed row is terminal, even if the device re-enrols again.
    expect(
      await runEffect(
        confirmFleetMigrationEntry(db, orgId, created.id, detail!.entries[0].id, "user-1", now),
      ),
    ).toMatchObject({ problem: expect.stringMatching(/cannot move/i) });
  });

  it("records a succeeded script as awaiting enrolment", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02SCRIPT"] });

    if ("problem" in created) throw new Error(created.problem);

    db.store.device.push(device("device-4", { serial: "C02SCRIPT", status: "enrolled" }));

    await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", { confirmSoleCopy: true }, now),
    );

    db.store.script_execution[0].status = "succeeded";
    db.store.script_execution[0].exitCode = 0;

    db.store.device.find((row: any) => row.id === "device-4")!.status = "unenrolling";

    const detail = await runEffect(getFleetMigration(db, orgId, created.id, origin, now));

    expect(detail!.entries[0]).toMatchObject({ status: "awaiting-enrolment" });
    expect(detail!.entries[0].lastEvidence).toContain("succeeded");
  });

  it("marks a device stuck after its window and lets the operator re-issue", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02STUCK"], stuckAfterDays: 7 });

    if ("problem" in created) throw new Error(created.problem);

    await runEffect(issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now));

    const entry = entryFor(db, created.id, "C02STUCK");

    entry.unenrolIssuedAt = new Date(now.getTime() - 8 * day);

    const stuck = await runEffect(getFleetMigration(db, orgId, created.id, origin, now));

    expect(stuck!.entries[0]).toMatchObject({ status: "stuck", actions: ["unenrol"] });
    expect(stuck!.entries[0].lastEvidence).toContain("No return within 7 days");
    expect(stuck!.migration.counts.stuck).toBe(1);

    const reissued = await runEffect(
      issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now),
    );

    expect(reissued!.issued).toBe(1);
    expect(entryFor(db, created.id, "C02STUCK")).toMatchObject({
      status: "unenrol-issued",
      stuckAt: null,
    });
  });

  it("sweeps every cohort for maintenance", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02SWEEP"], stuckAfterDays: 1 });

    if ("problem" in created) throw new Error(created.problem);

    await runEffect(issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now));

    entryFor(db, created.id, "C02SWEEP").unenrolIssuedAt = new Date(now.getTime() - 2 * day);

    const result = await runEffect(
      sweepFleetMigrations(db, { now: new Date(now.getTime() + day) }),
    );

    expect(result).toEqual({ migrations: 1, enrolled: 0, stuck: 1 });
  });

  it("lets an operator mark a manual unenrol complete", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02MANUAL"] });

    if ("problem" in created) throw new Error(created.problem);

    await runEffect(issueFleetMigrationUnenrol(db, orgId, created.id, "user-1", {}, now));

    const entry = entryFor(db, created.id, "C02MANUAL");

    expect(
      await runEffect(markFleetMigrationUnenrolled(db, orgId, created.id, entry.id, now)),
    ).toEqual({
      status: "awaiting-enrolment",
      lastEvidence: "Operator confirmed the incumbent unenrol was completed.",
    });

    // Confirming an entry that has not enrolled is refused.
    expect(
      await runEffect(confirmFleetMigrationEntry(db, orgId, created.id, entry.id, "user-1", now)),
    ).toMatchObject({ problem: expect.stringMatching(/cannot move/i) });
  });
});

describe("tenant scoping", () => {
  it("keeps every read and mutation inside the tenant", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02SCOPED"] });

    if ("problem" in created) throw new Error(created.problem);

    expect(await runEffect(getFleetMigration(db, otherOrgId, created.id, origin, now))).toBeNull();
    expect(
      await runEffect(issueFleetMigrationUnenrol(db, otherOrgId, created.id, "user-1", {}, now)),
    ).toBeNull();
    expect(
      await runEffect(exportFleetMigration(db, otherOrgId, created.id, "csv", origin, now)),
    ).toBeNull();
    expect(await runEffect(deleteFleetMigration(db, otherOrgId, created.id))).toEqual({
      deleted: false,
    });

    expect((await runEffect(listFleetMigrations(db, otherOrgId, now))).migrations).toEqual([]);
    expect(db.store.fleet_migration).toHaveLength(1);
  });

  it("deletes the cohort and its rows without touching devices", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02DELETE"] });

    if ("problem" in created) throw new Error(created.problem);

    expect(await runEffect(deleteFleetMigration(db, orgId, created.id))).toEqual({
      deleted: true,
    });
    expect(db.store.fleet_migration_device).toHaveLength(0);
    expect(db.store.device).toHaveLength(2);
  });
});

describe("export", () => {
  it("writes a CSV row per device with the enrolment handoff", async () => {
    const db = seed();

    const created = await cohort(db, { serials: ["C02CSV"], platforms: ["apple"] });

    if ("problem" in created) throw new Error(created.problem);

    const result = await runEffect(exportFleetMigration(db, orgId, created.id, "csv", origin, now));

    expect(result).toMatchObject({ format: "csv", rowCount: 1, truncated: false });

    const rows = result!.body.trim().split("\r\n");

    expect(rows[0]).toBe(
      "Serial,Platform,Status,Device,Unenrol issued,Enrolled,Confirmed,Stuck,Last evidence,Source MDM,Enrolment URL,Instructions",
    );
    expect(rows[1]).toContain("C02CSV,apple,Pending");
    expect(rows[1]).toContain("https://mattrax.test/enroll/org-1");
    expect(rows[1]).toContain("jamf");
  });

  it("writes JSON with the migration and the per-device handoff", async () => {
    const db = seed();

    const created = await cohort(db, {
      serials: ["C02JSON", "C02JSON2"],
      platforms: ["apple", "win"],
    });

    if ("problem" in created) throw new Error(created.problem);

    const result = await runEffect(
      exportFleetMigration(db, orgId, created.id, "json", origin, now),
    );

    const parsed = JSON.parse(result!.body);

    expect(parsed.version).toBe(1);
    expect(parsed.migration).toMatchObject({
      id: created.id,
      name: "Leave Jamf",
      sourceMdm: "jamf",
      platforms: ["apple", "win"],
    });
    expect(parsed.devices).toHaveLength(2);
    expect(parsed.devices[0]).toMatchObject({
      serial: "C02JSON",
      platform: "apple",
      status: "pending",
      enrollmentUrl: "https://mattrax.test/enroll/org-1",
      sourceMdm: "jamf",
    });
    expect(parsed.devices[0].instructions).toContain("System Settings");
  });
});

describe("permissions", () => {
  it("maps every migration endpoint to a device permission", () => {
    expect(permissionForMethod("listFleetMigrations")).toBe("devices.read");
    expect(permissionForMethod("getFleetMigration")).toBe("devices.read");
    expect(permissionForMethod("exportFleetMigration")).toBe("devices.read");
    expect(permissionForMethod("createFleetMigration")).toBe("devices.write");
    expect(permissionForMethod("deleteFleetMigration")).toBe("devices.write");
    expect(permissionForMethod("issueFleetMigrationUnenrol")).toBe("devices.write");
    expect(permissionForMethod("markFleetMigrationUnenrolled")).toBe("devices.write");
    expect(permissionForMethod("confirmFleetMigrationEntry")).toBe("devices.write");

    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.member, "devices.write")).toBe(false);
    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.auditor, "devices.write")).toBe(false);
    expect(hasPermission(BUILT_IN_ROLE_PERMISSIONS.admin, "devices.write")).toBe(true);
  });

  it("denies a member cohort mutations through the service", async () => {
    const timestamp = new Date("2026-11-01T00:00:00.000Z");
    const db = makeDb();
    const headers = { cookie: "mattrax_session=test" };

    const owner = {
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const member = {
      id: "user-2",
      name: "Member",
      email: "member@example.com",
      emailVerified: true,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    db.store.account.push(owner, member);

    let caller = owner;

    const auth = {
      requireUser: () => Effect.succeed({ user: caller }),
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
      // SAFETY: these tests never reach R2; the service only stores the binding.
      storage: {} as any,
      // SAFETY: the fake only implements the auth methods this test exercises.
      auth: auth as any,
      authSecret: "fleet-migration-test-secret",
    });

    const tenant = await runEffect(
      service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
    );

    db.store.member.push({
      id: "member-2",
      organizationId: tenant.id,
      accountId: "user-2",
      role: "member",
      customRoleId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // A member can read the cohorts...
    expect(await runEffect(service.listFleetMigrations(request(headers), tenant.id))).toEqual({
      migrations: [],
    });

    caller = member;

    // ...but creating one, or issuing the unenrol, needs devices.write.
    await expect(
      runEffect(
        service.createFleetMigration(request(headers), tenant.id, {
          name: "Leave Jamf",
          sourceMdm: "jamf",
          platforms: ["apple"],
          serials: ["C02DENIED"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    expect(db.store.fleet_migration).toHaveLength(0);
  });
});
