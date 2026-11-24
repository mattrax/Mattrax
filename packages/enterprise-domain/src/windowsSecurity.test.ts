import { describe, expect, it } from "vitest";
import {
  WINDOWS_DIAGNOSTICS_ARCHIVE_URI,
  WINDOWS_LAPS_CONFIGURATION_KIND,
  bitlockerKeyHealth,
  parseWindowsLapsPolicy,
  resolveWindowsLapsConfiguration,
  windowsBitlockerRotateCommand,
  windowsBuildNumber,
  windowsDiagnosticsCollectionXml,
  windowsDiagnosticsCommand,
  windowsDiagnosticsSupported,
  windowsFreshStartCommand,
  windowsFreshStartSupported,
  windowsLapsPolicyNodes,
  windowsLapsPolicyProblem,
  windowsLapsSupported,
  windowsSecretReasonProblem,
  windowsBitlockerRotationSupported,
  windowsBitlockerRotationStatusKind,
  windowsLapsResetStatusKind,
  windowsRotationPollDecision,
  bitlockerVolumeTypeFromGraph,
} from "./windowsSecurity.ts";
import { deviceActionUnavailableReason, deviceAvailableActions } from "./deviceActions.ts";

const windows = {
  proto: "win",
  status: "enrolled",
  osEdition: "Windows 11 Enterprise",
  osVersion: "10.0.22631",
  osBuild: "22631.3155",
};

describe("Windows action capabilities", () => {
  it("advertises Fresh Start, diagnostics and BitLocker rotation only when supported", () => {
    const actions = deviceAvailableActions({
      ...windows,
      bitLockerEnabled: true,
      entraDeviceId: "entra-device",
      windowsLapsConfigured: true,
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        "fresh-start",
        "collect-diagnostics",
        "rotate-bitlocker-key",
        "rotate-local-admin-password",
      ]),
    );

    expect(
      deviceAvailableActions({
        ...windows,
        osEdition: "Windows 11 Pro",
        osBuild: "22631.1",
      }),
    ).not.toContain("fresh-start");
  });

  it("rejects the actions with an explanation instead of queueing them", () => {
    const pro = {
      ...windows,
      osEdition: "Windows 11 Pro",
      bitLockerEnabled: false,
      entraDeviceId: null,
      domainName: null,
      windowsLapsConfigured: false,
    };

    expect(deviceActionUnavailableReason(pro, "fresh-start")).toMatch(/Enterprise and Education/);
    expect(deviceActionUnavailableReason(pro, "rotate-bitlocker-key")).toMatch(/not enabled/);
    expect(deviceActionUnavailableReason(pro, "rotate-local-admin-password")).toMatch(
      /No Windows LAPS policy/,
    );
    expect(
      deviceActionUnavailableReason({ ...windows, osBuild: "17763.1" }, "collect-diagnostics"),
    ).toMatch(/1903/);
  });

  it("requires Windows 11 22H2 or Server 2025 for LAPS", () => {
    expect(windowsBuildNumber("10.0.22631", "22631.3155")).toBe(22631);
    expect(windowsLapsSupported(windows)).toBe(true);
    expect(windowsLapsSupported({ ...windows, osBuild: "19045.1" })).toBe(false);
    expect(windowsDiagnosticsSupported({ ...windows, osBuild: "17763.1" })).toBe(false);
    expect(windowsFreshStartSupported({ ...windows, osEdition: "Windows 11 Pro" })).toBe(false);
  });

  it("requires an Entra device id, not a plain AD domain, for BitLocker rotation", () => {
    const base = {
      ...windows,
      bitLockerEnabled: true,
      entraDeviceId: null,
      domainName: "corp.example.com",
    };

    expect(windowsBitlockerRotationSupported(base)).toBe(false);
    expect(
      windowsBitlockerRotationSupported({ ...base, entraDeviceId: "entra-device" }),
    ).toBe(true);
    expect(
      windowsBitlockerRotationSupported({
        ...base,
        osBuild: "18362.1",
        entraDeviceId: "entra-device",
      }),
    ).toBe(false);
  });
});

describe("CSP payloads", () => {
  it("uses the documented CleanPC nodes and explicit data-retention modes", () => {
    expect(windowsFreshStartCommand("retain-user-data")).toEqual({
      locURI: "./Device/Vendor/MSFT/CleanPC/CleanPCRetainingUserData",
      data: "1",
      format: "int",
    });
    expect(windowsFreshStartCommand("remove-user-data").locURI).toBe(
      "./Device/Vendor/MSFT/CleanPC/CleanPCWithoutRetainingUserData",
    );
  });

  it("builds a bounded DiagnosticArchive collection with an HTTPS upload URL", () => {
    const xml = windowsDiagnosticsCollectionXml({
      collectionId: "f1e20cb4-9789-4f6b-8f6a-766989764c6d",
      uploadUrl:
        "https://mattrax.test/api/v1/windows-diagnostics/upload?token=abc&x=1",
    });

    expect(xml).toContain("<Collection>");
    expect(xml).toContain("<ID>f1e20cb4-9789-4f6b-8f6a-766989764c6d</ID>");
    expect(xml).toContain("<SasUrl><![CDATA[https://mattrax.test/");
    expect(xml).toContain("<Events>Application</Events>");
    expect(xml).toContain("<OutputFileFormat>Flattened</OutputFileFormat>");
    // The CSP only accepts allow-listed commands and folder roots.
    expect(xml).not.toContain("powershell");
    expect(xml).toContain("MdmDiagnosticsTool.exe");

    expect(() =>
      windowsDiagnosticsCollectionXml({
        collectionId: "id",
        uploadUrl: "http://mattrax.test/upload",
      }),
    ).toThrow(/HTTPS/);

    expect(windowsDiagnosticsCommand({ collectionId: "id", uploadUrl: "https://mattrax.test/u" }))
      .toMatchObject({ locURI: WINDOWS_DIAGNOSTICS_ARCHIVE_URI, format: "chr" });
  });

  it("uses RotateRecoveryPasswords with the request id", () => {
    expect(windowsBitlockerRotateCommand("abc")).toEqual({
      locURI: "./Device/Vendor/MSFT/BitLocker/RotateRecoveryPasswords",
      data: "abc",
      format: "chr",
    });
    expect(() => windowsBitlockerRotateCommand(" ")).toThrow();
  });
});

describe("LAPS policy", () => {
  const policy = {
    backupDirectory: "entra-id" as const,
    accountName: "MattraxAdmin",
    passwordAgeDays: 30,
    passwordLength: 20,
    passwordComplexity: 4,
    postAuthenticationActions: 3,
    postAuthenticationResetDelayHours: 24,
  };

  it("validates the documented ranges and Entra backup age", () => {
    expect(windowsLapsPolicyProblem(policy)).toBeUndefined();
    expect(windowsLapsPolicyProblem({ ...policy, passwordAgeDays: 5 })).toMatch(/at least 7/);
    expect(windowsLapsPolicyProblem({ ...policy, passwordLength: 4 })).toMatch(/8 and 64/);
    expect(windowsLapsPolicyProblem({ ...policy, passwordComplexity: 6 })).toMatch(
      /Windows 11 24H2/,
    );
    expect(windowsLapsPolicyProblem({ ...policy, accountName: "bad/name" })).toMatch(/slash/);
  });

  it("emits only the CSP nodes the operator configured", () => {
    const nodes = windowsLapsPolicyNodes(policy);

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          omaUri: "./Device/Vendor/MSFT/LAPS/Policies/BackupDirectory",
          value: 1,
          format: "int",
        }),
        expect.objectContaining({
          omaUri: "./Device/Vendor/MSFT/LAPS/Policies/AdministratorAccountName",
          value: "MattraxAdmin",
          format: "chr",
        }),
      ]),
    );
    expect(nodes.some((node) => node.omaUri.endsWith("PasswordLength"))).toBe(true);

    // Password expiration protection is an AD-only setting and must not be
    // delivered under an Entra policy.
    expect(
      nodes.some((node) => node.omaUri.endsWith("PasswordExpirationProtectionEnabled")),
    ).toBe(false);
    expect(
      windowsLapsPolicyNodes({
        ...policy,
        backupDirectory: "active-directory",
        passwordExpirationProtection: true,
      }).some((node) => node.omaUri.endsWith("PasswordExpirationProtectionEnabled")),
    ).toBe(true);

    expect(
      windowsLapsPolicyNodes({ ...policy, passwordComplexity: 6 }).some((node) =>
        node.omaUri.endsWith("PasswordComplexity"),
      ),
    ).toBe(false);
  });

  it("resolves a structured or raw custom policy deterministically", () => {
    expect(parseWindowsLapsPolicy(policy)).toMatchObject({ backupDirectory: "entra-id" });

    const resolved = resolveWindowsLapsConfiguration([
      {
        policyId: "b",
        kind: WINDOWS_LAPS_CONFIGURATION_KIND,
        data: { ...policy, passwordAgeDays: 60 },
      },
      {
        policyId: "a",
        kind: "mttx.windows.custom.laps",
        data: {
          nodes: [
            {
              omaUri: "./Device/Vendor/MSFT/LAPS/Policies/BackupDirectory",
              value: 1,
              format: "int",
            },
            {
              omaUri: "./Device/Vendor/MSFT/LAPS/Policies/PasswordAgeDays",
              value: 14,
              format: "int",
            },
          ],
        },
      },
    ]);

    expect(resolved).toMatchObject({
      configured: true,
      backupDirectory: "entra-id",
      passwordAgeDays: 14,
    });

    expect(resolveWindowsLapsConfiguration([])).toBeUndefined();
  });
});

describe("BitLocker key health and reveal reasons", () => {
  it("computes age and stale state", () => {
    const now = new Date("2026-11-24T00:00:00Z");

    expect(
      bitlockerKeyHealth({ capturedAt: "2026-11-01T00:00:00Z", now }),
    ).toMatchObject({ ageDays: 23, health: "fresh" });

    expect(
      bitlockerKeyHealth({ capturedAt: "2025-01-01T00:00:00Z", now }),
    ).toMatchObject({ health: "stale" });
  });

  it("requires a meaningful reveal reason", () => {
    expect(windowsSecretReasonProblem("")).toMatch(/reason/);
    expect(windowsSecretReasonProblem("disk swap")).toBeUndefined();
    expect(windowsSecretReasonProblem("a".repeat(501))).toMatch(/500/);
  });

  it("maps Graph volume types and interprets each rotation status format", () => {
    expect(bitlockerVolumeTypeFromGraph(1)).toBe("operating-system");
    expect(bitlockerVolumeTypeFromGraph("fixedDataVolume")).toBe("fixed-data");
    expect(bitlockerVolumeTypeFromGraph(3)).toBe("removable-data");

    // BitLocker status is an enum, not an HRESULT.
    expect(windowsBitlockerRotationStatusKind("0")).toBe("succeeded");
    expect(windowsBitlockerRotationStatusKind("1")).toBe("pending");
    expect(windowsBitlockerRotationStatusKind("2")).toBe("pending");
    expect(windowsBitlockerRotationStatusKind("3")).toBe("failed");

    // LAPS ResetPasswordStatus is an HRESULT. E_PENDING is 0x8000000A.
    expect(windowsLapsResetStatusKind("0")).toBe("succeeded");
    expect(windowsLapsResetStatusKind("0x8000000A")).toBe("pending");
    expect(windowsLapsResetStatusKind("2147483658")).toBe("pending");
    expect(windowsLapsResetStatusKind("-2147483638")).toBe("pending");
    expect(windowsLapsResetStatusKind("2147483648")).toBe("failed");
    expect(windowsLapsResetStatusKind("-2147483648")).toBe("failed");
  });

  it("polls rotation status until terminal and stops after the deadline", () => {
    const now = new Date("2026-11-24T10:00:00Z");
    const execUpdatedAt = new Date("2026-11-24T09:00:00Z");
    const base = { now, execUpdatedAt } as const;

    // Runtime-queued or merely sent Exec has no device ack yet, so no poll.
    for (const execStatus of ["queued", "sent"])
      expect(
        windowsRotationPollDecision({
          ...base,
          kind: "bitlocker",
          execStatus,
          latestStatusDetail: null,
        }),
      ).toBe("stop");

    // A device-accepted async Exec is polled just like succeeded.
    expect(
      windowsRotationPollDecision({
        ...base,
        kind: "bitlocker",
        execStatus: "accepted",
        latestStatusDetail: null,
      }),
    ).toBe("poll");

    // BitLocker 1=Pending and 2=NotStarted keep polling.
    for (const value of ["1", "2"])
      expect(
        windowsRotationPollDecision({
          ...base,
          kind: "bitlocker",
          execStatus: "succeeded",
          latestStatusDetail: "Status " + value,
        }),
      ).toBe("poll");

    expect(
      windowsRotationPollDecision({
        ...base,
        kind: "bitlocker",
        execStatus: "succeeded",
        latestStatusDetail: "Status 0",
      }),
    ).toBe("stop");

    expect(
      windowsRotationPollDecision({
        ...base,
        kind: "bitlocker",
        execStatus: "succeeded",
        latestStatusDetail: "Status 3",
      }),
    ).toBe("stop");

    // LAPS E_PENDING polls; 0x80000000 (E_FAIL) does not.
    expect(
      windowsRotationPollDecision({
        ...base,
        kind: "laps",
        execStatus: "succeeded",
        latestStatusDetail: "Status 0x8000000A",
      }),
    ).toBe("poll");

    expect(
      windowsRotationPollDecision({
        ...base,
        kind: "laps",
        execStatus: "succeeded",
        latestStatusDetail: "Status 2147483648",
      }),
    ).toBe("stop");

    expect(
      windowsRotationPollDecision({
        ...base,
        kind: "laps",
        execStatus: "failed",
        latestStatusDetail: null,
      }),
    ).toBe("stop");

    expect(
      windowsRotationPollDecision({
        kind: "laps",
        execStatus: "succeeded",
        latestStatusDetail: "Status 0x8000000A",
        now: new Date("2026-11-26T10:00:00Z"),
        execUpdatedAt,
      }),
    ).toBe("stop");
  });
});