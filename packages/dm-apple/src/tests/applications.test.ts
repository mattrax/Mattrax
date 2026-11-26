import { describe, expect, it } from "vitest";
import {
  APPLE_INSTALL_ASSET_TTL_SECONDS,
  appleInstallAssetExpiresAt,
  appleUploadKind,
  appleUploadSupportsDevice,
  buildAppleManifest,
  buildInstallApplicationPayload,
  buildInstallEnterpriseApplicationPayload,
  buildRemoveApplicationPayload,
  isAppleIpaUpload,
  isApplePackageUpload,
  isApplePackageUrl,
} from "../applications.js";

describe("Apple enterprise application commands", () => {
  it("builds a package manifest with a SHA-256 asset", () => {
    expect(
      buildAppleManifest({
        url: "https://mdm.test/mdm/apple/assets/asset?token=abc",
        sha256: "a".repeat(64),
        bundleId: "com.example.app",
        version: "1.2.3",
        title: "Example",
      }),
    ).toEqual({
      items: [
        {
          assets: [
            {
              kind: "software-package",
              url: "https://mdm.test/mdm/apple/assets/asset?token=abc",
              sha256: "a".repeat(64),
            },
          ],
          metadata: {
            "bundle-identifier": "com.example.app",
            "bundle-version": "1.2.3",
            kind: "software",
            title: "Example",
          },
        },
      ],
    });
  });

  it("builds an InstallEnterpriseApplication payload with managed app config", () => {
    const manifest = buildAppleManifest({
      url: "https://mdm.test/app.pkg",
      sha256: "b".repeat(64),
      bundleId: "com.example.app",
      version: "2.0",
      title: "Example",
    });

    expect(
      buildInstallEnterpriseApplicationPayload({
        manifest,
        configuration: { Key: "value" },
        managementFlags: 1,
      }),
    ).toEqual({
      Manifest: manifest,
      InstallAsManaged: true,
      ManagementFlags: 1,
      Configuration: { Key: "value" },
    });
  });

  it("builds App Store and manifest InstallApplication payloads", () => {
    expect(buildInstallApplicationPayload({ storeId: "123456789", managementFlags: 1 })).toEqual({
      iTunesStoreID: 123456789,
      InstallAsManaged: true,
      ManagementFlags: 1,
    });

    expect(
      buildInstallApplicationPayload({ manifestUrl: "https://example.test/app.plist" }),
    ).toEqual({
      ManifestURL: "https://example.test/app.plist",
      InstallAsManaged: true,
    });
  });

  it("refuses an InstallApplication payload with no target", () => {
    expect(() => buildInstallApplicationPayload({})).toThrow("exactly one");
    expect(() =>
      buildInstallApplicationPayload({
        storeId: "1",
        manifestUrl: "https://example.test/app.plist",
      }),
    ).toThrow("exactly one");
  });

  it("distinguishes a .pkg upload from an .ipa", () => {
    expect(isApplePackageUpload({ fileName: "App.pkg" })).toBe(true);
    expect(
      isApplePackageUpload({
        fileName: "App",
        contentType: "application/vnd.apple.installer+xml",
      }),
    ).toBe(true);
    expect(isApplePackageUpload({ fileName: "App.ipa" })).toBe(false);
    expect(isApplePackageUpload({ fileName: "App.zip" })).toBe(false);
    expect(
      isApplePackageUpload({ fileName: "App.ipa", contentType: "application/octet-stream" }),
    ).toBe(false);
  });

  it("classifies .pkg and .ipa uploads and the device each targets", () => {
    expect(appleUploadKind({ fileName: "App.pkg" })).toBe("pkg");
    expect(appleUploadKind({ fileName: "App.ipa" })).toBe("ipa");
    expect(appleUploadKind({ fileName: "App.zip" })).toBeUndefined();
    expect(appleUploadKind({ fileName: "App", contentType: "application/octet-stream" })).toBe(
      "pkg",
    );
    expect(isAppleIpaUpload({ fileName: "App.IPA" })).toBe(true);
    expect(isAppleIpaUpload({ fileName: "App.pkg" })).toBe(false);

    expect(appleUploadSupportsDevice({ fileName: "App.pkg", osEdition: "macOS" })).toBe(true);
    expect(appleUploadSupportsDevice({ fileName: "App.pkg", osEdition: "iOS" })).toBe(false);
    expect(appleUploadSupportsDevice({ fileName: "App.ipa", osEdition: "iOS" })).toBe(true);
    expect(appleUploadSupportsDevice({ fileName: "App.ipa", osEdition: "iPadOS" })).toBe(true);
    expect(appleUploadSupportsDevice({ fileName: "App.ipa", osEdition: "macOS" })).toBe(false);
    expect(appleUploadSupportsDevice({ fileName: "App.ipa", osEdition: "tvOS" })).toBe(false);
  });

  it("builds the OTA manifest InstallApplication payload for an .ipa", () => {
    expect(
      buildInstallApplicationPayload({
        manifestUrl: "https://mdm.test/mdm/apple/manifests/app.installer-1?token=abc",
        managementFlags: 1,
      }),
    ).toEqual({
      ManifestURL: "https://mdm.test/mdm/apple/manifests/app.installer-1?token=abc",
      InstallAsManaged: true,
      ManagementFlags: 1,
    });

    const manifest = buildAppleManifest({
      url: "https://mdm.test/mdm/apple/assets/app.installer-1?token=abc",
      sha256: "c".repeat(64),
      bundleId: "com.example.internal",
      version: "1.0",
      title: "Internal",
    });

    expect(manifest.items[0]).toEqual({
      assets: [
        {
          kind: "software-package",
          url: "https://mdm.test/mdm/apple/assets/app.installer-1?token=abc",
          sha256: "c".repeat(64),
        },
      ],
      metadata: {
        "bundle-identifier": "com.example.internal",
        "bundle-version": "1.0",
        kind: "software",
        title: "Internal",
      },
    });
  });

  it("builds a RemoveApplication payload by bundle id", () => {
    expect(buildRemoveApplicationPayload("com.example.internal")).toEqual({
      BundleIdentifier: "com.example.internal",
    });
  });

  it("rounds package URL expiry up to the next hour so commands de-duplicate", () => {
    const ttl = APPLE_INSTALL_ASSET_TTL_SECONDS;
    const first = appleInstallAssetExpiresAt(Date.UTC(2026, 0, 1, 10, 5, 0));
    const later = appleInstallAssetExpiresAt(Date.UTC(2026, 0, 1, 10, 55, 0));

    expect(first).toBe(Date.UTC(2026, 0, 1, 11, 0, 0) / 1000 + ttl);
    expect(later).toBe(first);
    expect(appleInstallAssetExpiresAt(Date.UTC(2026, 0, 1, 11, 0, 1))).toBe(
      Date.UTC(2026, 0, 1, 12, 0, 0) / 1000 + ttl,
    );
  });
});
describe("Apple package URL detection", () => {
  it("recognises an HTTPS vendor PKG", () => {
    expect(isApplePackageUrl("https://go.microsoft.com/fwlink/?linkid=2249065")).toBe(false);
    expect(isApplePackageUrl("https://zoom.us/client/latest/Zoom.pkg")).toBe(true);
    expect(isApplePackageUrl("https://example.test/App.PKG?download=1")).toBe(true);
  });

  it("rejects a manifest plist and a non-HTTPS URL", () => {
    expect(isApplePackageUrl("https://example.test/app.plist")).toBe(false);
    expect(isApplePackageUrl("http://example.test/app.pkg")).toBe(false);
    expect(isApplePackageUrl("not a url")).toBe(false);
  });
});
