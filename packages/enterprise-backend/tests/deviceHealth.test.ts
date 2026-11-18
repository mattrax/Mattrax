import { describe, expect, it } from "vitest";
import {
  countDeviceHealth,
  declarationReasonLabels,
  deriveDeviceHealth,
  groupDeviceHealthReasons,
  DEVICE_STALE_AFTER_DAYS,
} from "../src/Device/deviceHealth.ts";

const now = new Date("2026-11-10T12:00:00.000Z");

const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("deriveDeviceHealth", () => {
  it("reports a recently seen enrolled device as healthy", () => {
    const health = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
    });

    expect(health.level).toBe("healthy");
    expect(health.stale).toBe(false);
    expect(health.reasons).toEqual([]);
    expect(health.lastSeenAt).toBe(daysAgo(1).toISOString());
  });

  it("flags devices that have not checked in past the stale threshold", () => {
    const stale = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(DEVICE_STALE_AFTER_DAYS + 0.1),
      now,
    });

    expect(stale.level).toBe("attention");
    expect(stale.stale).toBe(true);
    expect(stale.reasons).toContainEqual(
      expect.objectContaining({ code: "stale", severity: "warning" }),
    );

    const fresh = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(DEVICE_STALE_AFTER_DAYS),
      now,
    });

    expect(fresh.stale).toBe(false);
    expect(fresh.level).toBe("healthy");
  });

  it("supports a configurable stale threshold", () => {
    const health = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(2),
      now,
      staleAfterDays: 1,
    });

    expect(health.stale).toBe(true);
    expect(health.reasons.map((reason) => reason.code)).toContain("stale");
  });

  it("treats an unenrolled device as critical", () => {
    const health = deriveDeviceHealth({
      status: "unenrolled",
      lastSeenAt: daysAgo(1),
      now,
    });

    expect(health.level).toBe("critical");
    expect(health.reasons[0]).toMatchObject({
      code: "enrollment_unenrolled",
      severity: "critical",
    });
  });

  it("treats transitional enrollment states as attention", () => {
    for (const status of ["enrolling", "unenrolling"]) {
      const health = deriveDeviceHealth({ status, lastSeenAt: daysAgo(1), now });
      expect(health.level).toBe("attention");
    }
  });

  it("surfaces invalid declarations with their identifier", () => {
    const health = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      declarations: [
        {
          identifier: "com.acme.wifi",
          declarationType: "configurations",
          valid: "invalid",
          active: true,
          reasons: [{ code: "Error", description: "Invalid payload" }],
        },
      ],
    });

    expect(health.level).toBe("attention");
    expect(health.reasons).toContainEqual(
      expect.objectContaining({
        code: "declaration_invalid",
        label: "Declaration com.acme.wifi is invalid",
        severity: "warning",
      }),
    );
  });

  it("flags inactive configuration declarations but ignores inactive assets", () => {
    const inactiveConfiguration = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      declarations: [
        {
          identifier: "config-1",
          declarationType: "configurations",
          valid: "valid",
          active: false,
        },
      ],
    });

    expect(inactiveConfiguration.reasons.map((reason) => reason.code)).toContain(
      "declaration_inactive",
    );

    const inactiveAsset = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      declarations: [
        { identifier: "asset-1", declarationType: "assets", valid: "valid", active: false },
      ],
    });

    expect(inactiveAsset.level).toBe("healthy");
  });

  it("escalates very low disk space", () => {
    const warning = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      diskTotal: "100000",
      diskUsed: "92000",
    });

    expect(warning.level).toBe("attention");
    expect(warning.reasons.map((reason) => reason.code)).toContain("disk_low");

    const critical = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      diskTotal: 100000,
      diskUsed: 99000,
    });

    expect(critical.level).toBe("critical");
    expect(critical.reasons.map((reason) => reason.code)).toContain("disk_critical");
  });

  it("flags FileVault only on macOS devices", () => {
    const mac = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      proto: "apple",
      model: "MacBook Pro",
      osEdition: "macOS",
      fileVaultEnabled: false,
    });

    expect(mac.level).toBe("attention");
    expect(mac.reasons).toContainEqual(
      expect.objectContaining({ code: "filevault_disabled", severity: "warning" }),
    );

    const ios = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      proto: "apple",
      model: "iPhone 15",
      osEdition: "iOS",
      fileVaultEnabled: false,
    });

    expect(ios.level).toBe("healthy");

    const encrypted = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      proto: "apple",
      model: "MacBook Pro",
      osEdition: "macOS",
      fileVaultEnabled: true,
    });

    expect(encrypted.level).toBe("healthy");
  });

  it("warns when the battery needs service", () => {
    const service = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      proto: "apple",
      model: "MacBook Air",
      osEdition: "macOS",
      batteryHealth: "Service Recommended",
    });

    expect(service.level).toBe("attention");
    expect(service.reasons).toContainEqual(
      expect.objectContaining({ code: "battery_service", severity: "warning" }),
    );

    const good = deriveDeviceHealth({
      status: "enrolled",
      lastSeenAt: daysAgo(1),
      now,
      proto: "apple",
      batteryHealth: "Good",
    });

    expect(good.level).toBe("healthy");
  });

  it("reports unknown when the enrollment status is missing or unrecognised", () => {
    expect(deriveDeviceHealth({ lastSeenAt: daysAgo(1), now }).level).toBe("unknown");
    expect(deriveDeviceHealth({ status: "mystery", lastSeenAt: daysAgo(1), now }).level).toBe(
      "unknown",
    );
  });

  it("treats a missing/epoch last seen as never seen", () => {
    for (const lastSeenAt of [null, undefined, new Date(0), "not-a-date"]) {
      const health = deriveDeviceHealth({ status: "enrolled", lastSeenAt, now });
      expect(health.lastSeenAt).toBeNull();
      expect(health.stale).toBe(false);
      expect(health.reasons.map((reason) => reason.code)).toContain("never_seen");
      expect(health.level).toBe("attention");
    }
  });
});

describe("countDeviceHealth", () => {
  it("aggregates levels, MIA devices and stale devices separately", () => {
    const health = (status: string, lastSeenAt: Date) =>
      deriveDeviceHealth({ status, lastSeenAt, now });

    const counts = countDeviceHealth([
      health("enrolled", daysAgo(1)),
      health("enrolled", daysAgo(8)),
      health("enrolled", daysAgo(30)),
      health("enrolling", daysAgo(1)),
      health("unenrolled", daysAgo(1)),
    ]);

    expect(counts).toEqual({
      total: 5,
      healthy: 1,
      attention: 2,
      critical: 1,
      missing: 1,
      // MIA devices are past the stale threshold too, so the stale count
      // includes both the 8-day attention device and the 30-day MIA device.
      stale: 2,
      unknown: 0,
    });
  });

  it("derives the MIA banner count from enrolled devices only", () => {
    const health = (status: string, lastSeenAt: Date) =>
      deriveDeviceHealth({ status, lastSeenAt, now });

    const counts = countDeviceHealth([
      health("enrolled", daysAgo(20)),
      health("enrolled", daysAgo(18)),
      health("unenrolled", daysAgo(20)),
      health("enrolled", daysAgo(2)),
    ]);

    expect(counts.missing).toBe(2);
    expect(counts.critical).toBe(1);
  });
});

describe("declarationReasonLabels", () => {
  it("formats structured and string reasons", () => {
    expect(
      declarationReasonLabels([
        { code: "Error", description: "Invalid payload" },
        "Plain reason",
        { details: "ignored" },
      ]),
    ).toEqual(["Error: Invalid payload", "Plain reason"]);
    expect(declarationReasonLabels(null)).toEqual([]);
  });
});

describe("groupDeviceHealthReasons", () => {
  it("groups stable rule codes and counts the devices they flag", () => {
    const health = (input: Parameters<typeof deriveDeviceHealth>[0]) =>
      deriveDeviceHealth({ now, ...input });

    const groups = groupDeviceHealthReasons([
      health({ status: "enrolled", lastSeenAt: daysAgo(1) }),
      health({ status: "enrolled", lastSeenAt: daysAgo(30) }),
      health({ status: "unenrolled", lastSeenAt: daysAgo(1) }),
      health({
        status: "enrolled",
        lastSeenAt: daysAgo(1),
        diskTotal: 100,
        diskUsed: 98,
      }),
    ]);

    expect(groups).toEqual([
      { code: "disk_critical", label: "Storage full", severity: "critical", count: 1 },
      { code: "enrollment_unenrolled", label: "Unenrolled", severity: "critical", count: 1 },
      { code: "missing", label: "MIA", severity: "warning", count: 1 },
    ]);
  });

  it("returns nothing when every device is healthy", () => {
    expect(
      groupDeviceHealthReasons([
        deriveDeviceHealth({ status: "enrolled", lastSeenAt: daysAgo(1), now }),
      ]),
    ).toEqual([]);
  });
});
