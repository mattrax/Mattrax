import { describe, expect, it } from "vitest";
import {
  appleDeviceNameFromSettingsPayload,
  appleDeviceNameSettingsPayload,
  appleUserAvailableActions,
  appleUserSupportsAction,
  deviceActionUnavailableReason,
  deviceAvailableActions,
  deviceSupportsAction,
  isAppleLockScreenMessageDevice,
  parseAppleLockScreenMessageConfiguration,
  resolveAppleLockScreenMessage,
} from "./deviceActions.ts";
import { APPLE_DEVICE_NAME_MAX_LENGTH, normalizeAppleDeviceName } from "./deviceInventory.ts";

describe("deviceAvailableActions", () => {
  it("offers Windows actions without a sync action", () => {
    const actions = deviceAvailableActions({ proto: "win", status: "enrolled" });

    expect(actions).toContain("wipe");
    expect(actions).toContain("restart");
    expect(actions).toContain("unenroll");
    expect(actions).not.toContain("sync");
    expect(actions).not.toContain("lock");
  });

  it("offers Apple's full command set", () => {
    const actions = deviceAvailableActions({ proto: "apple", status: "enrolled" });

    expect(actions).toContain("sync");
    expect(actions).toContain("lock");
    expect(actions).toContain("wipe");
    expect(actions).toContain("clear-passcode");
    expect(actions).toContain("collect-security-info");
    expect(actions).toContain("refresh-applications");
  });

  it("offers Android's full command set including retirement", () => {
    const actions = deviceAvailableActions({ proto: "android", status: "enrolled" });

    expect(actions).toEqual(
      expect.arrayContaining([
        "sync",
        "lock",
        "wipe",
        "restart",
        "start-lost-mode",
        "stop-lost-mode",
        "reset-password",
        "clear-app-data",
        "request-device-info",
        "relinquish-ownership",
        "unenroll",
      ]),
    );
    // Android commands do not include Apple-only or Windows-only vocabulary.
    expect(actions).not.toContain("clear-passcode");
    expect(actions).not.toContain("return-to-service");
  });

  it("narrows Android actions by ownership and management mode", () => {
    const companyWorkProfile = deviceAvailableActions({
      proto: "android",
      status: "enrolled",
      ownership: "COMPANY_OWNED",
      managementMode: "PROFILE_OWNER",
    });

    expect(companyWorkProfile).toContain("reset-password");
    expect(companyWorkProfile).toContain("relinquish-ownership");

    // A profile owner cannot reset the device password on a personal phone,
    // and Google cannot relinquish a device the employee owns.
    const personalWorkProfile = deviceAvailableActions({
      proto: "android",
      status: "enrolled",
      ownership: "PERSONALLY_OWNED",
      managementMode: "PROFILE_OWNER",
    });

    expect(personalWorkProfile).not.toContain("reset-password");
    expect(personalWorkProfile).not.toContain("relinquish-ownership");
    expect(personalWorkProfile).toContain("lock");

    // Fully managed devices can reset the password but have no work profile to
    // relinquish.
    const fullyManaged = deviceAvailableActions({
      proto: "android",
      status: "enrolled",
      ownership: "COMPANY_OWNED",
      managementMode: "DEVICE_OWNER",
    });

    expect(fullyManaged).toContain("reset-password");
    expect(fullyManaged).not.toContain("relinquish-ownership");
  });

  it("keeps Android mode-restricted actions while the report is unknown", () => {
    const actions = deviceAvailableActions({ proto: "android", status: "enrolled" });

    expect(actions).toContain("reset-password");
    expect(actions).toContain("relinquish-ownership");
  });

  it("narrows the platform set when a device reports action capabilities", () => {
    const actions = deviceAvailableActions({
      proto: "win",
      status: "enrolled",
      capabilities: ["erase"],
    });

    expect(actions).toEqual(["wipe", "unenroll"]);
    expect(deviceSupportsAction({ proto: "win", status: "enrolled" }, "restart")).toBe(true);
    expect(
      deviceSupportsAction(
        { proto: "win", status: "enrolled", capabilities: ["erase"] },
        "restart",
      ),
    ).toBe(false);
  });

  it("does not treat Apple's DDM capability list as action names", () => {
    const actions = deviceAvailableActions({
      proto: "apple",
      status: "enrolled",
      capabilities: ["declarative-management", "software-update"],
    });

    expect(actions).toContain("lock");
    expect(actions).toContain("sync");
  });

  it("offers no commands until the device is enrolled", () => {
    expect(deviceAvailableActions({ proto: "win", status: "unenrolled" })).toEqual([]);
    expect(deviceAvailableActions({ proto: "win", status: "unenrolling" })).toEqual(["unenroll"]);
  });

  it("explains why Windows sync is unavailable", () => {
    expect(deviceActionUnavailableReason({ proto: "win", status: "enrolled" }, "sync")).toContain(
      "no push channel",
    );
  });

  it("offers Return to Service on supported Apple platforms", () => {
    expect(deviceAvailableActions({ proto: "apple", status: "enrolled" })).toContain(
      "return-to-service",
    );
    expect(
      deviceAvailableActions({
        proto: "apple",
        status: "enrolled",
        osEdition: "iPadOS",
        osVersion: "17.4",
      }),
    ).toContain("return-to-service");
    expect(
      deviceAvailableActions({
        proto: "apple",
        status: "enrolled",
        osEdition: "tvOS",
        osVersion: "18.0",
      }),
    ).toContain("return-to-service");
  });

  it("does not offer Return to Service on macOS or old Apple releases", () => {
    expect(
      deviceAvailableActions({ proto: "apple", status: "enrolled", osEdition: "macOS 15.1" }),
    ).not.toContain("return-to-service");

    expect(
      deviceAvailableActions({
        proto: "apple",
        status: "enrolled",
        osEdition: "iOS",
        osVersion: "16.7",
      }),
    ).not.toContain("return-to-service");

    expect(
      deviceAvailableActions({
        proto: "apple",
        status: "enrolled",
        osEdition: "tvOS",
        osVersion: "17.0",
      }),
    ).not.toContain("return-to-service");
  });

  it("explains the Apple Return to Service platform limit", () => {
    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", osEdition: "macOS 15" },
        "return-to-service",
      ),
    ).toContain("not support it on macOS");
  });

  it("offers set-device-name on enrolled Apple devices", () => {
    const actions = deviceAvailableActions({ proto: "apple", status: "enrolled" });

    expect(actions).toContain("set-device-name");
    expect(deviceSupportsAction({ proto: "apple", status: "enrolled" }, "set-device-name")).toBe(
      true,
    );
  });

  it("does not offer set-device-name on Apple User Enrollment or other platforms", () => {
    expect(
      deviceAvailableActions({
        proto: "apple",
        status: "enrolled",
        enrollmentMode: "user",
      }),
    ).not.toContain("set-device-name");

    expect(deviceAvailableActions({ proto: "win", status: "enrolled" })).not.toContain(
      "set-device-name",
    );
    expect(deviceAvailableActions({ proto: "android", status: "enrolled" })).not.toContain(
      "set-device-name",
    );
    expect(deviceAvailableActions({ proto: "apple", status: "unenrolled" })).not.toContain(
      "set-device-name",
    );
  });

  it("explains why set-device-name is unavailable", () => {
    expect(
      deviceActionUnavailableReason({ proto: "win", status: "enrolled" }, "set-device-name"),
    ).toContain("only available for Apple devices");

    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", enrollmentMode: "user" },
        "set-device-name",
      ),
    ).toContain("User Enrollment");
  });

  it("offers ScheduleOSUpdate only where the DDM declaration is unavailable", () => {
    const fallback = { proto: "apple" as const, status: "enrolled", osEdition: "iOS" };

    expect(deviceAvailableActions({ ...fallback, osVersion: "16.7" })).toContain(
      "schedule-os-update",
    );
    expect(deviceAvailableActions({ ...fallback, osVersion: "18.1" })).not.toContain(
      "schedule-os-update",
    );
    expect(
      deviceAvailableActions({ ...fallback, osVersion: "18.1", declarationMode: "legacy" }),
    ).toContain("schedule-os-update");
    expect(
      deviceAvailableActions({
        ...fallback,
        osVersion: "18.1",
        declarationMode: "legacy",
        enrollmentMode: "user",
      }),
    ).not.toContain("schedule-os-update");
    expect(deviceAvailableActions({ ...fallback, osVersion: "27.0" })).not.toContain(
      "schedule-os-update",
    );
    expect(
      deviceAvailableActions({ proto: "apple", status: "enrolled", osEdition: "macOS 15.1" }),
    ).toContain("schedule-os-update");
  });

  it("explains the OS 27 command removal", () => {
    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", osEdition: "iPadOS", osVersion: "27.0" },
        "schedule-os-update",
      ),
    ).toContain("removed the ScheduleOSUpdate command in iOS/iPadOS 27");

    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", osEdition: "macOS", osVersion: "27.0" },
        "schedule-os-update",
      ),
    ).toContain("macOS 27");
  });

  it("explains why ScheduleOSUpdate is not offered on a DDM phone", () => {
    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", osEdition: "iPadOS", osVersion: "18.1" },
        "schedule-os-update",
      ),
    ).toContain("DDM declaration");
  });
});

describe("Apple device name payload", () => {
  it("builds the documented Settings/DeviceName item", () => {
    expect(appleDeviceNameSettingsPayload("Reception Mac")).toEqual({
      Settings: [{ Item: "DeviceName", DeviceName: "Reception Mac" }],
    });
  });

  it("reads the name back from a queued payload", () => {
    expect(
      appleDeviceNameFromSettingsPayload(appleDeviceNameSettingsPayload("Reception Mac")),
    ).toBe("Reception Mac");
    expect(
      appleDeviceNameFromSettingsPayload({
        Settings: [{ Item: "MDMOptions", MDMOptions: {} }],
      }),
    ).toBeUndefined();
    expect(appleDeviceNameFromSettingsPayload(null)).toBeUndefined();
  });

  it("trims names and documents Apple's 63-character limit", () => {
    expect(normalizeAppleDeviceName("  Reception Mac  ")).toBe("Reception Mac");
    expect(normalizeAppleDeviceName("   ")).toBeUndefined();
    expect(APPLE_DEVICE_NAME_MAX_LENGTH).toBe(63);
  });
});

describe("appleUserAvailableActions", () => {
  it("offers a profile refresh even without push credentials", () => {
    expect(appleUserAvailableActions({ configured: false })).toEqual(["refresh-profiles"]);
  });

  it("adds a wake-up once the channel has a token", () => {
    expect(appleUserAvailableActions({ configured: true })).toEqual(["sync", "refresh-profiles"]);
    expect(appleUserSupportsAction({ configured: true }, "sync")).toBe(true);
    expect(appleUserSupportsAction({ configured: false }, "sync")).toBe(false);
  });
});

describe("set-lock-screen-message", () => {
  it("is offered on iPhone and iPad, including before the OS is known", () => {
    expect(
      deviceAvailableActions({
        proto: "apple",
        status: "enrolled",
        osEdition: "iOS",
        osVersion: "18.1",
      }),
    ).toContain("set-lock-screen-message");
    expect(
      deviceAvailableActions({
        proto: "apple",
        status: "enrolled",
        osEdition: "iPadOS",
        osVersion: "18.1",
      }),
    ).toContain("set-lock-screen-message");
    expect(deviceAvailableActions({ proto: "apple", status: "enrolled" })).toContain(
      "set-lock-screen-message",
    );
  });

  it("is not offered on macOS, tvOS, visionOS, Android, Windows or BYOD devices", () => {
    const unavailable = [
      { proto: "apple", status: "enrolled", osEdition: "macOS", osVersion: "15.1" },
      { proto: "apple", status: "enrolled", osEdition: "tvOS", osVersion: "18" },
      { proto: "apple", status: "enrolled", osEdition: "visionOS", osVersion: "2.0" },
      { proto: "apple", status: "enrolled", enrollmentMode: "user" },
      { proto: "android", status: "enrolled" },
      { proto: "win", status: "enrolled" },
      { proto: "apple", status: "unenrolled", osEdition: "iOS" },
    ];

    for (const input of unavailable)
      expect(deviceAvailableActions(input)).not.toContain("set-lock-screen-message");
  });

  it("explains why the command is unavailable", () => {
    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", osEdition: "macOS" },
        "set-lock-screen-message",
      ),
    ).toContain("not available on macOS");

    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", osEdition: "tvOS" },
        "set-lock-screen-message",
      ),
    ).toContain("not available on tvOS");

    expect(
      deviceActionUnavailableReason(
        { proto: "apple", status: "enrolled", enrollmentMode: "user" },
        "set-lock-screen-message",
      ),
    ).toContain("User Enrollment");

    expect(
      deviceActionUnavailableReason(
        { proto: "android", status: "enrolled" },
        "set-lock-screen-message",
      ),
    ).toContain("only available on supervised iPhone and iPad");
  });

  it("recognises supported Apple families", () => {
    expect(isAppleLockScreenMessageDevice({ proto: "apple" })).toBe(true);
    expect(isAppleLockScreenMessageDevice({ proto: "apple", osEdition: "iOS" })).toBe(true);
    expect(isAppleLockScreenMessageDevice({ proto: "apple", model: "iPhone16,1" })).toBe(true);
    expect(isAppleLockScreenMessageDevice({ proto: "apple", osEdition: "macOS" })).toBe(false);
    expect(isAppleLockScreenMessageDevice({ proto: "apple", model: "Apple TV 4K" })).toBe(false);
  });
});

describe("resolveAppleLockScreenMessage", () => {
  const policy = {
    message: "Return to the IT desk",
    includeAssetTag: true,
    policyName: "Shared iPads",
  };

  it("prefers a per-device message and can override the asset-tag choice", () => {
    expect(
      resolveAppleLockScreenMessage({
        deviceMessage: "Call Oscar",
        deviceIncludeAssetTag: false,
        policy,
        assetTag: "AST-1042",
      }),
    ).toEqual({ message: "Call Oscar", includeAssetTag: false, source: "device" });

    expect(
      resolveAppleLockScreenMessage({ deviceIncludeAssetTag: true, policy, assetTag: "AST-1042" }),
    ).toMatchObject({
      message: policy.message,
      includeAssetTag: true,
      source: "policy",
      policyName: "Shared iPads",
    });
  });

  it("reports why a resolved default cannot be delivered", () => {
    expect(resolveAppleLockScreenMessage({ policy, assetTag: null })).toMatchObject({
      message: policy.message,
      includeAssetTag: true,
      source: "policy",
      problem: expect.stringContaining("no asset tag"),
    });
  });

  it("decodes a stored policy configuration", () => {
    expect(
      parseAppleLockScreenMessageConfiguration({
        message: " Return to IT ",
        includeAssetTag: true,
      }),
    ).toEqual({ message: "Return to IT", includeAssetTag: true });
    expect(parseAppleLockScreenMessageConfiguration({ message: "" })).toBeUndefined();
    expect(parseAppleLockScreenMessageConfiguration(null)).toBeUndefined();
  });
});
