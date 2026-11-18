import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseBadRequest, EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const makeContext = async () => {
  const db = makeDb();
  const now = new Date();

  db.store.account.push({
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user: db.store.account[0], apiToken: undefined })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
  });

  const headers = { cookie: "mattrax_session=test" };

  const tenant = await runEffect(
    service.createTenant(request(headers), { name: "Acme", slug: "acme" }),
  );

  const device = {
    id: "win-1",
    organizationId: tenant.id,
    proto: "win",
    status: "enrolled",
    name: "DESKTOP-TEST",
    model: "Surface Laptop 5",
    modelIdentifier: null,
    serial: "SERIAL-1",
    enrolledAt: now,
    lastSeenAt: now,
    notes: null,
    assetTag: null,
    physicalName: "DESKTOP-TEST",
    vendor: "Microsoft",
    osEdition: "Windows 11 Pro",
    osVersion: "10.0.22631",
    osBuild: "22631.3155",
    diskTotal: null,
    diskUsed: null,
    fileVaultEnabled: null,
    batteryHealth: null,
    capabilities: null,
    modelNumber: null,
    inventoryUpdatedAt: now,
    inventoryRequestedAt: now,
    applicationsUpdatedAt: now,
    applicationsRequestedAt: now,
    dmIdentifier: "device-1",
    dmCertHash: null,
    dmIdentityFingerprint: null,
    ddmDeclarationsToken: null,
    bitLockerEnabled: false,
    bitLockerStatus: 4,
    tpmVersion: "1.2",
    secureBootState: 2,
    domainName: null,
    entraDeviceId: null,
    securityUpdatedAt: now,
    windowsPolicyApplied: ["./Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring"],
    windowsPolicyDelivered: [
      { uri: "./Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring", hash: "h1" },
      { uri: "./Vendor/MSFT/Policy/Config/DeviceLock/EnforceLockScreenAndLogonImage", hash: "h2" },
    ],
    windowsPolicyReverting: [
      "./Vendor/MSFT/Policy/Config/DeviceLock/EnforceLockScreenAndLogonImage",
    ],
    windowsPolicyFailures: [
      {
        uri: "./Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring",
        hash: "h1",
        resultStatus: "400",
        detail:
          "OMA-URI ./Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring was rejected by the device with SyncML status 400.",
        at: now.toISOString(),
      },
    ],
    windowsPolicyUpdatedAt: now,
    windowsPolicyRevertedAt: null,
  };

  db.store.device.push(device);

  return { db, service, headers, tenant, device };
};

describe("Windows device API", () => {
  it("exposes security, policy and capability state on the device", async () => {
    const { service, headers, tenant, device } = await makeContext();

    const row = await runEffect(service.getDevice(request(headers), tenant.id, device.id));

    expect(row.windows).toMatchObject({
      security: {
        bitLockerEnabled: false,
        bitLockerStatus: 4,
        tpmVersion: "1.2",
        secureBootState: 2,
        updatedAt: expect.any(String),
      },
      policy: {
        appliedUris: ["./Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring"],
        pendingRevertUris: [
          "./Vendor/MSFT/Policy/Config/DeviceLock/EnforceLockScreenAndLogonImage",
        ],
        failed: [expect.objectContaining({ resultStatus: "400" })],
        revertedAt: null,
      },
    });
    expect(row.actions).toContain("wipe");
    expect(row.actions).toContain("restart");
    expect(row.actions).toContain("unenroll");
    expect(row.actions).not.toContain("sync");
  });

  it("rejects an action the device cannot run", async () => {
    const { service, headers, tenant, device } = await makeContext();

    await expect(
      runEffect(service.deviceAction(request(headers), tenant.id, device.id, { action: "lock" })),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    await expect(
      runEffect(service.deviceAction(request(headers), tenant.id, device.id, { action: "sync" })),
    ).rejects.toMatchObject({ message: expect.stringContaining("no push channel") });
  });

  it("queues a Windows wipe action", async () => {
    const { db, service, headers, tenant, device } = await makeContext();

    const result = await runEffect(
      service.deviceAction(request(headers), tenant.id, device.id, { action: "wipe" }),
    );

    expect(result.status).toBe("ok");
    expect(db.store.device_command).toEqual([
      expect.objectContaining({
        requestType: "WindowsWipe",
        status: "queued",
        payload: expect.objectContaining({
          locURI: "./Device/Vendor/MSFT/RemoteWipe/doWipeProtected",
        }),
      }),
    ]);
  });

  it("moves a Windows device through unenrolling and queues the unenroll Exec", async () => {
    const { db, service, headers, tenant, device } = await makeContext();

    await runEffect(service.deviceUnenroll(request(headers), tenant.id, device.id));

    expect(db.store.device[0]!.status).toBe("unenrolling");
    expect(db.store.device_command).toEqual([
      expect.objectContaining({
        requestType: "WindowsUnenroll",
        status: "queued",
        payload: expect.objectContaining({
          kind: "Exec",
          locURI: "./Vendor/MSFT/DMClient/Provider/Mattrax/Unenroll",
          data: "Mattrax",
        }),
      }),
    ]);
  });
});
