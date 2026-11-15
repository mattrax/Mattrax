import { describe, expect, it } from "vitest";
import {
  normalizeBatteryHealth,
  normalizeBoolean,
  normalizeCapabilities,
  parseDeviceInventory,
  statusItemValue,
} from "../inventory.js";

const nestedFixture = {
  device: {
    identifier: { "serial-number": "C02TEST12345" },
    model: {
      "marketing-name": "MacBook Pro (14-inch, 2023)",
      identifier: "Mac14,9",
      number: "MLH12LL/A",
    },
    "operating-system": {
      "marketing-name": "macOS",
      version: "14.5",
      "build-version": "23F79",
    },
    power: { "battery-health": "Service Recommended" },
  },
  diskmanagement: {
    filevault: { enabled: true },
    storage: { total: 1000000000, available: 250000000 },
  },
  management: {
    "client-capabilities": [
      { capability: "declarative-management" },
      { capability: "software-update" },
      "certificate-renewal",
    ],
  },
};

const flattenedFixture = {
  "device.identifier.serial-number": "C02FLAT12345",
  "device.model.marketing-name": "MacBook Air",
  "device.model.identifier": "Mac15,12",
  "device.model.number": "MRXV3LL/A",
  "device.operating-system.marketing-name": "macOS",
  "device.operating-system.version": "15.1",
  "device.operating-system.build-version": "24B83",
  "device.power.battery-health": "Good",
  "diskmanagement.filevault.enabled": "Disabled",
  "diskmanagement.storage.total": "500000000",
  "diskmanagement.storage.available": "400000000",
  "management.client-capabilities": "declarative-management,software-update",
};

describe("parseDeviceInventory", () => {
  it("reads the nested status-item tree", () => {
    expect(parseDeviceInventory(nestedFixture)).toEqual({
      serial: "C02TEST12345",
      model: "MacBook Pro (14-inch, 2023)",
      modelIdentifier: "Mac14,9",
      modelNumber: "MLH12LL/A",
      osEdition: "macOS",
      osVersion: "14.5",
      osBuild: "23F79",
      fileVaultEnabled: true,
      batteryHealth: "Service Recommended",
      capabilities: ["declarative-management", "software-update", "certificate-renewal"],
      diskTotal: "1000000000",
      diskUsed: "750000000",
    });
  });

  it("reads flattened status-item keys", () => {
    expect(parseDeviceInventory(flattenedFixture)).toEqual({
      serial: "C02FLAT12345",
      model: "MacBook Air",
      modelIdentifier: "Mac15,12",
      modelNumber: "MRXV3LL/A",
      osEdition: "macOS",
      osVersion: "15.1",
      osBuild: "24B83",
      fileVaultEnabled: false,
      batteryHealth: "Good",
      capabilities: ["declarative-management", "software-update"],
      diskTotal: "500000000",
      diskUsed: "100000000",
    });
  });

  it("ignores reports with nothing understood", () => {
    expect(parseDeviceInventory(null)).toEqual({});
    expect(parseDeviceInventory("not-an-object")).toEqual({});
    expect(parseDeviceInventory({ unrelated: true })).toEqual({});
  });

  it("prefers the nested value when both shapes are present", () => {
    expect(
      statusItemValue(
        { device: { model: { number: "NESTED" } }, "device.model.number": "FLAT" },
        "device.model.number",
      ),
    ).toBe("NESTED");
  });

  it("updates neither disk field when available exceeds total", () => {
    expect(
      parseDeviceInventory({
        diskmanagement: { storage: { total: 100, available: 200 } },
      }),
    ).toEqual({});
  });

  it("clears reported fields that are no longer present", () => {
    expect(
      parseDeviceInventory({
        diskmanagement: { filevault: { enabled: "" } },
        device: { power: { "battery-health": "   " } },
        management: { "client-capabilities": [] },
      }),
    ).toEqual({
      fileVaultEnabled: null,
      batteryHealth: null,
      capabilities: [],
    });
  });
});

describe("normalizeBoolean", () => {
  it("accepts the FileVault spellings Apple and clients use", () => {
    for (const value of [true, 1, "Enabled", "enabled", " YES "])
      expect(normalizeBoolean(value)).toBe(true);

    for (const value of [false, 0, "Disabled", "disabled", " false "])
      expect(normalizeBoolean(value)).toBe(false);
  });

  it("unwraps object payloads and rejects unknown values", () => {
    expect(normalizeBoolean({ enabled: "Enabled" })).toBe(true);
    expect(normalizeBoolean({ value: false })).toBe(false);
    expect(normalizeBoolean("maybe")).toBeUndefined();
    expect(normalizeBoolean(2)).toBeUndefined();
    expect(normalizeBoolean(null)).toBeUndefined();
  });
});

describe("normalizeBatteryHealth", () => {
  it("canonicalises known macOS battery conditions", () => {
    expect(normalizeBatteryHealth("service recommended")).toBe("Service Recommended");
    expect(normalizeBatteryHealth("  replace   now ")).toBe("Replace Now");
    expect(normalizeBatteryHealth({ value: "poor" })).toBe("Poor");
  });

  it("preserves unknown vendor strings", () => {
    expect(normalizeBatteryHealth("battery is fine")).toBe("Battery is fine");
    expect(normalizeBatteryHealth("   ")).toBeUndefined();
  });
});

describe("normalizeCapabilities", () => {
  it("normalises arrays of dictionaries and arrays of strings", () => {
    expect(normalizeCapabilities([{ name: "a" }, { identifier: "b" }, "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      normalizeCapabilities({ capabilities: ["declarative-management", "declarative-management"] }),
    ).toEqual(["declarative-management"]);
  });

  it("keeps an unrecognised shape rather than dropping it", () => {
    expect(normalizeCapabilities([{ unsupported: true }])).toEqual([{ unsupported: true }]);
    expect(normalizeCapabilities({ managed: true })).toEqual({ managed: true });
  });
});

describe("compliance status items", () => {
  it("parses passcode, software update, security and mdm.app reports", () => {
    const inventory = parseDeviceInventory({
      passcode: { "is-present": true, "is-compliant": false },
      softwareupdate: {
        "install-state": "prepared",
        "pending-version": { "os-version": "15.2", "build-version": "24C101" },
        "failure-reason": {
          count: 2,
          reason: "The update could not be prepared",
          timestamp: "2026-04-01T09:30:00Z",
        },
      },
      security: {
        "lockdown-mode": true,
        certificate: { list: [{ identifier: "a" }, { identifier: "b" }] },
      },
      mdm: {
        app: [
          { identifier: "com.example.z", state: "failed", version: "1.0" },
          { identifier: "com.example.a", state: "managed", "short-version": "2.1" },
        ],
      },
    });

    expect(inventory.passcodePresent).toBe(true);
    expect(inventory.passcodeCompliant).toBe(false);
    expect(inventory.osUpdateInstallState).toBe("prepared");
    expect(inventory.osUpdatePendingVersion).toBe("15.2");
    expect(inventory.osUpdatePendingBuild).toBe("24C101");
    expect(inventory.osUpdateFailureCount).toBe(2);
    expect(inventory.osUpdateFailureReason).toBe("The update could not be prepared");
    expect(inventory.osUpdateFailedAt?.toISOString()).toBe("2026-04-01T09:30:00.000Z");
    expect(inventory.securityLockdownMode).toBe(true);
    expect(inventory.managedCertificateCount).toBe(2);
    expect(inventory.managementApps).toEqual([
      {
        identifier: "com.example.a",
        state: "managed",
        version: null,
        shortVersion: "2.1",
      },
      {
        identifier: "com.example.z",
        state: "failed",
        version: "1.0",
        shortVersion: null,
      },
    ]);
  });

  it("keeps an empty pending version as null and rejects unknown install states", () => {
    const inventory = parseDeviceInventory({
      softwareupdate: {
        "install-state": "something-new",
        "pending-version": { "os-version": "", "build-version": "" },
      },
    });

    expect(inventory.osUpdateInstallState).toBeNull();
    expect(inventory.osUpdatePendingVersion).toBeNull();
    expect(inventory.osUpdatePendingBuild).toBeNull();
  });

  it("reads flattened mdm.app entries and ignores malformed ones", () => {
    const inventory = parseDeviceInventory({
      "mdm.app": [{ identifier: "com.example.app", state: "installing" }, { state: "managed" }],
    });

    expect(inventory.managementApps).toEqual([
      { identifier: "com.example.app", state: "installing", version: null, shortVersion: null },
    ]);
  });

  it("does not invent values for items the device did not report", () => {
    const inventory = parseDeviceInventory({ device: { identifier: { "serial-number": "S" } } });

    expect(inventory.passcodePresent).toBeUndefined();
    expect(inventory.osUpdateInstallState).toBeUndefined();
    expect(inventory.managedCertificateCount).toBeUndefined();
    expect(inventory.managementApps).toBeUndefined();
  });
});
