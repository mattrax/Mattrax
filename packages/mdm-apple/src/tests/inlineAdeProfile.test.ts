import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { dbRows, makeDb, tableName } from "./fake-db.js";

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

const setup = () => {
  const db = makeDb({
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
    [tableName(schema.abmDevice)]: [
      {
        organizationId: "org-1",
        serial: "C02ADE",
        abmDeviceId: "C02ADE",
        enrollmentState: "ASSIGNED",
        profileStatus: "assigned",
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({ db: db as any, origin, authSecret });

  return { db, backend };
};

const scope = {
  _tag: "device" as const,
  udid: "ade-udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  mdmOrigin,
};

describe("Apple Authenticate ADE profile", () => {
  it("returns a signed profile for a fresh ADE device", async () => {
    const { db, backend } = setup();

    const result = await run(
      backend.appleDeviceEvent(scope, {
        _tag: "Authenticate" as const,
        serialNumber: "C02ADE",
        model: "MacBookPro18,3",
        enrollmentMode: "device" as const,
      }),
    );

    expect(result?.enrollmentProfile).toEqual(expect.any(String));

    const profile = decode(result!.enrollmentProfile!);
    expect(new TextDecoder().decode(profile)).toContain("com.mattrax.ade.profile-1");
    expect(new TextDecoder().decode(profile)).toContain("com.apple.security.scep");

    const challenges = dbRows(db, tableName(schema.scepChallenge));
    expect(challenges).toHaveLength(1);
    expect(challenges[0]).toMatchObject({ organizationId: "org-1", enrollmentId: "enrollment-1" });
  });

  it("does not return a second profile for an existing device", async () => {
    const { backend } = setup();

    await run(
      backend.appleDeviceEvent(scope, {
        _tag: "Authenticate" as const,
        serialNumber: "C02ADE",
        model: "MacBookPro18,3",
        enrollmentMode: "device" as const,
      }),
    );

    await expect(
      run(
        backend.appleDeviceEvent(scope, {
          _tag: "Authenticate" as const,
          serialNumber: "C02ADE",
          model: "MacBookPro18,3",
          enrollmentMode: "device" as const,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("returns no profile for a serial that is not assigned in ABM", async () => {
    const { backend } = setup();

    await expect(
      run(
        backend.appleDeviceEvent(
          { ...scope, udid: "ade-udid-2" },
          {
            _tag: "Authenticate" as const,
            serialNumber: "C02OTHER",
            model: "MacBookPro18,3",
            enrollmentMode: "device" as const,
          },
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
