import type { Schema } from "effect";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  EnterprisePermissionDenied,
} from "@mattrax/enterprise-domain";
import { permissionForMethod } from "@mattrax/enterprise-identity";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const organizationId = "org-1";

const otherOrganizationId = "org-2";

const jsonResponse = (body: Schema.Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const found = (region: string, trackId = "111111") => ({
  resultCount: 1,
  results: [
    {
      wrapperType: "software",
      kind: "software",
      trackId,
      trackName: `Example ${region}`,
      bundleId: "com.example.app",
      version: "3.2.1",
    },
  ],
});

type LookupHandler = (region: string) => Response | Promise<Response>;

const lookupFetch = (handler: LookupHandler) => {
  const calls: Array<{ region: string; url: string }> = [];

  // SAFETY: the lookup client only calls fetch with a URL and reads the
  // response the handler returns, which is the surface this double implements.
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const parsed = new URL(url);
    const region = parsed.searchParams.get("country") ?? "";
    calls.push({ region, url });

    return handler(region);
  }) as typeof globalThis.fetch;

  return { fetchImpl, calls };
};

const makeContext = async (overrides: { lookup?: LookupHandler; autoUnlink?: boolean } = {}) => {
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

  db.store.account.push(user);

  for (const id of [organizationId, otherOrganizationId]) {
    db.store.organization.push({
      id,
      name: id === organizationId ? "Acme" : "Other",
      slug: id,
      appStoreRegion: "US",
      autoUnlinkUnavailableApplications: overrides.autoUnlink ?? false,
      createdAt: now,
      updatedAt: now,
    });
  }

  db.store.member.push(
    {
      id: "member-1",
      organizationId,
      accountId: user.id,
      role: "owner",
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

  db.store.device.push({
    id: "device-1",
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: "Mac 1",
    serial: "SERIAL-1",
    osEdition: "macOS",
    osVersion: "14.0",
    capabilities: ["vpp"],
    enrolledAt: now,
    lastSeenAt: now,
  });

  db.store.enterprise_group.push({
    id: "group-1",
    organizationId,
    name: "Design",
    kind: "static",
    createdAt: now,
    updatedAt: now,
  });
  db.store.group_device.push({ groupId: "group-1", deviceId: "device-1" });
  db.store.user_group.push({
    id: "user-group-1",
    organizationId,
    name: "Engineering",
    createdAt: now,
    updatedAt: now,
  });
  db.store.user_group_application.push({
    organizationId,
    groupId: "user-group-1",
    applicationId: "app-1",
    createdAt: now,
  });

  db.store.application.push({
    id: "app-1",
    organizationId,
    name: "Example",
    platform: "apple",
    source: "store",
    bundleId: "com.example.app",
    storeId: "111111",
    availability: "unknown",
    createdAt: now,
    updatedAt: now,
  });
  db.store.application_group.push({ groupId: "group-1", applicationId: "app-1" });
  db.store.application_device.push({ deviceId: "device-1", applicationId: "app-1" });

  // Installed-application inventory must survive an unlink untouched.
  db.store.device_application.push({
    deviceId: "device-1",
    organizationId,
    bundleId: "com.example.app",
    name: "Example",
    version: "3.2.1",
    hasUpdateAvailable: false,
    isManaged: true,
    lastReportedAt: now,
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

  const { fetchImpl } = lookupFetch(overrides.lookup ?? ((region) => jsonResponse(found(region))));

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
    authSecret: "app-storefront-test-secret",
    appleApi: { fetch: fetchImpl },
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

describe("application storefronts", () => {
  it("records a per-region id mapping and exposes it on the application", async () => {
    const { db, service, headers } = await makeContext();

    const result = await runEffect(
      service.patchApplicationStorefronts(request(headers), organizationId, "app-1", {
        storefronts: [
          { region: "us", storeId: "111111" },
          { region: "GB", storeId: "222222", name: "Example UK" },
        ],
      }),
    );

    expect(result.availability).toBe("available");
    expect(result.storefronts.map((row: any) => row.region)).toEqual(["GB", "US"]);
    expect(result.storefronts).toMatchObject([
      { region: "GB", storeId: "222222", available: true, source: "manual" },
      { region: "US", storeId: "111111", available: true, source: "manual" },
    ]);
    expect(db.store.application_storefront).toHaveLength(2);

    const application = await runEffect(
      service.getApplication(request(headers), organizationId, "app-1"),
    );

    expect(application.storefronts).toHaveLength(2);
    expect(application.availability).toBe("available");
  });

  it("rejects duplicate regions and available rows without an id", async () => {
    const { service, headers } = await makeContext();

    await expect(
      runEffect(
        service.patchApplicationStorefronts(request(headers), organizationId, "app-1", {
          storefronts: [
            { region: "US", storeId: "1" },
            { region: "us", storeId: "2" },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        service.patchApplicationStorefronts(request(headers), organizationId, "app-1", {
          storefronts: [{ region: "US", storeId: null, available: true }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(
        service.patchApplicationStorefronts(request(headers), organizationId, "app-1", {
          storefronts: [{ region: "USA", storeId: "1" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("queues the id resolved for the tenant's storefront", async () => {
    const { db, service, headers } = await makeContext();

    await runEffect(
      service.patchApplicationStorefronts(request(headers), organizationId, "app-1", {
        storefronts: [{ region: "US", storeId: "999999" }],
      }),
    );

    const installed = await runEffect(
      service.installApplication(request(headers), organizationId, "app-1"),
    );

    expect(installed).toMatchObject({ status: "ok", queued: 1, skipped: 0 });
    expect(db.store.device_command[0]).toMatchObject({
      requestType: "InstallApplication",
      deviceId: "device-1",
    });
    expect(db.store.device_command[0]!.payload.iTunesStoreID).toBe(999999);
  });

  it("marks an app unavailable when its storefront no longer lists it", async () => {
    let missing = false;

    const { db, service, headers } = await makeContext({
      lookup: (region) =>
        jsonResponse(missing ? { resultCount: 0, results: [] } : found(region, "777777")),
    });

    const first = await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["us"],
      }),
    );

    expect(first.availability).toBe("available");
    expect(first.storefronts).toMatchObject([
      { region: "US", storeId: "777777", available: true, source: "lookup" },
    ]);
    expect(first.errors).toEqual([]);

    const seenAt = first.storefronts[0].lastSeenAt;
    expect(seenAt).toBeTruthy();

    missing = true;

    const second = await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["US"],
      }),
    );

    expect(second.availability).toBe("unavailable");
    expect(second.storefronts).toMatchObject([
      {
        region: "US",
        storeId: "777777",
        available: false,
        reason: "Not found in the US App Store",
      },
    ]);
    expect(second.storefronts[0].lastSeenAt).toBe(seenAt);

    const application = await runEffect(
      service.getApplication(request(headers), organizationId, "app-1"),
    );

    expect(application).toMatchObject({
      availability: "unavailable",
      availabilityReason: "Not found in the US App Store",
      lastSeenAt: seenAt,
    });

    // New installs are refused honestly; the assignment is untouched.
    const installed = await runEffect(
      service.installApplication(request(headers), organizationId, "app-1"),
    );

    expect(installed).toMatchObject({
      status: "ok",
      queued: 0,
      skipped: 1,
      message: "Not found in the US App Store",
    });
    expect(db.store.device_command).toHaveLength(0);
    expect(db.store.application_group).toHaveLength(1);

    // Repeating the check is idempotent: one row, same summary.
    const third = await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["US"],
      }),
    );

    expect(third.availability).toBe("unavailable");
    expect(db.store.application_storefront).toHaveLength(1);
  });

  it("leaves availability intact when the lookup itself fails", async () => {
    let fail = false;

    const { service, headers } = await makeContext({
      lookup: (region) => {
        if (fail) throw new Error("network down");

        return jsonResponse(found(region, "888888"));
      },
    });

    await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["US"],
      }),
    );

    fail = true;

    const result = await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["US"],
      }),
    );

    expect(result.availability).toBe("available");
    expect(result.errors).toHaveLength(1);
    expect(result.storefronts[0]).toMatchObject({ region: "US", available: true });
  });

  it("unlinks every assignment but keeps the application and install history", async () => {
    const { db, service, headers } = await makeContext();

    const unlinked = await runEffect(
      service.unlinkApplicationAssignments(request(headers), organizationId, "app-1", {
        reason: "Pulled by the vendor",
      }),
    );

    expect(unlinked).toEqual({
      status: "ok",
      removed: { groups: 1, userGroups: 1, devices: 1 },
      retainedApplication: true,
    });
    expect(db.store.application_group).toHaveLength(0);
    expect(db.store.application_device).toHaveLength(0);
    expect(db.store.user_group_application).toHaveLength(0);
    expect(db.store.application).toHaveLength(1);
    expect(db.store.device_application).toHaveLength(1);
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "application.assignments_unlinked",
      targetId: "app-1",
      metadata: expect.objectContaining({
        groups: 1,
        userGroups: 1,
        devices: 1,
        trigger: "manual",
        reason: "Pulled by the vendor",
      }),
    });

    // Repeating the action is a no-op and does not duplicate audit entries.
    const again = await runEffect(
      service.unlinkApplicationAssignments(request(headers), organizationId, "app-1", {}),
    );

    expect(again.removed).toEqual({ groups: 0, userGroups: 0, devices: 0 });
    expect(db.store.audit_log).toHaveLength(1);
  });

  it("can auto-unlink when the tenant opts in", async () => {
    let missing = false;

    const { db, service, headers } = await makeContext({
      autoUnlink: true,
      lookup: () => jsonResponse(missing ? { resultCount: 0, results: [] } : found("US")),
    });

    await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["US"],
      }),
    );

    expect(db.store.application_group).toHaveLength(1);

    missing = true;

    const result = await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["US"],
      }),
    );

    expect(result.availability).toBe("unavailable");
    expect(result.unlinked).toEqual({ groups: 1, userGroups: 1, devices: 1 });
    expect(db.store.application_group).toHaveLength(0);
    expect(db.store.application_device).toHaveLength(0);
    expect(db.store.user_group_application).toHaveLength(0);
    expect(db.store.application).toHaveLength(1);
    expect(db.store.audit_log.at(-1)).toMatchObject({
      action: "application.assignments_unlinked",
      metadata: expect.objectContaining({
        groups: 1,
        userGroups: 1,
        devices: 1,
        trigger: "auto_unavailable",
        reason: "Not found in the US App Store",
      }),
    });
  });

  it("does not auto-unlink unless the tenant opted in", async () => {
    const { db, service, headers } = await makeContext({
      lookup: () => jsonResponse({ resultCount: 0, results: [] }),
    });

    const result = await runEffect(
      service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {
        regions: ["US"],
      }),
    );

    expect(result.availability).toBe("unavailable");
    expect(result.unlinked).toBeUndefined();
    expect(db.store.application_group).toHaveLength(1);
  });

  it("scopes storefront reads and writes to the tenant", async () => {
    const { service, headers } = await makeContext();

    await expect(
      runEffect(
        service.patchApplicationStorefronts(request(headers), otherOrganizationId, "app-1", {
          storefronts: [{ region: "US", storeId: "1" }],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    await expect(
      runEffect(
        service.refreshApplicationStorefronts(request(headers), otherOrganizationId, "app-1", {}),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    await expect(
      runEffect(
        service.unlinkApplicationAssignments(request(headers), otherOrganizationId, "app-1", {}),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("requires applications.write for storefront and unlink actions", async () => {
    expect(permissionForMethod("patchApplicationStorefronts")).toBe("applications.write");
    expect(permissionForMethod("refreshApplicationStorefronts")).toBe("applications.write");
    expect(permissionForMethod("unlinkApplicationAssignments")).toBe("applications.write");

    const { db, service, headers } = await makeContext();
    db.store.member[0].role = "auditor";

    await expect(
      runEffect(
        service.patchApplicationStorefronts(request(headers), organizationId, "app-1", {
          storefronts: [],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    await expect(
      runEffect(
        service.refreshApplicationStorefronts(request(headers), organizationId, "app-1", {}),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);

    await expect(
      runEffect(
        service.unlinkApplicationAssignments(request(headers), organizationId, "app-1", {}),
      ),
    ).rejects.toBeInstanceOf(EnterprisePermissionDenied);
  });
});
