import { describe, expect, it } from "vitest";
import {
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
});
