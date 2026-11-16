import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { buildAppleAdeConfiguration, buildAppleEnrollmentProfile } from "../enrollment.js";

/**
 * The generated profile must contain one SCEP payload and one MDM payload, the
 * MDM payload must reference the SCEP identity certificate, and the modern
 * server capabilities must be advertised.
 */
describe("Apple enrollment profile", () => {
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
      URL: "https://mdm.example.com/mdm/apple/scep/org-123",
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

  it("advertises the server capabilities it implements", () => {
    const profile = build();
    const mdm = profile.PayloadContent.find((payload) => payload.PayloadType === "com.apple.mdm")!;
    expect(mdm.ServerCapabilities).toEqual([
      "com.apple.mdm.per-user-connections",
      "com.apple.mdm.bootstraptoken",
    ]);
    // `com.apple.mdm.token` makes devices send GetToken; the product does not
    // implement Apple's token services, so it must not be advertised.
    expect(mdm.ServerCapabilities).not.toContain("com.apple.mdm.token");
  });

  it("builds an Apple User Enrollment (BYOD) profile", () => {
    const profile = buildAppleEnrollmentProfile({
      origin: "https://mdm.example.com",
      topic: "com.apple.mgmt.External.example",
      organizationId: "tenant-1",
      organizationName: "Acme",
      challenge: "challenge-1",
      userEnrollment: { managedAppleAccount: "oscar@acme.example" },
    });

    const mdm = profile.PayloadContent.find((payload) => payload.PayloadType === "com.apple.mdm")!;

    expect(mdm).toMatchObject({
      AssignedManagedAppleID: "oscar@acme.example",
      EnrollmentMode: "BYOD",
      PayloadIdentifier: "com.mattrax.mdm",
      CheckOutWhenRemoved: true,
    });
    // Apple cancels the enrollment when a BYOD profile declares access rights.
    expect(mdm.AccessRights).toBeUndefined();
    expect(mdm.ServerCapabilities).toEqual(["com.apple.mdm.per-user-connections"]);
    expect(profile.PayloadIdentifier).toBe("com.mattrax.enrollment.user");
    expect(profile.PayloadUUID).toBe("C3D4E5F6-A7B8-4C9D-8E0F-1A2B3C4D5E6F");
  });

  it("uses stable payload UUIDs across re-serves", () => {
    const first = build();
    const second = build();
    expect(second.PayloadUUID).toBe(first.PayloadUUID);

    for (let index = 0; index < first.PayloadContent.length; index++) {
      expect(second.PayloadContent[index]!.PayloadUUID).toBe(
        first.PayloadContent[index]!.PayloadUUID,
      );
    }

    expect(first.PayloadUUID).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
    );
  });

  it("uses the configured display name, identifier and organization", () => {
    const profile = buildAppleEnrollmentProfile({
      origin: "https://mdm.example.com/",
      topic: "topic",
      organizationId: "org",
      organizationName: "Acme",
      supportEmail: "help@acme.test",
      challenge: "challenge",
      displayName: "Acme Device Enrollment",
      identifier: "app.acme.enrollment",
    });

    expect(profile.PayloadDisplayName).toBe("Acme Device Enrollment");
    expect(profile.PayloadIdentifier).toBe("app.acme.enrollment");
    expect(profile.PayloadOrganization).toBe("Acme");
    expect(profile.PayloadDescription).toBe(
      "Enrollment profile for Acme. Contact help@acme.test for support.",
    );
    const scepPayload = profile.PayloadContent[0];

    if (!scepPayload) throw new Error("profile must have an SCEP payload");

    const scepContent = scepPayload["PayloadContent"];

    if (!Schema.is(Schema.JsonObject)(scepContent))
      throw new Error("SCEP payload must have content");

    expect(scepContent["URL"]).toBe("https://mdm.example.com/mdm/apple/scep/org");
  });

  it("accepts an explicit SCEP URL override", () => {
    const profile = buildAppleEnrollmentProfile({
      origin: "https://mdm.example.com",
      topic: "topic",
      organizationId: "org",
      organizationName: "Acme",
      challenge: "challenge",
      scepUrl: "https://scep.example.com/acme",
    });

    expect(
      Schema.decodeUnknownSync(Schema.JsonObject)(profile.PayloadContent[0]!.PayloadContent)["URL"],
    ).toBe("https://scep.example.com/acme");
  });

  it("keeps stable identifiers when only the branding changes", () => {
    const base = {
      origin: "https://mdm.example.com",
      topic: "topic",
      organizationId: "org",
      challenge: "challenge",
    };

    const first = buildAppleEnrollmentProfile({ ...base, organizationName: "Acme" });

    const rebranded = buildAppleEnrollmentProfile({
      ...base,
      organizationName: "Acme Corp",
      supportEmail: "help@acme.test",
    });

    expect(rebranded.PayloadIdentifier).toBe(first.PayloadIdentifier);
    expect(rebranded.PayloadUUID).toBe(first.PayloadUUID);
    expect(rebranded.PayloadContent.map((payload) => payload.PayloadUUID)).toEqual(
      first.PayloadContent.map((payload) => payload.PayloadUUID),
    );
    expect(rebranded.PayloadContent.map((payload) => payload.PayloadIdentifier)).toEqual(
      first.PayloadContent.map((payload) => payload.PayloadIdentifier),
    );
    expect(rebranded.PayloadDisplayName).toBe("Acme Corp Enrollment");
    expect(rebranded.PayloadOrganization).toBe("Acme Corp");
  });

  it("does not put AwaitingConfiguration in the MDM payload", () => {
    // `await_device_configured` is a key of Apple's ADE cloud configuration,
    // not of `com.apple.mdm`. The device reports AwaitingConfiguration in its
    // TokenUpdate; the profile cannot request it.
    const mdm = build().PayloadContent.find((payload) => payload.PayloadType === "com.apple.mdm")!;

    expect(mdm).not.toHaveProperty("AwaitingConfiguration");
  });
});

describe("Apple ADE cloud configuration", () => {
  it("awaits configuration and enables Return to Service", () => {
    const configuration = buildAppleAdeConfiguration({
      url: "https://mdm.example.com/api/v1/abm/ade/enroll",
      profileName: "Acme ADE",
      organizationName: "Acme Corp",
      supportEmail: "help@acme.test",
      skipSetupItems: ["AppleID", "TOS"],
    });

    expect(configuration).toMatchObject({
      profile_name: "Acme ADE",
      url: "https://mdm.example.com/api/v1/abm/ade/enroll",
      is_supervised: true,
      is_mdm_removable: false,
      is_mandatory: true,
      await_device_configured: true,
      is_return_to_service: false,
      support_email_address: "help@acme.test",
      skip_setup_items: ["AppleID", "TOS"],
    });

    expect(
      buildAppleAdeConfiguration({
        url: "https://mdm.example.com/enroll",
        profileName: "RTS",
        returnToService: true,
      }).is_return_to_service,
    ).toBe(true);
  });

  it("requires an https URL", () => {
    expect(() =>
      buildAppleAdeConfiguration({ url: "http://mdm.example.com/enroll", profileName: "Acme" }),
    ).toThrow(/https/);
  });
});
