import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  collectionFileKey,
  loadCollection,
  loadManifest,
  loadPlatform,
  loadPlatformIndex,
  loadSearchIndex,
  resetPlatformCache,
  searchCollections,
  searchIndexProperties,
  type CatalogManifest,
  type Collection,
  type PlatformData,
  type PlatformIndex,
  type SearchIndex,
} from "./catalog";

const windowsCollection = (id: string, name: string): Collection => ({
  id,
  platform: "windows",
  kind: "csp",
  surface: "settings",
  identifier: id.split("/").at(-1)!,
  name,
  description: `${name} description`,
  properties: [
    {
      key: "AllowCortanaAboveLock",
      name: "Allow Cortana Above Lock",
      type: "enum",
      description: "Added in Windows 10. Specifies whether Cortana works while locked.",
      address: `./Device/Vendor/MSFT/Policy/Config/${name}/AllowCortanaAboveLock`,
    },
    {
      key: "AllowActionCenterNotifications",
      name: "Allow Action Center Notifications",
      type: "boolean",
      description: "Turns notifications on the lock screen on or off.",
      address: `./Device/Vendor/MSFT/Policy/Config/${name}/AllowActionCenterNotifications`,
    },
  ],
});

const appleData: PlatformData = {
  id: "apple",
  collections: [
    {
      id: "apple/profiles/com.apple.applicationaccess",
      platform: "apple",
      kind: "profile",
      surface: "profiles",
      identifier: "com.apple.applicationaccess",
      name: "Restrictions",
      description: "Device restrictions",
      properties: [
        {
          key: "allowCamera",
          name: "Allow Camera",
          type: "boolean",
          description: "Allow the camera.",
        },
      ],
    },
  ],
};

const androidData: PlatformData = {
  id: "android",
  collections: [
    {
      id: "android/policy/Policy",
      platform: "android",
      kind: "policy",
      surface: "policy",
      identifier: "Policy",
      name: "Policy",
      description: "",
      properties: [
        {
          key: "cameraDisabled",
          name: "Disable the camera",
          type: "boolean",
          description: "Disable the camera.",
          // Android addresses are not the identity selections store.
          address: "cameraDisabled",
        },
      ],
    },
  ],
};

const manifest: CatalogManifest = {
  generatedAt: "2024-01-01T00:00:00Z",
  sources: [],
  platforms: [
    { id: "apple", name: "Apple", short: "Apple", description: "", docUrl: "" },
    { id: "android", name: "Android", short: "Android", description: "", docUrl: "" },
    { id: "windows", name: "Windows", short: "Windows", description: "", docUrl: "" },
  ],
  stats: {
    apple: { collections: 1, properties: 1 },
    android: { collections: 0, properties: 0 },
    windows: { collections: 2, properties: 4 },
  },
  collections: [],
};

const responses = new Map<
  string,
  CatalogManifest | PlatformData | Collection | PlatformIndex | SearchIndex
>([
  ["/catalog/manifest.json", manifest],
  ["/catalog/apple.json", appleData],
  ["/catalog/android.json", androidData],
  [
    "/catalog/windows/index.json",
    {
      platform: "windows",
      stats: { collections: 2, properties: 4 },
      collections: [
        {
          key: collectionFileKey("windows/settings/above-lock"),
          id: "windows/settings/above-lock",
          platform: "windows",
          kind: "csp",
          surface: "settings",
          identifier: "above-lock",
          name: "Above Lock",
          propertyCount: 2,
        },
        {
          key: collectionFileKey("windows/settings/defender"),
          id: "windows/settings/defender",
          platform: "windows",
          kind: "csp",
          surface: "settings",
          identifier: "defender",
          name: "Defender",
          group: "Security",
          deprecated: true,
          propertyCount: 2,
        },
      ],
    },
  ],
  [
    `/catalog/windows/${collectionFileKey("windows/settings/above-lock")}.json`,
    windowsCollection("windows/settings/above-lock", "Above Lock"),
  ],
  [
    "/catalog/windows/search.json",
    {
      platform: "windows",
      collections: {
        "windows/settings/above-lock": [
          [
            "./Device/Vendor/MSFT/Policy/Config/AboveLock/AllowCortanaAboveLock",
            "allow cortana above lock ./device/vendor/msft/policy/config/abovelock/allowcortanaabovelock added in windows 10. specifies whether cortana works while locked.",
          ],
        ],
        "windows/settings/defender": [
          [
            "./Device/Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring",
            "allow realtime monitoring ./device/vendor/msft/policy/config/defender/allowrealtimemonitoring defender antivirus",
          ],
        ],
      },
    },
  ],
]);

const installFetch = (overrides: Record<string, () => Response | Promise<Response>> = {}) => {
  const calls: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const override = overrides[url];

    if (override) return override();
    const body = responses.get(url);

    if (body === undefined) return new Response("not found", { status: 404 });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);

  return calls;
};

describe("policy catalogue loaders", () => {
  beforeEach(() => {
    for (const platform of ["apple", "android", "windows"] as const) resetPlatformCache(platform);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the Windows index without any collection payload", async () => {
    const calls = installFetch();
    const index = await loadPlatformIndex("windows");

    expect(index.platform).toBe("windows");
    expect(index.stats).toEqual({ collections: 2, properties: 4 });
    expect(index.collections.map((collection) => collection.name)).toEqual([
      "Above Lock",
      "Defender",
    ]);
    // Summaries are tagged with the platform so browse can filter uniformly.
    expect(index.collections.every((collection) => collection.platform === "windows")).toBe(true);
    expect(index.collections[1]?.key).toBe("windows--settings--defender");
    expect(calls).toEqual(["/catalog/windows/index.json"]);
  });

  it("loads a single collection by its stable file key and caches it", async () => {
    const calls = installFetch();
    const collection = await loadCollection("windows", "windows/settings/above-lock");
    const again = await loadCollection("windows", "windows/settings/above-lock");

    expect(collection.name).toBe("Above Lock");
    expect(collection.properties).toHaveLength(2);
    expect(again).toBe(collection);
    expect(calls).toEqual(["/catalog/windows/windows--settings--above-lock.json"]);
  });

  it("searches property text from the lazy search index", async () => {
    installFetch();
    const index = await loadSearchIndex("windows");

    expect([...searchIndexProperties(index, "cortana").keys()]).toEqual([
      "windows/settings/above-lock",
    ]);
    expect([...searchIndexProperties(index, "defender antivirus").keys()]).toEqual([
      "windows/settings/defender",
    ]);
    expect(searchIndexProperties(index, "nothing here").size).toBe(0);
    expect(searchIndexProperties(index, "   ").size).toBe(0);
  });

  it("derives index, collections and search from Apple's single file", async () => {
    const calls = installFetch();
    const index = await loadPlatformIndex("apple");
    expect(index.collections[0]?.name).toBe("Restrictions");
    expect(index.collections[0]?.propertyCount).toBe(1);

    const collection = await loadCollection("apple", "apple/profiles/com.apple.applicationaccess");
    expect(collection.properties[0]?.key).toBe("allowCamera");

    const search = await loadSearchIndex("apple");
    expect([...searchIndexProperties(search, "camera").keys()]).toEqual([
      "apple/profiles/com.apple.applicationaccess",
    ]);
    // One file answers index, collection and search lookups.
    expect(calls).toEqual(["/catalog/apple.json"]);
  });

  it("keys Android search matches by property key, not address", async () => {
    installFetch();
    const search = await loadSearchIndex("android");
    const matches = searchIndexProperties(search, "camera");
    expect([...matches.keys()]).toEqual(["android/policy/Policy"]);
    // Selections store `property.key` on Android, so the index must too.
    expect([...matches.get("android/policy/Policy")!]).toEqual(["cameraDisabled"]);
  });

  it("rejects loadPlatform for Windows and points at the split loaders", async () => {
    installFetch();
    await expect(loadPlatform("windows")).rejects.toThrow(/loadPlatformIndex/);
  });

  it("surfaces HTTP failures and retries after a transient error", async () => {
    let attempts = 0;
    installFetch({
      "/catalog/windows/index.json": () => {
        attempts += 1;

        if (attempts === 1) return new Response("boom", { status: 503 });

        return new Response(JSON.stringify(responses.get("/catalog/windows/index.json")), {
          status: 200,
        });
      },
    });

    await expect(loadPlatformIndex("windows")).rejects.toThrow(
      "Could not load the Windows settings index (503)",
    );
    const index = await loadPlatformIndex("windows");
    expect(index.collections).toHaveLength(2);
    expect(attempts).toBe(2);
  });

  it("reports a missing collection and does not cache the failure", async () => {
    let attempts = 0;
    installFetch({
      "/catalog/windows/windows--settings--missing.json": () => {
        attempts += 1;

        if (attempts === 1) return new Response("nope", { status: 500 });

        return new Response(
          JSON.stringify(windowsCollection("windows/settings/missing", "Missing")),
          { status: 200 },
        );
      },
    });

    await expect(loadCollection("windows", "windows/settings/missing")).rejects.toThrow(
      "Could not load windows/settings/missing settings (500)",
    );
    await expect(loadCollection("windows", "windows/settings/missing")).resolves.toMatchObject({
      name: "Missing",
    });
  });

  it("loads the manifest", async () => {
    installFetch();
    await expect(loadManifest()).resolves.toMatchObject({ platforms: manifest.platforms });
  });

  it("rejects collection ids that cannot be used as file names", () => {
    expect(() => collectionFileKey("windows/settings/above lock")).toThrow(/Invalid collection id/);
    expect(collectionFileKey("windows/settings/above-lock")).toBe("windows--settings--above-lock");
  });

  it("keeps collection-name search behaviour", () => {
    const summaries = [
      {
        id: "windows/settings/above-lock",
        platform: "windows" as const,
        kind: "csp" as const,
        surface: "settings",
        identifier: "above-lock",
        name: "Above Lock",
        propertyCount: 2,
      },
      {
        id: "windows/settings/defender",
        platform: "windows" as const,
        kind: "csp" as const,
        surface: "settings",
        identifier: "defender",
        name: "Defender",
        group: "Security",
        propertyCount: 2,
      },
    ];

    expect(searchCollections(summaries, "")).toEqual(summaries);
    expect(searchCollections(summaries, "def").map((item) => item.name)).toEqual(["Defender"]);
    expect(searchCollections(summaries, "security").map((item) => item.name)).toEqual(["Defender"]);
    expect(searchCollections(summaries, "lock above").map((item) => item.name)).toEqual([
      "Above Lock",
    ]);
    expect(searchCollections(summaries, "missing")).toEqual([]);
  });
});
