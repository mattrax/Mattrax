import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { dbRows, makeDb, tableName, type Row } from "./fake-db.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const now = new Date("2026-11-11T10:00:00.000Z");

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const decode = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

  return bytes;
};

const setup = (
  options: {
    readonly abmDevice?: Partial<Row>;
    readonly enrollmentRow?: boolean;
    readonly appleProfileSigning?: { certificatePem?: string; privateKeyPem?: string };
  } = {},
) => {
  const initial = {
    [tableName(schema.organization)]: [
      {
        id: "org-1",
        name: "Acme",
        slug: "acme",
        logo: null,
        metadata: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [tableName(schema.applePushCertificate)]: [
      {
        organizationId: "org-1",
        email: "mdm@acme.test",
        topic: "com.apple.mgmt.External.acme",
        certPem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
        encryptedKey: null,
        updatedAt: now,
      },
    ],
    [tableName(schema.appleBusinessManager)]: [
      {
        organizationId: "org-1",
        credentialType: "abm_api",
        encryptedToken: "sealed",
        profileUuid: "profile-1",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ],
    [tableName(schema.enterpriseEnrollment)]: [
      {
        id: "enrollment-1",
        organizationId: "org-1",
        enabledApple: true,
        enabledWindows: false,
        enabledAndroid: false,
        maxDevices: 100,
        createdAt: now,
        updatedAt: now,
      },
    ],
    [tableName(schema.abmDevice)]: [
      {
        organizationId: "org-1",
        serial: "C02ADE",
        abmDeviceId: "C02ADE",
        enrollmentState: "ASSIGNED",
        profileStatus: "assigned",
        createdAt: now,
        updatedAt: now,
        ...options.abmDevice,
      },
    ],
  };

  const db = makeDb(initial);

  if (options.enrollmentRow === false) db.store[tableName(schema.enterpriseEnrollment)] = [];

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({
    db: db as any,
    origin,
    authSecret,
    appleProfileSigning: options.appleProfileSigning,
  });

  return { db, backend };
};

const scope = {
  _tag: "device" as const,
  udid: "ade-udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
};

const authenticate = (serialNumber = "C02ADE") => ({
  _tag: "Authenticate" as const,
  serialNumber,
  model: "MacBookPro18,3",
  enrollmentMode: "device" as const,
});

describe("Apple Authenticate ADE profile", () => {
  it("returns a signed profile for a fresh ADE device", async () => {
    const { db, backend } = setup();

    const result = await run(backend.appleDeviceEvent(scope, authenticate()));

    expect(result?.enrollmentProfile).toEqual(expect.any(String));

    const profile = decode(result!.enrollmentProfile!);
    expect(new TextDecoder().decode(profile)).toContain("com.mattrax.ade.profile-1");
    expect(new TextDecoder().decode(profile)).toContain("com.apple.security.scep");

    const challenges = dbRows(db, tableName(schema.scepChallenge));
    expect(challenges).toHaveLength(1);
    expect(challenges[0]).toMatchObject({ organizationId: "org-1", enrollmentId: "enrollment-1" });
  });

  it("creates the enrollment row when the tenant has none", async () => {
    const { db, backend } = setup({ enrollmentRow: false });

    const result = await run(backend.appleDeviceEvent(scope, authenticate()));

    expect(result?.enrollmentProfile).toEqual(expect.any(String));
    expect(dbRows(db, tableName(schema.enterpriseEnrollment))).toHaveLength(1);
  });

  it("does not return a second profile for an existing device", async () => {
    const { backend } = setup();

    await run(backend.appleDeviceEvent(scope, authenticate()));

    await expect(run(backend.appleDeviceEvent(scope, authenticate()))).resolves.toBeUndefined();
  });

  it.each([
    ["unassigned", { enrollmentState: "UNASSIGNED" }],
    ["removed", { enrollmentState: "REMOVED" }],
    ["removed profile", { enrollmentState: "ASSIGNED", profileStatus: "removed" }],
  ])("returns no profile for a %s ABM device", async (_label, abmDevice) => {
    const { backend } = setup({ abmDevice });

    await expect(
      run(backend.appleDeviceEvent({ ...scope, udid: "ade-udid-2" }, authenticate())),
    ).resolves.toBeUndefined();
  });

  it("returns no profile for a serial that is not assigned in ABM", async () => {
    const { backend } = setup();

    await expect(
      run(backend.appleDeviceEvent({ ...scope, udid: "ade-udid-3" }, authenticate("C02OTHER"))),
    ).resolves.toBeUndefined();
  });

  it("treats a signing failure as no profile instead of failing Authenticate", async () => {
    const { db, backend } = setup({
      appleProfileSigning: { certificatePem: "not-a-cert", privateKeyPem: "not-a-key" },
    });

    await expect(run(backend.appleDeviceEvent(scope, authenticate()))).resolves.toBeUndefined();

    expect(dbRows(db, tableName(schema.device))).toHaveLength(1);
  });
});
