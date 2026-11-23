import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import { ManagementBackendEnterpriseLive } from "@mattrax/mdm-apple";
import { makeDb, tableName } from "./fake-db.js";

const origin = "https://enterprise.test";

const mdmOrigin = new MdmOrigin({ url: origin });

const at = new Date("2026-11-20T12:00:00.000Z");

const scope = {
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  mdmOrigin,
};

const setup = (
  options: { readonly withProvenance?: boolean; readonly withPolicy?: boolean } = {},
) => {
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
        osEdition: "iOS",
        osVersion: "17.0",
        enrolledAt: at,
        lastSeenAt: at,
      },
    ],
    [tableName(schema.deviceApple)]: [
      { deviceId: "device-1", deviceToken: "token-1", declarationMode: "legacy" },
    ],
    [tableName(schema.application)]: [
      {
        id: "app-1",
        organizationId: "org-1",
        name: "Internal",
        platform: "apple",
        bundleId: "com.example.internal",
        version: "1.0",
        source: "upload",
        removeOnUnassign: true,
        createdAt: at,
        updatedAt: at,
      },
    ],
    [tableName(schema.applicationInstall)]:
      options.withProvenance === false
        ? []
        : [
            {
              id: "provenance-1",
              organizationId: "org-1",
              deviceId: "device-1",
              applicationId: "app-1",
              installerId: null,
              platform: "apple",
              bundleId: "com.example.internal",
              createdAt: at,
              updatedAt: at,
            },
          ],
    [tableName(schema.deviceApplication)]: [
      {
        deviceId: "device-1",
        organizationId: "org-1",
        bundleId: "com.example.internal",
        name: "Internal",
        version: "1.0",
        isManaged: true,
        lastReportedAt: at,
      },
    ],
    [tableName(schema.policy)]: options.withPolicy
      ? [
          {
            id: "policy-1",
            organizationId: "org-1",
            name: "Policy",
            notes: null,
            priority: 1,
            createdAt: at,
            updatedAt: at,
          },
        ]
      : [],
    [tableName(schema.devicePolicy)]: options.withPolicy
      ? [{ deviceId: "device-1", policyId: "policy-1", mode: "include" }]
      : [],
    [tableName(schema.configuration)]: options.withPolicy
      ? [
          {
            policyId: "policy-1",
            kind: "mttx.apple.application.app1",
            data: { applicationId: "app-1" },
            hash: "hash-1",
          },
        ]
      : [],
  });

  const backend = ManagementBackendEnterpriseLive.make({
    // SAFETY: the in-memory fake implements the query surface used here.
    db: db as any,
    origin,
    authSecret: "remove-on-unassign-secret",
  });

  return { db, backend };
};

describe("remove on unassign at check-in", () => {
  it("queues RemoveApplication when group membership removal left the app installed", async () => {
    const { db, backend } = setup();

    await Effect.runPromise(backend.appleManagementCheckin(scope));

    const command = db.store.device_command?.find((row) => row.requestType === "RemoveApplication");

    expect(command).toMatchObject({
      deviceId: "device-1",
      payload: { BundleIdentifier: "com.example.internal" },
    });
    expect(db.store.application_uninstall[0]).toMatchObject({
      deviceId: "device-1",
      applicationId: "app-1",
      status: "queued",
    });
  });

  it("keeps an app that a policy still delivers", async () => {
    const { db, backend } = setup({ withPolicy: true });

    await Effect.runPromise(backend.appleManagementCheckin(scope));

    expect(
      (db.store.device_command ?? []).some((row) => row.requestType === "RemoveApplication"),
    ).toBe(false);
    expect(db.store.application_uninstall ?? []).toHaveLength(0);
  });

  it("does not remove an app Mattrax has no install provenance for", async () => {
    const { db, backend } = setup({ withProvenance: false });

    await Effect.runPromise(backend.appleManagementCheckin(scope));

    expect(
      (db.store.device_command ?? []).some((row) => row.requestType === "RemoveApplication"),
    ).toBe(false);
    expect(db.store.application_uninstall ?? []).toHaveLength(0);
  });
});
