import { describe, expect, it } from "vitest";
import {
  DEVICE_SECURITY_INFO_STALE_AFTER_DAYS,
  deriveDeviceHealth,
  isWindowsDevice,
  type DeviceHealthInput,
} from "./deviceHealth.ts";

const now = new Date("2026-01-01T12:00:00Z");

const windows = (overrides: Partial<DeviceHealthInput> = {}) =>
  deriveDeviceHealth({
    proto: "win",
    status: "enrolled",
    lastSeenAt: now,
    osEdition: "Windows 11 Pro",
    windowsSecurityReported: true,
    bitLockerEnabled: true,
    tpmVersion: "2.0",
    secureBootState: 1,
    domainName: "corp.contoso.com",
    entraDeviceId: null,
    now,
    ...overrides,
  });

const codes = (summary: ReturnType<typeof deriveDeviceHealth>) =>
  summary.reasons.map((reason) => reason.code);

describe("Windows device health", () => {
  it("identifies Windows from the protocol or OS edition", () => {
    expect(isWindowsDevice({ proto: "win" })).toBe(true);
    expect(isWindowsDevice({ osEdition: "Windows 11 Enterprise" })).toBe(true);
    expect(isWindowsDevice({ proto: "apple", osEdition: "macOS 15" })).toBe(false);
  });

  it("is healthy when the security snapshot is compliant", () => {
    expect(windows().level).toBe("healthy");
    expect(codes(windows())).toEqual([]);
  });

  it("flags BitLocker being off", () => {
    expect(codes(windows({ bitLockerEnabled: false }))).toContain("bitlocker_disabled");
    expect(codes(windows({ bitLockerEnabled: true, bitLockerStatus: 1 << 2 }))).toContain(
      "bitlocker_disabled",
    );
    expect(codes(windows({ bitLockerEnabled: true, bitLockerStatus: 0 }))).not.toContain(
      "bitlocker_disabled",
    );
  });

  it("flags a missing or outdated TPM", () => {
    expect(codes(windows({ tpmVersion: null }))).toContain("tpm_absent");
    expect(codes(windows({ tpmVersion: "1.2" }))).toContain("tpm_outdated");
    expect(codes(windows({ tpmVersion: "2.0" }))).not.toContain("tpm_outdated");
  });

  it("flags Secure Boot being disabled but not unsupported", () => {
    expect(codes(windows({ secureBootState: 2 }))).toContain("secure_boot_disabled");
    expect(codes(windows({ secureBootState: 1 }))).not.toContain("secure_boot_disabled");
    expect(codes(windows({ secureBootState: 0 }))).not.toContain("secure_boot_disabled");
  });

  it("flags a device that is neither domain nor Entra joined", () => {
    expect(codes(windows({ domainName: null, entraDeviceId: null }))).toContain("not_joined");
    expect(codes(windows({ domainName: null, entraDeviceId: "entra-id" }))).not.toContain(
      "not_joined",
    );
  });

  it("does not run the rules before the first security report", () => {
    const summary = deriveDeviceHealth({
      proto: "win",
      status: "enrolled",
      lastSeenAt: now,
      bitLockerEnabled: false,
      tpmVersion: null,
      secureBootState: 2,
      now,
    });

    expect(codes(summary)).not.toContain("bitlocker_disabled");
    expect(codes(summary)).not.toContain("tpm_absent");
    expect(codes(summary)).not.toContain("secure_boot_disabled");
  });

  it("does not apply Windows rules to Apple devices", () => {
    const summary = deriveDeviceHealth({
      proto: "apple",
      status: "enrolled",
      lastSeenAt: now,
      osEdition: "macOS 15",
      bitLockerEnabled: false,
      secureBootState: 2,
      windowsSecurityReported: true,
      now,
    });

    expect(codes(summary)).not.toContain("bitlocker_disabled");
  });
});

describe("Apple compliance status health", () => {
  const apple = (overrides: Partial<DeviceHealthInput> = {}) =>
    deriveDeviceHealth({
      proto: "apple",
      status: "enrolled",
      lastSeenAt: now,
      osEdition: "iOS",
      model: "iPhone15,2",
      now,
      ...overrides,
    });

  it("flags a missing passcode and a non-compliant one", () => {
    expect(codes(apple({ passcodePresent: false }))).toContain("passcode_missing");
    expect(codes(apple({ passcodePresent: true, passcodeCompliant: false }))).toContain(
      "passcode_noncompliant",
    );
    expect(codes(apple({ passcodePresent: true, passcodeCompliant: true }))).toEqual([]);
  });

  it("does not treat a null passcode as a missing one", () => {
    expect(codes(apple({ passcodePresent: null }))).not.toContain("passcode_missing");
  });

  it("reports a failed software update with its count", () => {
    const summary = apple({ osUpdateInstallState: "failed", osUpdateFailureCount: 3 });

    expect(codes(summary)).toContain("os_update_failed");
    expect(summary.reasons.find((reason) => reason.code === "os_update_failed")?.label).toContain(
      "3 times",
    );
    expect(summary.level).toBe("attention");
  });

  it("reports a pending update as information, not a warning", () => {
    const summary = apple({ osUpdatePendingVersion: "18.4" });

    expect(codes(summary)).toContain("os_update_pending");
    expect(summary.level).toBe("healthy");
  });

  it("flags a management app that failed to install", () => {
    expect(
      codes(
        apple({
          managementApps: [
            { identifier: "com.example.app", state: "failed" },
            { identifier: "com.example.ok", state: "managed" },
          ],
        }),
      ),
    ).toContain("management_app_failed");
  });

  it("flags FileVault without an escrowed key only on a Mac", () => {
    const mac = (overrides: Partial<DeviceHealthInput> = {}) =>
      apple({ osEdition: "macOS", model: "MacBookPro18,3", ...overrides });

    expect(codes(mac({ fileVaultEnabled: true }))).toContain("filevault_key_missing");
    expect(codes(mac({ fileVaultEnabled: true, recoveryKeyUpdatedAt: now }))).not.toContain(
      "filevault_key_missing",
    );
    expect(codes(apple({ fileVaultEnabled: true }))).not.toContain("filevault_key_missing");
  });

  it("warns when security information is stale", () => {
    const stale = new Date(
      now.getTime() - (DEVICE_SECURITY_INFO_STALE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000,
    );

    expect(codes(apple({ recoveryKeyUpdatedAt: stale, securityInfoUpdatedAt: stale }))).toContain(
      "security_info_stale",
    );
    expect(codes(apple({ recoveryKeyUpdatedAt: now, securityInfoUpdatedAt: now }))).not.toContain(
      "security_info_stale",
    );
  });
});
