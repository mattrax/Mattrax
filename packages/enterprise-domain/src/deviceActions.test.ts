import { describe, expect, it } from "vitest";
import {
  appleUserAvailableActions,
  appleUserSupportsAction,
  deviceActionUnavailableReason,
  deviceAvailableActions,
  deviceSupportsAction,
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

  it("does not offer Android unenrollment", () => {
    expect(deviceAvailableActions({ proto: "android", status: "enrolled" })).not.toContain(
      "unenroll",
    );
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
