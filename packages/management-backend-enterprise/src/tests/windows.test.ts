import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { arrayBufferToBase64, exportPrivateKeyJwk, generateCaKeyPair } from "@mattrax/crypto";
import { certToPem, createCaCertificate, pemToCert, signScepCsr } from "@mattrax/scep";
import { MdmOrigin, UnknownDevice } from "@mattrax/management-backend";
import {
  createWindowsEnrollmentToken,
  createWindowsTenantToken,
  createWindowsBackend,
  verifyWindowsEnrollmentToken,
  verifyWindowsEnrollmentTokenDetailed,
  verifyWindowsTenantToken,
  verifyWindowsTenantTokenDetailed,
  windowsTenantTokenExpiresAt,
} from "../windows.js";
import { dbRows, makeDb, tableName, type Store, dateValue } from "./fake-db.js";
import {
  WINDOWS_APPLICATION_INVENTORY_REQUESTS,
  WINDOWS_APPLICATION_INVENTORY_URI,
  WINDOWS_INVENTORY_REQUESTS,
  WINDOWS_INVENTORY_URI,
  WINDOWS_MDM_PROVIDER_ID,
  windowsUnenrollUri,
} from "../windowsInventory.js";
import {
  WINDOWS_POLICY_DELETE_REQUEST_TYPE,
  WINDOWS_POLICY_REPLACE_REQUEST_TYPE,
  WINDOWS_UNENROLL_REQUEST_TYPE,
} from "../windowsCommands.js";
import { parsePlanLimits, schema } from "@mattrax/enterprise-core";
import type { Row } from "./fake-db.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const origin = "https://windows.test";

const authSecret = "windows-test-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const makeCa = async () => {
  const keyPair = await generateCaKeyPair();
  const privateKeyJwk = await exportPrivateKeyJwk(keyPair.privateKey);
  const certificate = await createCaCertificate(keyPair, "Mattrax Windows Test CA");

  return { certPem: certToPem(certificate), privateKeyJwk, certificate };
};

const makeCsr = async (commonName = "DESKTOP-TEST") => {
  const keyPair = await generateCaKeyPair();
  const csr = new pkijs.CertificationRequest();
  csr.version = 0;
  csr.subject = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: commonName }),
      }),
    ],
  });
  await csr.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await csr.sign(keyPair.privateKey, "SHA-256");

  return arrayBufferToBase64(csr.toSchema().toBER(false));
};

const organizationRow = (id: string, createdAt: Date) => ({
  id,
  name: id,
  slug: id,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt,
  updatedAt: createdAt,
});

const enrollmentRow = (organizationId: string) => ({
  id: `enrollment-${organizationId}`,
  organizationId,
  code: null,
  enabledApple: true,
  enabledWindows: true,
  enabledAndroid: false,
  enabledAssetTag: false,
  maxDevices: 100,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
});

const setup = async (
  overrides: {
    windowsOrganizationId?: string | null;
    requireDeviceIdentity?: boolean;
    tenantTokenTtlSeconds?: number;
    planLimits?: ReturnType<typeof parsePlanLimits>;
    subscription?: Row;
    devices?: Array<Row>;
    ssoConfig?: Array<Row>;
    federated?: Parameters<typeof createWindowsBackend>[0]["federated"];
  } = {},
) => {
  const ca = await makeCa();

  const initial: Store = {
    [tableName(schema.organization)]: [
      organizationRow("org-late", new Date("2024-02-01T00:00:00Z")),
      organizationRow("org-early", new Date("2024-01-01T00:00:00Z")),
    ],
    [tableName(schema.scepCa)]: [
      {
        id: 1,
        organizationId: "org-early",
        certPem: ca.certPem,
        privateKeyJwk: ca.privateKeyJwk,
        source: "generated",
        createdAt: new Date(),
        rotatedAt: null,
      },
    ],
    [tableName(schema.enterpriseEnrollment)]: [
      enrollmentRow("org-late"),
      enrollmentRow("org-early"),
    ],
  };

  if (overrides.subscription) initial[tableName(schema.subscription)] = [overrides.subscription];

  if (overrides.devices) initial[tableName(schema.device)] = overrides.devices;

  if (overrides.ssoConfig) initial[tableName(schema.ssoConfig)] = overrides.ssoConfig;

  const db = makeDb(initial);

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = createWindowsBackend({
    db: db as any,
    origin,
    authSecret,
    windowsOrganizationId:
      overrides.windowsOrganizationId === null
        ? undefined
        : (overrides.windowsOrganizationId ?? "org-early"),
    requireDeviceIdentity: overrides.requireDeviceIdentity,
    tenantTokenTtlSeconds: overrides.tenantTokenTtlSeconds,
    planLimits: overrides.planLimits,
    federated: overrides.federated,
  });

  return { ca, db, backend };
};

const enrollmentRequest = (authToken: string, csr: string, deviceId = "device-1") => ({
  authToken,
  csr,
  deviceId,
  deviceName: "DESKTOP-TEST",
  enrollmentType: "Full",
  context: { DeviceID: deviceId, DeviceName: "DESKTOP-TEST" },
  mdmOrigin,
});

/**
 * Mark the seeded devices as freshly inventoried so tests that assert on
 * policy/operator commands are not coupled to the inventory `Get` requests that
 * a genuinely new device receives on its first check-in.
 */
const commandPayload = (row: Row): Schema.JsonObject | undefined =>
  Schema.is(Schema.JsonObject)(row.payload) ? row.payload : undefined;

const suppressInventory = (db: ReturnType<typeof makeDb>) => {
  const now = new Date();

  for (const row of db.store[tableName(schema.device)] ?? []) {
    row.inventoryRequestedAt = now;
    row.inventoryUpdatedAt = now;
    row.applicationsRequestedAt = now;
    row.applicationsUpdatedAt = now;
  }
};

const federatedTenantId = "11111111-1111-1111-1111-111111111111";

const federatedAudience = "22222222-2222-2222-2222-222222222222";

const base64Url = (value: Uint8Array | string): string => {
  const bytes = Schema.is(Schema.String)(value) ? new TextEncoder().encode(value) : value;
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const makeFederatedSigner = async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  return {
    privateKey: pair.privateKey,
    jwks: {
      keys: [
        {
          kty: "RSA",
          kid: "federated-test-key",
          use: "sig",
          alg: "RS256",
          n: publicJwk.n!,
          e: publicJwk.e!,
        },
      ],
    },
  };
};

const makeFederatedToken = async (
  signer: Awaited<ReturnType<typeof makeFederatedSigner>>,
  overrides: Row = {},
) => {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "federated-test-key" }));
  const now = Math.floor(Date.now() / 1000);

  const payload = base64Url(
    JSON.stringify({
      iss: `https://login.microsoftonline.com/${federatedTenantId}/v2.0`,
      aud: federatedAudience,
      tid: federatedTenantId,
      sub: "federated-subject",
      oid: "federated-device-object",
      upn: "device@contoso.com",
      exp: now + 3_600,
      nbf: now - 10,
      iat: now - 10,
      ...overrides,
    }),
  );

  const signingInput = `${header}.${payload}`;

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      signer.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );

  return `${signingInput}.${base64Url(signature)}`;
};

const federatedSsoConfig = (organizationId: string) => ({
  organizationId,
  enabled: true,
  azureTenantId: federatedTenantId,
  autoProvision: true,
  requireMfa: false,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
});

describe("Windows enterprise backend", () => {
  it("discovers the OnPremise policy and enrollment services", async () => {
    const { backend } = await setup();

    const response = await run(
      backend.windowsDiscovery({
        requestVersion: "5.0",
        deviceType: "CIMClient_Windows",
        applicationVersion: "10.0",
        osEdition: 48,
        authPolicies: ["OnPremise"],
        mdmOrigin,
      }),
    );

    expect(response).toEqual({
      authPolicy: "OnPremise",
      enrollmentVersion: "4.0",
      enrollmentPolicyServiceUrl: `${origin}/mdm/windows/policy`,
      enrollmentServiceUrl: `${origin}/mdm/windows/enroll`,
    });
  });

  it("issues a short-lived policy and a verifiable enrollment token", async () => {
    const { backend } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));

    expect(policy.minimalKeyLength).toBe("2048");
    expect(policy.certificateValidityPeriodSeconds).toBe("31536000");
    expect(policy.renewalPeriodSeconds).toBe("15552000");
    const verification = await verifyWindowsEnrollmentToken(policy.authToken, authSecret);
    expect(verification).not.toBeNull();
    expect(verification!.subject).toBeTruthy();
  });

  it("rejects forged Mattrax policy tokens but allows opaque or expired-but-verifiable tokens", async () => {
    const { backend } = await setup();
    // The WSTEP policy request carries an opaque client credential before any
    // Mattrax token exists; that first-enrollment path must keep working.
    await expect(
      run(backend.getWindowsEnrollmentPolicy("opaque-wstep-client-credential")),
    ).resolves.toMatchObject({ authToken: expect.any(String) });

    // A token in our format that fails signature verification is not a first
    // enrollment.
    const forged = await createWindowsEnrollmentToken("subject", "wrong-secret");
    await expect(run(backend.getWindowsEnrollmentPolicy(forged))).rejects.toMatchObject({
      _tag: "UnknownDevice" as const,
    });

    // An authentic token whose lifetime elapsed may start a fresh enrollment
    // subject, so a device that was offline for a while is not wedged.
    const expired = await createWindowsEnrollmentToken("subject", authSecret, {
      now: Date.now() - 2 * 60 * 60 * 1000,
    });

    const renewed = await run(backend.getWindowsEnrollmentPolicy(expired));
    const verification = await verifyWindowsEnrollmentToken(renewed.authToken, authSecret);
    expect(verification).not.toBeNull();
    expect(verification!.subject).not.toBe("subject");
  });

  it("enrolls a CSR, issues a client-auth certificate and creates a device", async () => {
    const { backend, db, ca } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    const csr = await makeCsr();
    const result = await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, csr)));

    expect(result.deviceId).toBe("device-1");
    expect(result.identityCertificate).toBe(ca.certPem);
    expect(result.providerId).toBe("Mattrax");
    expect(result.username).toBe("device-1");
    expect(result.secret).toBeTruthy();
    expect(result.signedCertificate).toContain("-----BEGIN CERTIFICATE-----");

    const certificate = pemToCert(result.signedCertificate);
    expect(await certificate.verify(pemToCert(ca.certPem))).toBe(true);
    expect(certificate.subject.typesAndValues[0]!.value.valueBlock.value).toBe("device-1");
    const extensionIds = certificate.extensions?.map((extension) => extension.extnID) ?? [];
    // ExtendedKeyUsage (clientAuth) and the Microsoft DeviceID extension.
    expect(extensionIds.filter((id) => id === "2.5.29.37")).toHaveLength(1);
    expect(extensionIds).toContain("1.3.6.1.4.1.311.66.1.0");

    const deviceExtension = certificate.extensions!.find(
      (extension) => extension.extnID === "1.3.6.1.4.1.311.66.1.0",
    )!;

    expect(new Uint8Array(deviceExtension.extnValue.valueBlock.valueHexView)).toEqual(
      new Uint8Array(new asn1js.Utf8String({ value: "device-1" }).toBER(false)),
    );

    const devices = dbRows(db, tableName(schema.device));
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      organizationId: "org-early",
      proto: "win",
      status: "enrolled",
      name: "DESKTOP-TEST",
      vendor: "Microsoft",
      dmIdentifier: "device-1",
    });

    // Linkage: the certificate must be recorded against the internal device
    // row id, not the Windows DeviceID, or revocation/health/renewal miss it.
    const certificates = dbRows(db, tableName(schema.scepIssuedCertificate));
    expect(certificates).toHaveLength(1);
    expect(certificates[0]!.deviceId).toBe(devices[0]!.id);
    expect(certificates[0]!.deviceId).not.toBe(devices[0]!.dmIdentifier);
    expect(certificates[0]!.organizationId).toBe("org-early");

    // Wide, positive ASN.1 serial from the CSR signer.
    const serialBytes = certificate.serialNumber.valueBlock.valueHexView;
    expect(serialBytes.byteLength).toBeGreaterThanOrEqual(8);
    expect(serialBytes[0]! & 0x80).toBe(0);
  });

  it("rejects a new Windows device when the plan device limit is reached", async () => {
    const now = new Date("2024-03-01T00:00:00Z");

    const { backend, db } = await setup({
      planLimits: parsePlanLimits(JSON.stringify({ free: { devices: 1 } })),
      subscription: {
        id: "sub-1",
        plan: "free",
        referenceId: "org-early",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      devices: [
        {
          id: "existing",
          organizationId: "org-early",
          proto: "win",
          status: "enrolled",
          name: "EXISTING",
          dmIdentifier: "device-existing",
          enrolledAt: now,
          lastSeenAt: now,
        },
      ],
    });

    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    const csr = await makeCsr();
    await expect(
      run(backend.windowsEnroll(enrollmentRequest(policy.authToken, csr, "device-1"))),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });
    expect(dbRows(db, tableName(schema.device))).toHaveLength(1);
  });

  it("allows re-enrolling an existing Windows device above the plan limit", async () => {
    const now = new Date("2024-03-01T00:00:00Z");

    const { backend, db } = await setup({
      planLimits: parsePlanLimits(JSON.stringify({ free: { devices: 1 } })),
      subscription: {
        id: "sub-1",
        plan: "free",
        referenceId: "org-early",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      devices: [
        {
          id: "existing",
          organizationId: "org-early",
          proto: "win",
          status: "enrolled",
          name: "EXISTING",
          dmIdentifier: "device-existing",
          enrolledAt: now,
          lastSeenAt: now,
        },
      ],
    });

    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    const csr = await makeCsr();
    await expect(
      run(backend.windowsEnroll(enrollmentRequest(policy.authToken, csr, "device-existing"))),
    ).resolves.toMatchObject({ deviceId: "device-existing" });
    expect(dbRows(db, tableName(schema.device))).toHaveLength(1);
  });

  it("updates an existing device instead of inserting a duplicate", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr("FIRST"))));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr("SECOND"))));

    const devices = dbRows(db, tableName(schema.device));
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe("DESKTOP-TEST");
    const certificates = dbRows(db, tableName(schema.scepIssuedCertificate));
    expect(certificates).toHaveLength(2);

    for (const certificate of certificates) expect(certificate.deviceId).toBe(devices[0]!.id);
    expect(certificates[0]!.serial).not.toBe(certificates[1]!.serial);
  });

  it("rejects forged and expired enrollment tokens", async () => {
    const { backend } = await setup();
    const csr = await makeCsr();

    await expect(
      run(backend.windowsEnroll(enrollmentRequest("forged.token.value", csr))),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });

    const expired = await createWindowsEnrollmentToken("subject", authSecret, {
      now: Date.now() - 2 * 60 * 60 * 1000,
    });

    await expect(run(backend.windowsEnroll(enrollmentRequest(expired, csr)))).rejects.toMatchObject(
      { _tag: "UnknownDevice" as const },
    );
  });

  it("verifies token expiry and tampering deterministically", async () => {
    const now = 1_700_000_000_000;

    const token = await createWindowsEnrollmentToken("subject", authSecret, {
      now,
      ttlSeconds: 60,
    });

    await expect(
      verifyWindowsEnrollmentToken(token, authSecret, { now, ttlSeconds: 60 }),
    ).resolves.toMatchObject({ subject: "subject" });
    await expect(
      verifyWindowsEnrollmentToken(token, authSecret, {
        now: now + 61_000,
        ttlSeconds: 60,
      }),
    ).resolves.toBeNull();
    await expect(
      verifyWindowsEnrollmentTokenDetailed(token, authSecret, {
        now: now + 61_000,
        ttlSeconds: 60,
      }),
    ).resolves.toEqual({ verification: null, expired: true });
    await expect(
      verifyWindowsEnrollmentTokenDetailed(`${token}tampered`, authSecret, { now }),
    ).resolves.toEqual({ verification: null, expired: false });
    await expect(
      verifyWindowsEnrollmentToken(`${token}tampered`, authSecret, { now }),
    ).resolves.toBeNull();
  });

  it("returns no commands for management check-in and updates lastSeenAt", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));
    suppressInventory(db);

    const old = new Date("2020-01-01T00:00:00Z");
    db.store[tableName(schema.device)]![0]!.lastSeenAt = old;

    const response = await run(
      backend.windowsManagementCheckin(
        { deviceId: "device-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [],
          alerts: [],
        },
      ),
    );

    expect(response).toEqual({ commands: [] });
    const device = db.store[tableName(schema.device)]![0]!;
    expect(dateValue(device.lastSeenAt).getTime()).toBeGreaterThan(old.getTime());
  });

  it("requests inventory on the first check-in and throttles repeats", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    const checkin = () =>
      run(
        backend.windowsManagementCheckin(
          { deviceId: "device-1", mdmOrigin },
          {
            sessionID: "1",
            msgID: "1",
            source: "device-1",
            target: origin,
            statuses: [],
            alerts: [],
          },
        ),
      );

    const first = await checkin();
    const gets = first.commands.filter((command) => command.kind === "Get");

    expect(gets).toHaveLength(
      WINDOWS_INVENTORY_REQUESTS.length + WINDOWS_APPLICATION_INVENTORY_REQUESTS.length,
    );
    expect(gets.map((command) => command.locURI)).toContain(
      WINDOWS_APPLICATION_INVENTORY_URI.win32,
    );
    expect(gets.map((command) => command.locURI)).toContain(WINDOWS_INVENTORY_URI.osVersion);
    expect(gets.map((command) => command.locURI)).toContain(WINDOWS_INVENTORY_URI.serial);
    expect(gets.map((command) => command.locURI)).toContain(WINDOWS_INVENTORY_URI.model);
    expect(dateValue(db.store[tableName(schema.device)]![0]!.inventoryRequestedAt)).toBeInstanceOf(
      Date,
    );
    expect(
      dateValue(db.store[tableName(schema.device)]![0]!.applicationsRequestedAt),
    ).toBeInstanceOf(Date);

    // The same check-in cycle must not re-ask. Only a report (or the refresh
    // interval) can make inventory due again.
    expect((await checkin()).commands).toEqual([]);
  });

  it("applies a SyncML Results report to the device row", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    const results = [
      {
        cmdID: "3",
        msgRef: "1",
        cmdRef: "windows-inventory-os-version",
        items: [
          {
            source: { locURI: WINDOWS_INVENTORY_URI.osVersion },
            data: "10.0.19045.3803",
          },
        ],
      },
      {
        cmdID: "4",
        msgRef: "1",
        // No Source: the stable inventory command id identifies the URI.
        cmdRef: "windows-inventory-serial",
        items: [{ data: "SERIAL-123" }],
      },
      {
        cmdID: "5",
        msgRef: "1",
        cmdRef: "windows-inventory-device-name",
        items: [{ source: { locURI: WINDOWS_INVENTORY_URI.deviceName }, data: "DESKTOP-ABC" }],
      },
      {
        cmdID: "6",
        msgRef: "1",
        cmdRef: "windows-inventory-model",
        items: [{ source: { locURI: WINDOWS_INVENTORY_URI.model }, data: "Surface Laptop 5" }],
      },
      {
        cmdID: "7",
        msgRef: "1",
        cmdRef: "windows-inventory-system-sku",
        items: [{ source: { locURI: WINDOWS_INVENTORY_URI.systemSKU }, data: "Surface_Laptop_5" }],
      },
      {
        cmdID: "8",
        msgRef: "1",
        cmdRef: "windows-inventory-os-platform",
        items: [{ source: { locURI: WINDOWS_INVENTORY_URI.osPlatform }, data: "Windows 11 Pro" }],
      },
      {
        cmdID: "9",
        msgRef: "1",
        cmdRef: "windows-inventory-total-storage",
        items: [{ source: { locURI: WINDOWS_INVENTORY_URI.totalStorage }, data: "512000" }],
      },
      {
        cmdID: "10",
        msgRef: "1",
        cmdRef: "windows-inventory-free-storage",
        items: [{ source: { locURI: WINDOWS_INVENTORY_URI.freeStorage }, data: "128000" }],
      },
    ];

    const response = await run(
      backend.windowsManagementCheckin(
        { deviceId: "device-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [],
          alerts: [],
          results,
        },
      ),
    );

    // The report satisfies the DevDetail cadence guard, but the installed
    // application inventory is still due because this report carried none.
    expect(response.commands.map((command) => command.cmdID)).toEqual(
      WINDOWS_APPLICATION_INVENTORY_REQUESTS.map((request) => request.cmdID),
    );

    const device = dbRows(db, tableName(schema.device))[0]!;
    expect(device).toMatchObject({
      model: "Surface Laptop 5",
      modelIdentifier: "Surface_Laptop_5",
      serial: "SERIAL-123",
      osEdition: "Windows 11 Pro",
      osVersion: "10.0.19045",
      osBuild: "19045.3803",
      diskTotal: String(512000 * 1024 * 1024),
      diskUsed: String((512000 - 128000) * 1024 * 1024),
    });
    // Enrollment supplied a human name, so the inventory one must not replace it.
    expect(device.name).toBe("DESKTOP-TEST");
    expect(dateValue(device.inventoryUpdatedAt)).toBeInstanceOf(Date);
  });

  it("stores the installed-application inventory reported by a device", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    const win32 = (key: string, field: string, value: string) => ({
      source: {
        locURI: `./Vendor/MSFT/Win32AppInventory/Win32InstalledProgram/InstalledProgram/${key}/${field}`,
      },
      data: value,
    });

    const response = await run(
      backend.windowsManagementCheckin(
        { deviceId: "device-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [],
          alerts: [],
          results: [
            {
              cmdID: "11",
              msgRef: "1",
              cmdRef: "windows-app-inventory-win32",
              items: [
                win32("Google Chrome", "Name", "Google Chrome"),
                win32("Google Chrome", "Version", "131.0.6778.86"),
                win32("Google Chrome", "Publisher", "Google LLC"),
                win32("Google Chrome", "RegKey", "Google Chrome"),
              ],
            },
            {
              cmdID: "12",
              msgRef: "1",
              cmdRef: "windows-app-inventory-msi",
              items: [
                {
                  source: {
                    locURI:
                      "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/COMPANY-APP/Name",
                  },
                  data: "Contoso Client",
                },
                {
                  source: {
                    locURI:
                      "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/COMPANY-APP/Status",
                  },
                  data: "70",
                },
              ],
            },
          ],
        },
      ),
    );

    const applications = dbRows(db, tableName(schema.deviceApplication));
    expect(applications).toHaveLength(2);
    expect(
      applications
        .map((row) => row.bundleId)
        .sort((left: any, right: any) => String(left).localeCompare(String(right))),
    ).toEqual(["COMPANY-APP", "Google Chrome"]);
    expect(applications.find((row) => row.bundleId === "Google Chrome")).toMatchObject({
      name: "Google Chrome",
      version: "131.0.6778.86",
      publisher: "Google LLC",
      isManaged: false,
    });
    expect(applications.find((row) => row.bundleId === "COMPANY-APP")).toMatchObject({
      name: "Contoso Client",
      isManaged: true,
    });

    const device = dbRows(db, tableName(schema.device))[0]!;
    expect(dateValue(device.applicationsUpdatedAt)).toBeInstanceOf(Date);
    // The app inventory was just reported, so it is not requested again.
    expect(response.commands.filter((command) => command.locURI?.includes("AppInventory"))).toEqual(
      [],
    );
  });

  it("fills an enrollment placeholder name from inventory", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));
    db.store[tableName(schema.device)]![0]!.name = "device-1";

    await run(
      backend.windowsManagementCheckin(
        { deviceId: "device-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [],
          alerts: [],
          results: [
            {
              cmdID: "3",
              msgRef: "1",
              cmdRef: "windows-inventory-device-name",
              items: [
                { source: { locURI: WINDOWS_INVENTORY_URI.deviceName }, data: "DESKTOP-ABC" },
              ],
            },
          ],
        },
      ),
    );

    expect(dbRows(db, tableName(schema.device))[0]!.name).toBe("DESKTOP-ABC");
  });

  it("does not reuse another device's serial", async () => {
    const now = new Date("2024-01-01T00:00:00Z");

    const { backend, db } = await setup({
      devices: [
        {
          id: "existing",
          organizationId: "org-early",
          proto: "win",
          status: "enrolled",
          name: "EXISTING",
          serial: "SERIAL-123",
          dmIdentifier: "device-existing",
          enrolledAt: now,
          lastSeenAt: now,
        },
      ],
    });

    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    await run(
      backend.windowsManagementCheckin(
        { deviceId: "device-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [],
          alerts: [],
          results: [
            {
              cmdID: "3",
              msgRef: "1",
              cmdRef: "windows-inventory-serial",
              items: [{ source: { locURI: WINDOWS_INVENTORY_URI.serial }, data: "SERIAL-123" }],
            },
          ],
        },
      ),
    );

    const enrolled = dbRows(db, tableName(schema.device)).find((row) => row.id !== "existing")!;
    expect(enrolled.serial ?? null).toBeNull();
  });

  it("requires a matching client certificate when configured", async () => {
    const { backend, db } = await setup({ requireDeviceIdentity: true });
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));
    suppressInventory(db);

    await expect(
      run(
        backend.windowsManagementCheckin(
          { deviceId: "device-1", mdmOrigin },
          {
            sessionID: "1",
            msgID: "1",
            source: "device-1",
            target: origin,
            statuses: [],
            alerts: [],
          },
        ),
      ),
    ).rejects.toBeInstanceOf(UnknownDevice);

    const response = await run(
      backend.windowsManagementCheckin(
        {
          deviceId: "device-1",
          identityCertificate: "O=Mattrax, OU=org-early, CN=device-1",
          mdmOrigin,
        },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [],
          alerts: [],
        },
      ),
    );

    expect(response.commands).toEqual([]);
  });

  it("rejects management check-in from an unknown device", async () => {
    const { backend } = await setup();
    await expect(
      run(
        backend.windowsManagementCheckin(
          { deviceId: "missing", mdmOrigin },
          {
            sessionID: "1",
            msgID: "1",
            source: "missing",
            target: origin,
            statuses: [],
            alerts: [],
          },
        ),
      ),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });
  });

  it("upserts on Enrolled and touches the device on CommandResult", async () => {
    const { backend, db } = await setup();
    await run(
      backend.windowsDeviceEvent(
        { deviceId: "device-2", mdmOrigin },
        {
          _tag: "Enrolled" as const,
          deviceId: "device-2",
        },
      ),
    );

    const devices = dbRows(db, tableName(schema.device));
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      proto: "win",
      status: "enrolled",
      dmIdentifier: "device-2",
    });

    const old = new Date("2020-01-01T00:00:00Z");
    db.store[tableName(schema.device)]![0]!.lastSeenAt = old;
    await run(
      backend.windowsDeviceEvent(
        { deviceId: "device-2", mdmOrigin },
        { _tag: "CommandResult" as const, deviceId: "device-2", status: "200" },
      ),
    );
    expect(dateValue(db.store[tableName(schema.device)]![0]!.lastSeenAt).getTime()).toBeGreaterThan(
      old.getTime(),
    );
  });

  it("pins Windows devices to a configured tenant", async () => {
    const { backend, db } = await setup({ windowsOrganizationId: "org-late" });
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    expect(dbRows(db, tableName(schema.device))[0]!.organizationId).toBe("org-late");
  });

  it("fails closed when neither a tenant token nor a pin is present", async () => {
    const { backend } = await setup({ windowsOrganizationId: null });
    await expect(
      run(
        backend.windowsDiscovery({
          requestVersion: "5.0",
          deviceType: "CIMClient_Windows",
          applicationVersion: "10.0",
          osEdition: 48,
          authPolicies: ["OnPremise"],
          mdmOrigin,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });
  });
});

describe("Windows tenant enrollment tokens", () => {
  it("creates a verifiable token that expires", async () => {
    const now = 1_700_000_000_000;

    const token = await createWindowsTenantToken("org-late", authSecret, {
      now,
      ttlSeconds: 60,
    });

    await expect(verifyWindowsTenantToken(token, authSecret, { now })).resolves.toMatchObject({
      organizationId: "org-late",
    });
    const expiresAt = windowsTenantTokenExpiresAt(token);
    expect(expiresAt?.getTime()).toBe(now + 60_000);
    await expect(
      verifyWindowsTenantToken(token, authSecret, { now: now + 61_000 }),
    ).resolves.toBeNull();
    await expect(
      verifyWindowsTenantTokenDetailed(token, authSecret, { now: now + 61_000 }),
    ).resolves.toEqual({ verification: null, expired: true });
  });

  it("rejects tampered and wrong-secret tokens", async () => {
    const now = 1_700_000_000_000;
    const token = await createWindowsTenantToken("org-late", authSecret, { now });
    await expect(
      verifyWindowsTenantToken(`${token}tampered`, authSecret, { now }),
    ).resolves.toBeNull();
    await expect(verifyWindowsTenantToken(token, "wrong-secret", { now })).resolves.toBeNull();
    // Swapping the encoded organization must invalidate the signature.
    const parts = token.split(".");
    const other = (await createWindowsTenantToken("org-early", authSecret, { now })).split(".");
    const swapped = [parts[0], other[1], parts[2], parts[3], parts[4]].join(".");
    await expect(verifyWindowsTenantToken(swapped, authSecret, { now })).resolves.toBeNull();
  });

  it("routes discovery, policy and enrollment to the token's tenant", async () => {
    const { backend, db } = await setup({ windowsOrganizationId: null });
    const token = await createWindowsTenantToken("org-late", authSecret);
    const encoded = encodeURIComponent(token);

    const discovery = await run(
      backend.windowsDiscovery({
        requestVersion: "5.0",
        deviceType: "CIMClient_Windows",
        applicationVersion: "10.0",
        osEdition: 48,
        authPolicies: ["OnPremise"],
        mdmOrigin,
        tenantToken: token,
      }),
    );

    expect(discovery.enrollmentPolicyServiceUrl).toBe(
      `${origin}/mdm/windows/policy?tenant=${encoded}`,
    );
    expect(discovery.enrollmentServiceUrl).toBe(`${origin}/mdm/windows/enroll?tenant=${encoded}`);

    const policy = await run(backend.getWindowsEnrollmentPolicy("", { tenantToken: token }));
    await run(
      backend.windowsEnroll({
        ...enrollmentRequest(policy.authToken, await makeCsr()),
        tenantToken: token,
      }),
    );
    expect(dbRows(db, tableName(schema.device))[0]!.organizationId).toBe("org-late");
  });

  it("rejects a WSTEP token issued to another tenant", async () => {
    const { backend } = await setup({ windowsOrganizationId: null });
    const lateToken = await createWindowsTenantToken("org-late", authSecret);
    const earlyToken = await createWindowsTenantToken("org-early", authSecret);
    const policy = await run(backend.getWindowsEnrollmentPolicy("", { tenantToken: lateToken }));

    await expect(
      run(
        backend.windowsEnroll({
          ...enrollmentRequest(policy.authToken, await makeCsr()),
          tenantToken: earlyToken,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });

    // Replaying the late tenant's WSTEP token through the early tenant's
    // policy endpoint must also fail.
    await expect(
      run(backend.getWindowsEnrollmentPolicy(policy.authToken, { tenantToken: earlyToken })),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });
  });

  it("rejects a tenant token that disagrees with the client certificate", async () => {
    const { backend } = await setup({ requireDeviceIdentity: true });
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    const lateToken = await createWindowsTenantToken("org-late", authSecret);
    await expect(
      run(
        backend.windowsManagementCheckin(
          {
            deviceId: "device-1",
            identityCertificate: "O=Mattrax, OU=org-early, CN=device-1",
            tenantToken: lateToken,
            mdmOrigin,
          },
          {
            sessionID: "1",
            msgID: "1",
            source: "device-1",
            target: origin,
            statuses: [],
            alerts: [],
          },
        ),
      ),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });
  });
});

describe("Windows identity lifecycle", () => {
  const checkin = (backend: Awaited<ReturnType<typeof setup>>["backend"], scope: any) =>
    run(
      backend.windowsManagementCheckin(scope, {
        sessionID: "1",
        msgID: "1",
        source: scope.deviceId,
        target: origin,
        statuses: [],
        alerts: [],
      }),
    );

  it("rejects a revoked identity certificate serial and accepts an active one", async () => {
    const { backend, db } = await setup({ requireDeviceIdentity: true });
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));
    suppressInventory(db);

    const certificate = dbRows(db, tableName(schema.scepIssuedCertificate))[0]!;
    const storedCertificate = db.store[tableName(schema.scepIssuedCertificate)]![0]!;

    const scope = {
      deviceId: "device-1",
      identityCertificate: "O=Mattrax, OU=org-early, CN=device-1",
      identityCertificateSerial: Schema.decodeUnknownSync(Schema.String)(certificate.serial),
      mdmOrigin,
    };

    await expect(checkin(backend, scope)).resolves.toEqual({ commands: [] });

    // A management URL token expires long before the device certificate; the
    // certificate OU must keep the device checking in.
    const expiredToken = await createWindowsTenantToken("org-early", authSecret, {
      now: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });

    await expect(checkin(backend, { ...scope, tenantToken: expiredToken })).resolves.toEqual({
      commands: [],
    });

    storedCertificate.revokedAt = new Date();
    await expect(checkin(backend, scope)).rejects.toMatchObject({ _tag: "UnknownDevice" as const });

    storedCertificate.revokedAt = null;
    await expect(checkin(backend, scope)).resolves.toEqual({ commands: [] });
  });

  it("enforces identity on management events but allows enrollment with a tenant token", async () => {
    const { backend } = await setup({
      requireDeviceIdentity: true,
      windowsOrganizationId: null,
    });

    const token = await createWindowsTenantToken("org-early", authSecret);

    // Enrollment events arrive before a client certificate exists.
    await expect(
      run(
        backend.windowsDeviceEvent(
          { deviceId: "device-2", tenantToken: token, mdmOrigin },
          { _tag: "Enrolled" as const, deviceId: "device-2" },
        ),
      ),
    ).resolves.toBeUndefined();

    await expect(
      run(
        backend.windowsDeviceEvent(
          { deviceId: "device-2", tenantToken: token, mdmOrigin },
          { _tag: "ManagementCheckin" as const, deviceId: "device-2" },
        ),
      ),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" as const });

    await expect(
      run(
        backend.windowsDeviceEvent(
          {
            deviceId: "device-2",
            identityCertificate: "O=Mattrax, OU=org-early, CN=device-2",
            tenantToken: token,
            mdmOrigin,
          },
          { _tag: "ManagementCheckin" as const, deviceId: "device-2" },
        ),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("Windows federated Entra enrollment", () => {
  const setupFederated = async () => {
    const signer = await makeFederatedSigner();

    const setupResult = await setup({
      ssoConfig: [federatedSsoConfig("org-early")],
      federated: {
        enabled: true,
        audience: federatedAudience,
        jwks: signer.jwks,
      },
    });

    return { ...setupResult, signer };
  };

  it("advertises Federated with a tenant-specific auth service URL", async () => {
    const { backend } = await setupFederated();
    const token = await createWindowsTenantToken("org-early", authSecret);

    const response = await run(
      backend.windowsDiscovery({
        requestVersion: "5.0",
        deviceType: "CIMClient_Windows",
        applicationVersion: "10.0",
        osEdition: 48,
        authPolicies: ["Federated"],
        tenantToken: token,
        mdmOrigin,
      }),
    );

    expect(response.authPolicy).toBe("Federated");
    expect(response.authServiceUrl).toContain(federatedTenantId);
    expect(response.authServiceUrl).toContain("/wsfed");
    expect(response.enrollmentPolicyServiceUrl).toContain("/mdm/windows/policy?tenant=");
  });

  it("keeps OnPremise when the client does not offer Federated", async () => {
    const { backend } = await setupFederated();
    const token = await createWindowsTenantToken("org-early", authSecret);

    const response = await run(
      backend.windowsDiscovery({
        requestVersion: "5.0",
        deviceType: "CIMClient_Windows",
        applicationVersion: "10.0",
        osEdition: 48,
        authPolicies: ["OnPremise"],
        tenantToken: token,
        mdmOrigin,
      }),
    );

    expect(response.authPolicy).toBe("OnPremise");
    expect(response.authServiceUrl).toBeUndefined();
  });

  it("keeps OnPremise policy/enroll working for a federated-configured tenant", async () => {
    const { backend } = await setupFederated();
    const tenantToken = await createWindowsTenantToken("org-early", authSecret);
    const policy = await run(backend.getWindowsEnrollmentPolicy("", { tenantToken }));
    expect(policy.authToken).toBeTruthy();

    const enrolled = await run(
      backend.windowsEnroll({
        ...enrollmentRequest(policy.authToken, await makeCsr("ONPREM-HOST")),
        tenantToken,
      }),
    );

    expect(enrolled.signedCertificate).toContain("BEGIN CERTIFICATE");
  });

  it("fails closed when a federated-mode tenant token is used without a JWT", async () => {
    const { backend } = await setupFederated();

    const federatedToken = await createWindowsTenantToken("org-early", authSecret, {
      federated: true,
    });

    await expect(
      run(backend.getWindowsEnrollmentPolicy("", { tenantToken: federatedToken })),
    ).rejects.toBeInstanceOf(UnknownDevice);
  });

  it("validates the Entra token before issuing a WSTEP policy token", async () => {
    const { backend, signer } = await setupFederated();
    const tenantToken = await createWindowsTenantToken("org-early", authSecret);
    const jwt = await makeFederatedToken(signer);
    const policy = await run(backend.getWindowsEnrollmentPolicy(jwt, { tenantToken }));

    expect(policy.authToken).toBeTruthy();
    expect(policy.authToken.split(".")).toHaveLength(3);
  });

  it("fails closed for a token with an invalid signature", async () => {
    const { backend } = await setupFederated();
    const tenantToken = await createWindowsTenantToken("org-early", authSecret);
    const otherSigner = await makeFederatedSigner();
    const jwt = await makeFederatedToken(otherSigner);

    await expect(
      run(backend.getWindowsEnrollmentPolicy(jwt, { tenantToken })),
    ).rejects.toBeInstanceOf(UnknownDevice);
  });

  it("fails closed when the token tenant does not match the enrollment tenant", async () => {
    const { backend, signer } = await setupFederated();
    const tenantToken = await createWindowsTenantToken("org-early", authSecret);

    const jwt = await makeFederatedToken(signer, {
      tid: "33333333-3333-3333-3333-333333333333",
      iss: "https://login.microsoftonline.com/33333333-3333-3333-3333-333333333333/v2.0",
    });

    await expect(
      run(backend.getWindowsEnrollmentPolicy(jwt, { tenantToken })),
    ).rejects.toBeInstanceOf(UnknownDevice);
  });

  it("enrolls a device with a valid federated token", async () => {
    const { backend, signer, db } = await setupFederated();
    const tenantToken = await createWindowsTenantToken("org-early", authSecret);
    const jwt = await makeFederatedToken(signer);

    const result = await run(
      backend.windowsEnroll({
        ...enrollmentRequest(jwt, await makeCsr("FEDERATED-HOST")),
        tenantToken,
      }),
    );

    expect(result.deviceId).toBe("device-1");
    expect(result.signedCertificate).toContain("BEGIN CERTIFICATE");
    const devices = dbRows(db, tableName(schema.device));
    expect(devices.some((device) => device.dmIdentifier === "device-1")).toBe(true);
  });
});

describe("SCEP CSR signing helper", () => {
  it("signs a PKCS#10 CSR with the CA and client-auth extensions", async () => {
    const ca = await makeCa();

    const signed = await run(
      signScepCsr({
        csr: await makeCsr("WINDOWS-HOST"),
        caCertPem: ca.certPem,
        caPrivateKeyJwk: ca.privateKeyJwk,
        deviceId: "device-extension",
      }),
    );

    const certificate = signed.certificate;
    expect(await certificate.verify(ca.certificate)).toBe(true);
    const extensionIds = certificate.extensions?.map((extension) => extension.extnID) ?? [];
    expect(extensionIds.filter((id) => id === "2.5.29.37")).toHaveLength(1);
    expect(extensionIds).toContain("1.3.6.1.4.1.311.66.1.0");

    const eku = certificate.extensions!.find((extension) => extension.extnID === "2.5.29.37")!;
    expect(new Uint8Array(eku.extnValue.valueBlock.valueHexView)).toEqual(
      new Uint8Array(
        new asn1js.Sequence({
          value: [new asn1js.ObjectIdentifier({ value: "1.3.6.1.5.5.7.3.2" })],
        }).toBER(false),
      ),
    );
  });
});

describe("Windows command history and desired-state policy", () => {
  const table = (value: any) => tableName(value);

  const checkin = (
    backend: Awaited<ReturnType<typeof setup>>["backend"],
    input: {
      statuses?: Array<unknown>;
      alerts?: Array<unknown>;
      results?: Array<unknown>;
    } = {},
  ) =>
    run(
      backend.windowsManagementCheckin(
        { deviceId: "device-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: input.statuses ?? [],
          alerts: input.alerts ?? [],
          results: input.results,
        },
      ),
    );

  const seedPolicy = (
    db: ReturnType<typeof makeDb>,
    deviceId: string,
    nodes: ReadonlyArray<{ omaUri: string; value: Schema.Json; format?: string }>,
  ) => {
    const createdAt = new Date("2024-01-01T00:00:00Z");

    db.store[table(schema.policy)] = [
      {
        id: "policy-1",
        organizationId: "org-early",
        name: "Windows security",
        notes: null,
        priority: 0,
        createdAt,
        updatedAt: createdAt,
        __table: table(schema.policy),
      },
    ];
    db.store[table(schema.devicePolicy)] = [
      {
        deviceId,
        policyId: "policy-1",
        mode: "include",
        __table: table(schema.devicePolicy),
      },
    ];
    db.store[table(schema.configuration)] = [
      {
        kind: "mttx.windows.custom.security",
        policyId: "policy-1",
        data: { nodes },
        hash: "hash-1",
        __table: table(schema.configuration),
      },
    ];
  };

  const enroll = async () => {
    const result = await setup();

    const policy = await run(result.backend.getWindowsEnrollmentPolicy(""));

    await run(result.backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    const device = dbRows(result.db, table(schema.device))[0]!;

    return { ...result, device };
  };

  it("creates a row for each policy Replace and reconciles its result", async () => {
    const { backend, db, device } = await enroll();

    suppressInventory(db);
    seedPolicy(db, String(device.id), [
      {
        omaUri: "./Vendor/MSFT/Policy/Config/DeviceLock/EnforceLockScreenAndLogonImage",
        value: 1,
        format: "int",
      },
    ]);

    const first = await checkin(backend);
    const replace = first.commands.find((command) => command.kind === "Replace")!;

    expect(replace.locURI).toBe(
      "./Vendor/MSFT/Policy/Config/DeviceLock/EnforceLockScreenAndLogonImage",
    );
    expect(replace.cmdID.startsWith("winp-r-")).toBe(true);

    const delivered = dbRows(db, table(schema.deviceCommand)).find(
      (row) => row.id === replace.cmdID,
    );

    expect(delivered).toMatchObject({
      requestType: WINDOWS_POLICY_REPLACE_REQUEST_TYPE,
      status: "sent",
    });
    expect(commandPayload(delivered!)?.locURI).toBe(replace.locURI);

    const second = await checkin(backend, {
      statuses: [{ cmdRef: replace.cmdID, data: "200" }],
    });

    expect(second.commands).toEqual([]);
    expect(dbRows(db, table(schema.device))[0]!.windowsPolicyApplied).toContain(replace.locURI);
    expect(
      dbRows(db, table(schema.deviceCommand)).find((row) => row.id === replace.cmdID),
    ).toMatchObject({ status: "succeeded", resultStatus: "200" });
  });

  it("records the rejected OMA-URI and status on the device", async () => {
    const { backend, db, device } = await enroll();

    suppressInventory(db);
    seedPolicy(db, String(device.id), [
      { omaUri: "./Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring", value: 1 },
    ]);

    const first = await checkin(backend);
    const replace = first.commands.find((command) => command.kind === "Replace")!;

    await checkin(backend, {
      statuses: [{ cmdRef: replace.cmdID, data: "400" }],
    });

    expect(
      dbRows(db, table(schema.deviceCommand)).find((row) => row.id === replace.cmdID),
    ).toMatchObject({
      status: "failed",
      resultStatus: "400",
    });
    expect(dbRows(db, table(schema.device))[0]!.windowsPolicyFailures).toEqual([
      expect.objectContaining({
        uri: replace.locURI,
        resultStatus: "400",
        detail: expect.stringContaining(replace.locURI!),
      }),
    ]);

    // The rejection stays visible instead of being overwritten immediately.
    expect((await checkin(backend)).commands).toEqual([]);
  });

  it("emits Delete when a policy stops providing an applied setting", async () => {
    const { backend, db, device } = await enroll();

    suppressInventory(db);
    seedPolicy(db, String(device.id), [
      { omaUri: "./Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring", value: 1 },
    ]);

    const first = await checkin(backend);
    const replace = first.commands.find((command) => command.kind === "Replace")!;

    await checkin(backend, { statuses: [{ cmdRef: replace.cmdID, data: "200" }] });

    // Disabling the policy removes its configuration from the device's
    // effective set.
    db.store[table(schema.devicePolicy)] = [];

    const removed = await checkin(backend);
    const remove = removed.commands.find((command) => command.kind === "Delete")!;

    expect(remove.locURI).toBe(replace.locURI);
    expect(remove.cmdID.startsWith("winp-d-")).toBe(true);
    expect(
      dbRows(db, table(schema.deviceCommand)).find((row) => row.id === remove.cmdID),
    ).toMatchObject({ requestType: WINDOWS_POLICY_DELETE_REQUEST_TYPE, status: "sent" });
    expect(dbRows(db, table(schema.device))[0]!.windowsPolicyReverting).toEqual([replace.locURI]);

    await checkin(backend, { statuses: [{ cmdRef: remove.cmdID, data: "200" }] });

    const reverted = dbRows(db, table(schema.device))[0]!;

    expect(reverted.windowsPolicyApplied).toEqual([]);
    expect(reverted.windowsPolicyDelivered).toEqual([]);
    expect(reverted.windowsPolicyReverting).toEqual([]);
    expect(dateValue(reverted.windowsPolicyRevertedAt)).toBeInstanceOf(Date);
  });

  it("creates a row for each inventory Get and marks answered nodes", async () => {
    const { backend, db } = await enroll();

    const first = await checkin(backend);
    const gets = first.commands.filter((command) => command.kind === "Get");

    expect(gets.length).toBe(
      WINDOWS_INVENTORY_REQUESTS.length + WINDOWS_APPLICATION_INVENTORY_REQUESTS.length,
    );

    const rows = dbRows(db, table(schema.deviceCommand));

    for (const request of WINDOWS_INVENTORY_REQUESTS) {
      const row = rows.find(
        (candidate) =>
          commandPayload(candidate)?.cmdID === request.cmdID &&
          candidate.requestType === "WindowsInventoryGet",
      );

      expect(row, `missing command row for ${request.cmdID}`).toBeDefined();
      expect(row!.status).toBe("sent");
    }

    await checkin(backend, {
      results: [
        {
          cmdID: "3",
          cmdRef: "windows-inventory-serial",
          items: [{ source: { locURI: WINDOWS_INVENTORY_URI.serial }, data: "SERIAL-999" }],
        },
      ],
    });

    expect(
      dbRows(db, table(schema.deviceCommand)).find(
        (row) => commandPayload(row)?.cmdID === "windows-inventory-serial",
      ),
    ).toMatchObject({ status: "succeeded", resultStatus: "200" });
    expect(dbRows(db, table(schema.device))[0]!.serial).toBe("SERIAL-999");
  });

  it("delivers a queued unenroll Exec and completes when the device acknowledges it", async () => {
    const { backend, db, device } = await enroll();

    suppressInventory(db);

    const createdAt = new Date();

    db.store[table(schema.deviceCommand)] = [
      {
        id: "unenroll-1",
        organizationId: "org-early",
        deviceId: device.id,
        requestType: WINDOWS_UNENROLL_REQUEST_TYPE,
        payload: {
          kind: "Exec",
          locURI: windowsUnenrollUri(WINDOWS_MDM_PROVIDER_ID),
          data: WINDOWS_MDM_PROVIDER_ID,
          format: "chr",
        },
        status: "queued",
        dedupeKey: null,
        expiresAt: null,
        resultStatus: null,
        resultDetail: null,
        createdAt,
        updatedAt: createdAt,
        __table: table(schema.deviceCommand),
      },
    ];

    const delivered = await checkin(backend);
    const command = delivered.commands.find((entry) => entry.kind === "Exec")!;

    expect(command.locURI).toBe(windowsUnenrollUri(WINDOWS_MDM_PROVIDER_ID));
    expect(command.data).toBe(WINDOWS_MDM_PROVIDER_ID);

    await checkin(backend, { statuses: [{ cmdRef: "unenroll-1", data: "200" }] });

    expect(dbRows(db, table(schema.device))[0]!.status).toBe("unenrolled");
    expect(
      dbRows(db, table(schema.deviceCommand)).find((row) => row.id === "unenroll-1"),
    ).toMatchObject({ status: "succeeded" });
  });

  it("handles a device-initiated unenroll Generic Alert", async () => {
    const { backend, db, device } = await enroll();

    suppressInventory(db);

    const [certificate] = dbRows(db, table(schema.scepIssuedCertificate));

    expect(certificate).toBeDefined();

    await checkin(backend, { alerts: [{ cmdID: "9", data: "1226" }] });

    expect(dbRows(db, table(schema.device))[0]!.status).toBe("unenrolled");
    expect(
      dbRows(db, table(schema.scepIssuedCertificate)).find((row) => row.deviceId === device.id)
        ?.revokedAt,
    ).toBeInstanceOf(Date);
  });
});

describe("Windows partial application inventory", () => {
  it("keeps Win32 rows when only the MSI block arrives", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    const device = dbRows(db, tableName(schema.device))[0]!;
    const reportedAt = new Date("2024-01-01T00:00:00Z");

    const application = (bundleId: string, isManaged: boolean) => ({
      deviceId: device.id,
      organizationId: device.organizationId,
      bundleId,
      name: bundleId,
      version: null,
      shortVersion: null,
      publisher: null,
      bundleSize: null,
      dynamicSize: null,
      hasUpdateAvailable: false,
      isManaged,
      lastReportedAt: reportedAt,
      __table: tableName(schema.deviceApplication),
    });

    db.store[tableName(schema.deviceApplication)] = [
      application("WIN32-APP", false),
      application("STALE-MANAGED", true),
    ];

    const msi = (field: string, value: string) => ({
      source: {
        locURI: `./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/MANAGED-APP/${field}`,
      },
      data: value,
    });

    await run(
      backend.windowsManagementCheckin(
        { deviceId: "device-1", mdmOrigin },
        {
          sessionID: "1",
          msgID: "1",
          source: "device-1",
          target: origin,
          statuses: [],
          alerts: [],
          results: [
            {
              cmdID: "3",
              cmdRef: "windows-app-inventory-msi",
              items: [msi("Name", "Managed Client"), msi("Version", "2.0.0"), msi("Status", "70")],
            },
          ],
        },
      ),
    );

    const rows = dbRows(db, tableName(schema.deviceApplication));

    expect(rows.map((row) => row.bundleId).sort()).toEqual(["MANAGED-APP", "WIN32-APP"]);
    expect(rows.find((row) => row.bundleId === "MANAGED-APP")).toMatchObject({
      isManaged: true,
    });
    expect(rows.find((row) => row.bundleId === "WIN32-APP")).toMatchObject({
      isManaged: false,
    });
  });

  it("records a failed application Get so the report is classified as partial", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    const checkin = (
      input: {
        statuses?: Array<unknown>;
        results?: Array<unknown>;
      } = {},
    ) =>
      run(
        backend.windowsManagementCheckin(
          { deviceId: "device-1", mdmOrigin },
          {
            sessionID: "1",
            msgID: "1",
            source: "device-1",
            target: origin,
            statuses: input.statuses ?? [],
            alerts: [],
            results: input.results,
          },
        ),
      );

    await checkin();

    await checkin({
      statuses: [{ cmdRef: "windows-app-inventory-win32", data: "404" }],
    });

    const row = dbRows(db, tableName(schema.deviceCommand)).find(
      (candidate) => commandPayload(candidate)?.cmdID === "windows-app-inventory-win32",
    );

    expect(row).toMatchObject({ status: "failed", resultStatus: "404" });
  });
});
