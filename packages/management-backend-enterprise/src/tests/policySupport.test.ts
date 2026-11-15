import { describe, expect, it } from "vitest";
import { describeSkippedConfigurations, scopeConfigurationsToDevice } from "../policySupport.js";
import type { ConfigurationDelivery } from "../policySupport.js";

const configuration = (
  kind: string,
  data: ConfigurationDelivery["data"],
  overrides: Partial<ConfigurationDelivery> = {},
): ConfigurationDelivery => ({
  policyId: "policy-1",
  kind,
  data,
  hash: "hash",
  groupId: "group-1",
  organizationId: "tenant-1",
  ...overrides,
});

const mac = { proto: "apple", osEdition: "macOS", osVersion: "13.6.1" };

describe("scopeConfigurationsToDevice", () => {
  it("drops a declaration the device OS is too old for", async () => {
    const result = await scopeConfigurationsToDevice(
      [
        configuration("mttx.apple.declaration.a", {
          kind: "com.apple.configuration.security.certificate",
          configuration: {},
        }),
        configuration("mttx.apple.declaration.b", {
          kind: "com.apple.configuration.legacy",
          configuration: { ProfileURL: "https://example.test/p" },
        }),
      ],
      mac,
      "ddm",
    );

    expect(result.delivered.map((row) => row.kind)).toEqual(["mttx.apple.declaration.b"]);
    expect(result.skipped).toEqual([
      {
        policyId: "policy-1",
        kind: "mttx.apple.declaration.a",
        reason: "com.apple.configuration.security.certificate requires macOS 14.0 or later",
      },
    ]);
  });

  it("keeps a certificate on the legacy path, where it becomes a pkcs1 profile", async () => {
    const result = await scopeConfigurationsToDevice(
      [configuration("mttx.apple.certificate.cert", { pem: "x" })],
      mac,
      "legacy",
    );

    expect(result.delivered).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("keeps the same certificate out of a DDM sync on the same device", async () => {
    const result = await scopeConfigurationsToDevice(
      [configuration("mttx.apple.certificate.cert", { pem: "x" })],
      mac,
      "ddm",
    );

    expect(result.delivered).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("filters Windows nodes that declare a minimum build", async () => {
    const result = await scopeConfigurationsToDevice(
      [
        configuration("mttx.windows.custom.a", {
          nodes: [
            { omaUri: "./Device/Vendor/MSFT/Policy/Config/A/B", value: 1 },
            { omaUri: "./Device/Vendor/MSFT/Policy/Config/C/D", value: 2, minOs: "10.0.22000" },
          ],
        }),
      ],
      { proto: "win", osEdition: "Windows", osVersion: "10.0.19045", osBuild: "19045" },
      "none",
    );

    expect(result.delivered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("10.0.22000");
  });

  it("delivers Windows nodes when the build is new enough", async () => {
    const result = await scopeConfigurationsToDevice(
      [
        configuration("mttx.windows.custom.a", {
          nodes: [
            { omaUri: "./Device/Vendor/MSFT/Policy/Config/C/D", value: 2, minOs: "10.0.19041" },
          ],
        }),
      ],
      { proto: "win", osEdition: "Windows", osVersion: "10.0.22631", osBuild: "22631" },
      "none",
    );

    expect(result.delivered).toHaveLength(1);
  });

  it("passes macOS-native payloads through and reports nothing", async () => {
    const result = await scopeConfigurationsToDevice(
      [configuration("mttx.apple.device", { camera: false })],
      mac,
      "ddm",
    );

    expect(result.delivered).toHaveLength(1);
    expect(describeSkippedConfigurations(result.skipped)).toBeNull();
  });
});

describe("describeSkippedConfigurations", () => {
  it("summarises one or many skips for the delivery decision", () => {
    expect(
      describeSkippedConfigurations([
        { policyId: "p", kind: "k", reason: "com.apple.x requires macOS 14.0 or later" },
      ]),
    ).toBe("1 configuration is not delivered because com.apple.x requires macOS 14.0 or later.");

    expect(
      describeSkippedConfigurations([
        { policyId: "p", kind: "k", reason: "a" },
        { policyId: "p", kind: "k2", reason: "b" },
      ]),
    ).toContain("2 configurations are not delivered");
  });
});
