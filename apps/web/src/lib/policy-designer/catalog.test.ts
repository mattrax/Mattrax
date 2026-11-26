import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { CatalogueService } from "~/lib/catalogue-service";
import {
  appleCollectionManaged,
  appleOsRangeLabel,
  collectionFileKey,
  loadCollectionEffect,
  loadManifestEffect,
  loadPlatformEffect,
  loadPlatformIndexEffect,
  loadSearchIndexEffect,
  searchCollections,
  searchIndexProperties,
} from "./catalog";
import type {
  CatalogManifest,
  Collection,
  PlatformData,
  PlatformIndex,
  SearchIndex,
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
  const client = HttpClient.mapRequest((request) =>
    HttpClientRequest.prependUrl("https://mattrax.test")(request),
  )(
    HttpClient.make((request) =>
      Effect.promise(async () => {
        const url = new URL(request.url).pathname;
        calls.push(url);
        const override = overrides[url];

        if (override) return HttpClientResponse.fromWeb(request, await override());
        const body = responses.get(url);

        return HttpClientResponse.fromWeb(
          request,
          body === undefined
            ? new Response("not found", { status: 404 })
            : new Response(JSON.stringify(body), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
        );
      }),
    ),
  );
  const layer = CatalogueService.layerHttp.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
  );

  return Object.assign(calls, { layer, runtime: ManagedRuntime.make(layer) });
};

const run = <A, E>(
  effect: Effect.Effect<A, E, CatalogueService>,
  transport: { runtime: ManagedRuntime.ManagedRuntime<CatalogueService, never> },
) => transport.runtime.runPromise(effect);

describe("policy catalogue loaders", () => {
  it("loads the Windows index without any collection payload", async () => {
    const transport = installFetch();
    const index = await run(loadPlatformIndexEffect("windows"), transport);

    expect(index.platform).toBe("windows");
    expect(index.stats).toEqual({ collections: 2, properties: 4 });
    expect(index.collections.map((collection) => collection.name)).toEqual([
      "Above Lock",
      "Defender",
    ]);
    expect(index.collections.every((collection) => collection.platform === "windows")).toBe(true);
    expect(index.collections[1]?.key).toBe("windows--settings--defender");
    expect([...transport]).toEqual(["/catalog/windows/index.json"]);
  });

  it("loads a single collection by its stable file key and caches it", async () => {
    const transport = installFetch();
    const collection = await run(
      loadCollectionEffect("windows", "windows/settings/above-lock"),
      transport,
    );
    const again = await run(
      loadCollectionEffect("windows", "windows/settings/above-lock"),
      transport,
    );

    expect(collection.name).toBe("Above Lock");
    expect(collection.properties).toHaveLength(2);
    expect(again).toEqual(collection);
    expect([...transport]).toEqual(["/catalog/windows/windows--settings--above-lock.json"]);
  });

  it("searches property text from the lazy search index", async () => {
    const transport = installFetch();
    const index = await run(loadSearchIndexEffect("windows"), transport);

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
    const transport = installFetch();
    const index = await run(loadPlatformIndexEffect("apple"), transport);
    expect(index.collections[0]?.name).toBe("Restrictions");
    expect(index.collections[0]?.propertyCount).toBe(1);

    const collection = await run(
      loadCollectionEffect("apple", "apple/profiles/com.apple.applicationaccess"),
      transport,
    );
    expect(collection.properties[0]?.key).toBe("allowCamera");

    const search = await run(loadSearchIndexEffect("apple"), transport);
    expect([...searchIndexProperties(search, "camera").keys()]).toEqual([
      "apple/profiles/com.apple.applicationaccess",
    ]);
    expect([...transport]).toEqual(["/catalog/apple.json"]);
  });

  it("keys Android search matches by property key, not address", async () => {
    const transport = installFetch();
    const search = await run(loadSearchIndexEffect("android"), transport);
    const matches = searchIndexProperties(search, "camera");
    expect([...matches.keys()]).toEqual(["android/policy/Policy"]);
    expect([...matches.get("android/policy/Policy")!]).toEqual(["cameraDisabled"]);
  });

  it("rejects loadPlatform for Windows and points at the split loaders", async () => {
    const transport = installFetch();
    await expect(run(loadPlatformEffect("windows"), transport)).rejects.toThrow(
      /loadPlatformIndex/,
    );
  });

  it("surfaces HTTP failures and retries after a transient error", async () => {
    let attempts = 0;
    const transport = installFetch({
      "/catalog/windows/index.json": () => {
        attempts += 1;

        if (attempts === 1) return new Response("boom", { status: 503 });

        return new Response(JSON.stringify(responses.get("/catalog/windows/index.json")), {
          status: 200,
        });
      },
    });

    await expect(run(loadPlatformIndexEffect("windows"), transport)).rejects.toThrow(
      /Could not load catalogue asset/,
    );
    const index = await run(loadPlatformIndexEffect("windows"), transport);
    expect(index.collections).toHaveLength(2);
    expect(attempts).toBe(2);
  });

  it("reports a missing collection and does not cache the failure", async () => {
    let attempts = 0;
    const transport = installFetch({
      "/catalog/windows/windows--settings--missing.json": () => {
        attempts += 1;

        if (attempts === 1) return new Response("nope", { status: 500 });

        return new Response(
          JSON.stringify(windowsCollection("windows/settings/missing", "Missing")),
          { status: 200 },
        );
      },
    });

    await expect(
      run(loadCollectionEffect("windows", "windows/settings/missing"), transport),
    ).rejects.toThrow(/Could not load catalogue asset/);
    await expect(
      run(loadCollectionEffect("windows", "windows/settings/missing"), transport),
    ).resolves.toMatchObject({ name: "Missing" });
  });

  it("rejects malformed assets and retries them on the next call", async () => {
    let attempts = 0;
    const transport = installFetch({
      "/catalog/manifest.json": () => {
        attempts += 1;

        return new Response(attempts === 1 ? "{}" : JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(run(loadManifestEffect(), transport)).rejects.toThrow(/malformed/);
    await expect(run(loadManifestEffect(), transport)).resolves.toMatchObject({
      platforms: manifest.platforms,
    });
    expect(attempts).toBe(2);
  });

  it("loads the manifest", async () => {
    const transport = installFetch();
    await expect(run(loadManifestEffect(), transport)).resolves.toMatchObject({
      platforms: manifest.platforms,
    });
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

describe("Apple OS range labels", () => {
  const support = {
    supportedOs: {
      "com.apple.configuration.security.certificate": {
        macOS: { introduced: "14.0" },
        iOS: { introduced: "17.0" },
      },
      "com.apple.security.FDERecoveryKeyEscrow": {
        macOS: { introduced: "10.13" },
      },
    },
  };

  it("shows the per-family minimums the delivery path enforces", () => {
    expect(
      appleOsRangeLabel(
        {
          identifier: "com.apple.configuration.security.certificate",
          minOs: "14.0",
        },
        support,
      ),
    ).toBe("macOS 14.0+ · iOS 17.0+");
  });

  it("falls back to the catalogue minimum when Apple publishes no block", () => {
    expect(appleOsRangeLabel({ identifier: "com.example.custom", minOs: "13.0" }, support)).toBe(
      "13.0+",
    );
  });

  it("returns no label when nothing is known", () => {
    expect(appleOsRangeLabel({ identifier: "com.example.custom" }, undefined)).toBeNull();
  });

  it("flags payloads that no managed OS family supports", () => {
    expect(appleCollectionManaged(undefined)).toBe(true);
    expect(appleCollectionManaged(["macOS"])).toBe(true);
    expect(appleCollectionManaged(["iPadOS"])).toBe(true);
    expect(appleCollectionManaged(["watchOS", "tvOS"])).toBe(false);
  });
});
