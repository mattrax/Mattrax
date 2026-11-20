import { describe, expect, it } from "vitest";
import { buildAdmxCatalogueIndex, matchAdmxCataloguePolicy } from "./index.js";

const collections = [
  {
    id: "windows/settings/access-denied-assistance",
    properties: [
      {
        address:
          "./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/AccessDeniedConfiguration",
      },
      {
        address: "./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/EnableShellAccessCheck",
      },
      {
        // Same address repeated for another element of the same policy.
        address: "./Device/Vendor/MSFT/Policy/Config/ADMX_srmfci/AccessDeniedConfiguration",
      },
      { address: "./Device/Vendor/MSFT/Policy/Config/AboveLock/AllowCortanaAboveLock" },
      { address: "./Device/Vendor/MSFT/Policy/Config/ADMX_Desktop/Vector_{0}" },
    ],
  },
  {
    id: "windows/settings/tablet-shell",
    properties: [
      {
        address: "./Device/Vendor/MSFT/Policy/Config/ADMX_TabletShell/DisableInkball_2",
      },
      { address: "./User/Vendor/MSFT/Policy/Config/ADMX_TabletShell/DisableInkball_1" },
    ],
  },
  {
    id: "windows/settings/desktop",
    properties: [
      { address: "./Device/Vendor/MSFT/Policy/Config/ADMX_Desktop/AD_QueryLimit" },
      { address: "./User/Vendor/MSFT/Policy/Config/ADMX_Desktop/AD_QueryLimit" },
    ],
  },
  {
    id: "windows/settings/device-installation",
    group: "Administrative Templates",
    properties: [
      {
        address:
          "./Device/Vendor/MSFT/Policy/Config/DeviceInstallation/PreventInstallationOfMatchingDeviceSetupClasses",
      },
    ],
  },
  {
    id: "windows/settings/above-lock",
    // A normal CSP collection is not grouped as administrative templates.
    properties: [{ address: "./Device/Vendor/MSFT/Policy/Config/AboveLock/AllowToasts" }],
  },
];

describe("buildAdmxCatalogueIndex", () => {
  it("indexes ADMX addresses and ignores everything else", () => {
    const index = buildAdmxCatalogueIndex(collections);

    expect(Object.keys(index.policies).sort()).toEqual([
      "accessdeniedconfiguration",
      "ad_querylimit",
      "disableinkball_1",
      "disableinkball_2",
      "enableshellaccesscheck",
      "preventinstallationofmatchingdevicesetupclasses",
    ]);

    expect(index.policies.accessdeniedconfiguration).toEqual([
      {
        area: "ADMX_srmfci",
        scope: "device",
        collectionId: "windows/settings/access-denied-assistance",
        policyName: "AccessDeniedConfiguration",
      },
    ]);
    expect(index.policies.allowtoasts).toBeUndefined();
    expect(index.policies["vector_{0}"]).toBeUndefined();
    // Areas without the ADMX_ prefix are indexed when the catalogue groups them
    // as administrative templates.
    expect(index.policies.preventinstallationofmatchingdevicesetupclasses).toEqual([
      {
        area: "DeviceInstallation",
        scope: "device",
        collectionId: "windows/settings/device-installation",
        policyName: "PreventInstallationOfMatchingDeviceSetupClasses",
      },
    ]);
  });

  it("is deterministic and versioned", () => {
    const first = JSON.stringify(buildAdmxCatalogueIndex(collections));
    const second = JSON.stringify(buildAdmxCatalogueIndex(collections));

    expect(first).toBe(second);
    expect(buildAdmxCatalogueIndex([])).toEqual({ version: 1, policies: {} });
  });
});

describe("matchAdmxCataloguePolicy", () => {
  const index = buildAdmxCatalogueIndex(collections);

  it("matches by name and class", () => {
    expect(
      matchAdmxCataloguePolicy(
        { name: "AccessDeniedConfiguration", className: "machine" },
        index,
      ),
    ).toEqual({
      status: "matched",
      entry: expect.objectContaining({ area: "ADMX_srmfci", scope: "device" }),
    });

    expect(
      matchAdmxCataloguePolicy({ name: "DisableInkball_1", className: "user" }, index),
    ).toEqual({
      status: "matched",
      entry: expect.objectContaining({ area: "ADMX_TabletShell", scope: "user" }),
    });
  });

  it("does not match the wrong scope", () => {
    expect(
      matchAdmxCataloguePolicy({ name: "DisableInkball_1", className: "machine" }, index),
    ).toMatchObject({ status: "unmatched" });
  });

  it("matches ADMX-backed areas that are not prefixed ADMX_", () => {
    expect(
      matchAdmxCataloguePolicy(
        {
          name: "PreventInstallationOfMatchingDeviceSetupClasses",
          className: "machine",
          fileName: "deviceinstallation.admx",
        },
        index,
      ),
    ).toEqual({
      status: "matched",
      entry: expect.objectContaining({ area: "DeviceInstallation", scope: "device" }),
    });
  });

  it("breaks a name tie with the template namespace", () => {
    expect(
      matchAdmxCataloguePolicy(
        {
          name: "AD_QueryLimit",
          className: "machine",
          namespace: "Microsoft.Policies.Desktop",
        },
        index,
      ),
    ).toEqual({
      status: "matched",
      entry: expect.objectContaining({ area: "ADMX_Desktop", scope: "device" }),
    });
  });

  it("matches a Both-class policy on the device scope", () => {
    expect(
      matchAdmxCataloguePolicy({ name: "AD_QueryLimit", className: "both" }, index),
    ).toMatchObject({ status: "matched", entry: { scope: "device" } });
  });

  it("explains why an unmatched or ambiguous policy cannot be mapped", () => {
    expect(
      matchAdmxCataloguePolicy({ name: "NotInCatalogue", className: "machine" }, index),
    ).toEqual({
      status: "unmatched",
      reason: expect.stringMatching(/not exposed by the Windows settings catalogue/),
    });

    const ambiguousIndex = {
      version: 1 as const,
      policies: {
        ad_querylimit: [
          {
            area: "ADMX_One",
            scope: "device" as const,
            collectionId: "one",
            policyName: "AD_QueryLimit",
          },
          {
            area: "ADMX_Two",
            scope: "device" as const,
            collectionId: "two",
            policyName: "AD_QueryLimit",
          },
        ],
      },
    };

    expect(
      matchAdmxCataloguePolicy({ name: "AD_QueryLimit", className: "machine" }, ambiguousIndex),
    ).toEqual({ status: "unmatched", reason: expect.stringMatching(/matches 2 catalogue areas/) });
  });

  it("reports a missing lookup instead of guessing", () => {
    expect(
      matchAdmxCataloguePolicy({ name: "AccessDeniedConfiguration", className: "machine" }, undefined),
    ).toEqual({ status: "unmatched", reason: expect.stringMatching(/lookup could not be loaded/) });
  });
});
