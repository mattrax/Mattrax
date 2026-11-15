import { describe, expect, it } from "vitest";
import {
  appleDeclarativeMinimumOs,
  appleOsFamily,
  applePayloadMinimumOs,
  applePayloadOsVersions,
  applePayloadSupportForDevice,
  compareOsVersion,
} from "../supportedOs.js";

describe("Apple OS support metadata", () => {
  it("compares dotted versions numerically", () => {
    expect(compareOsVersion("14.10", "14.9")).toBeGreaterThan(0);
    expect(compareOsVersion("15", "15.0.0")).toBe(0);
    expect(compareOsVersion("13.6.1", "14")).toBeLessThan(0);
  });

  it("maps marketing names to families, folding iPadOS into iOS", () => {
    expect(appleOsFamily("macOS")).toBe("macOS");
    expect(appleOsFamily("iPadOS")).toBe("iOS");
    expect(appleOsFamily("iOS")).toBe("iOS");
    expect(appleOsFamily("visionOS")).toBe("visionOS");
    expect(appleOsFamily("Windows")).toBeNull();
    expect(appleOsFamily(null)).toBeNull();
  });

  it("knows the declarative management minimum per family", () => {
    expect(appleDeclarativeMinimumOs("macOS")).toBe("13.0");
    expect(appleDeclarativeMinimumOs("iOS")).toBe("15.0");
    expect(appleDeclarativeMinimumOs("tvOS")).toBe("16.0");
  });

  it("exposes Apple's supportedOS data", () => {
    expect(applePayloadMinimumOs("com.apple.configuration.security.certificate", "macOS")).toBe(
      "14.0",
    );
    expect(applePayloadMinimumOs("com.apple.configuration.security.certificate", "iOS")).toBe(
      "17.0",
    );
    expect(applePayloadMinimumOs("com.apple.security.FDERecoveryKeyEscrow", "macOS")).toBe("10.13");
    expect(applePayloadMinimumOs("com.example.custom", "macOS")).toBeNull();
    expect(applePayloadOsVersions("com.apple.configuration.security.certificate")).toContain(
      "macOS",
    );
  });

  it("rejects a payload on an OS that does not support it", () => {
    const mac13 = { family: "macOS" as const, version: "13.6.1" };

    expect(
      applePayloadSupportForDevice("com.apple.configuration.security.certificate", mac13),
    ).toEqual({ supported: false, reason: "os-version", minimum: "14.0" });

    expect(applePayloadSupportForDevice("com.apple.configuration.legacy", mac13)).toEqual({
      supported: true,
    });

    // iOS is not an OS this payload exists on.
    expect(
      applePayloadSupportForDevice("com.apple.security.FDERecoveryKeyEscrow", {
        family: "iOS",
        version: "17.0",
      }),
    ).toEqual({ supported: false, reason: "os-family" });
  });

  it("treats unknown inventory as supported rather than dropping the config", () => {
    expect(
      applePayloadSupportForDevice("com.apple.configuration.security.certificate", {
        family: null,
        version: null,
      }),
    ).toEqual({ supported: true });
    expect(
      applePayloadSupportForDevice("com.apple.configuration.security.certificate", {
        family: "macOS",
        version: null,
      }),
    ).toEqual({ supported: true });
  });
});
