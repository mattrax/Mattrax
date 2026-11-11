import { describe, expect, it } from "vitest";
import {
  assignVppLicence,
  openVppToken,
  parseVppTokenUpload,
  releaseVppLicence,
  saveVppToken,
  sealVppToken,
  syncVppAssets,
  vppInfo,
} from "../src/volumePurchase.js";
import { makeDb, runEffect } from "./helpers.js";

const authSecret = "vpp-test-secret";
const organizationId = "org-1";
const otherOrganizationId = "org-2";

const contentToken = (overrides: Record<string, unknown> = {}) =>
  btoa(
    JSON.stringify({
      token: "vpp-org-token",
      expDate: "2030-11-08T22:33:22+0000",
      orgName: "ORG12345",
      ...overrides,
    }),
  );

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const makeFetch = (
  options: {
    assets?: Array<Record<string, unknown>>;
    tokenStatus?: number;
  } = {},
) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (options.tokenStatus && options.tokenStatus !== 200)
      return jsonResponse(
        { errorMessage: "Invalid token", errorNumber: 9601 },
        options.tokenStatus,
      );
    if (url.includes("/v2/assets/associate")) return jsonResponse({ eventId: "associate-event-1" });
    if (url.includes("/v2/assets/disassociate"))
      return jsonResponse({ eventId: "disassociate-event-1" });
    if (url.includes("/v2/assets"))
      return jsonResponse({
        assets: options.assets ?? [],
        currentPageIndex: 0,
        totalPages: 1,
      });
    return jsonResponse({ errorMessage: `Unexpected URL ${url}` }, 500);
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
};

const makeDbWithTenant = () => {
  const db = makeDb();
  const now = new Date();
  for (const id of [organizationId, otherOrganizationId]) {
    db.store.organization.push({
      id,
      name: id,
      slug: id,
      createdAt: now,
      updatedAt: now,
    });
  }
  db.store.device.push({
    id: "device-1",
    organizationId,
    proto: "apple",
    status: "enrolled",
    name: "Mac 1",
    serial: "SERIAL-1",
    enrolledAt: now,
    lastSeenAt: now,
  });
  db.store.device.push({
    id: "device-other",
    organizationId: otherOrganizationId,
    proto: "apple",
    status: "enrolled",
    name: "Other Mac",
    serial: "OTHER-SERIAL",
    enrolledAt: now,
    lastSeenAt: now,
  });
  return db;
};

const saveToken = async (db: any, fetchImpl: typeof fetch) =>
  runEffect(
    saveVppToken({
      db,
      organizationId,
      authSecret,
      upload: { content: contentToken() },
      config: { fetch: fetchImpl },
    }),
  );

const seedAsset = (db: any, overrides: Record<string, unknown> = {}) => {
  const now = new Date();
  db.store.vpp_asset.push({
    organizationId,
    adamId: "361309726",
    name: "Pages",
    bundleId: "com.apple.Pages",
    totalLicenses: 5,
    availableLicenses: 5,
    assignedLicenses: 0,
    retiredLicenses: 0,
    pricingParam: "STDQ",
    deviceAssignable: true,
    revocable: true,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
};

describe("Apps and Books tokens", () => {
  it("parses the base64 sToken and rejects expired tokens", async () => {
    const parsed = await parseVppTokenUpload({ content: contentToken() });
    expect(parsed).toMatchObject({ tokenId: "vpp-org-token", orgName: "ORG12345" });
    expect(parsed.expiresAt.getUTCFullYear()).toBe(2030);

    await expect(
      parseVppTokenUpload({
        content: contentToken({ expDate: "2000-01-01T00:00:00+0000" }),
      }),
    ).rejects.toMatchObject({ kind: "expired" });
  });

  it("seals the content token and never exposes it in info", async () => {
    const token = await parseVppTokenUpload({ content: contentToken() });
    const sealed = await sealVppToken(authSecret, token);
    expect(sealed).not.toContain("ORG12345");
    const opened = await openVppToken(authSecret, sealed);
    expect(opened.contentToken).toBe(contentToken());
    await expect(openVppToken("wrong", sealed)).rejects.toMatchObject({ kind: "invalid_token" });
  });

  it("fails closed when unconfigured and records Apple rejection", async () => {
    const db = makeDbWithTenant();
    await expect(runEffect(vppInfo(db, organizationId))).resolves.toMatchObject({
      configured: false,
      status: "unconfigured",
    });
    const { fetchImpl } = makeFetch({ tokenStatus: 401 });
    await expect(saveToken(db, fetchImpl)).rejects.toMatchObject({ kind: "unauthorized" });
    expect(db.store.vpp_token[0]).toMatchObject({ status: "error" });
  });
});

describe("Apps and Books asset sync and licences", () => {
  it("syncs assets and keeps tenant rows separate", async () => {
    const db = makeDbWithTenant();
    const { fetchImpl } = makeFetch({
      assets: [
        {
          adamId: "361309726",
          totalCount: 10,
          availableCount: 8,
          assignedCount: 2,
          retiredCount: 0,
          pricingParam: "STDQ",
          deviceAssignable: true,
          revocable: true,
          productType: "App",
          supportedPlatforms: ["iOS", "macOS"],
        },
      ],
    });
    await saveToken(db, fetchImpl);
    const result = await runEffect(
      syncVppAssets({
        db,
        organizationId,
        authSecret,
        config: { fetch: fetchImpl },
        appMetadata: new Map([["361309726", { name: "Pages", bundleId: "com.apple.Pages" }]]),
      }),
    );
    expect(result).toMatchObject({
      assets: 1,
      totalLicenses: 10,
      availableLicenses: 8,
      assignedLicenses: 2,
    });
    expect(db.store.vpp_asset[0]).toMatchObject({
      organizationId,
      adamId: "361309726",
      name: "Pages",
      bundleId: "com.apple.Pages",
    });
    expect(db.store.vpp_asset).toHaveLength(1);
    expect(db.store.vpp_asset.some((row) => row.organizationId === otherOrganizationId)).toBe(
      false,
    );
  });

  it("consumes a licence, records the assignment and is idempotent", async () => {
    const db = makeDbWithTenant();
    const { fetchImpl, calls } = makeFetch();
    await saveToken(db, fetchImpl);
    seedAsset(db);

    const first = await runEffect(
      assignVppLicence({
        db,
        organizationId,
        deviceId: "device-1",
        adamId: "361309726",
        authSecret,
        config: { fetch: fetchImpl },
      }),
    );
    expect(first).toMatchObject({ serial: "SERIAL-1", eventId: "associate-event-1" });
    expect(db.store.vpp_asset[0]).toMatchObject({ availableLicenses: 4, assignedLicenses: 1 });
    expect(db.store.device_vpp_assignment[0]).toMatchObject({
      organizationId,
      deviceId: "device-1",
      adamId: "361309726",
      state: "assigned",
    });

    const second = await runEffect(
      assignVppLicence({
        db,
        organizationId,
        deviceId: "device-1",
        adamId: "361309726",
        authSecret,
        config: { fetch: fetchImpl },
      }),
    );
    expect(second).toMatchObject({ serial: "SERIAL-1" });
    expect(db.store.vpp_asset[0]).toMatchObject({ availableLicenses: 4, assignedLicenses: 1 });
    expect(calls.filter((call) => call.url.includes("/associate"))).toHaveLength(1);
  });

  it("fails closed when no licence is available and records the failed attempt", async () => {
    const db = makeDbWithTenant();
    const { fetchImpl } = makeFetch();
    await saveToken(db, fetchImpl);
    seedAsset(db, { availableLicenses: 0, assignedLicenses: 5 });

    await expect(
      runEffect(
        assignVppLicence({
          db,
          organizationId,
          deviceId: "device-1",
          adamId: "361309726",
          authSecret,
          config: { fetch: fetchImpl },
        }),
      ),
    ).rejects.toMatchObject({ kind: "no_license" });
    expect(db.store.device_vpp_assignment[0]).toMatchObject({ state: "failed" });
    expect(db.store.vpp_asset[0]).toMatchObject({ availableLicenses: 0, assignedLicenses: 5 });
  });

  it("releases a revocable licence and returns it to the pool", async () => {
    const db = makeDbWithTenant();
    const { fetchImpl, calls } = makeFetch();
    await saveToken(db, fetchImpl);
    seedAsset(db);
    await runEffect(
      assignVppLicence({
        db,
        organizationId,
        deviceId: "device-1",
        adamId: "361309726",
        authSecret,
        config: { fetch: fetchImpl },
      }),
    );

    const result = await runEffect(
      releaseVppLicence({
        db,
        organizationId,
        deviceId: "device-1",
        adamId: "361309726",
        authSecret,
        config: { fetch: fetchImpl },
      }),
    );
    expect(result).toMatchObject({ released: true, eventId: "disassociate-event-1" });
    expect(db.store.vpp_asset[0]).toMatchObject({ availableLicenses: 5, assignedLicenses: 0 });
    expect(db.store.device_vpp_assignment[0]).toMatchObject({ state: "revoked" });
    expect(calls.some((call) => call.url.includes("/disassociate"))).toBe(true);
  });

  it("does not let a tenant assign a licence to another tenant's device", async () => {
    const db = makeDbWithTenant();
    const { fetchImpl } = makeFetch();
    await saveToken(db, fetchImpl);
    seedAsset(db);
    await expect(
      runEffect(
        assignVppLicence({
          db,
          organizationId,
          deviceId: "device-other",
          adamId: "361309726",
          authSecret,
          config: { fetch: fetchImpl },
        }),
      ),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
