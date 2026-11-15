import { describe, expect, it } from "vitest";
import {
  APPLE_INSTALL_ASSET_TTL_SECONDS,
  appleInstallAssetExpiresAt,
  buildAppleManifest,
  buildInstallApplicationPayload,
  buildInstallEnterpriseApplicationPayload,
  isApplePackageUpload,
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
