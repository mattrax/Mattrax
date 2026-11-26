import { describe, expect, it } from "vitest";
import {
  describeSkippedConfigurations,
  scopeConfigurationsToDevice as scopeConfigurationsToDeviceBase,
} from "@mattrax/mdm-core";
import type { ConfigurationDelivery } from "@mattrax/mdm-core";
import { applePolicySupport } from "../applePolicySupport.js";

const scopeConfigurationsToDevice: typeof scopeConfigurationsToDeviceBase = (
  configurations,
  device,
  mode,
) => scopeConfigurationsToDeviceBase(configurations, device, mode, { apple: applePolicySupport });

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

  it("scopes the lock screen profile to iOS/iPadOS only", async () => {
    const data = { message: "Return to IT", includeAssetTag: false };
    const ipad = { proto: "apple", osEdition: "iPadOS", osVersion: "18.1" };

    const supported = await scopeConfigurationsToDevice(
      [configuration("mttx.apple.lockScreenMessage", data)],
      ipad,
      "ddm",
    );

    expect(supported.delivered).toHaveLength(1);
    expect(supported.skipped).toHaveLength(0);

    const unsupported = await scopeConfigurationsToDevice(
      [configuration("mttx.apple.lockScreenMessage", data)],
      mac,
      "ddm",
    );

    expect(unsupported.delivered).toHaveLength(0);
    expect(unsupported.skipped[0]?.reason).toContain("only available on supervised iPhone");
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

describe("certificate and mail scoping", () => {
  it("delivers a PKCS identity on the legacy path without requiring a material lookup", async () => {
    const result = await scopeConfigurationsToDevice(
      [
        configuration("mttx.apple.pfx.smime", {
          materialSha256: "a".repeat(64),
          certificatePem: "pem",
          subject: "person",
          notAfter: "2027-01-01T00:00:00.000Z",
          fingerprintSha256: "b".repeat(64),
        }),
      ],
      mac,
      "legacy",
    );

    expect(result.delivered).toHaveLength(1);
  });

  it("reports an identity with no uploaded material instead of sending it", async () => {
    const result = await scopeConfigurationsToDevice(
      [configuration("mttx.apple.pfx.smime", { certificatePem: "pem" })],
      mac,
      "legacy",
    );

    expect(result.delivered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("PFX certificate material");
  });

  it("reports password authentication on either mail server", async () => {
    const result = await scopeConfigurationsToDevice(
      [
        configuration("mttx.apple.mail.work", {
          incoming: {
            serverType: "IMAP",
            hostName: "imap.example.com",
            authenticationMethod: "None",
          },
          outgoing: { hostName: "smtp.example.com", authenticationMethod: "Password" },
        }),
      ],
      mac,
      "ddm",
    );

    expect(result.delivered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("credentials asset");
  });

  it("reports password-based Apple mail on the declarative path", async () => {
    const result = await scopeConfigurationsToDevice(
      [
        configuration("mttx.apple.mail.work", {
          incoming: {
            serverType: "IMAP",
            hostName: "imap.example.com",
            authenticationMethod: "Password",
          },
          outgoing: { hostName: "smtp.example.com", authenticationMethod: "Password" },
        }),
      ],
      mac,
      "ddm",
    );

    expect(result.delivered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("credentials asset");
  });
});
