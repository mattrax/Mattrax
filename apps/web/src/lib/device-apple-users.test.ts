import { describe, expect, it } from "vitest";
import {
  appleUserBindingLabel,
  appleUserDisplayName,
  appleUserEnrollmentLabel,
  appleUserLoginName,
  appleUserPushLabel,
  appleUserPushTone,
} from "./device-apple-users";

const push = (overrides: Partial<Parameters<typeof appleUserPushLabel>[0]> = {}) => ({
  configured: true,
  consecutiveFailures: 0,
  invalidToken: false,
  lastError: null,
  ...overrides,
});

describe("apple user channel display", () => {
  it("prefers the full name, then the short name, then Apple's identifier", () => {
    expect(
      appleUserDisplayName({
        longName: "Oscar Beaumont",
        shortName: "oscar",
        platformUserId: "user-1",
      }),
    ).toBe("Oscar Beaumont");

    expect(
      appleUserDisplayName({ longName: null, shortName: "oscar", platformUserId: "user-1" }),
    ).toBe("oscar");

    // A Shared iPad reports no names at all; the opaque id is all there is.
    expect(
      appleUserDisplayName({ longName: null, shortName: null, platformUserId: "user-1" }),
    ).toBe("user-1");

    expect(
      appleUserLoginName({ longName: "Oscar", shortName: null, platformUserId: "user-1" }),
    ).toBe("user-1");
  });

  it("labels how the user was bound to the device", () => {
    expect(appleUserBindingLabel("authenticated")).toBe("Authenticated");
    expect(appleUserBindingLabel("enrollment")).toBe("User enrollment");
    expect(appleUserBindingLabel("unbound")).toBe("Not authenticated");
  });

  it("reports push health without exposing token material", () => {
    expect(appleUserPushLabel(push())).toBe("Push ready");
    expect(appleUserPushTone(push())).toBe("success");
    expect(appleUserPushLabel(push({ configured: false }))).toBe("No push token yet");
    expect(appleUserPushTone(push({ configured: false }))).toBe("muted");
    expect(appleUserPushLabel(push({ consecutiveFailures: 2, lastError: "BadDeviceToken" }))).toBe(
      "Push failing: BadDeviceToken",
    );
    expect(appleUserPushTone(push({ consecutiveFailures: 2 }))).toBe("warning");
    expect(appleUserPushLabel(push({ invalidToken: true }))).toContain("rejected");
    expect(appleUserPushTone(push({ invalidToken: true }))).toBe("danger");
  });

  it("names the enrollment mode", () => {
    expect(appleUserEnrollmentLabel("user")).toBe("BYOD (User Enrollment)");
    expect(appleUserEnrollmentLabel("device")).toBe("Device enrollment");
    expect(appleUserEnrollmentLabel(null)).toBe("Device enrollment");
  });
});
