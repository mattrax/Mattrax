import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { arrayBufferToBase64, exportPrivateKeyJwk, generateCaKeyPair } from "@mattrax/crypto";
import { certToPem, createCaCertificate, pemToCert, signScepCsr } from "@mattrax/scep";
import { MdmOrigin, UnknownDevice } from "@mattrax/management-backend";
import {
  createWindowsEnrollmentToken,
  makeWindowsBackend,
  verifyWindowsEnrollmentToken,
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

const setup = async (
  overrides: { windowsOrganizationId?: string; requireDeviceIdentity?: boolean } = {},
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
  });
  const backend = makeWindowsBackend({
    db: db as any,
    origin,
    authSecret,
    windowsOrganizationId: overrides.windowsOrganizationId,
    requireDeviceIdentity: overrides.requireDeviceIdentity,
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
    const policy = await run(backend.getWindowsEnrollmentPolicy("untrusted-client-token"));

    expect(policy.minimalKeyLength).toBe("2048");
    expect(policy.certificateValidityPeriodSeconds).toBe("31536000");
    expect(policy.renewalPeriodSeconds).toBe("15552000");
    const verification = await verifyWindowsEnrollmentToken(policy.authToken, authSecret);
    expect(verification).not.toBeNull();
    expect(verification!.subject).toBeTruthy();
  });

  it("enrolls a CSR, issues a client-auth certificate and creates a device", async () => {
    const { backend, db, ca } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy("client-token"));
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
    expect(certificate.subject.typesAndValues[0]!.value.valueBlock.value).toBe("DESKTOP-TEST");
    const extensionIds = certificate.extensions?.map((extension) => extension.extnID) ?? [];
    // ExtendedKeyUsage (clientAuth) and the Microsoft DeviceID extension.
    expect(extensionIds).toContain("2.5.29.37");
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
  });

  it("updates an existing device instead of inserting a duplicate", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy("client-token"));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr("FIRST"))));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr("SECOND"))));

    const devices = dbRows(db, tableName(schema.device));
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe("DESKTOP-TEST");
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
      verifyWindowsEnrollmentToken(`${token}tampered`, authSecret, { now }),
    ).resolves.toBeNull();
  });

  it("returns no commands for management check-in and updates lastSeenAt", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy("client-token"));
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
    const policy = await run(backend.getWindowsEnrollmentPolicy("client-token"));
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
    const policy = await run(backend.getWindowsEnrollmentPolicy("client-token"));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    expect(dbRows(db, tableName(schema.device))[0]!.organizationId).toBe("org-late");
  });

  it("falls back to the earliest organization when no tenant is configured", async () => {
    const { backend, db } = await setup();
    const policy = await run(backend.getWindowsEnrollmentPolicy("client-token"));
    await run(backend.windowsEnroll(enrollmentRequest(policy.authToken, await makeCsr())));

    expect(dbRows(db, tableName(schema.device))[0]!.organizationId).toBe("org-early");
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
    expect(extensionIds).toContain("2.5.29.37");
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
