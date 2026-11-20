import { describe, expect, it } from "vitest";
import {
  clampMigrationStuckDays,
  clampMigrationUnenrolBatch,
  FLEET_MIGRATION_UNENROL_BATCH_DEFAULT,
  FLEET_MIGRATION_UNENROL_BATCH_MAX,
  migrationEntryActions,
  migrationEnrolmentGuide,
  migrationIsStuck,
  migrationObservationChanges,
  migrationTransitionAllowed,
  migrationTransitionProblem,
  migrationUnenrolRecipe,
  normalizeMigrationSerial,
  normalizeMigrationSerials,
  observeMigrationEntry,
  type FleetMigrationEntryStatus,
} from "./fleetMigration.js";

const now = new Date("2026-11-20T12:00:00.000Z");

const day = 24 * 60 * 60 * 1000;

const DEFAULT_STATUS: FleetMigrationEntryStatus = "pending";

const entry = (overrides: {
  status?: FleetMigrationEntryStatus;
  deviceId?: string | null;
  unenrolIssuedAt?: Date | null;
  stuckAfterDays?: number;
}) => ({
  status: overrides.status ?? DEFAULT_STATUS,
  platform: "apple" as const,
  serial: "C02ABC123",
  deviceId: overrides.deviceId ?? null,
  unenrolIssuedAt: overrides.unenrolIssuedAt ?? null,
  stuckAfterDays: overrides.stuckAfterDays ?? 7,
  now,
});

describe("migration status machine", () => {
  it("moves forward and only re-opens a cohort deliberately", () => {
    expect(migrationTransitionAllowed("pending", "unenrol-issued")).toBe(true);
    expect(migrationTransitionAllowed("unenrol-issued", "awaiting-enrolment")).toBe(true);
    expect(migrationTransitionAllowed("awaiting-enrolment", "enrolled")).toBe(true);
    expect(migrationTransitionAllowed("enrolled", "confirmed")).toBe(true);
    // A stuck device can be retried, an enrolled one can be re-issued when it
    // disappears again, but a confirmed device is finished.
    expect(migrationTransitionAllowed("stuck", "unenrol-issued")).toBe(true);
    expect(migrationTransitionAllowed("enrolled", "unenrol-issued")).toBe(true);
    expect(migrationTransitionAllowed("confirmed", "pending")).toBe(false);
    expect(migrationTransitionAllowed("pending", "confirmed")).toBe(false);
    expect(migrationTransitionProblem("pending", "confirmed")).toMatch(/cannot move/i);
    expect(migrationTransitionProblem("pending", "unenrol-issued")).toBeNull();
  });

  it("offers the actions each status actually supports", () => {
    expect(migrationEntryActions("pending")).toEqual(["unenrol"]);
    expect(migrationEntryActions("unenrol-issued")).toEqual(["unenrol", "mark-unenrolled"]);
    expect(migrationEntryActions("awaiting-enrolment")).toEqual(["unenrol"]);
    expect(migrationEntryActions("enrolled")).toEqual(["unenrol", "confirm"]);
    expect(migrationEntryActions("confirmed")).toEqual([]);
    expect(migrationEntryActions("stuck")).toEqual(["unenrol"]);
  });

  it("only counts an unenrol window that has actually elapsed", () => {
    expect(
      migrationIsStuck({
        status: "unenrol-issued",
        issuedAt: new Date(now.getTime() - 6 * day),
        stuckAfterDays: 7,
        now,
      }),
    ).toBe(false);

    expect(
      migrationIsStuck({
        status: "unenrol-issued",
        issuedAt: new Date(now.getTime() - 8 * day),
        stuckAfterDays: 7,
        now,
      }),
    ).toBe(true);

    // A pending device has no deadline yet.
    expect(migrationIsStuck({ status: "pending", issuedAt: null, stuckAfterDays: 7, now })).toBe(
      false,
    );
  });
});

describe("migration observations", () => {
  it("marks a returning device enrolled and keeps the evidence", () => {
    const observation = observeMigrationEntry(
      entry({ status: "awaiting-enrolment", unenrolIssuedAt: new Date(now.getTime() - day) }),
      {
        id: "device-1",
        name: "Reception Mac",
        serial: "C02ABC123",
        status: "enrolled",
        enrolledAt: new Date(now.getTime() + 1_000),
      },
      null,
    );

    expect(observation).toMatchObject({ status: "enrolled", deviceId: "device-1" });
    expect(observation?.lastEvidence).toContain("Reception Mac");
    expect(observation?.enrolledAt).toEqual(now);
  });

  it("does not rewrite an unchanged enrolled entry on every read", () => {
    const enrolled = observeMigrationEntry(
      entry({ status: "enrolled", deviceId: "device-1" }),
      {
        id: "device-1",
        name: "Reception Mac",
        serial: "C02ABC123",
        status: "enrolled",
        enrolledAt: now,
      },
      null,
    );

    expect(enrolled).toBeNull();
    expect(
      migrationObservationChanges(
        { status: "enrolled", lastEvidence: "x", deviceId: "device-1" },
        null,
      ),
    ).toBe(false);
  });

  it("moves to awaiting-enrolment when the delivered script succeeded", () => {
    const observation = observeMigrationEntry(
      entry({ status: "unenrol-issued", unenrolIssuedAt: now }),
      null,
      { id: "run-1", status: "succeeded", exitCode: 0, detail: null },
    );

    expect(observation?.status).toBe("awaiting-enrolment");
    expect(observation?.lastEvidence).toContain("succeeded");
  });

  it("keeps a failed handoff issued and records the failure", () => {
    const facts = entry({ status: "unenrol-issued", unenrolIssuedAt: now });

    const observation = observeMigrationEntry(facts, null, {
      id: "run-1",
      status: "failed",
      exitCode: 1,
      detail: "profiles: -D failed",
    });

    expect(observation?.status).toBe("unenrol-issued");
    expect(observation?.lastEvidence).toContain("exit 1");
    expect(observation?.lastEvidence).toContain("profiles: -D failed");
  });

  it("declares a silent device stuck once its window closes, but a return wins", () => {
    const facts = entry({
      status: "unenrol-issued",
      unenrolIssuedAt: new Date(now.getTime() - 8 * day),
    });

    expect(observeMigrationEntry(facts, null, null)).toMatchObject({ status: "stuck" });

    // A device that came back after the deadline is enrolled, not stuck.
    expect(
      observeMigrationEntry(
        facts,
        {
          id: "d",
          name: "Mac",
          serial: "C02ABC123",
          status: "enrolled",
          enrolledAt: now,
        },
        null,
      ),
    ).toMatchObject({ status: "enrolled" });
  });

  it("never touches a confirmed device", () => {
    expect(
      observeMigrationEntry(
        entry({ status: "confirmed", unenrolIssuedAt: new Date(0) }),
        { id: "d", name: "Mac", serial: "C02ABC123", status: "enrolled", enrolledAt: now },
        null,
      ),
    ).toBeNull();
  });
});

describe("serial handling", () => {
  it("normalises case and whitespace so a pasted list matches", () => {
    expect(normalizeMigrationSerial("  c02abc123 ")).toBe("C02ABC123");
  });

  it("drops duplicates and reports invalid rows without failing the import", () => {
    const result = normalizeMigrationSerials([
      "C02ABC123",
      "c02abc123",
      " C02XYZ999 ",
      "",
      "bad serial!",
      "C02ABC123",
    ]);

    expect(result.serials).toEqual(["C02ABC123", "C02XYZ999"]);
    expect(result.duplicates).toEqual(["C02ABC123", "C02ABC123"]);
    expect(result.invalid.map((row) => row.serial)).toEqual(["", "BAD SERIAL!"]);
  });
});

describe("bounded batches", () => {
  it("clamps a requested batch to the documented bound", () => {
    expect(clampMigrationUnenrolBatch(undefined)).toBe(FLEET_MIGRATION_UNENROL_BATCH_DEFAULT);
    expect(clampMigrationUnenrolBatch(0)).toBe(1);
    expect(clampMigrationUnenrolBatch(-5)).toBe(1);
    expect(clampMigrationUnenrolBatch(10)).toBe(10);
    expect(clampMigrationUnenrolBatch(10_000)).toBe(FLEET_MIGRATION_UNENROL_BATCH_MAX);
    expect(clampMigrationUnenrolBatch(Number.NaN)).toBe(FLEET_MIGRATION_UNENROL_BATCH_DEFAULT);
  });

  it("clamps the stuck window", () => {
    expect(clampMigrationStuckDays(undefined)).toBe(7);
    expect(clampMigrationStuckDays(0)).toBe(1);
    expect(clampMigrationStuckDays(1_000)).toBe(90);
  });
});

describe("platform recipes", () => {
  it("hands macOS a root script that removes the incumbent profile", () => {
    const recipe = migrationUnenrolRecipe("apple");

    expect(recipe.delivery).toBe("script");
    expect(recipe.script?.runAs).toBe("root");
    expect(recipe.script?.body).toContain("profiles -D");
    expect(recipe.script?.body).toContain("must run as root");
  });

  it("documents Windows and Android instead of inventing a script", () => {
    expect(migrationUnenrolRecipe("win")).toMatchObject({
      delivery: "manual",
      script: null,
    });
    expect(migrationUnenrolRecipe("win").instructions).toContain("Access work or school");

    expect(migrationUnenrolRecipe("android")).toMatchObject({
      delivery: "manual",
      script: null,
    });
    expect(migrationUnenrolRecipe("android").instructions).toContain("Retire");
  });

  it("surfaces the tenant enrolment URL for every platform", () => {
    const apple = migrationEnrolmentGuide({
      platform: "apple",
      origin: "https://mattrax.test/",
      organizationId: "org-1",
    });

    expect(apple.enrollmentUrl).toBe("https://mattrax.test/enroll/org-1");
    expect(apple.profileUrl).toBe(
      "https://mattrax.test/api/v1/enrollment/org-1/apple.mobileconfig",
    );
    expect(apple.steps.join(" ")).toContain("System Settings");

    for (const platform of ["win", "android"] as const)
      expect(
        migrationEnrolmentGuide({
          platform,
          origin: "https://mattrax.test",
          organizationId: "org-1",
        }).enrollmentUrl,
      ).toBe("https://mattrax.test/enroll/org-1");
  });
});
