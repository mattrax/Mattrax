import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { collectionProperties } from "./catalog";
import { buildAndroidPolicy, buildAppleProfile, buildWindowsNodes } from "./build";
import type { Draft } from "./build";
import {
  ThirdPartyCatalog,
  thirdPartyAppCollection,
  thirdPartyAppsForPlatform,
  thirdPartySelectionTemplate,
} from "./thirdPartyApps";

const catalog = Schema.decodeUnknownSync(ThirdPartyCatalog)(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../../../data/catalog/third-party-apps.json", import.meta.url)),
      "utf8",
    ),
  ),
);

const app = (id: string) => {
  const found = catalog.applications.find((entry) => entry.id === id);

  if (!found) throw new Error(`missing ${id}`);

  return found;
};

const settingKeys = (settings: ReadonlyArray<{ key: string }>) =>
  settings.map((setting) => setting.key);

describe("third-party application catalogue", () => {
  it("validates every entry and keeps ids unique", () => {
    expect(catalog.applications.length).toBeGreaterThanOrEqual(6);
    expect(new Set(catalog.applications.map((entry) => entry.id)).size).toBe(
      catalog.applications.length,
    );

    for (const entry of catalog.applications) {
      expect(entry.name.trim()).not.toBe("");
      expect(entry.vendor.trim()).not.toBe("");
      expect(entry.description.trim()).not.toBe("");
      expect(entry.apple ?? entry.windows ?? entry.android).toBeTruthy();

      if (entry.apple) {
        expect(entry.apple.bundleId).toMatch(/^[A-Za-z0-9._-]+$/);
        expect(entry.apple.domain).toMatch(/^[A-Za-z0-9._-]+$/);
        expect(new Set(settingKeys(entry.apple.settings)).size).toBe(entry.apple.settings.length);
        expect(settingKeys(entry.apple.settings).length).toBeGreaterThan(0);
      }

      if (entry.windows) {
        expect(settingKeys(entry.windows.settings).length).toBeGreaterThan(0);

        for (const setting of entry.windows.settings)
          expect(setting.omaUri.startsWith("./Device/Vendor/MSFT/Policy/Config/")).toBe(true);
      }

      if (entry.android) {
        expect(entry.android.packageName).toMatch(
          /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/,
        );
        expect(settingKeys(entry.android.settings).length).toBeGreaterThan(0);
      }

      for (const platform of [entry.apple, entry.windows, entry.android]) {
        if (!platform) continue;

        for (const setting of platform.settings) {
          if (!("enum" in setting) || !setting.enum) continue;

          expect(setting.type).toBe("enum");
          expect(setting.enum.length).toBeGreaterThan(0);
          expect(setting.enum.every((option) => option.label.trim().length > 0)).toBe(true);
        }
      }
    }
  });

  it("lists the applications the platform can actually configure", () => {
    const apple = thirdPartyAppsForPlatform(catalog, "apple").map((entry) => entry.id);
    const windows = thirdPartyAppsForPlatform(catalog, "windows").map((entry) => entry.id);
    const android = thirdPartyAppsForPlatform(catalog, "android").map((entry) => entry.id);

    expect(apple).toEqual(
      expect.arrayContaining(["google-chrome", "microsoft-edge", "slack", "zoom"]),
    );
    expect(windows).toEqual(expect.arrayContaining(["google-chrome", "microsoft-edge"]));
    expect(android).toEqual(expect.arrayContaining(["google-chrome", "microsoft-edge"]));
    expect(apple).not.toContain("not-an-app");
  });
});

describe("third-party application compilation", () => {
  it("builds an Apple managed preference payload for the app domain", () => {
    const chrome = app("google-chrome");
    const collection = thirdPartyAppCollection(chrome, "apple")!;
    const template = thirdPartySelectionTemplate(chrome, "apple")!;

    const profile = buildAppleProfile({
      version: 1,
      platform: "apple",
      name: "Chrome policy",
      selections: [
        {
          collectionId: collection.id,
          identifier: collection.identifier,
          kind: collection.kind,
          surface: collection.surface,
          name: collection.name,
          properties: collectionProperties(collection),
          values: {
            DefaultBrowserSettingEnabled: true,
            IncognitoModeAvailability: 1,
          },
          template,
        },
      ],
    });

    expect(profile.PayloadContent).toHaveLength(1);
    expect(profile.PayloadContent[0]).toMatchObject({
      PayloadType: "com.apple.ManagedClient.preferences",
      PayloadContent: {
        "com.google.Chrome": {
          Forced: [
            {
              mcx_preference_settings: {
                DefaultBrowserSettingEnabled: true,
                IncognitoModeAvailability: 1,
              },
            },
          ],
        },
      },
    });
  });

  it("builds Windows Policy CSP nodes from the catalogue addresses", () => {
    const chrome = app("google-chrome");
    const collection = thirdPartyAppCollection(chrome, "windows")!;

    const nodes = buildWindowsNodes({
      version: 1,
      platform: "windows",
      name: "Chrome policy",
      selections: [
        {
          collectionId: collection.id,
          identifier: collection.identifier,
          kind: collection.kind,
          surface: collection.surface,
          name: collection.name,
          properties: collectionProperties(collection),
          values: {
            "./Device/Vendor/MSFT/Policy/Config/Chrome~Policy~googlechrome/DefaultBrowserSettingEnabled": true,
            "./Device/Vendor/MSFT/Policy/Config/Chrome~Policy~googlechrome/MetricsReportingEnabled": false,
          },
          template: thirdPartySelectionTemplate(chrome, "windows"),
        },
      ],
    });

    expect(nodes).toEqual(
      expect.arrayContaining([
        {
          omaUri:
            "./Device/Vendor/MSFT/Policy/Config/Chrome~Policy~googlechrome/DefaultBrowserSettingEnabled",
          value: true,
          format: "int",
        },
        {
          omaUri:
            "./Device/Vendor/MSFT/Policy/Config/Chrome~Policy~googlechrome/MetricsReportingEnabled",
          value: false,
          format: "int",
        },
      ]),
    );
  });

  it("builds an Android application entry with managed configuration", () => {
    const chrome = app("google-chrome");
    const collection = thirdPartyAppCollection(chrome, "android")!;

    const policy = buildAndroidPolicy({
      version: 1,
      platform: "android",
      name: "Chrome policy",
      selections: [
        {
          collectionId: collection.id,
          identifier: collection.identifier,
          kind: collection.kind,
          surface: collection.surface,
          name: collection.name,
          properties: collectionProperties(collection),
          values: { PasswordManagerEnabled: false },
          template: thirdPartySelectionTemplate(chrome, "android"),
        },
      ],
    });

    expect(policy).toEqual({
      applications: [
        {
          packageName: "com.android.chrome",
          installType: "FORCE_INSTALLED",
          autoUpdateMode: "AUTO_UPDATE_DEFAULT",
          managedConfiguration: { PasswordManagerEnabled: false },
        },
      ],
    });
  });

  it("omits platforms an application does not document", () => {
    const slack = app("slack");

    expect(thirdPartyAppCollection(slack, "windows")).toBeNull();
    expect(thirdPartyAppCollection(slack, "android")).toBeNull();
    expect(thirdPartySelectionTemplate(slack, "windows")).toBeUndefined();
  });

  it("stores the template so a saved draft can be rehydrated", () => {
    const chrome = app("google-chrome");

    const draft: Draft = {
      version: 1,
      platform: "apple",
      name: "Draft",
      selections: [],
    };

    expect(draft.selections).toHaveLength(0);
    expect(thirdPartySelectionTemplate(chrome, "apple")).toMatchObject({
      provider: "thirdparty-app",
      appId: "google-chrome",
      bundleId: "com.google.Chrome",
    });
  });
});
