import { Effect, Match, Schema } from "effect";
import { CatalogueService, runCatalogue } from "~/lib/catalogue-service";
import type { Collection, PlatformId, Property, PropertyType } from "./catalog";

/**
 * Third-party application templates.
 *
 * The data (`/catalog/third-party-apps.json`) is generated from the vendors'
 * published managed-settings documentation: ProfileManifests (the manifests
 * behind iMazing Profile Editor and ProfileCreator) for Apple preferences,
 * Chrome/Edge ADMX through Microsoft's Policy CSP for Windows, and each app's
 * AppConfig schema for Android. Keeping it as data means adding an application
 * is a catalogue edit, not a new code path.
 *
 * An application's presence on a platform is what makes it offerable there: an
 * app with no Windows settings is not listed on the Windows tab.
 */

export const ThirdPartySettingType = Schema.Literals([
  "string",
  "integer",
  "real",
  "boolean",
  "array",
  "dictionary",
  "enum",
]);

export type ThirdPartySettingType = typeof ThirdPartySettingType.Type;

export const ThirdPartySetting = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  type: ThirdPartySettingType,
  description: Schema.String,
  default: Schema.optional(Schema.Json),
  enum: Schema.optional(
    Schema.Array(
      Schema.Struct({
        value: Schema.Json,
        label: Schema.String,
      }),
    ),
  ),
});

export type ThirdPartySetting = typeof ThirdPartySetting.Type;

export const ThirdPartyApple = Schema.Struct({
  bundleId: Schema.String,
  /** Managed preference domain (`com.google.Chrome`). */
  domain: Schema.String,
  settings: Schema.Array(ThirdPartySetting),
});

export const ThirdPartyWindows = Schema.Struct({
  settings: Schema.Array(
    Schema.Struct({
      ...ThirdPartySetting.fields,
      /** Full Policy CSP OMA-URI for the setting. */
      omaUri: Schema.String,
    }),
  ),
});

export const ThirdPartyAndroid = Schema.Struct({
  packageName: Schema.String,
  settings: Schema.Array(ThirdPartySetting),
});

export const ThirdPartyApp = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  vendor: Schema.String,
  description: Schema.String,
  apple: Schema.optional(ThirdPartyApple),
  windows: Schema.optional(ThirdPartyWindows),
  android: Schema.optional(ThirdPartyAndroid),
});

export type ThirdPartyApp = typeof ThirdPartyApp.Type;

export const ThirdPartyCatalog = Schema.Struct({
  version: Schema.Number,
  generatedAt: Schema.String,
  sources: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      url: Schema.String,
      license: Schema.optional(Schema.String),
    }),
  ),
  applications: Schema.Array(ThirdPartyApp),
});

export type ThirdPartyCatalog = typeof ThirdPartyCatalog.Type;

/** Load the catalogue through the Layer-owned, request-coalescing cache. */
export const loadThirdPartyApps = () =>
  runCatalogue(
    CatalogueService.pipe(
      Effect.flatMap((service) => service.get("/catalog/third-party-apps.json", ThirdPartyCatalog)),
    ),
  );

const settingType = (setting: ThirdPartySetting): PropertyType => {
  switch (setting.type) {
    case "enum":
      return "string";
    case "array":
      return "array";
    case "dictionary":
      return "dictionary";
    default:
      return setting.type;
  }
};

type MutableProperty = { -readonly [K in keyof Property]: Property[K] };

const toProperty = (setting: ThirdPartySetting, windowsOmaUri?: string): Property => {
  const property: MutableProperty = {
    key: setting.key,
    name: setting.name,
    type: settingType(setting),
    description: setting.description,
  };

  if (setting.default !== undefined) property.defaultValue = setting.default;

  if (setting.enum) {
    property.enum = setting.enum.map((option) => ({
      value: String(option.value),
      description: option.label,
    }));
  }

  if (windowsOmaUri) property.address = windowsOmaUri;

  return property;
};

export const thirdPartyAppCollectionId = (platform: PlatformId, appId: string) =>
  `thirdparty:${platform}:${appId}`;

/** Whether a collection id belongs to the third-party catalogue. */
export const isThirdPartyCollectionId = (id: string): boolean => id.startsWith("thirdparty:");

export const thirdPartyCollectionPlatform = (id: string): PlatformId | null => {
  const [, platform] = id.split(":");

  return platform === "apple" || platform === "windows" || platform === "android" ? platform : null;
};

/**
 * The designer's collection shape for one application on one platform.
 *
 * Apple settings become a `com.apple.ManagedClient.preferences` profile; Windows
 * settings are Policy CSP nodes; Android settings become the app's
 * `managedConfiguration` inside the policy's `applications` array.
 */
export const thirdPartyAppCollection = (
  app: ThirdPartyApp,
  platform: PlatformId,
): Collection | null => {
  if (platform === "apple") {
    if (!app.apple) return null;

    return {
      id: thirdPartyAppCollectionId(platform, app.id),
      platform,
      kind: "profile",
      surface: "Third-party apps",
      identifier: "com.apple.ManagedClient.preferences",
      name: app.name,
      description: `${app.vendor}: ${app.description}`,
      group: app.vendor,
      // Managed preferences are a macOS payload; iOS managed app config is
      // delivered by the install command, not a profile.
      osVersions: ["macOS"],
      properties: app.apple.settings.map((setting) => toProperty(setting)),
    };
  }

  if (platform === "windows") {
    if (!app.windows) return null;

    return {
      id: thirdPartyAppCollectionId(platform, app.id),
      platform,
      kind: "csp",
      surface: "Third-party apps",
      identifier: app.id,
      name: app.name,
      description: `${app.vendor}: ${app.description}`,
      group: app.vendor,
      properties: app.windows.settings.map((setting) => toProperty(setting, setting.omaUri)),
    };
  }

  if (!app.android) return null;

  return {
    id: thirdPartyAppCollectionId(platform, app.id),
    platform,
    kind: "policy",
    surface: "Third-party apps",
    identifier: app.id,
    name: app.name,
    description: `${app.vendor}: ${app.description}`,
    group: app.vendor,
    properties: app.android.settings.map((setting) => toProperty(setting)),
  };
};

export type ThirdPartySelectionTemplate = {
  readonly provider: "thirdparty-app";
  readonly appId: string;
  readonly bundleId?: string;
  readonly packageName?: string;
  readonly installType?: string;
};

/** The template a selection stores so its configuration can be compiled later. */
export const thirdPartySelectionTemplate = (
  app: ThirdPartyApp,
  platform: PlatformId,
): ThirdPartySelectionTemplate | undefined => {
  if (platform === "apple" && app.apple)
    return {
      provider: "thirdparty-app",
      appId: app.id,
      bundleId: app.apple.bundleId,
    };

  if (platform === "android" && app.android)
    return {
      provider: "thirdparty-app",
      appId: app.id,
      packageName: app.android.packageName,
      installType: "FORCE_INSTALLED",
    };

  if (platform === "windows" && app.windows) return { provider: "thirdparty-app", appId: app.id };

  return undefined;
};

/** Applications the catalogue offers for a platform, in display order. */
export const thirdPartyAppsForPlatform = (
  catalog: ThirdPartyCatalog,
  platform: PlatformId,
): ThirdPartyApp[] =>
  catalog.applications
    .filter((app) =>
      Match.value(platform).pipe(
        Match.when("apple", () => Boolean(app.apple)),
        Match.when("windows", () => Boolean(app.windows)),
        Match.orElse(() => Boolean(app.android)),
      ),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
