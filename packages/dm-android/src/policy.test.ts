import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { compileAndroidPolicy } from "./policy.js";

const compile = (configurations: Parameters<typeof compileAndroidPolicy>[0]) => {
  const result = compileAndroidPolicy(configurations);

  expect(Result.isSuccess(result)).toBe(true);

  if (Result.isFailure(result)) throw result.failure;

  return result.success;
};

const pem = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAOq0m8gE9j4zMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnJv
b3RDQTAeFw0yNjAxMDEwMDAwMDBaFw0zNjAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnJvb3RDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMJv6hV0dWZ0
-----END CERTIFICATE-----
`;

describe("Android certificate policy", () => {
  it("compiles a trusted root into an ONC user CA", () => {
    const policy = compile([
      {
        kind: "mttx.android.certificate.corp",
        data: { pem },
      },
    ]);

    expect(policy.openNetworkConfiguration).toMatchObject({
      Type: "UnencryptedConfiguration",
      NetworkConfigurations: [],
      Certificates: [
        {
          GUID: "mattrax-policy-corp",
          Type: "Authority",
          TrustBits: ["Web"],
        },
      ],
    });

    const certificate = (
      policy.openNetworkConfiguration as { Certificates: Array<{ X509: string }> }
    ).Certificates[0];

    expect(certificate?.X509).toBe(
      "MIIBkTCB+wIJAOq0m8gE9j4zMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnJvb3RDQTAeFw0yNjAxMDEwMDAwMDBaFw0zNjAxMDEwMDAwMDBaMBExDzANBgNVBAMMBnJvb3RDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMJv6hV0dWZ0",
    );
  });

  it("keeps ONC certificate GUIDs unique across policies", () => {
    const policy = compile([
      { kind: "mttx.android.certificate.corp", data: { pem }, policyId: "policy-a" },
      { kind: "mttx.android.certificate.corp", data: { pem }, policyId: "policy-b" },
    ]);
    const certificates = (
      policy.openNetworkConfiguration as { Certificates: Array<{ GUID: string }> }
    ).Certificates;

    expect(certificates.map((entry) => entry.GUID)).toEqual([
      "mattrax-policya-corp",
      "mattrax-policyb-corp",
    ]);
  });

  it("keeps an existing network configuration alongside the CA", () => {
    const policy = compile([
      {
        kind: "mttx.android.policy.wifi",
        data: {
          policy: {
            openNetworkConfiguration: {
              Type: "UnencryptedConfiguration",
              NetworkConfigurations: [{ GUID: "wifi", Name: "Corp" }],
            },
          },
        },
      },
      { kind: "mttx.android.certificate.corp", data: { pem } },
    ]);

    expect(policy.openNetworkConfiguration).toMatchObject({
      NetworkConfigurations: [{ GUID: "wifi", Name: "Corp" }],
      Certificates: [{ GUID: "mattrax-policy-corp" }],
    });
  });
});
