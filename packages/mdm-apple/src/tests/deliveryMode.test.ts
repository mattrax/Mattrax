import { describe, expect, it } from "vitest";
import {
  appleDeclarativeCapability,
  appleDeliveryModeChanged,
  decideAppleDelivery,
} from "../deliveryMode.js";

const declarativeCapabilities = {
  "supported-versions": ["1.0"],
  "supported-payloads": {
    declarations: {
      configurations: [
        "com.apple.configuration.legacy",
        "com.apple.configuration.management.status-subscriptions",
      ],
    },
    "status-items": ["device.identifier.serial-number"],
  },
};

describe("appleDeclarativeCapability", () => {
  it("reads Apple's documented capability dictionary", () => {
    expect(appleDeclarativeCapability(declarativeCapabilities).support).toBe("supported");
  });

  it("accepts camelCase and snake_case shims", () => {
    expect(
      appleDeclarativeCapability({
        supportedPayloads: { declarations: { configurations: ["com.apple.configuration.legacy"] } },
      }).support,
    ).toBe("supported");
    expect(
      appleDeclarativeCapability({
        supported_payloads: {
          declarations: { configurations: ["com.apple.configuration.legacy"] },
        },
      }).support,
    ).toBe("supported");
  });

  it("treats a missing report as unknown and an empty declarative section as unsupported", () => {
    expect(appleDeclarativeCapability(null).support).toBe("unknown");
    expect(appleDeclarativeCapability({ unrelated: true }).support).toBe("unknown");
    expect(appleDeclarativeCapability({ "supported-payloads": { declarations: {} } }).support).toBe(
      "unknown",
    );
    expect(
      appleDeclarativeCapability({
        "supported-versions": ["1.0"],
        "supported-payloads": { declarations: { configurations: [] } },
      }).support,
    ).toBe("unsupported");
    expect(
      appleDeclarativeCapability({
        "supported-payloads": {
          declarations: { configurations: ["com.apple.ManagedClient.preferences"] },
        },
      }).support,
    ).toBe("unsupported");
  });
});

describe("decideAppleDelivery", () => {
  it("uses declarative management on a supported OS with capabilities", () => {
    expect(
      decideAppleDelivery({
        osEdition: "macOS",
        osVersion: "15.1",
        capabilities: declarativeCapabilities,
      }),
    ).toMatchObject({ mode: "ddm" });
  });

  it("falls back to legacy profiles on an OS older than the declarative minimum", () => {
    const decision = decideAppleDelivery({ osEdition: "macOS", osVersion: "12.7.6" });

    expect(decision.mode).toBe("legacy");
    expect(decision.reason).toContain("macOS 12.7.6");
    expect(decision.reason).toContain("13.0");
  });

  it("falls back when the client advertises no declarative configuration support", () => {
    const decision = decideAppleDelivery({
      osEdition: "macOS",
      osVersion: "15.1",
      capabilities: {
        "supported-versions": ["1.0"],
        "supported-payloads": { declarations: { configurations: [] } },
      },
    });

    expect(decision.mode).toBe("legacy");
    expect(decision.reason).toContain("no declarative configuration types");
  });

  it("falls back for iOS below 15", () => {
    expect(decideAppleDelivery({ osEdition: "iOS", osVersion: "14.8" }).mode).toBe("legacy");
  });

  it("keeps the declarative path until evidence says otherwise", () => {
    expect(decideAppleDelivery({ osEdition: "macOS", osVersion: "15.1" })).toMatchObject({
      mode: "ddm",
    });
    expect(decideAppleDelivery({})).toMatchObject({ mode: "ddm" });
    expect(
      decideAppleDelivery({ osEdition: "macOS", osVersion: "15.1", capabilities: { odd: 1 } }),
    ).toMatchObject({ mode: "ddm" });
  });

  it("falls back for an OS family Apple does not support declaratively", () => {
    const decision = decideAppleDelivery({ osEdition: "UnknownOS", osVersion: "1.0" });

    // No family means no evidence: keep DDM rather than guess.
    expect(decision.mode).toBe("ddm");
  });
});

describe("appleDeliveryModeChanged", () => {
  it("only reports a change when the mode or recorded reason moves", () => {
    expect(
      appleDeliveryModeChanged({ mode: "ddm", reason: "a" }, { mode: "ddm", reason: "a" }),
    ).toBe(false);
    expect(
      appleDeliveryModeChanged({ mode: "ddm", reason: "a" }, { mode: "legacy", reason: "a" }),
    ).toBe(true);
    expect(appleDeliveryModeChanged(undefined, { mode: "ddm", reason: "a" })).toBe(true);
  });
});
