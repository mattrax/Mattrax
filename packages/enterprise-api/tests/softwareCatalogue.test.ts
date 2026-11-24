import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const organizationId = "org-1";
const otherOrganizationId = "org-2";

const makeContext = (role: "owner" | "member" = "owner") => {
  const db = makeDb();
  const now = new Date();

  const user = {
    id: role === "owner" ? "user-1" : "user-2",
    name: role === "owner" ? "Owner" : "Member",
    email: role + "@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);

  for (const id of [organizationId, otherOrganizationId]) {
    db.store.organization.push({
      id,
      name: id === organizationId ? "Acme" : "Other",
      slug: id,
      createdAt: now,
      updatedAt: now,
    });
  }

  db.store.member.push(
    {
      id: "member-1",
      organizationId,
      accountId: user.id,
      role,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "member-2",
      organizationId: otherOrganizationId,
      accountId: user.id,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    },
  );

  db.store.device.push(
    {
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
    },
    {
      id: "iphone-1",
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: "iPhone 1",
      serial: "IPHONE-1",
      osEdition: "iOS",
      osVersion: "17.0",
      enrolledAt: now,
      lastSeenAt: now,
    },
  );

  db.store.apple_push_certificate.push({
    organizationId,
    email: user.email,
    topic: "com.apple.mgmt.External.acme",
    certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    updatedAt: now,
  });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user, apiToken: undefined })
        : Effect.fail(new (class extends Error {})("Unauthenticated"));
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
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake only implements the auth methods this test exercises.
    auth: auth as any,
    authSecret: "software-catalogue-test-secret",
    appleApi: {
      fetch: (async () => new Response("{}")) as typeof globalThis.fetch,
    },
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const addChrome = (
  service: ReturnType<typeof makeContext>["service"],
  headers: Record<string, string>,
) =>
  runEffect(
    service.addSoftwareCatalogueTitle(request(headers), organizationId, "google-chrome", {
      methods: [{ methodId: "ios-app-store" }, { methodId: "android-play" }],
    }),
  );

describe("software catalogue API", () => {
  it("searches by name, alias and vendor", async () => {
    const { service, headers } = makeContext();

    const byName = await runEffect(
      service.searchSoftwareCatalogue(request(headers), organizationId, { q: "chrome" }),
    );
    expect(byName.items[0]?.id).toBe("google-chrome");
    expect(byName.total).toBeGreaterThan(0);
    expect(byName.facets.categories.length).toBeGreaterThan(0);

    const byAlias = await runEffect(
      service.searchSoftwareCatalogue(request(headers), organizationId, { q: "vscode" }),
    );
    expect(byAlias.items[0]?.id).toBe("visual-studio-code");

    const byVendor = await runEffect(
      service.searchSoftwareCatalogue(request(headers), organizationId, { q: "microsoft" }),
    );
    expect(byVendor.items.map((title: { id: string }) => title.id)).toContain("microsoft-teams");
  });

  it("filters by platform and paginates", async () => {
    const { service, headers } = makeContext();

    const android = await runEffect(
      service.searchSoftwareCatalogue(request(headers), organizationId, {
        platform: "android",
        limit: 2,
        offset: 0,
      }),
    );

    expect(android.items).toHaveLength(2);
    expect(android.total).toBeGreaterThan(2);
    for (const title of android.items) expect(title.platforms).toContain("android");
  });

  it("returns one title and its existing additions", async () => {
    const { service, headers } = makeContext();

    const detail = await runEffect(
      service.getSoftwareCatalogueTitle(request(headers), organizationId, "google-chrome"),
    );

    expect(detail.title.name).toBe("Google Chrome");
    expect(detail.additions).toEqual([]);

    await addChrome(service, headers);

    const after = await runEffect(
      service.getSoftwareCatalogueTitle(request(headers), organizationId, "google-chrome"),
    );
    expect(after.additions).toHaveLength(2);
    expect(after.additions.map((row: { methodId: string }) => row.methodId).sort()).toEqual([
      "android-play",
      "ios-app-store",
    ]);
  });

  it("adds the right application and installer for each method", async () => {
    const { db, service, headers } = makeContext();

    const result = await addChrome(service, headers);

    expect(result.applications).toHaveLength(2);
    expect(
      result.applications.every((application: { created: boolean }) => application.created),
    ).toBe(true);

    expect(db.store.application).toHaveLength(2);
    expect(db.store.application).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Google Chrome (iOS)",
          platform: "apple",
          source: "store",
          bundleId: "com.google.chrome.ios",
          storeId: "535886823",
          catalogueTitleId: "google-chrome",
          catalogueMethodId: "ios-app-store",
          catalogueTarget: "ios",
          catalogueKind: "apple-app-store",
        }),
        expect.objectContaining({
          name: "Google Chrome (Android)",
          platform: "android",
          source: "store",
          bundleId: "com.android.chrome",
          catalogueTitleId: "google-chrome",
          catalogueMethodId: "android-play",
          catalogueTarget: "android",
          catalogueKind: "android-play",
        }),
      ]),
    );

    expect(db.store.application_installer).toHaveLength(2);
    expect(db.store.audit_log.map((row: any) => row.action)).toContain(
      "application.catalogue_added",
    );
  });

  it("is idempotent for a method the tenant already added", async () => {
    const { db, service, headers } = makeContext();

    const first = await addChrome(service, headers);
    const second = await addChrome(service, headers);

    expect(second.applications).toHaveLength(2);
    expect(
      second.applications.every((application: { created: boolean }) => !application.created),
    ).toBe(true);
    expect(second.applications.map((application: { id: string }) => application.id)).toEqual(
      first.applications.map((application: { id: string }) => application.id),
    );
    expect(db.store.application).toHaveLength(2);
  });

  it("treats a concurrent retry as one add", async () => {
    const { db, service, headers } = makeContext();

    const [first, second] = await Promise.all([
      addChrome(service, headers),
      addChrome(service, headers),
    ]);

    expect(first.applications).toHaveLength(2);
    expect(second.applications).toHaveLength(2);
    expect(db.store.application).toHaveLength(2);
    expect(
      db.store.application_installer.filter((row: any) => row.source === "store"),
    ).toHaveLength(2);
  });

  it("installs a macOS App Store title only on Macs and an iOS title only on iPhones", async () => {
    const { db, service, headers } = makeContext();

    const added = await runEffect(
      service.addSoftwareCatalogueTitle(request(headers), organizationId, "slack", {
        methods: [{ methodId: "macos-app-store" }, { methodId: "ios-app-store" }],
      }),
    );

    const macApp = added.applications.find(
      (application: { target: string }) => application.target === "macos",
    )!;
    const iosApp = added.applications.find(
      (application: { target: string }) => application.target === "ios",
    )!;

    for (const deviceId of ["device-1", "iphone-1"])
      db.store.application_device.push(
        { deviceId, applicationId: macApp.id },
        { deviceId, applicationId: iosApp.id },
      );

    const macInstall = await runEffect(
      service.installApplication(request(headers), organizationId, macApp.id),
    );
    expect(macInstall).toMatchObject({ status: "ok", queued: 1, skipped: 1 });
    expect(db.store.device_command.at(-1)).toMatchObject({
      deviceId: "device-1",
      requestType: "InstallApplication",
    });

    const iosInstall = await runEffect(
      service.installApplication(request(headers), organizationId, iosApp.id),
    );
    expect(iosInstall).toMatchObject({ status: "ok", queued: 1, skipped: 1 });
    expect(db.store.device_command.at(-1)).toMatchObject({
      deviceId: "iphone-1",
      requestType: "InstallApplication",
    });
  });

  it("rejects a deployment path the pipeline cannot deliver", async () => {
    const { db, service, headers } = makeContext();

    await expect(
      runEffect(
        service.addSoftwareCatalogueTitle(request(headers), organizationId, "windows-terminal", {
          methods: [{ methodId: "windows-store" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(db.store.application).toHaveLength(0);
  });

  it("requires a ProductCode for a Windows MSI", async () => {
    const { db, service, headers } = makeContext();

    await expect(
      runEffect(
        service.addSoftwareCatalogueTitle(request(headers), organizationId, "google-chrome", {
          methods: [{ methodId: "windows-msi" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    const created = await runEffect(
      service.addSoftwareCatalogueTitle(request(headers), organizationId, "google-chrome", {
        methods: [
          {
            methodId: "windows-msi",
            productCode: "8a69f5d9-4b3d-4f7e-9c5a-1b2c3d4e5f60",
          },
        ],
      }),
    );

    expect(created.applications).toHaveLength(1);
    expect(db.store.application[0]).toMatchObject({
      platform: "win",
      source: "manifest",
      bundleId: "{8A69F5D9-4B3D-4F7E-9C5A-1B2C3D4E5F60}",
      manifestUrl: "https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi",
    });
  });

  it("queues a direct vendor PKG through InstallEnterpriseApplication", async () => {
    const { db, service, headers } = makeContext();

    const added = await runEffect(
      service.addSoftwareCatalogueTitle(request(headers), organizationId, "microsoft-teams", {
        methods: [{ methodId: "macos-pkg" }],
      }),
    );

    const applicationId = added.applications[0]!.id;
    db.store.application_device.push({ deviceId: "device-1", applicationId });

    const installed = await runEffect(
      service.installApplication(request(headers), organizationId, applicationId),
    );

    expect(installed).toMatchObject({ status: "ok", queued: 1, skipped: 0 });
    expect(db.store.device_command[0]).toMatchObject({
      requestType: "InstallEnterpriseApplication",
      deviceId: "device-1",
    });
    // SAFETY: the direct PKG path builds this payload shape.
    const payload = db.store.device_command[0]!.payload as any;
    expect(payload.Manifest.items[0].assets[0]).toEqual({
      kind: "software-package",
      url: "https://go.microsoft.com/fwlink/?linkid=2249065",
    });
    expect(payload.Manifest.items[0].metadata["bundle-identifier"]).toBe("com.microsoft.teams2");
  });

  it("refuses a catalogue vendor PKG served over plain HTTP", async () => {
    const { db, service, headers } = makeContext();

    const added = await runEffect(
      service.addSoftwareCatalogueTitle(request(headers), organizationId, "microsoft-teams", {
        methods: [{ methodId: "macos-pkg" }],
      }),
    );

    const applicationId = added.applications[0]!.id;
    const app = db.store.application.find((row: any) => row.id === applicationId)!;
    const installer = db.store.application_installer.find(
      (row: any) => row.applicationId === applicationId,
    )!;

    app.manifestUrl = "http://example.test/Teams.pkg";
    installer.manifestUrl = "http://example.test/Teams.pkg";
    db.store.application_device.push({ deviceId: "device-1", applicationId });

    const installed = await runEffect(
      service.installApplication(request(headers), organizationId, applicationId),
    );

    expect(installed).toMatchObject({ status: "ok", queued: 0, skipped: 1 });
    expect(installed.message).toContain("HTTPS");
    expect(db.store.device_command).toHaveLength(0);
  });

  it("lets a reader search but not add", async () => {
    const { service, headers } = makeContext("member");

    const readable = await runEffect(
      service.searchSoftwareCatalogue(request(headers), organizationId, { q: "slack" }),
    );
    expect(readable.items[0]?.id).toBe("slack");

    await expect(addChrome(service, headers)).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });

  it("does not leak another tenant's title state", async () => {
    const { service, headers } = makeContext();

    await addChrome(service, headers);

    const other = await runEffect(
      service.searchSoftwareCatalogue(request(headers), otherOrganizationId, { q: "chrome" }),
    );
    expect(other.additions).toEqual([]);
  });

  it("reports an unknown title as missing", async () => {
    const { service, headers } = makeContext();

    await expect(
      runEffect(service.getSoftwareCatalogueTitle(request(headers), organizationId, "not-a-title")),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });
});
