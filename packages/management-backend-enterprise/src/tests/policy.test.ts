import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { verifyAppleAssetToken, verifyAppleProfileToken } from "@mattrax/dm-apple";
import {
  buildAssetDeclaration,
  buildConfigurationDeclaration,
  buildLegacyProfile,
  certificateAllowsOrganization,
  configurationAssetIdentifier,
  configurationProfileUrl,
  configurationServerToken,
  parseAppleApplicationConfiguration,
  splitConfigurationAssetIdentifier,
  splitConfigurationDeclarationIdentifier,
  validateConfiguration,
  windowsPolicyNodes,
  type DeclarationContext,
  type PolicyConfigurationRow,
} from "../policy.js";

const context: DeclarationContext = {
  origin: "https://mdm.example.com",
  authSecret: "test-secret",
  deviceToken: "device-token-1",
  deviceId: "device-1",
  // Fixed clock keeps the expiring asset URL deterministic.
  now: 1_700_000_000_000,
};

const row = (overrides: Partial<PolicyConfigurationRow> = {}): PolicyConfigurationRow => ({
  policyId: "policy-1",
  kind: "mttx.apple.device",
  data: { camera: false },
  hash: "hash-1",
  organizationId: "tenant-1",
  ...overrides,
});

const mobileconfig = (payloadTypes: string[]) => {
  const payloads = payloadTypes
    .map(
      (type) =>
        `<dict><key>PayloadType</key><string>${type}</string><key>PayloadIdentifier</key><string>test.${type}</string></dict>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadIdentifier</key><string>test.profile</string><key>PayloadDisplayName</key><string>Test profile</string><key>PayloadUUID</key><string>11111111-1111-1111-1111-111111111111</string><key>PayloadVersion</key><integer>1</integer><key>PayloadContent</key><array>${payloads}</array></dict></plist>`;

  return btoa(xml);
};

const certificatePem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("enterprise policy compiler", () => {
  it("maps device kinds to a legacy profile declaration", async () => {
    const declaration = await buildConfigurationDeclaration(row(), context);
    expect(declaration).toMatchObject({
      Type: "com.apple.configuration.legacy",
      Identifier: "policy-1:mttx.apple.device",
    });
    const profileUrl = Schema.decodeUnknownSync(Schema.String)(declaration!.Payload.ProfileURL);
    const url = new URL(profileUrl);
    expect(url.origin).toBe("https://mdm.example.com");
    expect(url.pathname).toBe("/mdm/apple/profiles/device-token-1/policy-1/mttx.apple.device");
    const token = url.searchParams.get("token")!;
    await expect(
      verifyAppleProfileToken(context.authSecret, token, {
        policyId: "policy-1",
        kind: "mttx.apple.device",
        deviceToken: "device-token-1",
      }),
    ).resolves.toBe(true);
    // A token for one device is not valid for another.
    await expect(
      verifyAppleProfileToken(context.authSecret, token, {
        policyId: "policy-1",
        kind: "mttx.apple.device",
        deviceToken: "device-token-2",
      }),
    ).resolves.toBe(false);
  });

  it("maps certificate kinds to an asset plus security.certificate declaration", async () => {
    const certificate = row({
      kind: "mttx.apple.certificate.root",
      data: { pem: certificatePem },
      hash: "cert-hash",
    });

    const declaration = await buildConfigurationDeclaration(certificate, context);
    expect(declaration).toMatchObject({
      Type: "com.apple.configuration.security.certificate",
      Identifier: "policy-1:mttx.apple.certificate.root",
      Payload: {
        CredentialAssetReference: configurationAssetIdentifier(
          "policy-1",
          "mttx.apple.certificate.root",
        ),
      },
    });

    const asset = await buildAssetDeclaration(certificate, context);
    expect(asset).toMatchObject({
      Type: "com.apple.asset.credential.certificate",
      Identifier: "policy-1.mttx.apple.certificate.root.asset",
    });
    const reference = Schema.decodeUnknownSync(Schema.JsonObject)(asset!.Payload.Reference);
    expect(reference.ContentType).toBe("application/pem");
    const assetUrl = Schema.decodeUnknownSync(Schema.String)(reference.DataURL);
    const url = new URL(assetUrl);
    expect(url.pathname).toBe("/mdm/apple/assets/policy-1.mttx.apple.certificate.root.asset");
    const token = url.searchParams.get("token")!;
    await expect(
      verifyAppleAssetToken(
        context.authSecret,
        token,
        { policyId: "policy-1", kind: "mttx.apple.certificate.root" },
        context.now,
      ),
    ).resolves.toMatchObject({
      policyId: "policy-1",
      kind: "mttx.apple.certificate.root",
      deviceId: "device-1",
    });
    await expect(
      verifyAppleAssetToken(
        context.authSecret,
        token,
        { policyId: "policy-1", kind: "mttx.apple.certificate.other" },
        context.now,
      ),
    ).resolves.toBeNull();
  });

  it("expires asset links and refreshes their declaration token", async () => {
    const certificate = row({
      kind: "mttx.apple.certificate.root",
      data: { pem: certificatePem },
      hash: "cert-hash",
    });

    const declaration = await buildAssetDeclaration(certificate, context);
    const reference = Schema.decodeUnknownSync(Schema.JsonObject)(declaration!.Payload.Reference);
    const assetUrl = Schema.decodeUnknownSync(Schema.String)(reference.DataURL);
    const token = new URL(assetUrl).searchParams.get("token")!;

    const expiry = verifyAppleAssetToken(
      context.authSecret,
      token,
      { policyId: "policy-1", kind: "mttx.apple.certificate.root" },
      context.now!,
    );

    await expect(expiry).resolves.not.toBeNull();

    // Two hours later the same link is rejected.
    await expect(
      verifyAppleAssetToken(
        context.authSecret,
        token,
        { policyId: "policy-1", kind: "mttx.apple.certificate.root" },
        context.now! + 2 * 60 * 60 * 1000,
      ),
    ).resolves.toBeNull();

    // A later sync produces a different ServerToken (so the device re-fetches
    // the declaration) and a token that is valid again.
    const refreshed = await buildAssetDeclaration(certificate, {
      ...context,
      now: context.now! + 60 * 60 * 1000,
    });

    expect(refreshed!.ServerToken).not.toBe(declaration!.ServerToken);
  });

  it("passes through custom declarations with the supplied kind", async () => {
    const declaration = await buildConfigurationDeclaration(
      row({
        kind: "mttx.apple.declaration.files",
        data: {
          kind: "com.apple.configuration.services.configuration-files",
          configuration: { ServiceType: "com.apple.servicemanagement" },
        },
      }),
      context,
    );

    expect(declaration).toMatchObject({
      Type: "com.apple.configuration.services.configuration-files",
      Payload: { ServiceType: "com.apple.servicemanagement" },
    });
  });

  it("never emits the legacy com.apple.configuration.mttx.* type", async () => {
    const declaration = await buildConfigurationDeclaration(row(), context);
    expect(declaration!.Type.startsWith("com.apple.configuration.mttx")).toBe(false);
  });

  it("recomputes server tokens when content changes", async () => {
    const first = await configurationServerToken(row({ hash: "hash-1" }), context);
    const second = await configurationServerToken(row({ hash: "hash-2" }), context);
    expect(first).not.toBe(second);
  });

  it("includes origin and device token in legacy profile tokens", async () => {
    const otherDevice = await configurationServerToken(row(), { ...context, deviceToken: "other" });
    expect(await configurationServerToken(row(), context)).not.toBe(otherDevice);
  });

  it("renders the device camera restriction as a legacy mobileconfig", async () => {
    const profile = await buildLegacyProfile(row({ data: { camera: false } }));
    expect(profile?.contentType).toBe("application/x-apple-aspen-config");
    const text = new TextDecoder().decode(profile!.content);
    expect(text).toContain("com.apple.applicationaccess");
    expect(text).toContain("<key>allowCamera</key><false/>");
  });

  it("renders custom mobileconfigs verbatim", async () => {
    const content = mobileconfig(["com.apple.wifi.managed"]);

    const profile = await buildLegacyProfile(
      row({ kind: "mttx.apple.custom.wifi", data: { content } }),
    );

    const text = new TextDecoder().decode(profile!.content);
    expect(text).toContain("com.apple.wifi.managed");
    expect(profile?.contentType).toBe("application/x-apple-aspen-config");
  });

  it("builds signed profile URLs", async () => {
    const url = new URL(await configurationProfileUrl(row(), context));
    expect(url.searchParams.get("token")).toBeTruthy();
  });

  it("splits declaration and asset identifiers", () => {
    expect(splitConfigurationDeclarationIdentifier("policy-1:mttx.apple.custom.foo")).toEqual({
      policyId: "policy-1",
      kind: "mttx.apple.custom.foo",
    });
    expect(splitConfigurationAssetIdentifier("policy-1.mttx.apple.certificate.root.asset")).toEqual(
      {
        policyId: "policy-1",
        kind: "mttx.apple.certificate.root",
      },
    );
  });

  it("rejects cross-tenant asset access", () => {
    expect(certificateAllowsOrganization("CN=device, OU=tenant-1", "tenant-1")).toBe(true);
    expect(certificateAllowsOrganization("CN=device, OU=tenant-2", "tenant-1")).toBe(false);
    expect(certificateAllowsOrganization(undefined, "tenant-1")).toBe(false);
  });
});

describe("policy configuration validation", () => {
  const validate = (kind: string, data: Schema.Json) =>
    Effect.runPromise(validateConfiguration(kind, data).pipe(Effect.flip));

  it("accepts supported kinds", async () => {
    await expect(
      validateConfiguration("mttx.apple.device", { camera: false }).pipe(Effect.runPromise),
    ).resolves.toBeUndefined();
    await expect(
      validateConfiguration("mttx.apple.certificate.root", { pem: certificatePem }).pipe(
        Effect.runPromise,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects unknown kinds", async () => {
    await expect(validate("passcode", { minLength: 8 })).resolves.toContain(
      "Unknown configuration kind",
    );
  });

  it("rejects an application kind that cannot be installed", async () => {
    await expect(
      validate("mttx.apple.application.office", { fileName: "Office.pkg" }),
    ).resolves.toContain("must reference an applicationId or describe an installable Apple app");
  });

  it("accepts a policy-uploaded .pkg application", async () => {
    await expect(
      validateConfiguration("mttx.apple.application.office", {
        source: "upload",
        sha256: "a".repeat(64),
        fileName: "Office.pkg",
        contentType: "application/vnd.apple.installer+xml",
        bundleId: "com.microsoft.Office",
        version: "16.0",
        title: "Microsoft Office",
        configuration: { AllowedDomain: "example.com" },
      }).pipe(Effect.runPromise),
    ).resolves.toBeUndefined();
  });

  it("rejects an uploaded .ipa, which needs an OTA manifest", async () => {
    await expect(
      validate("mttx.apple.application.ios", {
        source: "upload",
        sha256: "b".repeat(64),
        fileName: "App.ipa",
        bundleId: "com.example.app",
        version: "1.0",
      }),
    ).resolves.toContain("must reference an applicationId");
  });

  it("parses the three inline Apple application sources", () => {
    expect(
      parseAppleApplicationConfiguration({
        source: "manifest",
        manifestUrl: "https://example.test/app.plist",
        bundleId: "com.example.app",
        version: "1.2",
      }),
    ).toMatchObject({ type: "inline", source: "manifest", bundleId: "com.example.app" });

    expect(
      parseAppleApplicationConfiguration({ storeId: "123456789", bundleId: "com.example.app" }),
    ).toMatchObject({ type: "inline", source: "store", storeId: "123456789", version: "0" });

    expect(
      parseAppleApplicationConfiguration({ applicationId: "app-1", configuration: { a: 1 } }),
    ).toMatchObject({ type: "catalogue", applicationId: "app-1" });
  });

  it("rejects custom profiles that contain an MDM payload", async () => {
    await expect(
      validate("mttx.apple.custom.mdm", { content: mobileconfig(["com.apple.mdm"]) }),
    ).resolves.toContain("com.apple.mdm");
  });

  it("validates and extracts Windows OMA-URI nodes", async () => {
    await expect(
      validateConfiguration("mttx.windows.custom.policy", {
        nodes: [
          { omaUri: "./Vendor/MSFT/Policy/Config/DeviceLock/AllowSimpleDevicePassword", value: 1 },
          {
            omaUri: "./Vendor/MSFT/Policy/Config/Connectivity/AllowBluetooth",
            value: "2",
            format: "chr",
          },
        ],
      }).pipe(Effect.runPromise),
    ).resolves.toBeUndefined();
    expect(
      windowsPolicyNodes({
        policyId: "policy-1",
        kind: "mttx.windows.custom.policy",
        data: { nodes: [{ omaUri: "./Vendor/MSFT/Reboot/1/RebootNow", value: "" }] },
        hash: "hash",
      }),
    ).toEqual([{ omaUri: "./Vendor/MSFT/Reboot/1/RebootNow", value: "" }]);
  });

  it("rejects malformed Windows OMA-URI nodes", async () => {
    await expect(
      validate("mttx.windows.custom.policy", { omaUri: "Vendor/MSFT/missing-prefix", value: 1 }),
    ).resolves.toContain('starting with "./"');
    await expect(
      validate("mttx.windows.custom.policy", {
        omaUri: "./Vendor/MSFT/x",
        value: 1,
        format: "nope",
      }),
    ).resolves.toContain("format");
  });

  it("rejects mobileconfigs missing required top-level fields", async () => {
    const valid = atob(mobileconfig([]));

    const withoutDisplayName = valid.replace(
      "<key>PayloadDisplayName</key><string>Test profile</string>",
      "",
    );

    await expect(
      validate("mttx.apple.custom.profile", { content: btoa(withoutDisplayName) }),
    ).resolves.toContain("PayloadDisplayName");

    const badScope = valid.replace(
      "<key>PayloadIdentifier</key><string>test.profile</string>",
      "<key>PayloadIdentifier</key><string>test.profile</string><key>PayloadScope</key><string>Device</string>",
    );

    await expect(
      validate("mttx.apple.custom.profile", { content: btoa(badScope) }),
    ).resolves.toContain("PayloadScope");
  });

  it("rejects malformed certificates", async () => {
    await expect(
      validate("mttx.apple.certificate.root", { pem: "not a certificate" }),
    ).resolves.toContain("exactly one PEM certificate");
  });
});
