import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEnterpriseService } from "../src/enterpriseHandlers.js";
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

const jsonResponse = (body: unknown, status = 200) =>
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
  }) as typeof globalThis.fetch;

  return { fetchImpl, calls };
};

const makeContext = async () => {
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
        : Effect.fail({ _tag: "EnterpriseUnauthorized", message: "Unauthenticated" });
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
    db: db as any,
    schema,
    origin: "https://enterprise.test",
    storage: {} as any,
    auth: auth as any,
    authSecret,
    appleApi: { fetch: fetchImpl },
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
    expect(profile.filename).toBe("serial-1.mobileconfig");
    expect(profile.plist).toContain("com.apple.mgmt.External.acme");
    expect(profile.plist).toContain(`com.mattrax.ade.${link.profileUuid}`);
    expect(profile.plist).toContain("com.apple.security.scep");
  });

  it("scopes ABM reads and writes to the tenant", async () => {
    const { service, headers } = await makeContext();
    await expect(
      runEffect(service.getAbmDevice(request(headers), otherOrganizationId, "SERIAL-1")),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotFound" });
    await expect(
      runEffect(service.syncAppleBusinessManager(request(headers), otherOrganizationId)),
    ).rejects.toMatchObject({ _tag: "EnterpriseNotConfigured" });
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
    expect((db.store.device_command[0].payload as any).iTunesStoreID).toBe(361309726);
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
    ).rejects.toMatchObject({ _tag: "EnterpriseBadRequest" });
  });
});
