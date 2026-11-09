import { describe, expect, it } from "vitest";
import { buildAppleEnrollmentProfile } from "../enrollment.js";

/**
 * Adapted from Fleet's `server/mdm/apple/apple_mdm_test.go`:
 *   - TestGenerateEnrollmentProfileMobileconfig
 *   - TestEnrollmentProfileServerCapabilities
 *
 * Fleet's tests assert the generated profile contains one SCEP payload and one
 * MDM payload, that the MDM payload references the SCEP identity certificate,
 * and that the modern server capabilities are advertised.
 */
describe("Apple enrollment profile (Fleet parity)", () => {
  const build = () =>
    buildAppleEnrollmentProfile({
      origin: "https://mdm.example.com",
      topic: "com.apple.mgmt.External.example",
      organizationId: "org-123",
      organizationName: "Acme Corp",
      challenge: "org-123.challenge-signature",
    });

  it("generates one SCEP and one MDM payload", () => {
    const profile = build();
    expect(profile.PayloadType).toBe("Configuration");
    expect(profile.PayloadIdentifier).toBe("com.mattrax.enrollment");
    expect(profile.PayloadContent).toHaveLength(2);

    const types = profile.PayloadContent.map((payload) => payload.PayloadType);
    expect(types.filter((type) => type === "com.apple.security.scep")).toHaveLength(1);
    expect(types.filter((type) => type === "com.apple.mdm")).toHaveLength(1);
  });

  it("builds the SCEP payload with the per-enrollment challenge and tenant subject", () => {
    const profile = build();
    const scep = profile.PayloadContent.find(
      (payload) => payload.PayloadType === "com.apple.security.scep",
    )!;
    expect(scep.PayloadContent).toMatchObject({
      Challenge: "org-123.challenge-signature",
      "Key Type": "RSA",
      "Key Usage": 5,
      Keysize: 2048,
      URL: "https://mdm.example.com/mdm/apple/scep",
      Subject: [[["O", "Acme Corp"]], [["OU", "org-123"]], [["CN", "Acme Corp Identity"]]],
    });
  });

  it("builds the MDM payload and references the SCEP identity certificate", () => {
    const profile = build();
    const scep = profile.PayloadContent.find(
      (payload) => payload.PayloadType === "com.apple.security.scep",
    )!;
    const mdm = profile.PayloadContent.find((payload) => payload.PayloadType === "com.apple.mdm")!;

    expect(mdm).toMatchObject({
      AccessRights: 8191,
      CheckInURL: "https://mdm.example.com/mdm/apple/mdm",
      CheckOutWhenRemoved: true,
      IdentityCertificateUUID: scep.PayloadUUID,
      SignMessage: true,
      ServerURL: "https://mdm.example.com/mdm/apple/mdm",
      Topic: "com.apple.mgmt.External.example",
    });
  });

  it("advertises the server capabilities Fleet requires", () => {
    const profile = build();
    const mdm = profile.PayloadContent.find((payload) => payload.PayloadType === "com.apple.mdm")!;
    expect(mdm.ServerCapabilities).toEqual(
      expect.arrayContaining([
        "com.apple.mdm.per-user-connections",
        "com.apple.mdm.bootstraptoken",
        "com.apple.mdm.token",
      ]),
    );
  });

  it("uses the configured display name, identifier and organization", () => {
    const profile = buildAppleEnrollmentProfile({
      origin: "https://mdm.example.com/",
      topic: "topic",
      organizationId: "org",
      organizationName: "Acme",
      challenge: "challenge",
      displayName: "Acme Device Enrollment",
      identifier: "app.acme.enrollment",
    });

    expect(profile.PayloadDisplayName).toBe("Acme Device Enrollment");
    expect(profile.PayloadIdentifier).toBe("app.acme.enrollment");
    expect(profile.PayloadOrganization).toBe("Acme");
    expect((profile.PayloadContent[0]!.PayloadContent as Record<string, unknown>).URL).toBe(
      "https://mdm.example.com/mdm/apple/scep",
    );
  });
});
