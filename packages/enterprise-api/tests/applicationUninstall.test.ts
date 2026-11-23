import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterprisePermissionDenied } from "@mattrax/enterprise-domain";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { sweepDeviceCommands } from "@mattrax/mdm-apple";
import { reconcileApplicationUninstalls } from "@mattrax/enterprise-core";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const authSecret = "application-uninstall-test-secret";

const organizationId = "org-1";

const productCode = "8A69D345-D564-463C-AFF1-A69D9E530F96";

const now = new Date("2026-11-20T12:00:00.000Z");

const makeContext = (options: { readonly removeOnUnassign?: boolean } = {}) => {
  const db = makeDb();

  const user = {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);
  db.store.organization.push({
    id: organizationId,
    name: "Acme",
    slug: "acme",
    createdAt: now,
    updatedAt: now,
  });
  db.store.member.push({
    id: "member-1",
    organizationId,
    accountId: user.id,
    role: "owner",
    createdAt: now,
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
    name: "Internal",
    platform: "apple",
    bundleId: "com.example.internal",
    version: "1.0",
    source: "upload",
    fileName: "Internal.pkg",
    contentType: "application/vnd.apple.installer+xml",
    size: 4,
    sha256: "a".repeat(64),
    r2Key: "a/org-1/app-1/sha",
    notes: null,
    removeOnUnassign: options.removeOnUnassign ?? false,
    createdAt: now,
    updatedAt: now,
  });
  db.store.application_device.push({ deviceId: "device-1", applicationId: "app-1" });
  db.store.device_command.push({
    id: "command-install",
    organizationId,
    deviceId: "device-1",
    requestType: "InstallEnterpriseApplication",
    payload: {
      Manifest: {
        items: [
          {
            assets: [{ kind: "software-package", url: "https://enterprise.test/pkg" }],
            metadata: {
              "bundle-identifier": "com.example.internal",
              "bundle-version": "1.0",
              kind: "software",
              title: "Internal",
            },
          },
        ],
      },
    },
    status: "succeeded",
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user, apiToken: undefined })
        : Effect.fail(new Error("unauthenticated"));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
  };

  const service = createEnterpriseService({
    // SAFETY: the in-memory fake implements the query/insert/update surface the
    // service uses at runtime, but not the full `Db` service type.
    db,
    schema,
    origin: "https://enterprise.test",
    // SAFETY: this test never reaches R2.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods this test exercises.
    auth: auth as any,
    authSecret,
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const uninstallCommand = (db: ReturnType<typeof makeDb>) =>
  db.store.device_command.find((row) => row.requestType === "RemoveApplication");

describe("application uninstall", () => {
  it("queues RemoveApplication for an installed Apple app and tracks the state", async () => {
    const { db, service, headers } = makeContext();

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-1"),
    );

    expect(result).toMatchObject({ status: "ok", queued: 1, skipped: 0, failed: 0 });
    expect(uninstallCommand(db)).toMatchObject({
      deviceId: "device-1",
      payload: { BundleIdentifier: "com.example.internal" },
    });
    expect(db.store.application_uninstall[0]).toMatchObject({
      deviceId: "device-1",
      applicationId: "app-1",
      bundleId: "com.example.internal",
      platform: "apple",
      status: "queued",
      commandId: uninstallCommand(db)!.id,
    });
  });

  it("attributes an uploaded .ipa install through its signed manifest URL", async () => {
    const { db, service, headers } = makeContext();

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
      id: "app-ipa",
      organizationId,
      name: "Internal iOS",
      platform: "apple",
      bundleId: null,
      version: "1.0",
      source: "upload",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_installer.push({
      id: "installer-ipa",
      organizationId,
      applicationId: "app-ipa",
      platform: "apple",
      source: "upload",
      bundleId: "com.example.internal",
      version: "1.0",
      manifestUrl: null,
      storeId: null,
      fileName: "Internal.ipa",
      contentType: "application/octet-stream",
      size: 3,
      sha256: "e".repeat(64),
      r2Key: "a/org-1/installer-ipa/sha",
      minOsVersion: null,
      requiredCapability: null,
      priority: 0,
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "iphone-1", applicationId: "app-ipa" });
    db.store.device_command.push({
      id: "command-ipa-install",
      organizationId,
      deviceId: "iphone-1",
      requestType: "InstallApplication",
      payload: {
        ManifestURL: "https://enterprise.test/mdm/apple/manifests/app.installer-ipa?token=signed",
        InstallAsManaged: true,
        ManagementFlags: 1,
      },
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-ipa"),
    );

    expect(result).toMatchObject({ queued: 1, failed: 0 });
    expect(
      db.store.device_command.find(
        (row) => row.requestType === "RemoveApplication" && row.deviceId === "iphone-1",
      ),
    ).toMatchObject({
      payload: { BundleIdentifier: "com.example.internal" },
    });
  });

  it("attributes an install from an older installer in a multi-version app", async () => {
    const { db, service, headers } = makeContext();

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
      id: "app-versions",
      organizationId,
      name: "Internal",
      platform: "apple",
      bundleId: null,
      version: "2.0",
      source: "upload",
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, version] of [
      ["installer-v1", "1.0"],
      ["installer-v2", "2.0"],
    ] as const)
      db.store.application_installer.push({
        id,
        organizationId,
        applicationId: "app-versions",
        platform: "apple",
        source: "upload",
        bundleId: "com.example.internal",
        version,
        manifestUrl: null,
        storeId: null,
        fileName: "Internal.ipa",
        contentType: "application/octet-stream",
        size: 3,
        sha256: "f".repeat(64),
        r2Key: `a/org-1/${id}/sha`,
        minOsVersion: null,
        requiredCapability: null,
        priority: version === "2.0" ? 10 : 0,
        createdAt: now,
        updatedAt: now,
      });
    db.store.application_device.push({ deviceId: "iphone-1", applicationId: "app-versions" });
    db.store.device_command.push({
      id: "command-installed-v1",
      organizationId,
      deviceId: "iphone-1",
      requestType: "InstallApplication",
      payload: {
        ManifestURL: "https://enterprise.test/mdm/apple/manifests/app.installer-v1?token=signed",
        InstallAsManaged: true,
        ManagementFlags: 1,
      },
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-versions"),
    );

    expect(result).toMatchObject({ queued: 1, failed: 0 });
    expect(
      db.store.device_command.find(
        (row) => row.requestType === "RemoveApplication" && row.deviceId === "iphone-1",
      ),
    ).toMatchObject({ payload: { BundleIdentifier: "com.example.internal" } });
  });

  it("attributes a legacy upload signed with the application id", async () => {
    const { db, service, headers } = makeContext();

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
      id: "app-legacy",
      organizationId,
      name: "Legacy",
      platform: "apple",
      bundleId: "com.example.legacy",
      version: "1.0",
      source: "upload",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "iphone-1", applicationId: "app-legacy" });
    db.store.device_command.push({
      id: "command-legacy-install",
      organizationId,
      deviceId: "iphone-1",
      requestType: "InstallApplication",
      payload: {
        ManifestURL: "https://enterprise.test/mdm/apple/manifests/app.app-legacy?token=signed",
        InstallAsManaged: true,
        ManagementFlags: 1,
      },
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-legacy"),
    );

    expect(result).toMatchObject({ queued: 1, failed: 0 });
  });

  it("keeps install provenance beyond the command history window", async () => {
    const { db, service, headers } = makeContext();

    for (let index = 0; index < 60; index++)
      db.store.device_command.push({
        id: `command-newer-${index}`,
        organizationId,
        deviceId: "device-1",
        requestType: "InstallApplication",
        payload: { ManifestURL: `https://example.test/${index}.plist` },
        status: "succeeded",
        createdAt: new Date(now.getTime() + index * 1000),
        updatedAt: new Date(now.getTime() + index * 1000),
      });

    db.store.application_install.push({
      id: "provenance-1",
      organizationId,
      deviceId: "device-1",
      applicationId: "app-1",
      installerId: null,
      platform: "apple",
      bundleId: "com.example.internal",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-1"),
    );

    expect(result).toMatchObject({ queued: 1, failed: 0 });
  });

  it("explains a zero count when no device is assigned", async () => {
    const { db, service, headers } = makeContext();

    db.store.application_device.length = 0;

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-1"),
    );

    expect(result).toMatchObject({ queued: 0 });
    expect(result.message).toContain("not assigned");
  });

  it("refuses to remove an app Mattrax did not install", async () => {
    const { db, service, headers } = makeContext();

    db.store.device_command.length = 0;

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-1"),
    );

    expect(result).toMatchObject({ queued: 0, skipped: 0, failed: 1 });
    expect(result.message).toContain("did not install");
    expect(uninstallCommand(db)).toBeUndefined();
    expect(db.store.application_uninstall).toHaveLength(0);
  });

  it("queues the MSI uninstall node for a Windows product code", async () => {
    const { db, service, headers } = makeContext();

    db.store.device.push({
      id: "win-1",
      organizationId,
      proto: "win",
      status: "enrolled",
      name: "PC 1",
      serial: "WIN-1",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.application.push({
      id: "win-app",
      organizationId,
      name: "Chrome",
      platform: "win",
      bundleId: productCode,
      version: "120.0",
      source: "manifest",
      manifestUrl: "https://cdn.example.test/chrome.msi",
      fileName: "chrome.msi",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "win-1", applicationId: "win-app" });
    db.store.device_command.push({
      id: "command-win-install",
      organizationId,
      deviceId: "win-1",
      requestType: "InstallApplication",
      payload: {
        kind: "Exec",
        locURI:
          "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/" +
          encodeURIComponent("{" + productCode + "}") +
          "/DownloadInstall",
        data: "xml",
        format: "xml",
      },
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "win-app"),
    );

    expect(result).toMatchObject({ queued: 1, failed: 0 });
    expect(db.store.application_uninstall[0]).toMatchObject({
      platform: "win",
      bundleId: productCode,
      status: "queued",
    });

    const command = db.store.device_command.find(
      (row) => row.requestType === "WindowsRemoveApplication",
    );

    expect(command).toBeTruthy();
    // SAFETY: windowsMsiUninstallPayload always returns these fields.
    expect(command!.payload.locURI).toContain(encodeURIComponent("{" + productCode + "}"));
    expect(command!.payload.locURI).toMatch(/\/Uninstall$/);
    expect(command!.payload.data).toBe("/quiet /norestart");
  });

  it("reports a Windows app without an MSI ProductCode instead of queueing", async () => {
    const { db, service, headers } = makeContext();

    db.store.device.push({
      id: "win-1",
      organizationId,
      proto: "win",
      status: "enrolled",
      name: "PC 1",
      serial: "WIN-1",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.application.push({
      id: "win-store",
      organizationId,
      name: "Store app",
      platform: "win",
      bundleId: "Microsoft.WindowsCalculator",
      source: "manifest",
      manifestUrl: "https://example.test/app.msix",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_device.push({ deviceId: "win-1", applicationId: "win-store" });
    db.store.device_command.push({
      id: "command-win-store-install",
      organizationId,
      deviceId: "win-1",
      requestType: "InstallApplication",
      payload: { ManifestURL: "https://example.test/app.msix" },
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "win-store"),
    );

    expect(result).toMatchObject({ queued: 0, failed: 1 });
    expect(result.message).toContain("MSI ProductCode");
    expect(
      db.store.device_command.some((row) => row.requestType === "WindowsRemoveApplication"),
    ).toBe(false);
  });

  it("refuses to remove a managed app from an Apple User Enrollment device", async () => {
    const { db, service, headers } = makeContext();

    db.store.device_apple.push({ deviceId: "device-1", enrollmentMode: "user" });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "app-1"),
    );

    expect(result).toMatchObject({ queued: 0, failed: 1 });
    expect(result.message).toContain("User Enrollment");
    expect(db.store.application_uninstall).toHaveLength(0);
  });

  it("refuses an explicit Android uninstall while the app is assigned", async () => {
    const { db, service, headers } = makeContext();

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
    db.store.device_application.push({
      deviceId: "android-1",
      organizationId,
      bundleId: "com.google.android.gm",
      lastReportedAt: now,
    });

    const result = await runEffect(
      service.uninstallApplication(request(headers), organizationId, "android-app"),
    );

    expect(result).toMatchObject({ queued: 0, failed: 1 });
    expect(result.message).toContain("Managed Google Play policy");
    expect(db.store.device_command.some((row) => row.requestType === "RemoveApplication")).toBe(
      false,
    );
  });

  it("removes devices when the app is unassigned and removeOnUnassign is on", async () => {
    const { db, service, headers } = makeContext({ removeOnUnassign: true });

    await runEffect(
      service.patchApplicationAssignments(request(headers), organizationId, "app-1", {
        unassign: { devices: ["device-1"] },
      }),
    );

    expect(uninstallCommand(db)).toBeTruthy();
    expect(db.store.application_uninstall[0]).toMatchObject({
      deviceId: "device-1",
      status: "queued",
    });
    expect(
      db.store.audit_log.find((row) => row.action === "application.uninstall_queued"),
    ).toMatchObject({
      metadata: expect.objectContaining({ trigger: "remove_on_unassign", queued: 1 }),
    });
  });

  it("only stops future installs when removeOnUnassign is off", async () => {
    const { db, service, headers } = makeContext();

    await runEffect(
      service.patchApplicationAssignments(request(headers), organizationId, "app-1", {
        unassign: { devices: ["device-1"] },
      }),
    );

    expect(uninstallCommand(db)).toBeUndefined();
    expect(db.store.application_uninstall).toHaveLength(0);
  });

  it("reconciles a queued uninstall from the next inventory", async () => {
    const db = makeDb();

    db.store.device.push({
      id: "device-1",
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: "iPhone",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.device_command.push({
      id: "command-remove",
      organizationId,
      deviceId: "device-1",
      requestType: "RemoveApplication",
      payload: { BundleIdentifier: "com.example.internal" },
      status: "sent",
      dedupeKey: "key",
      createdAt: now,
      updatedAt: now,
    });
    db.store.application_uninstall.push({
      id: "uninstall-1",
      organizationId,
      deviceId: "device-1",
      applicationId: "app-1",
      installerId: null,
      platform: "apple",
      bundleId: "com.example.internal",
      adamId: null,
      commandId: "command-remove",
      status: "queued",
      requestedAt: now,
      deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      observedVersion: null,
      resultDetail: null,
      createdAt: now,
      updatedAt: now,
    });

    const succeeded = await runEffect(
      reconcileApplicationUninstalls(db as any, {
        deviceId: "device-1",
        organizationId,
        applications: [],
        at: new Date(now.getTime() + 60_000),
      }),
    );

    expect(succeeded).toMatchObject([{ status: "succeeded" }]);
    expect(db.store.application_uninstall[0]).toMatchObject({ status: "succeeded" });
    expect(db.store.device_command[0]).toMatchObject({
      status: "succeeded",
      resultStatus: "Reconciled",
      dedupeKey: null,
    });

    db.store.application_uninstall[0]!.status = "queued";
    db.store.application_uninstall[0]!.deadline = new Date(now.getTime() - 1);
    db.store.device_command[0]!.status = "sent";

    const failed = await runEffect(
      reconcileApplicationUninstalls(db as any, {
        deviceId: "device-1",
        organizationId,
        applications: [{ bundleId: "com.example.internal", version: "1.4.0" }],
        at: now,
      }),
    );

    expect(failed).toMatchObject([{ status: "failed", observedVersion: "1.4.0" }]);
    expect(db.store.application_uninstall[0]).toMatchObject({
      status: "failed",
      observedVersion: "1.4.0",
    });
    expect(db.store.device_command[0]).toMatchObject({ status: "failed" });
  });

  it("fails an uninstall whose deadline passed without an inventory report", async () => {
    const db = makeDb();

    db.store.device.push({
      id: "device-1",
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: "iPhone",
      enrolledAt: now,
      lastSeenAt: now,
    });
    db.store.application_uninstall.push(
      {
        id: "overdue",
        organizationId,
        deviceId: "device-1",
        applicationId: "app-1",
        installerId: null,
        platform: "apple",
        bundleId: "com.example.internal",
        adamId: "361309726",
        commandId: null,
        status: "queued",
        requestedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        deadline: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        observedVersion: null,
        resultDetail: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "not-due",
        organizationId,
        deviceId: "device-1",
        applicationId: "app-2",
        installerId: null,
        platform: "apple",
        bundleId: "com.example.other",
        adamId: null,
        commandId: null,
        status: "queued",
        requestedAt: now,
        deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        observedVersion: null,
        resultDetail: null,
        createdAt: now,
        updatedAt: now,
      },
    );

    const result = await runEffect(sweepDeviceCommands(db as any, { now, retentionDays: 0 }));

    expect(result.failedUninstalls).toBe(1);
    expect(db.store.application_uninstall.find((row) => row.id === "overdue")).toMatchObject({
      status: "failed",
    });
    expect(db.store.application_uninstall.find((row) => row.id === "not-due")).toMatchObject({
      status: "queued",
    });
  });

  it("requires applications.write for uninstall", async () => {
    expect(permissionForMethod("uninstallApplication")).toBe("applications.write");

    const { db, service, headers } = makeContext();

    db.store.member[0]!.role = "auditor";

    await expect(
      runEffect(service.uninstallApplication(request(headers), organizationId, "app-1")),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });
});
