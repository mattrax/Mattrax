import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseNotConfigured,
  EnterpriseNotFound,
  EnterpriseUnauthorized,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const authSecret = "abm-api-test-secret";

const organizationId = "org-1";

const otherOrganizationId = "org-2";

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const makePrivateKeyPem = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);

  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);

  return `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(new Uint8Array(pkcs8))
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END PRIVATE KEY-----`;
};

const credentialJson = async () => ({
  clientId: "BUSINESSAPI.11111111-2222-3333-4444-555555555555",
  keyId: "key-1",
  privateKey: await makePrivateKeyPem(),
  scope: "business.api",
});

const vppToken = () =>
  btoa(
    JSON.stringify({
      token: "vpp-org-token",
      expDate: "2030-11-08T22:33:22+0000",
      orgName: "ORG12345",
    }),
  );

const jsonResponse = (body: Schema.Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const makeFetch = () => {
  const calls: string[] = [];

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/auth/oauth2/token"))
      return jsonResponse({
        access_token: "apple-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "business.api",
      });

    if (url.includes("/orgDevices"))
      return jsonResponse({
        data: [
          {
            id: "SERIAL-1",
            attributes: {
              serialNumber: "SERIAL-1",
              deviceModel: 'MacBook Pro 14"',
              productFamily: "Mac",
              status: "ASSIGNED",
              updatedDateTime: "2026-01-02T03:04:05Z",
            },
          },
        ],
      });

    if (url.includes("/mdmServers"))
      return jsonResponse({
        data: [
          {
            id: "mdm-server-1",
            attributes: { serverName: "Mattrax Acme", serverType: "MDM", status: "ACTIVE" },
          },
        ],
      });

    if (url.includes("/orgDeviceActivities"))
      return jsonResponse({ data: { id: "activity-1", attributes: { status: "IN_PROGRESS" } } });

    if (url.includes("/v2/assets/associate")) return jsonResponse({ eventId: "associate-event-1" });

    if (url.includes("/v2/assets/disassociate"))
      return jsonResponse({ eventId: "disassociate-event-1" });

    if (url.includes("/v2/assets"))
      return jsonResponse({
        assets: [
          {
            adamId: "361309726",
            totalCount: 5,
            availableCount: 5,
            assignedCount: 0,
            retiredCount: 0,
            pricingParam: "STDQ",
            deviceAssignable: true,
            revocable: true,
            productType: "App",
            supportedPlatforms: ["iOS"],
          },
        ],
        currentPageIndex: 0,
        totalPages: 1,
      });

    return jsonResponse({ errors: [{ detail: `Unexpected ${url}` }] }, 500);
  }) satisfies typeof globalThis.fetch;

  return { fetchImpl, calls };
};

const makeContext = async (
  overrides: {
    readonly android?: Parameters<typeof createEnterpriseService>[0]["android"];
  } = {},
) => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.user.push(user);

  for (const id of [organizationId, otherOrganizationId]) {
    db.store.organization.push({
      id,
      name: id === organizationId ? "Acme" : "Other",
      slug: id,
      createdAt: now,
      updatedAt: now,
    });
  }

  db.store.member.push({
    id: "member-1",
    organizationId,
    userId: user.id,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });
  db.store.member.push({
    id: "member-2",
    organizationId: otherOrganizationId,
    userId: user.id,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });
  db.store.apple_push_certificate.push({
    organizationId,
    email: "owner@example.com",
    topic: "com.apple.mgmt.External.acme",
    certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    updatedAt: now,
  });
  db.store.device.push({
    id: "device-1",
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: "Mac 1",
    serial: "SERIAL-1",
    osEdition: "macOS",
    osVersion: "14.0",
    enrolledAt: now,
    lastSeenAt: now,
  });
  db.store.application.push({
    id: "app-1",
    organizationId,
    name: "Pages",
    platform: "apple",
    source: "store",
    storeId: "361309726",
    createdAt: now,
    updatedAt: now,
  });
  db.store.application_device.push({ deviceId: "device-1", applicationId: "app-1" });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user, apiToken: undefined })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const { fetchImpl } = makeFetch();

  const service = createEnterpriseService({
    // SAFETY: the in-memory fake implements the query/insert/update surface the
    // service uses at runtime, but not the full `Db` service type.
    db,
    schema,
    origin: "https://enterprise.test",
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods this test exercises.
    auth: auth as any,
    authSecret,
    appleApi: { fetch: fetchImpl },
    android: overrides.android,
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

describe("Apple Business Manager API flow", () => {
  it("uploads, syncs, assigns and serves a tenant-scoped ADE profile", async () => {
    const { db, service, headers } = await makeContext();

    const info = await runEffect(
      service.uploadAppleBusinessManagerToken(request(headers), organizationId, {
        content: JSON.stringify(await credentialJson()),
      }),
    );

    expect(info).toMatchObject({ configured: true, status: "active", credentialType: "abm_api" });

    const sync = await runEffect(
      service.syncAppleBusinessManager(request(headers), organizationId),
    );

    expect(sync).toMatchObject({ devices: 1, assigned: 1, unassigned: 0 });
    expect(db.store.abm_device[0]).toMatchObject({
      organizationId,
      serial: "SERIAL-1",
      deviceId: "device-1",
    });

    const assigned = await runEffect(
      service.assignAppleBusinessManagerDevice(request(headers), organizationId, "SERIAL-1"),
    );

    expect(assigned).toMatchObject({ status: "ok", mdmServerId: "mdm-server-1" });

    const link = await runEffect(
      service.getAbmDeviceProfileUrl(request(headers), organizationId, "SERIAL-1"),
    );

    const token = decodeURIComponent(link.url.split("/api/v1/abm/ade/")[1]!);
    const profile = await runEffect(service.getAdeEnrollmentProfile(token));
    const plist = new TextDecoder().decode(profile.profile);

    expect(profile.filename).toBe("serial-1.mobileconfig");
    expect(plist).toContain("com.apple.mgmt.External.acme");
    expect(plist).toContain(`com.mattrax.ade.${link.profileUuid}`);
    expect(plist).toContain("com.apple.security.scep");
  });

  it("creates an application with several installers and replaces them on patch", async () => {
    const { db, service, headers } = await makeContext();

    const created = await runEffect(
      service.createApplication(request(headers), organizationId, {
        name: "Multi installer",
        installers: [
          {
            platform: "apple",
            source: "manifest",
            bundleId: "com.example.multi",
            version: "2.0",
            manifestUrl: "https://example.com/2.plist",
            minOsVersion: "14.0",
          },
          {
            platform: "apple",
            source: "store",
            bundleId: "com.example.multi",
            version: "3.0",
            storeId: "123456",
            priority: 10,
          },
        ],
      }),
    );

    const first = await runEffect(
      service.getApplication(request(headers), organizationId, created.id),
    );

    expect(first.installers).toHaveLength(2);
    expect(first.installers.map((installer) => installer.source)).toEqual(["store", "manifest"]);

    await runEffect(
      service.patchApplication(request(headers), organizationId, created.id, {
        installers: [
          {
            id: first.installers[1]!.id,
            platform: "apple",
            source: "manifest",
            bundleId: "com.example.multi",
            version: "2.1",
            manifestUrl: "https://example.com/2.1.plist",
          },
        ],
      }),
    );

    const second = await runEffect(
      service.getApplication(request(headers), organizationId, created.id),
    );

    expect(second.installers).toHaveLength(1);
    expect(second.installers[0]).toMatchObject({
      version: "2.1",
      manifestUrl: "https://example.com/2.1.plist",
    });
    expect(db.store.application_installer).toHaveLength(1);
  });

  it("scopes ABM reads and writes to the tenant", async () => {
    const { service, headers } = await makeContext();
    await expect(
      runEffect(service.getAbmDevice(request(headers), otherOrganizationId, "SERIAL-1")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
    await expect(
      runEffect(service.syncAppleBusinessManager(request(headers), otherOrganizationId)),
    ).rejects.toBeInstanceOf(EnterpriseNotConfigured);
  });

  it("uploads and syncs Apps and Books, then installs with a consumed licence", async () => {
    const { db, service, headers } = await makeContext();

    const vpp = await runEffect(
      service.uploadVppToken(request(headers), organizationId, { content: vppToken() }),
    );

    expect(vpp).toMatchObject({ configured: true, status: "active", appleOrgId: "ORG12345" });

    const synced = await runEffect(service.syncVpp(request(headers), organizationId));
    expect(synced).toMatchObject({ assets: 1, totalLicenses: 5, availableLicenses: 5 });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "app-1"),
    );

    expect(result).toMatchObject({ status: "ok", queued: 1, skipped: 0 });
    expect(db.store.device_vpp_assignment[0]).toMatchObject({
      organizationId,
      deviceId: "device-1",
      adamId: "361309726",
      state: "assigned",
    });
    expect(db.store.vpp_asset[0]).toMatchObject({ availableLicenses: 4, assignedLicenses: 1 });
    expect(db.store.device_command[0]).toMatchObject({
      requestType: "InstallApplication",
      deviceId: "device-1",
    });
    expect(db.store.device_command[0].payload.iTunesStoreID).toBe(361309726);
  });

  it("installs and releases a VPP app through the asset endpoint", async () => {
    const { db, service, headers } = await makeContext();
    await runEffect(
      service.uploadVppToken(request(headers), organizationId, { content: vppToken() }),
    );
    await runEffect(service.syncVpp(request(headers), organizationId));

    const installed = await runEffect(
      service.installVppAsset(request(headers), organizationId, "361309726", {
        devices: ["device-1"],
      }),
    );

    expect(installed).toMatchObject({ status: "ok", assigned: 1, queued: 1, failed: 0 });
    expect(db.store.device_command[0]).toMatchObject({ requestType: "InstallApplication" });

    const released = await runEffect(
      service.releaseVppAsset(request(headers), organizationId, "361309726", {
        devices: ["device-1"],
      }),
    );

    expect(released).toMatchObject({ status: "ok", released: 1, failed: 0 });
    expect(db.store.vpp_asset[0]).toMatchObject({ availableLicenses: 5, assignedLicenses: 0 });
  });

  it("queues an InstallEnterpriseApplication for an uploaded Apple package", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    db.store.application.push({
      id: "app-upload",
      organizationId,
      name: "Office",
      platform: "apple",
      bundleId: "com.microsoft.Office",
      version: "16.0",
      source: "upload",
      fileName: "Office.pkg",
      contentType: "application/vnd.apple.installer+xml",
      size: 4,
      sha256: "a".repeat(64),
      r2Key: "a/org-1/app-upload/sha",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "device-1", applicationId: "app-upload" });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "app-upload"),
    );

    expect(result).toMatchObject({ status: "ok", queued: 1, skipped: 0 });
    expect(db.store.device_command[0]).toMatchObject({
      requestType: "InstallEnterpriseApplication",
      deviceId: "device-1",
    });

    // SAFETY: the queued payload is produced by this test's install path and
    // the assertions verify the manifest keys it wrote.
    const payload = db.store.device_command[0]!.payload as any;
    expect(payload.Manifest.items[0].metadata["bundle-identifier"]).toBe("com.microsoft.Office");
    expect(payload.Manifest.items[0].assets[0].sha256).toBe("a".repeat(64));
    expect(payload.Manifest.items[0].assets[0].url).toContain(
      "/mdm/apple/assets/app.app-upload?token=",
    );
  });

  it("selects the installer that matches the device OS version", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    const installers = [
      {
        id: "installer-14",
        organizationId,
        applicationId: "app-versioned",
        platform: "apple",
        source: "manifest",
        bundleId: "com.example.app",
        version: "2.0",
        manifestUrl: "https://example.com/14.plist",
        storeId: null,
        fileName: null,
        contentType: null,
        size: null,
        sha256: null,
        r2Key: null,
        minOsVersion: "14.0",
        requiredCapability: null,
        priority: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "installer-15",
        organizationId,
        applicationId: "app-versioned",
        platform: "apple",
        source: "manifest",
        bundleId: "com.example.app",
        version: "3.0",
        manifestUrl: "https://example.com/15.plist",
        storeId: null,
        fileName: null,
        contentType: null,
        size: null,
        sha256: null,
        r2Key: null,
        minOsVersion: "15.0",
        requiredCapability: null,
        priority: 10,
        createdAt: now,
        updatedAt: now,
      },
    ];

    db.store.application.push({
      id: "app-versioned",
      organizationId,
      name: "Versioned",
      platform: "apple",
      source: "manifest",
      bundleId: "com.example.app",
      version: "2.0",
      manifestUrl: "https://example.com/14.plist",
      storeId: null,
      fileName: null,
      contentType: null,
      size: null,
      sha256: null,
      r2Key: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({
      deviceId: "device-1",
      applicationId: "app-versioned",
    });
    db.store.application_installer.push(...installers);

    const first = await runEffect(
      service.installApplication(request(headers), organizationId, "app-versioned"),
    );

    expect(first).toMatchObject({ queued: 1, skipped: 0 });
    expect(db.store.device_command[0]!.payload.ManifestURL).toBe("https://example.com/14.plist");

    db.store.device[0]!.osVersion = "15.4";

    const second = await runEffect(
      service.installApplication(request(headers), organizationId, "app-versioned"),
    );

    expect(second).toMatchObject({ queued: 1, skipped: 0 });
    expect(db.store.device_command.at(-1)!.payload.ManifestURL).toBe(
      "https://example.com/15.plist",
    );
  });

  it("reports an uploaded .ipa instead of queueing an install it cannot perform", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    db.store.application.push({
      id: "app-ipa",
      organizationId,
      name: "Internal iOS",
      platform: "apple",
      bundleId: "com.example.internal",
      version: "1.0",
      source: "upload",
      fileName: "Internal.ipa",
      contentType: "application/octet-stream",
      sha256: "b".repeat(64),
      r2Key: "a/org-1/app-ipa/sha",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "device-1", applicationId: "app-ipa" });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "app-ipa"),
    );

    expect(result).toMatchObject({ queued: 0 });
    expect(result.message).toContain("OTA manifest");
    expect(db.store.device_command).toHaveLength(0);
  });

  it("does not queue an uploaded .pkg for an iPhone", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    db.store.device.push({
      id: "iphone-1",
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: "iPhone",
      serial: "IPHONE-1",
      osEdition: "iOS",
      osVersion: "17.0",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.application.push({
      id: "app-pkg-ios",
      organizationId,
      name: "Office",
      platform: "apple",
      bundleId: "com.microsoft.Office",
      version: "16.0",
      source: "upload",
      fileName: "Office.pkg",
      contentType: "application/vnd.apple.installer+xml",
      sha256: "c".repeat(64),
      r2Key: "a/org-1/app-pkg-ios/sha",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "iphone-1", applicationId: "app-pkg-ios" });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "app-pkg-ios"),
    );

    expect(result).toMatchObject({ queued: 0, skipped: 1 });
    expect(result.message).toContain("macOS only");
    expect(db.store.device_command).toHaveLength(0);
  });

  it("queues an MSI Exec for a Windows application", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    db.store.device.push({
      id: "win-1",
      organizationId,
      proto: "win",
      status: "enrolled",
      name: "PC 1",
      serial: "WIN-SERIAL",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.application.push({
      id: "win-app",
      organizationId,
      name: "Chrome",
      platform: "win",
      bundleId: "8A69D345-D564-463C-AFF1-A69D9E530F96",
      version: "120.0",
      source: "manifest",
      manifestUrl: "https://cdn.example.test/chrome.msi",
      fileName: "chrome.msi",
      sha256: "c".repeat(64),
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "win-1", applicationId: "win-app" });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "win-app"),
    );

    expect(result).toMatchObject({ status: "ok", queued: 1, skipped: 0 });
    const command = db.store.device_command[0]!;
    expect(command).toMatchObject({ requestType: "InstallApplication", deviceId: "win-1" });

    // SAFETY: the InstallApplication payload for a Windows MSI is constructed
    // by windowsMsiInstallPayload, which always returns these fields.
    const payload = command.payload as any;
    expect(payload.kind).toBe("Exec");
    expect(payload.format).toBe("xml");
    expect(payload.locURI).toContain(encodeURIComponent("{8A69D345-D564-463C-AFF1-A69D9E530F96}"));
    expect(payload.data).toContain("<ContentURL>https://cdn.example.test/chrome.msi</ContentURL>");
  });

  it("reports a Windows .exe instead of queueing an MSI install", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    db.store.device.push({
      id: "win-1",
      organizationId,
      proto: "win",
      status: "enrolled",
      name: "PC 1",
      serial: "WIN-SERIAL",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.application.push({
      id: "win-exe",
      organizationId,
      name: "Tool",
      platform: "win",
      bundleId: "{8A69D345-D564-463C-AFF1-A69D9E530F96}",
      source: "manifest",
      manifestUrl: "https://cdn.example.test/tool.exe",
      fileName: "tool.exe",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "win-1", applicationId: "win-exe" });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "win-exe"),
    );

    expect(result).toMatchObject({ queued: 0 });
    expect(result.message).toContain("Intune Management Extension");
    expect(db.store.device_command).toHaveLength(0);
  });

  it("does not claim Android success when Android Management is not configured", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    db.store.device.push({
      id: "android-1",
      organizationId,
      proto: "android",
      status: "enrolled",
      name: "Pixel",
      serial: "ANDROID-1",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.application.push({
      id: "android-app",
      organizationId,
      name: "Gmail",
      platform: "android",
      bundleId: "com.google.android.gm",
      source: "store",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "android-1", applicationId: "android-app" });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "android-app"),
    );

    expect(result).toMatchObject({ queued: 0 });
    expect(result.message).toContain("not configured");
    expect(db.store.device_command).toHaveLength(0);
  });

  it("reports Apple applications that have no file or bundle id", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();

    db.store.application.push({
      id: "app-empty",
      organizationId,
      name: "Empty",
      platform: "apple",
      source: "upload",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "device-1", applicationId: "app-empty" });

    const result = await runEffect(
      service.installApplication(request(headers), organizationId, "app-empty"),
    );

    expect(result).toMatchObject({ queued: 0 });
    expect(result.message).toContain("Upload the installer");
    expect(db.store.device_command).toHaveLength(0);
  });

  it("fails VPP installs closed when the token is inactive and reports no licence", async () => {
    const { db, service, headers } = await makeContext();
    const now = new Date();
    db.store.vpp_token.push({
      organizationId,
      encryptedToken: "sealed",
      status: "error",
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      runEffect(service.installApplication(request(headers), organizationId, "app-1")),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });
});
