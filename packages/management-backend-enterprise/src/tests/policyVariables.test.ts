import { describe, expect, it } from "vitest";
import { substitutePolicyVariables } from "@mattrax/enterprise-domain";
import { buildConfigurationDeclaration, policyDataHash, windowsPolicyNodes } from "../policy.ts";

/**
 * Variables are resolved before the platform compilers see a payload, so these
 * tests compile the resolved data exactly as delivery does for Apple and
 * Windows.
 */
const context = {
  device: { name: "Alice's MacBook", serial: "C02XYZ", model: "Mac14,2" },
  tenant: { name: "Acme Ltd" },
  attributes: { cost_centre: "EMEA", warranty_end: null },
};

describe("per-platform compilation of policy variables", () => {
  it("resolves Apple declaration payloads", async () => {
    const data = substitutePolicyVariables(
      {
        kind: "com.apple.configuration.wifi",
        configuration: {
          SSID_STR: "${attribute.cost_centre}-wifi",
          DisplayName: "${tenant.name} ${device.name}",
        },
      },
      context,
    );

    const declaration = await buildConfigurationDeclaration(
      {
        policyId: "policy-1",
        kind: "mttx.apple.declaration.wifi",
        data,
        hash: "hash-1",
      },
      {
        origin: "https://mdm.example.com",
        authSecret: "secret",
        deviceToken: "token",
        deviceId: "device-1",
      },
    );

    expect(declaration?.Payload).toEqual({
      SSID_STR: "EMEA-wifi",
      DisplayName: "Acme Ltd Alice's MacBook",
    });
  });

  it("resolves Windows SyncML node values", () => {
    const data = substitutePolicyVariables(
      {
        omaUri: "./Vendor/MSFT/Policy/Config/DeviceLock/DeviceName",
        value: "${device.name} (${tenant.name})",
        format: "chr",
      },
      context,
    );

    expect(
      windowsPolicyNodes({
        policyId: "policy-1",
        kind: "mttx.windows.custom.devicename",
        data,
        hash: "hash-1",
      }),
    ).toEqual([
      {
        omaUri: "./Vendor/MSFT/Policy/Config/DeviceLock/DeviceName",
        value: "Alice's MacBook (Acme Ltd)",
        format: "chr",
      },
    ]);
  });

  it("leaves a missing attribute value empty instead of shipping literal text", () => {
    expect(
      substitutePolicyVariables(
        {
          omaUri: "./Vendor/MSFT/Policy/Config/DeviceLock/Warranty",
          value: "${attribute.warranty_end}",
        },
        context,
      ),
    ).toEqual({
      omaUri: "./Vendor/MSFT/Policy/Config/DeviceLock/Warranty",
      value: "",
    });
  });
});

describe("resolution changes the declaration token", () => {
  it("hashes the resolved payload, so an attribute change re-delivers", async () => {
    const template = { value: "${attribute.cost_centre}" };

    const first = substitutePolicyVariables(template, context);

    const second = substitutePolicyVariables(template, {
      ...context,
      attributes: { cost_centre: "AMER" },
    });

    expect(await policyDataHash(first)).not.toBe(await policyDataHash(second));
  });
});
