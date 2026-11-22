import { describe, expect, it } from "vitest";
import {
  APPLE_DEVICE_NAME_MAX_LENGTH,
  appleDeviceNameFromSettingsPayload,
  appleDeviceNameSettingsPayload,
  appleUserAvailableActions,
  appleUserSupportsAction,
  deviceActionUnavailableReason,
  deviceAvailableActions,
  deviceSupportsAction,
  normalizeAppleDeviceName,
} from "./deviceActions.ts";

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
