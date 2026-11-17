import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { signAppleAssetToken } from "@mattrax/dm-apple";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import {
  CATALOGUE_APPLICATION_ASSET_KIND,
  catalogueApplicationAssetIdentifier,
} from "@mattrax/mdm-core";
import { makeDb, tableName, type Store } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "application-delivery-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const at = new Date("2026-11-16T10:00:00.000Z");

const sha256 = "a".repeat(64);

const pkg = new Uint8Array([1, 2, 3, 4]);

const scope = {
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  mdmOrigin,
};

const device = (overrides: { osEdition?: string; osVersion?: string } = {}) => ({
  id: "device-1",
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: "device-1",
  dmIdentifier: "udid-1",
  osEdition: overrides.osEdition ?? "macOS",
  osVersion: overrides.osVersion ?? "14.0",
  capabilities: null,
  enrolledAt: at,
  lastSeenAt: at,
});

const uploadConfiguration = {
  source: "upload",
  sha256,
  fileName: "Office.pkg",
  contentType: "application/vnd.apple.installer+xml",
  bundleId: "com.microsoft.Office",
  version: "16.0",
  title: "Microsoft Office",
  configuration: { AllowedDomain: "example.com" },
};

const setup = (
  options: {
    readonly configurationData?: Schema.Json;
    readonly device?: ReturnType<typeof device>;
    readonly applications?: Store[string];
    readonly installers?: Store[string];
    readonly readApplicationObject?: (key: string) => Promise<Uint8Array | null>;
    readonly vpp?: boolean;
  } = {},
) => {
  const db = makeDb({
    [tableName(schema.organization)]: [{ id: "org-1", name: "Org", slug: "org", metadata: null }],
    [tableName(schema.policy)]: [
      {
        id: "policy-1",
        organizationId: "org-1",
        name: "Policy",
        notes: null,
        priority: 1,
        createdAt: at,
        updatedAt: at,
      },
    ],
    [tableName(schema.device)]: [options.device ?? device()],
    [tableName(schema.deviceApple)]: [
      { deviceId: "device-1", deviceToken: "token-1", declarationMode: "ddm" },
    ],
    [tableName(schema.devicePolicy)]: [
      { deviceId: "device-1", policyId: "policy-1", mode: "include" },
    ],
    [tableName(schema.configuration)]: [
      {
        policyId: "policy-1",
        kind: "mttx.apple.application.office",
        data: options.configurationData ?? uploadConfiguration,
        hash: "hash-1",
      },
    ],
    [tableName(schema.application)]: options.applications ?? [],
    [tableName(schema.applicationInstaller)]: options.installers ?? [],
    [tableName(schema.vppToken)]: options.vpp
      ? [{ organizationId: "org-1", status: "active", encryptedToken: "sealed" }]
      : [],
  });

  // SAFETY: the fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({
    db: db as any,
    origin,
    authSecret,
    readApplicationObject: options.readApplicationObject,
  });

  return { db, backend };
};

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const commands = (db: ReturnType<typeof makeDb>, requestType: string) =>
  (db.store[tableName(schema.deviceCommand)] ?? []).filter(
    (row) => row.requestType === requestType,
  );

const manifestAssetUrl = (payload: Schema.Json): string => {
  const decoded = Schema.decodeUnknownSync(
    Schema.Struct({
      Manifest: Schema.Struct({
        items: Schema.Array(
          Schema.Struct({
            assets: Schema.Array(Schema.Struct({ url: Schema.String })),
          }),
        ),
      }),
    }),
  )(payload);

  return decoded.Manifest.items[0]!.assets[0]!.url;
};

const fetchAsset = (
  backend: ReturnType<typeof ManagementBackendEnterpriseLive.make>,
  url: string,
) => {
  const parsed = new URL(url);

  return run(
    backend.getAppleAsset(
      undefined,
      decodeURIComponent(parsed.pathname.split("/").pop()!),
      parsed.searchParams.get("token") ?? undefined,
    ),
  );
};

describe("Apple policy application delivery", () => {
  it("queues an InstallEnterpriseApplication with a device-bound package URL", async () => {
    const { db, backend } = setup({
      readApplicationObject: async (key) => (key.startsWith("p/org-1/policy-1/") ? pkg : null),
    });

    await run(backend.appleManagementCheckin(scope));

    const [command] = commands(db, "InstallEnterpriseApplication");
    expect(command).toBeTruthy();
    // SAFETY: the command was queued by this test with an object payload; the
    // assertions below check the exact keys that matter.
    const payload = command!.payload as Record<string, Schema.Json>;
    expect(payload).toMatchObject({
      InstallAsManaged: true,
      ManagementFlags: 1,
      Configuration: { AllowedDomain: "example.com" },
    });

    const url = manifestAssetUrl(payload);
    expect(url).toContain(
      `/mdm/apple/assets/${encodeURIComponent("policy-1.mttx.apple.application.office.asset")}`,
    );

    await expect(fetchAsset(backend, url)).resolves.toEqual({
      content: pkg,
      contentType: "application/vnd.apple.installer+xml",
    });
  });

  it("rejects a package URL signed for another device", async () => {
    const { backend } = setup({
      readApplicationObject: async () => pkg,
    });

    const token = await signAppleAssetToken(authSecret, {
      policyId: "policy-1",
      kind: "mttx.apple.application.office",
      deviceId: "device-2",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });

    await expect(
      run(backend.getAppleAsset(undefined, "policy-1.mttx.apple.application.office.asset", token)),
    ).resolves.toBeNull();
  });

  it("fails closed when the uploaded object is gone", async () => {
    const { backend } = setup({ readApplicationObject: async () => null });

    const token = await signAppleAssetToken(authSecret, {
      policyId: "policy-1",
      kind: "mttx.apple.application.office",
      deviceId: "device-1",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });

    await expect(
      run(backend.getAppleAsset(undefined, "policy-1.mttx.apple.application.office.asset", token)),
    ).resolves.toBeNull();
  });

  it("installs a catalogue application referenced from a policy", async () => {
    const { db, backend } = setup({
      configurationData: { applicationId: "app-1" },
      applications: [
        {
          id: "app-1",
          organizationId: "org-1",
          name: "Slack",
          platform: "apple",
          bundleId: "com.tinyspeck.slackmacgap",
          version: "4.0",
          source: "upload",
          manifestUrl: null,
          storeId: null,
          fileName: "Slack.pkg",
          contentType: "application/vnd.apple.installer+xml",
          size: pkg.byteLength,
          sha256,
          r2Key: "a/org-1/app-1/sha",
          notes: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
      readApplicationObject: async (key) => (key === "a/org-1/app-1/sha" ? pkg : null),
    });

    await run(backend.appleManagementCheckin(scope));

    const [command] = commands(db, "InstallEnterpriseApplication");
    expect(command).toBeTruthy();

    // SAFETY: the catalogued command payload is a JSON object by construction;
    // manifestAssetUrl asserts the manifest shape it was queued with.
    const url = manifestAssetUrl(command!.payload as Schema.Json);
    expect(url).toContain(
      `/mdm/apple/assets/${encodeURIComponent(catalogueApplicationAssetIdentifier("app-1"))}`,
    );

    await expect(fetchAsset(backend, url)).resolves.toEqual({
      content: pkg,
      contentType: "application/vnd.apple.installer+xml",
    });
  });

  it("delivers the installer that matches the device OS and signs its own asset", async () => {
    const catalogue = {
      id: "app-1",
      organizationId: "org-1",
      name: "Slack",
      platform: "apple" as const,
      bundleId: "com.tinyspeck.slackmacgap",
      version: "4.0",
      source: "upload" as const,
      manifestUrl: null,
      storeId: null,
      fileName: "Slack.pkg",
      contentType: "application/vnd.apple.installer+xml",
      size: pkg.byteLength,
      sha256,
      r2Key: "a/org-1/installer-14/sha",
      notes: null,
      createdAt: at,
      updatedAt: at,
    };

    const installer = (id: string, minOsVersion: string, priority: number, key: string) => ({
      id,
      organizationId: "org-1",
      applicationId: "app-1",
      platform: "apple" as const,
      source: "upload" as const,
      bundleId: "com.tinyspeck.slackmacgap",
      version: minOsVersion,
      manifestUrl: null,
      storeId: null,
      fileName: "Slack.pkg",
      contentType: "application/vnd.apple.installer+xml",
      size: pkg.byteLength,
      sha256,
      r2Key: key,
      minOsVersion,
      requiredCapability: null,
      priority,
      createdAt: at,
      updatedAt: at,
    });

    const options = {
      configurationData: { applicationId: "app-1" },
      applications: [catalogue],
      installers: [
        installer("installer-14", "14.0", 0, "a/org-1/installer-14/sha"),
        installer("installer-15", "15.0", 10, "a/org-1/installer-15/sha"),
      ],
      readApplicationObject: async (key: string) => (key.startsWith("a/org-1/") ? pkg : null),
    };

    const first = setup({ ...options, device: device({ osVersion: "14.6" }) });
    await run(first.backend.appleManagementCheckin(scope));

    const [command] = commands(first.db, "InstallEnterpriseApplication");
    expect(command).toBeTruthy();

    // SAFETY: the upload path queues this exact payload shape; the helper
    // decodes the manifest URL it contains.
    const url = manifestAssetUrl(command!.payload as Schema.Json);
    expect(url).toContain(
      `/mdm/apple/assets/${encodeURIComponent(catalogueApplicationAssetIdentifier("installer-14"))}`,
    );
    await expect(fetchAsset(first.backend, url)).resolves.toMatchObject({ content: pkg });

    const second = setup({ ...options, device: device({ osVersion: "15.1" }) });
    await run(second.backend.appleManagementCheckin(scope));

    const [newer] = commands(second.db, "InstallEnterpriseApplication");

    // SAFETY: the upload path queues this exact payload shape; the helper
    // decodes the manifest URL it contains.
    const newerUrl = manifestAssetUrl(newer!.payload as Schema.Json);
    expect(newerUrl).toContain(
      `/mdm/apple/assets/${encodeURIComponent(catalogueApplicationAssetIdentifier("installer-15"))}`,
    );
    await expect(fetchAsset(second.backend, newerUrl)).resolves.toMatchObject({ content: pkg });
  });

  it("does not send a .pkg install to an iOS device", async () => {
    const { db, backend } = setup({
      device: device({ osEdition: "iOS", osVersion: "17.0" }),
      readApplicationObject: async () => pkg,
    });

    await run(backend.appleManagementCheckin(scope));

    expect(commands(db, "InstallEnterpriseApplication")).toHaveLength(0);
  });

  it("falls back to a matching manifest installer for an iPhone", async () => {
    const { db, backend } = setup({
      device: device({ osEdition: "iOS", osVersion: "17.0" }),
      configurationData: { applicationId: "app-1" },
      applications: [
        {
          id: "app-1",
          organizationId: "org-1",
          name: "Slack",
          platform: "apple",
          bundleId: "com.tinyspeck.slackmacgap",
          version: "4.0",
          source: "upload",
          manifestUrl: null,
          storeId: null,
          fileName: "Slack.pkg",
          contentType: "application/vnd.apple.installer+xml",
          size: pkg.byteLength,
          sha256,
          r2Key: "a/org-1/app-1/sha",
          notes: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
      installers: [
        {
          id: "installer-mac",
          organizationId: "org-1",
          applicationId: "app-1",
          platform: "apple",
          source: "upload",
          bundleId: "com.tinyspeck.slackmacgap",
          version: "4.0",
          manifestUrl: null,
          storeId: null,
          fileName: "Slack.pkg",
          contentType: "application/vnd.apple.installer+xml",
          size: pkg.byteLength,
          sha256,
          r2Key: "a/org-1/app-1/sha",
          minOsVersion: null,
          requiredCapability: null,
          priority: 10,
          createdAt: at,
          updatedAt: at,
        },
        {
          id: "installer-ios",
          organizationId: "org-1",
          applicationId: "app-1",
          platform: "apple",
          source: "manifest",
          bundleId: "com.tinyspeck.slackmacgap",
          version: "4.0",
          manifestUrl: "https://example.com/slack.plist",
          storeId: null,
          fileName: null,
          contentType: null,
          size: null,
          sha256: null,
          r2Key: null,
          minOsVersion: "16.0",
          requiredCapability: null,
          priority: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
    });

    await run(backend.appleManagementCheckin(scope));

    const [command] = commands(db, "InstallApplication");
    expect(command).toBeTruthy();
    // SAFETY: the manifest path builds this exact payload shape.
    expect((command!.payload as Record<string, Schema.Json>).ManifestURL).toBe(
      "https://example.com/slack.plist",
    );
    expect(commands(db, "InstallEnterpriseApplication")).toHaveLength(0);
  });

  it("does not claim a catalogue install when the app has no uploaded file", async () => {
    const { db, backend } = setup({
      configurationData: { applicationId: "app-1" },
      applications: [
        {
          id: "app-1",
          organizationId: "org-1",
          name: "Slack",
          platform: "apple",
          bundleId: "com.tinyspeck.slackmacgap",
          version: "4.0",
          source: "upload",
          manifestUrl: null,
          storeId: null,
          fileName: null,
          contentType: null,
          size: null,
          sha256: null,
          r2Key: null,
          notes: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
    });

    await run(backend.appleManagementCheckin(scope));

    expect(commands(db, "InstallEnterpriseApplication")).toHaveLength(0);
  });

  it("queues a store app from a policy only when Apps and Books is not configured", async () => {
    const storeConfiguration = {
      source: "store",
      storeId: "123456789",
      bundleId: "com.example.store",
    };

    const { db, backend } = setup({ configurationData: storeConfiguration });

    await run(backend.appleManagementCheckin(scope));

    expect(commands(db, "InstallApplication")).toHaveLength(1);

    const { db: licensedDb, backend: licensedBackend } = setup({
      configurationData: storeConfiguration,
      vpp: true,
    });

    await run(licensedBackend.appleManagementCheckin(scope));

    expect(commands(licensedDb, "InstallApplication")).toHaveLength(0);
  });

  it("binds a catalogue package URL to the synthetic asset kind", async () => {
    const token = await signAppleAssetToken(authSecret, {
      policyId: "app-1",
      kind: CATALOGUE_APPLICATION_ASSET_KIND,
      deviceId: "device-1",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });

    const { backend } = setup({
      applications: [
        {
          id: "app-1",
          organizationId: "org-1",
          name: "Slack",
          platform: "apple",
          bundleId: "com.tinyspeck.slackmacgap",
          version: "4.0",
          source: "upload",
          manifestUrl: null,
          storeId: null,
          fileName: "Slack.pkg",
          contentType: "application/vnd.apple.installer+xml",
          size: pkg.byteLength,
          sha256,
          r2Key: "a/org-1/app-1/sha",
          notes: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
      readApplicationObject: async () => pkg,
    });

    await expect(
      run(backend.getAppleAsset(undefined, catalogueApplicationAssetIdentifier("app-1"), token)),
    ).resolves.toMatchObject({ content: pkg });
  });
});
