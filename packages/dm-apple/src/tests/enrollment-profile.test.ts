import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { buildAppleEnrollmentProfile } from "../enrollment.js";

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

  it("advertises the required server capabilities", () => {
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

  it("points SCEP at the tenant CA endpoint", () => {
    const profile = build();

    const scep = profile.PayloadContent.find(
      (payload) => payload.PayloadType === "com.apple.security.scep",
    )!;

    // A path segment (not a query parameter) so SCEP clients can append
    // `?operation=...` without losing the tenant.
    expect(Schema.decodeUnknownSync(Schema.JsonObject)(scep.PayloadContent)["URL"]).toBe(
      "https://mdm.example.com/mdm/apple/scep/org-123",
    );
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
});
