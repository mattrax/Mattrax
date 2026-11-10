import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { arrayBufferToBase64, exportPrivateKeyJwk, generateCaKeyPair } from "@mattrax/crypto";
import { certToPem, createCaCertificate, pemToCert, signScepCsr } from "@mattrax/scep";
import { MdmOrigin, UnknownDevice } from "@mattrax/management-backend";
import {
  createWindowsEnrollmentToken,
  createWindowsTenantToken,
  makeWindowsBackend,
  verifyWindowsEnrollmentToken,
  verifyWindowsEnrollmentTokenDetailed,
  verifyWindowsTenantToken,
  verifyWindowsTenantTokenDetailed,
  windowsTenantTokenExpiresAt,
} from "../windows.js";
import { dbRows, makeDb, tableName } from "./fake-db.js";
import { schema } from "@mattrax/enterprise-core";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto as unknown as Crypto, crypto.subtle);
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
  } = {},
) => {
  const ca = await makeCa();
  const db = makeDb({
    [tableName(schema.organization)]: [
      organizationRow("org-late", new Date("2024-02-01T00:00:00Z")),
      organizationRow("org-early", new Date("2024-01-01T00:00:00Z")),
    ],
    [tableName(schema.scepCa)]: [
      { id: 1, certPem: ca.certPem, privateKeyJwk: ca.privateKeyJwk, createdAt: new Date() },
    ],
    [tableName(schema.enterpriseEnrollment)]: [
      enrollmentRow("org-late"),
      enrollmentRow("org-early"),
    ],
  });
  const backend = makeWindowsBackend({
    db: db as any,
    origin,
    authSecret,
    windowsOrganizationId:
      overrides.windowsOrganizationId === null
        ? undefined
        : (overrides.windowsOrganizationId ?? "org-early"),
    requireDeviceIdentity: overrides.requireDeviceIdentity,
    tenantTokenTtlSeconds: overrides.tenantTokenTtlSeconds,
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
      _tag: "UnknownDevice",
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
    ).rejects.toMatchObject({ _tag: "UnknownDevice" });

    const expired = await createWindowsEnrollmentToken("subject", authSecret, {
      now: Date.now() - 2 * 60 * 60 * 1000,
    });
    await expect(run(backend.windowsEnroll(enrollmentRequest(expired, csr)))).rejects.toMatchObject(
      { _tag: "UnknownDevice" },
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
    expect(device.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("requires a matching client certificate when configured", async () => {
    const { backend } = await setup({ requireDeviceIdentity: true });
    const policy = await run(backend.getWindowsEnrollmentPolicy(""));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

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
    ).rejects.toMatchObject({ _tag: "UnknownDevice" });
  });

  it("upserts on Enrolled and touches the device on CommandResult", async () => {
    const { backend, db } = await setup();
    await run(
      backend.windowsDeviceEvent(
        { deviceId: "device-2", mdmOrigin },
        {
          _tag: "Enrolled",
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
        { _tag: "CommandResult", deviceId: "device-2", status: "200" },
      ),
    );
    expect(db.store[tableName(schema.device)]![0]!.lastSeenAt.getTime()).toBeGreaterThan(
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
    ).rejects.toMatchObject({ _tag: "UnknownDevice" });
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
    ).rejects.toMatchObject({ _tag: "UnknownDevice" });

    // Replaying the late tenant's WSTEP token through the early tenant's
    // policy endpoint must also fail.
    await expect(
      run(backend.getWindowsEnrollmentPolicy(policy.authToken, { tenantToken: earlyToken })),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" });
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
    ).rejects.toMatchObject({ _tag: "UnknownDevice" });
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

    const certificate = dbRows(db, tableName(schema.scepIssuedCertificate))[0]!;
    const storedCertificate = db.store[tableName(schema.scepIssuedCertificate)]![0]!;
    const scope = {
      deviceId: "device-1",
      identityCertificate: "O=Mattrax, OU=org-early, CN=device-1",
      identityCertificateSerial: certificate.serial as string,
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
    await expect(checkin(backend, scope)).rejects.toMatchObject({ _tag: "UnknownDevice" });

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
          { _tag: "Enrolled", deviceId: "device-2" },
        ),
      ),
    ).resolves.toBeUndefined();

    await expect(
      run(
        backend.windowsDeviceEvent(
          { deviceId: "device-2", tenantToken: token, mdmOrigin },
          { _tag: "ManagementCheckin", deviceId: "device-2" },
        ),
      ),
    ).rejects.toMatchObject({ _tag: "UnknownDevice" });

    await expect(
      run(
        backend.windowsDeviceEvent(
          {
            deviceId: "device-2",
            identityCertificate: "O=Mattrax, OU=org-early, CN=device-2",
            tenantToken: token,
            mdmOrigin,
          },
          { _tag: "ManagementCheckin", deviceId: "device-2" },
        ),
      ),
    ).resolves.toBeUndefined();
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
