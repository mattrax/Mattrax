import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { serializePlist } from "@mattrax/plist";
import {
  AppleBusinessManagerError,
  appleBusinessManagerInfo,
  assignAppleBusinessManagerDevice,
  createAdeProfileToken,
  openAbmCredential,
  parseAbmTokenUpload,
  readAdeProfileToken,
  saveAppleBusinessManagerToken,
  sealAbmCredential,
  syncAppleBusinessManagerDevices,
} from "../src/appleBusinessManager.js";
import { makeDb, runEffect } from "./helpers.js";

const authSecret = "abm-test-secret";
const organizationId = "org-1";
const otherOrganizationId = "org-2";

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const makePrivateKeyPem = async (): Promise<string> => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);

  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const body = bytesToBase64(new Uint8Array(pkcs8));

  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
};

const credentialJson = async (overrides: Schema.JsonObject = {}) => ({
  clientId: "BUSINESSAPI.11111111-2222-3333-4444-555555555555",
  keyId: "key-1",
  teamId: "BUSINESSAPI.11111111-2222-3333-4444-555555555555",
  privateKey: await makePrivateKeyPem(),
  scope: "business.api",
  orgId: "apple-org-1",
  orgName: "Acme Apple Org",
  ...overrides,
});

const jsonResponse = (body: Schema.Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const makeFetch = (
  options: {
    devices?: Array<Schema.JsonObject>;
    next?: string;
    tokenStatus?: number;
    devicesStatus?: number;
  } = {},
) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes("/auth/oauth2/token")) {
      if (options.tokenStatus && options.tokenStatus !== 200)
        return jsonResponse({ error: "invalid_client" }, options.tokenStatus);

      return jsonResponse({
        access_token: "apple-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "business.api",
      });
    }

    if (url.includes("/orgDevices")) {
      if (options.devicesStatus && options.devicesStatus !== 200)
        return jsonResponse({ errors: [{ detail: "Not authorized" }] }, options.devicesStatus);

      const links = options.next ? { links: { next: options.next } } : undefined;

      return jsonResponse({
        data: options.devices ?? [],
        ...links,
      });
    }

    if (url.includes("/mdmServers") && init?.method === "POST")
      return jsonResponse(
        { data: { id: "mdm-server-created", attributes: { status: "ACTIVE" } } },
        201,
      );

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
      return jsonResponse({
        data: { id: "activity-1", attributes: { status: "IN_PROGRESS" } },
      });

    return jsonResponse({ errors: [{ detail: `Unexpected URL ${url}` }] }, 500);
  }) satisfies typeof globalThis.fetch;

  return { fetchImpl, calls };
};

const makeDbWithTenant = () => {
  const db = makeDb();
  const now = new Date();
  db.store.organization.push({
    id: organizationId,
    name: "Acme",
    slug: "acme",
    createdAt: now,
    updatedAt: now,
  });
  db.store.organization.push({
    id: otherOrganizationId,
    name: "Other",
    slug: "other",
    createdAt: now,
    updatedAt: now,
  });

  return db;
};

describe("Apple Business Manager credentials", () => {
  it("parses a JSON API credential and a PEM with Client ID/Key ID", async () => {
    const json = await credentialJson();
    const parsed = await parseAbmTokenUpload({ content: JSON.stringify(json) });
    expect(parsed).toMatchObject({
      kind: "abm_api",
      clientId: json.clientId,
      keyId: "key-1",
      scope: "business.api",
    });

    const pem = await makePrivateKeyPem();

    const fromPem = await parseAbmTokenUpload({
      content: pem,
      clientId: "BUSINESSAPI.aaaa",
      keyId: "key-2",
    });

    expect(fromPem).toMatchObject({
      kind: "abm_api",
      clientId: "BUSINESSAPI.aaaa",
      keyId: "key-2",
    });
  });

  it("fails closed when ids or a valid EC P-256 key are missing", async () => {
    const missing = parseAbmTokenUpload({ content: await makePrivateKeyPem() });
    await expect(missing).rejects.toBeInstanceOf(AppleBusinessManagerError);
    await expect(missing).rejects.toMatchObject({ kind: "invalid_token" });

    await expect(
      parseAbmTokenUpload({
        content: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----",
        clientId: "BUSINESSAPI.aaaa",
        keyId: "key-2",
      }),
    ).rejects.toMatchObject({ kind: "invalid_token" });
  });

  it("accepts and validates a legacy DEP plist without pretending it is an API credential", async () => {
    const parsed = await parseAbmTokenUpload({
      content: JSON.stringify({
        consumer_key: "consumer-key",
        consumer_secret: "consumer-secret",
        org_id: "dep-org",
        org_name: "Legacy Org",
        token_expiration_date: "2030-01-01T00:00:00+0000",
      }),
    });

    expect(parsed).toMatchObject({ kind: "legacy_dep", orgId: "dep-org", orgName: "Legacy Org" });

    await expect(
      parseAbmTokenUpload({
        content: JSON.stringify({
          consumer_key: "consumer-key",
          consumer_secret: "consumer-secret",
          org_id: "dep-org",
          token_expiration_date: "2000-01-01T00:00:00+0000",
        }),
      }),
    ).rejects.toMatchObject({ kind: "expired" });
  });

  it("extracts a legacy DEP plist from a PKCS#7 .p7m token", async () => {
    const plist = await Effect.runPromise(
      serializePlist({
        consumer_key: "consumer-key",
        consumer_secret: "consumer-secret",
        org_id: "dep-org",
        org_name: "Legacy Org",
        token_expiration_date: "2030-01-01T00:00:00+0000",
      }),
    );

    const bytes = new TextEncoder().encode(plist);

    const signedData = new pkijs.SignedData({
      version: 1,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: "1.2.840.113549.1.7.1",
        eContent: new asn1js.OctetString({ valueHex: bytes.buffer }),
      }),
      signerInfos: [],
      certificates: [],
    });

    const contentInfo = new pkijs.ContentInfo({
      contentType: pkijs.ContentInfo.SIGNED_DATA,
      content: signedData.toSchema(true),
    });

    const base64 = bytesToBase64(new Uint8Array(contentInfo.toSchema().toBER(false)));
    const parsed = await parseAbmTokenUpload({ content: base64, encoding: "base64" });
    expect(parsed).toMatchObject({ kind: "legacy_dep", orgId: "dep-org", orgName: "Legacy Org" });
  });

  it("seals credentials with AUTH_SECRET and never stores plaintext", async () => {
    const credential = await parseAbmTokenUpload({
      content: JSON.stringify(await credentialJson()),
    });

    const sealed = await sealAbmCredential(authSecret, credential);
    expect(sealed).not.toContain("PRIVATE KEY");
    expect(sealed).not.toContain("BUSINESSAPI");
    const opened = await openAbmCredential(authSecret, sealed);
    expect(opened).toMatchObject({ kind: "abm_api", keyId: "key-1" });
    await expect(openAbmCredential("wrong-secret", sealed)).rejects.toMatchObject({
      kind: "invalid_token",
    });
  });
});

describe("Apple Business Manager sync", () => {
  it("fails closed when the tenant has no ABM credential", async () => {
    const db = makeDbWithTenant();

    const sync = runEffect(
      syncAppleBusinessManagerDevices({
        db,
        organizationId,
        authSecret,
      }),
    );

    await expect(sync).rejects.toBeInstanceOf(AppleBusinessManagerError);
    await expect(sync).rejects.toMatchObject({ kind: "not_configured" });
    expect((await runEffect(appleBusinessManagerInfo(db, organizationId))).configured).toBe(false);
  });

  it("stores the credential, syncs devices, marks removed devices and stays tenant-scoped", async () => {
    const db = makeDbWithTenant();
    const now = new Date();
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
    db.store.abm_device.push({
      organizationId: otherOrganizationId,
      serial: "OTHER-SERIAL",
      enrollmentState: "UNASSIGNED",
      profileStatus: "unassigned",
      createdAt: now,
      updatedAt: now,
    });
    db.store.abm_device.push({
      organizationId,
      serial: "SERIAL-REMOVED",
      enrollmentState: "UNASSIGNED",
      profileStatus: "unassigned",
      createdAt: now,
      updatedAt: now,
    });

    const { fetchImpl, calls } = makeFetch({
      devices: [
        {
          id: "SERIAL-1",
          attributes: {
            serialNumber: "SERIAL-1",
            deviceModel: 'MacBook Pro 14"',
            productFamily: "Mac",
            productType: "Mac14,5",
            status: "ASSIGNED",
            updatedDateTime: "2026-01-02T03:04:05Z",
          },
        },
        {
          id: "SERIAL-2",
          attributes: {
            serialNumber: "SERIAL-2",
            deviceModel: "iPad Pro",
            productFamily: "iPad",
            status: "UNASSIGNED",
            updatedDateTime: "2026-01-02T03:04:05Z",
          },
        },
      ],
    });

    const info = await runEffect(
      saveAppleBusinessManagerToken({
        db,
        organizationId,
        authSecret,
        upload: { content: JSON.stringify(await credentialJson()) },
        config: { fetch: fetchImpl },
      }),
    );

    expect(info.status).toBe("active");
    expect(info.credentialType).toBe("abm_api");
    expect(db.store.apple_business_manager[0]).toMatchObject({ organizationId });
    expect(String(db.store.apple_business_manager[0].encryptedToken)).not.toContain("PRIVATE KEY");

    const result = await runEffect(
      syncAppleBusinessManagerDevices({
        db,
        organizationId,
        authSecret,
        config: { fetch: fetchImpl },
      }),
    );

    expect(result).toMatchObject({ devices: 2, assigned: 1, unassigned: 1, removed: 1 });

    const devices = db.store.abm_device.filter((row) => row.organizationId === organizationId);
    expect(devices).toHaveLength(3);
    expect(devices.find((row) => row.serial === "SERIAL-1")).toMatchObject({
      deviceId: "device-1",
      os: "macOS",
      enrollmentState: "ASSIGNED",
      profileStatus: "assigned",
    });
    expect(devices.find((row) => row.serial === "SERIAL-2")).toMatchObject({
      os: "iPadOS",
      enrollmentState: "UNASSIGNED",
    });
    expect(devices.find((row) => row.serial === "SERIAL-REMOVED")).toMatchObject({
      enrollmentState: "REMOVED",
      profileStatus: "removed",
    });
    expect(
      db.store.abm_device.find((row) => row.organizationId === otherOrganizationId),
    ).toMatchObject({ enrollmentState: "UNASSIGNED" });

    const refreshed = await runEffect(appleBusinessManagerInfo(db, organizationId));
    expect(refreshed).toMatchObject({ configured: true, deviceCount: 3, assignedCount: 1 });
    expect(calls.some((call) => call.url.includes("/orgDevices"))).toBe(true);
  });

  it("rejects a legacy DEP token at sync time with a migration message", async () => {
    const db = makeDbWithTenant();
    const { fetchImpl } = makeFetch();
    await runEffect(
      saveAppleBusinessManagerToken({
        db,
        organizationId,
        authSecret,
        upload: {
          content: JSON.stringify({
            consumer_key: "key",
            consumer_secret: "secret",
            org_id: "dep-org",
            org_name: "Legacy",
            token_expiration_date: "2030-01-01T00:00:00+0000",
          }),
        },
        config: { fetch: fetchImpl },
      }),
    );
    await expect(
      runEffect(
        syncAppleBusinessManagerDevices({
          db,
          organizationId,
          authSecret,
          config: { fetch: fetchImpl },
        }),
      ),
    ).rejects.toMatchObject({ kind: "not_configured" });
    expect(String(db.store.apple_business_manager[0].lastError)).toContain("legacy DEP");
  });

  it("records an error state when Apple rejects the credential", async () => {
    const db = makeDbWithTenant();
    const { fetchImpl } = makeFetch({ tokenStatus: 401 });
    await expect(
      runEffect(
        saveAppleBusinessManagerToken({
          db,
          organizationId,
          authSecret,
          upload: { content: JSON.stringify(await credentialJson()) },
          config: { fetch: fetchImpl },
        }),
      ),
    ).rejects.toBeInstanceOf(AppleBusinessManagerError);
    expect(db.store.apple_business_manager[0]).toMatchObject({ status: "error" });
    expect(String(db.store.apple_business_manager[0].lastError)).toContain("rejected");
  });

  it("creates or reuses an MDM server and records the device assignment", async () => {
    const db = makeDbWithTenant();
    const now = new Date();
    const { fetchImpl, calls } = makeFetch();
    await runEffect(
      saveAppleBusinessManagerToken({
        db,
        organizationId,
        authSecret,
        upload: { content: JSON.stringify(await credentialJson()) },
        config: { fetch: fetchImpl },
      }),
    );
    db.store.abm_device.push({
      organizationId,
      serial: "SERIAL-1",
      abmDeviceId: "SERIAL-1",
      enrollmentState: "UNASSIGNED",
      profileStatus: "unassigned",
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      assignAppleBusinessManagerDevice({
        db,
        organizationId,
        serial: "SERIAL-1",
        authSecret,
        serverName: "Mattrax Acme",
        certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
        config: { fetch: fetchImpl },
      }),
    );

    expect(result).toMatchObject({ serial: "SERIAL-1", mdmServerId: "mdm-server-1" });
    expect(calls.some((call) => call.url.includes("/orgDeviceActivities"))).toBe(true);
    expect(db.store.abm_device[0]).toMatchObject({
      enrollmentState: "ASSIGNED",
      assignedServerId: "mdm-server-1",
    });
  });
});

describe("ADE profile links", () => {
  it("signs a tenant/serial/profile-bound link and rejects tampering", async () => {
    const signed = await runEffect(
      createAdeProfileToken({
        authSecret,
        organizationId,
        serial: "SERIAL-1",
        profileUuid: "profile-1",
        ttlSeconds: 60,
      }),
    );

    const read = await runEffect(readAdeProfileToken({ authSecret, token: signed.token }));
    expect(read).toMatchObject({
      organizationId,
      serial: "SERIAL-1",
      profileUuid: "profile-1",
    });
    await expect(
      runEffect(readAdeProfileToken({ authSecret, token: `${signed.token}x` })),
    ).rejects.toMatchObject({ kind: "invalid_token" });
  });
});
