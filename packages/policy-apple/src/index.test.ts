import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ComAppleConfigurationPasscodeSettings,
  ComAppleWifiManaged,
  Erasedevice,
  Tokenupdate,
} from "./index.js";

describe("declaration schemas", () => {
  it("validates passcode settings", () => {
    const valid = {
      RequirePasscode: true,
      MinimumLength: 6,
    };
    const result = Schema.decodeUnknownExit(ComAppleConfigurationPasscodeSettings)(valid);
    expect(result._tag).toBe("Success");
  });

  it("rejects invalid passcode settings", () => {
    const invalid = {
      MinimumLength: 20, // exceeds max of 16
    };
    const result = Schema.decodeUnknownExit(ComAppleConfigurationPasscodeSettings)(invalid);
    expect(result._tag).toBe("Failure");
  });
});

describe("profile schemas", () => {
  it("validates wifi profile", () => {
    const valid = {
      SSID_STR: "MyNetwork",
      AutoJoin: true,
      EncryptionType: "WPA3",
    };
    const result = Schema.decodeUnknownExit(ComAppleWifiManaged)(valid);
    expect(result._tag).toBe("Success");
  });

  it("rejects invalid wifi encryption type", () => {
    const invalid = {
      SSID_STR: "MyNetwork",
      EncryptionType: "INVALID",
    };
    const result = Schema.decodeUnknownExit(ComAppleWifiManaged)(invalid);
    expect(result._tag).toBe("Failure");
  });
});

describe("command schemas", () => {
  it("validates erase device command", () => {
    const valid = {
      PreserveDataPlan: true,
    };
    const result = Schema.decodeUnknownExit(Erasedevice)(valid);
    expect(result._tag).toBe("Success");
  });
});

describe("checkin schemas", () => {
  it("validates token update", () => {
    const valid = {
      NotOnConsole: true,
      MessageType: "TokenUpdate",
      Topic: "com.example.mdm",
      UDID: "abc123",
      EnrollmentID: "enroll-1",
      EnrollmentUserID: "user-1",
      UserLongName: "Test User",
      PushMagic: "magic",
      Token: "token",
    };
    const result = Schema.decodeUnknownExit(Tokenupdate)(valid);
    expect(result._tag).toBe("Success");
  });
});
