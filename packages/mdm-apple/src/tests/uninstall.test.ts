import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { AppleDeviceEvent, MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { appleIdentityCertificate, makeDb, tableName } from "./fake-db.js";

const origin = "https://enterprise.test";

const mdmOrigin = new MdmOrigin({ url: origin });

const at = new Date("2026-11-20T12:00:00.000Z");

const CommandResultEvent = AppleDeviceEvent.members[5];

const scope = {
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  identityCertificateFingerprintSha256: "fingerprint-1",
  identityCertificateSerial: "A1:B2:C3",
  mdmOrigin,
};

const setup = (options: { readonly deadline?: Date } = {}) => {
  const released: Array<{ organizationId: string; deviceId: string; adamId: string }> = [];

  const db = makeDb({
    [tableName(schema.organization)]: [{ id: "org-1", name: "Org", slug: "org", metadata: null }],
    [tableName(schema.device)]: [
      {
        id: "device-1",
        organizationId: "org-1",
        proto: "apple",
        status: "enrolled",
        name: "iPhone",
        dmIdentifier: "udid-1",
        dmIdentityFingerprint: "fingerprint-1",
        osEdition: "iOS",
        osVersion: "17.0",
        enrolledAt: at,
        lastSeenAt: at,
      },
    ],
    [tableName(schema.scepIssuedCertificate)]: [appleIdentityCertificate()],
    [tableName(schema.deviceApple)]: [
      { deviceId: "device-1", deviceToken: "token-1", declarationMode: "legacy" },
    ],
    [tableName(schema.applicationUninstall)]: [
      {
        id: "uninstall-1",
        organizationId: "org-1",
        deviceId: "device-1",
        applicationId: "app-1",
        installerId: null,
        platform: "apple",
        bundleId: "com.example.internal",
        adamId: "361309726",
        commandId: "command-1",
        status: "queued",
        requestedAt: at,
        deadline: options.deadline ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        observedVersion: null,
        resultDetail: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    [tableName(schema.deviceVppAssignment)]: [
      {
        organizationId: "org-1",
        deviceId: "device-1",
        adamId: "361309726",
        serial: "SERIAL-1",
        state: "assigned",
        createdAt: at,
        updatedAt: at,
      },
    ],
  });

  const backend = ManagementBackendEnterpriseLive.make({
    // SAFETY: the in-memory fake implements the query surface used here.
    db: db as any,
    origin,
    authSecret: "uninstall-secret",
    releaseAppleVppLicence: async (input) => {
      released.push({
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        adamId: input.adamId,
      });

      return true;
    },
  });

  return { db, backend, released };
};

const inventoryReport = (backend: ReturnType<typeof setup>["backend"]) =>
  Effect.runPromise(
    backend.appleDeviceEvent(
      scope,
      CommandResultEvent.make({
        commandUUID: "missing-command",
        status: "Acknowledged",
        queryResponses: { InstalledApplicationList: [] },
      }),
    ),
  );

describe("uninstall reconciliation", () => {
  it("returns a VPP licence once inventory confirms the app is gone", async () => {
    const { db, backend, released } = setup();

    await inventoryReport(backend);

    expect(released).toEqual([
      { organizationId: "org-1", deviceId: "device-1", adamId: "361309726" },
    ]);
    expect(db.store.application_uninstall[0]).toMatchObject({ status: "succeeded" });
  });

  it("does not release the licence twice on repeated reports", async () => {
    const { backend, released } = setup();

    await inventoryReport(backend);
    await inventoryReport(backend);

    expect(released).toHaveLength(1);
  });

  it("does not release a licence when the uninstall deadline has not passed and the app is present", async () => {
    const { db, backend, released } = setup();

    await Effect.runPromise(
      backend.appleDeviceEvent(
        scope,
        CommandResultEvent.make({
          commandUUID: "missing-command",
          status: "Acknowledged",
          queryResponses: {
            InstalledApplicationList: [
              {
                Identifier: "com.example.internal",
                Version: "1.4.0",
                IsManaged: true,
              },
            ],
          },
        }),
      ),
    );

    expect(released).toHaveLength(0);
    expect(db.store.application_uninstall[0]).toMatchObject({ status: "queued" });
  });
});
