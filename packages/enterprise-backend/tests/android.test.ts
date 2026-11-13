import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  AndroidManagement,
  base64UrlEncode,
  clearJwksCache,
  type AndroidManagementShape,
} from "@mattrax/dm-android";
import {
  AndroidDeliveryError,
  DEFAULT_ANDROID_POLICY_ID,
  androidEnterpriseInfo,
  completeAndroidSignup,
  createAndroidEnrollmentToken,
  createAndroidSignup,
  handleAndroidPubSub,
  issueAndroidCommand,
  syncAndroidPoliciesForTenant,
  type AndroidDeliveryConfig,
} from "../src/android.js";
import { makeDb, runEffect } from "./helpers.js";

const organizationId = "org-1";
const otherOrganizationId = "org-2";
const enterpriseName = "enterprises/LC123";
const deviceName = `${enterpriseName}/devices/device-1`;
const serviceAccountEmail = "android@test-project.iam.gserviceaccount.com";
const audience = "https://mattrax.test/api/v1/android/pubsub";
const jwksUri = "https://keys.test/jwks";
const kid = "android-test-key";

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

const encoder = new TextEncoder();

const config: AndroidDeliveryConfig = {
  serviceAccount: {
    clientEmail: serviceAccountEmail,
    privateKeyPem: "unused-in-tests",
    projectId: "test-project",
  },
  pubsubTopic: "projects/test-project/topics/mattrax-android",
  pubsubSubscription: "projects/test-project/subscriptions/mattrax-android",
  pubsubAudience: audience,
  jwksUri,
};

async function sign(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));

  const payload = base64UrlEncode(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "123",
      email: serviceAccountEmail,
      email_verified: true,
      iat: now - 10,
      exp: now + 600,
      ...overrides,
    }),
  );

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

const jwksFetch = (async () =>
  new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof globalThis.fetch;

function base64Json(value: unknown): string {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function pushBody(
  data: unknown,
  type: string,
  messageId = "message-1",
): {
  message: { data: string; attributes: Record<string, string>; messageId: string };
  subscription: string;
} {
  return {
    message: {
      data: base64Json(data),
      attributes: { notificationType: type },
      messageId,
    },
    subscription: "projects/test-project/subscriptions/mattrax-android",
  };
}

type AndroidCalls = {
  signupUrls: Array<{ callbackUrl: string }>;
  enterprises: Array<Record<string, unknown>>;
  policies: Array<{ enterpriseName: string; policyId: string; policy: Record<string, unknown> }>;
  devices: Array<{ deviceName: string; policyName: string }>;
  commands: Array<{ deviceName: string; type: string }>;
};

function makeAndroid(overrides: Partial<AndroidManagementShape> = {}) {
  const calls: AndroidCalls = {
    signupUrls: [],
    enterprises: [],
    policies: [],
    devices: [],
    commands: [],
  };

  const service = AndroidManagement.of({
    createSignupUrl: (input) => {
      calls.signupUrls.push({ callbackUrl: input.callbackUrl });

      return Effect.succeed({
        name: "signups/signup-1",
        url: "https://enterprise.google.test/signup",
      });
    },
    createEnterprise: (input) => {
      calls.enterprises.push({ ...input });

      return Effect.succeed({ name: enterpriseName });
    },
    createEnrollmentToken: () =>
      Effect.succeed({
        name: `${enterpriseName}/enrollmentTokens/t1`,
        value: "TOKEN-VALUE",
        qrCode: "QR-JSON",
        expirationTimestamp: "2026-11-12T00:00:00Z",
        policyName: `${enterpriseName}/policies/${DEFAULT_ANDROID_POLICY_ID}`,
      }),
    patchPolicy: (input) => {
      calls.policies.push({
        enterpriseName: input.enterpriseName,
        policyId: input.policyId,
        policy: input.policy,
      });

      return Effect.succeed(input.policy);
    },
    patchDevice: (input) => {
      calls.devices.push({ deviceName: input.deviceName, policyName: input.policyName });

      return Effect.succeed({ name: input.deviceName, policyName: input.policyName });
    },
    listDevices: () => Effect.succeed({ devices: [] }),
    issueCommand: (input) => {
      calls.commands.push({ deviceName: input.deviceName, type: input.type });

      return Effect.succeed({ operationName: `${input.deviceName}/operations/op-1` });
    },
    deleteDevice: () => Effect.void,
    ...overrides,
  });

  return { service, calls };
}

const provideAndroid = <A, E>(
  effect: Effect.Effect<A, E, AndroidManagement>,
  service: AndroidManagementShape,
) => Effect.runPromise(effect.pipe(Effect.provideService(AndroidManagement, service)));

function organizationRow(id: string, name: string) {
  return {
    id,
    name,
    displayName: name,
    slug: name.toLowerCase(),
    supportEmail: `support@${name.toLowerCase()}.test`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function activeEnterpriseRow(organization = organizationId) {
  return {
    organizationId: organization,
    enterpriseName,
    signupUrl: null,
    signupState: null,
    pubsubTopic: config.pubsubTopic,
    pubsubSubscription: config.pubsubSubscription,
    serviceAccountEmail,
    status: "active" as const,
    lastError: null,
    lastSyncedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function androidDeviceRow() {
  return {
    id: "device-1",
    organizationId,
    proto: "android",
    status: "enrolled",
    name: "Pixel 9",
    model: "Pixel 9",
    modelIdentifier: null,
    serial: null,
    enrolledAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-01T00:00:00Z"),
    notes: null,
    assetTag: null,
    physicalName: null,
    vendor: "Google",
    osEdition: null,
    osVersion: "15",
    osBuild: null,
    diskTotal: null,
    diskUsed: null,
    fileVaultEnabled: null,
    batteryHealth: null,
    capabilities: null,
    modelNumber: null,
    inventoryUpdatedAt: null,
    applicationsUpdatedAt: null,
    dmIdentifier: deviceName,
    dmCertHash: null,
    dmIdentityFingerprint: null,
    ddmDeclarationsToken: null,
  };
}

describe("Android Enterprise delivery", () => {
  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    privateKey = pair.privateKey;
    publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
  });

  beforeEach(() => clearJwksCache());

  it("reports unconfigured tenants and fails closed", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
    });

    const info = await runEffect(androidEnterpriseInfo(db, organizationId));
    expect(info.configured).toBe(false);
    expect(info.status).toBe("disabled");
    expect(info.available).toBe(false);

    const configError = await Effect.runPromise(
      Effect.flip(
        createAndroidSignup({
          db,
          origin: "https://mattrax.test",
          authSecret: "secret",
          organization: { id: organizationId, name: "Acme" },
        }),
      ),
    );

    expect(configError.kind).toBe("not_configured");

    const sync = await Effect.runPromise(syncAndroidPoliciesForTenant({ db, organizationId }));
    expect(sync).toEqual({ devices: 0, updated: 0, skipped: 0, failed: 0 });
  });

  it("creates a signup URL, binds state to the tenant, and stores the enterprise", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [],
    });

    const { service, calls } = makeAndroid();

    const signup = await provideAndroid(
      createAndroidSignup({
        db,
        config,
        origin: "https://mattrax.test",
        authSecret: "test-secret",
        organization: { id: organizationId, name: "Acme" },
      }),
      service,
    );

    expect(signup.url).toBe("https://enterprise.google.test/signup");
    expect(calls.signupUrls).toHaveLength(1);
    const callback = new URL(calls.signupUrls[0]!.callbackUrl);
    expect(callback.pathname).toBe("/api/v1/android/signup/callback");
    const state = callback.searchParams.get("state");
    expect(state).toBeTruthy();

    const pending = db.store.android_enterprise![0]!;
    expect(pending.status).toBe("pending");
    expect(pending.signupUrl).toBe("signups/signup-1");
    expect(pending.signupState).toBeTruthy();

    const completed = await provideAndroid(
      completeAndroidSignup({
        db,
        config,
        authSecret: "test-secret",
        state: state!,
        enterpriseToken: "enterprise-token-1",
      }),
      service,
    );

    expect(completed).toEqual({ organizationId, enterpriseName });
    expect(calls.enterprises[0]).toMatchObject({
      signupUrlName: "signups/signup-1",
      enterpriseToken: "enterprise-token-1",
      displayName: "Acme",
      contactEmail: "support@acme.test",
      pubsubTopic: config.pubsubTopic,
    });
    expect(calls.policies[0]).toMatchObject({
      enterpriseName,
      policyId: DEFAULT_ANDROID_POLICY_ID,
      policy: {},
    });

    const row = db.store.android_enterprise![0]!;
    expect(row.status).toBe("active");
    expect(row.enterpriseName).toBe(enterpriseName);
    expect(row.signupState).toBeNull();
    expect(db.store.audit_log!.map((entry: any) => entry.action)).toEqual(
      expect.arrayContaining(["android.signup_started", "android.enterprise_connected"]),
    );
  });

  it("rejects a tampered or replayed signup state", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [],
    });

    const { service, calls } = makeAndroid();
    await provideAndroid(
      createAndroidSignup({
        db,
        config,
        origin: "https://mattrax.test",
        authSecret: "test-secret",
        organization: { id: organizationId, name: "Acme" },
      }),
      service,
    );
    const callback = new URL(calls.signupUrls[0]!.callbackUrl);
    const state = callback.searchParams.get("state")!;

    const error = await Effect.runPromise(
      Effect.flip(
        completeAndroidSignup({
          db,
          config,
          authSecret: "test-secret",
          state: `${state}tampered`,
          enterpriseToken: "enterprise-token-1",
        }).pipe(Effect.provideService(AndroidManagement, service)),
      ),
    );

    expect(error.kind).toBe("invalid_state");
    expect(db.store.android_enterprise![0]!.status).toBe("pending");
  });

  it("scopes Pub/Sub notifications by enterprise and creates a device once", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [activeEnterpriseRow()],
    });

    const { service, calls } = makeAndroid();
    const token = await sign();

    const device = {
      name: deviceName,
      state: "ACTIVE",
      hardwareInfo: { model: "Pixel 9", manufacturer: "Google", serialNumber: "SER-1" },
      softwareInfo: { androidVersion: "15" },
      enrollmentTime: "2026-11-11T00:00:00Z",
      lastStatusReportTime: "2026-11-11T00:05:00Z",
    };

    const result = await provideAndroid(
      handleAndroidPubSub({
        db,
        config,
        authSecret: "test-secret",
        origin: "https://mattrax.test",
        authorization: `Bearer ${token}`,
        body: pushBody(device, "ENROLLMENT"),
        fetch: jwksFetch,
      }),
      service,
    );

    expect(result.status).toBe("ok");
    expect(db.store.device).toHaveLength(1);
    expect(db.store.device![0]).toMatchObject({
      organizationId,
      proto: "android",
      status: "enrolled",
      dmIdentifier: deviceName,
      serial: "SER-1",
    });
    expect(db.store.android_device).toHaveLength(1);
    expect(calls.devices[0]).toMatchObject({ deviceName });
    const assigned = calls.policies[0]!;
    expect(assigned.enterpriseName).toBe(enterpriseName);
    expect(assigned.policyId).toMatch(/^mattrax-/);

    const duplicate = await provideAndroid(
      handleAndroidPubSub({
        db,
        config,
        authSecret: "test-secret",
        origin: "https://mattrax.test",
        authorization: `Bearer ${token}`,
        body: pushBody(device, "ENROLLMENT"),
        fetch: jwksFetch,
      }),
      service,
    );

    expect(duplicate.status).toBe("duplicate");
    expect(db.store.device).toHaveLength(1);
    expect(calls.policies).toHaveLength(1);
  });

  it("rejects Pub/Sub requests without a valid Google OIDC token", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [activeEnterpriseRow()],
    });

    const { service } = makeAndroid();
    const body = pushBody({ name: deviceName }, "ENROLLMENT");

    const missing = await Effect.runPromise(
      Effect.flip(
        handleAndroidPubSub({
          db,
          config,
          origin: "https://mattrax.test",
          body,
        }).pipe(Effect.provideService(AndroidManagement, service)),
      ),
    );

    expect(missing.kind).toBe("unauthorized");

    const wrongAudienceToken = await sign({ aud: "https://other.test/pubsub" });

    const wrongAudience = await Effect.runPromise(
      Effect.flip(
        handleAndroidPubSub({
          db,
          config,
          origin: "https://mattrax.test",
          authorization: `Bearer ${wrongAudienceToken}`,
          body,
          fetch: jwksFetch,
        }).pipe(Effect.provideService(AndroidManagement, service)),
      ),
    );

    expect(wrongAudience.kind).toBe("unauthorized");

    const wrongIssuerToken = await sign({ iss: "https://evil.test" });

    const wrongIssuer = await Effect.runPromise(
      Effect.flip(
        handleAndroidPubSub({
          db,
          config,
          origin: "https://mattrax.test",
          authorization: `Bearer ${wrongIssuerToken}`,
          body,
          fetch: jwksFetch,
        }).pipe(Effect.provideService(AndroidManagement, service)),
      ),
    );

    expect(wrongIssuer.kind).toBe("unauthorized");

    const validToken = await sign();
    const [header, payload, signature] = validToken.split(".");
    const tampered = `${header}.${payload}.${signature!.slice(0, -2)}AA`;

    const badSignature = await Effect.runPromise(
      Effect.flip(
        handleAndroidPubSub({
          db,
          config,
          origin: "https://mattrax.test",
          authorization: `Bearer ${tampered}`,
          body,
          fetch: jwksFetch,
        }).pipe(Effect.provideService(AndroidManagement, service)),
      ),
    );

    expect(badSignature.kind).toBe("unauthorized");
    expect(db.store.device).toHaveLength(0);
  });

  it("ignores notifications that name another enterprise", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [activeEnterpriseRow()],
    });

    const { service } = makeAndroid();
    const token = await sign();

    const foreign = {
      name: "enterprises/LC999/devices/device-9",
      state: "ACTIVE",
    };

    const result = await provideAndroid(
      handleAndroidPubSub({
        db,
        config,
        authSecret: "test-secret",
        origin: "https://mattrax.test",
        authorization: `Bearer ${token}`,
        body: pushBody(foreign, "ENROLLMENT"),
        fetch: jwksFetch,
      }),
      service,
    );

    expect(result.status).toBe("ignored");
    expect(db.store.device).toHaveLength(0);
  });

  it("compiles and pushes the effective Android policy idempotently", async () => {
    const db = makeDb({
      organization: [
        organizationRow(organizationId, "Acme"),
        organizationRow(otherOrganizationId, "Other"),
      ],
      android_enterprise: [activeEnterpriseRow()],
      device: [
        androidDeviceRow(),
        { ...androidDeviceRow(), id: "other-device", organizationId: otherOrganizationId },
      ],
      policy: [
        {
          id: "policy-1",
          organizationId,
          name: "Android baseline",
          notes: null,
          priority: 10,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
      configuration: [
        {
          policyId: "policy-1",
          kind: "mttx.android.policy.designer",
          data: {
            policy: {
              cameraDisabled: true,
              applications: [{ packageName: "com.example.app", installType: "FORCE_INSTALLED" }],
            },
            draft: { name: "Android baseline" },
          },
          hash: "hash-1",
        },
      ],
      device_policy: [{ deviceId: "device-1", policyId: "policy-1", mode: "include" }],
    });

    const { service, calls } = makeAndroid();

    const first = await provideAndroid(
      syncAndroidPoliciesForTenant({ db, config, organizationId }),
      service,
    );

    expect(first).toEqual({ devices: 1, updated: 1, skipped: 0, failed: 0 });
    expect(calls.policies).toHaveLength(1);
    expect(calls.policies[0]!.policy).toEqual({
      applications: [{ packageName: "com.example.app", installType: "FORCE_INSTALLED" }],
      cameraDisabled: true,
    });
    expect(calls.devices).toEqual([{ deviceName, policyName: calls.policies[0]!.policyId }]);
    expect(db.store.android_device![0]).toMatchObject({
      deviceId: "device-1",
      policyId: calls.policies[0]!.policyId,
    });

    const second = await provideAndroid(
      syncAndroidPoliciesForTenant({ db, config, organizationId }),
      service,
    );

    expect(second).toEqual({ devices: 1, updated: 0, skipped: 1, failed: 0 });
    expect(calls.policies).toHaveLength(1);
  });

  it("issues an enrollment token only while the enterprise is active", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [activeEnterpriseRow()],
    });

    const { service } = makeAndroid();

    const token = await provideAndroid(
      createAndroidEnrollmentToken({ db, config, organizationId }),
      service,
    );

    expect(token).toEqual({
      value: "TOKEN-VALUE",
      qrCode: "QR-JSON",
      policyName: `${enterpriseName}/policies/${DEFAULT_ANDROID_POLICY_ID}`,
      expiresAt: "2026-11-12T00:00:00Z",
    });

    const disabled = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [{ ...activeEnterpriseRow(), status: "disabled" }],
    });

    const error = await Effect.runPromise(
      Effect.flip(
        createAndroidEnrollmentToken({ db: disabled, config, organizationId }).pipe(
          Effect.provideService(AndroidManagement, service),
        ),
      ),
    );

    expect(error.kind).toBe("conflict");
  });

  it("records erase and restart commands through the AMAPI client", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [activeEnterpriseRow()],
      device: [androidDeviceRow()],
    });

    const { service, calls } = makeAndroid();

    const wipe = await provideAndroid(
      issueAndroidCommand({
        db,
        config,
        organizationId,
        device: { id: "device-1", dmIdentifier: deviceName },
        action: "wipe",
      }),
      service,
    );

    expect(wipe?.operationName).toContain("/operations/op-1");
    expect(calls.commands).toEqual([{ deviceName, type: "WIPE" }]);
    expect(db.store.device_command![0]).toMatchObject({
      organizationId,
      deviceId: "device-1",
      requestType: "AndroidWipe",
      status: "sent",
    });

    const restart = await provideAndroid(
      issueAndroidCommand({
        db,
        config,
        organizationId,
        device: { id: "device-1", dmIdentifier: deviceName },
        action: "restart",
      }),
      service,
    );

    expect(restart?.operationName).toBeDefined();
    expect(calls.commands[1]).toEqual({ deviceName, type: "REBOOT" });
  });

  it("does not leak another tenant's enterprise when completing signup", async () => {
    const db = makeDb({
      organization: [
        organizationRow(organizationId, "Acme"),
        organizationRow(otherOrganizationId, "Other"),
      ],
      android_enterprise: [],
    });

    const { service, calls } = makeAndroid();
    await provideAndroid(
      createAndroidSignup({
        db,
        config,
        origin: "https://mattrax.test",
        authSecret: "test-secret",
        organization: { id: organizationId, name: "Acme" },
      }),
      service,
    );
    const state = new URL(calls.signupUrls[0]!.callbackUrl).searchParams.get("state")!;

    await provideAndroid(
      completeAndroidSignup({
        db,
        config,
        authSecret: "test-secret",
        state,
        enterpriseToken: "enterprise-token-1",
      }),
      service,
    );
    expect(db.store.android_enterprise!).toHaveLength(1);
    expect(db.store.android_enterprise![0]!.organizationId).toBe(organizationId);
    expect(db.store.android_enterprise![0]!.organizationId).not.toBe(otherOrganizationId);
  });

  it("surfaces Google failures without leaking credentials", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [],
    });

    const { service } = makeAndroid({
      createSignupUrl: () =>
        Effect.fail({
          _tag: "GoogleApiError",
          message: `permission denied for ${serviceAccountEmail}`,
        } as never),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        createAndroidSignup({
          db,
          config,
          origin: "https://mattrax.test",
          authSecret: "test-secret",
          organization: { id: organizationId, name: "Acme" },
        }).pipe(Effect.provideService(AndroidManagement, service)),
      ),
    );

    expect(error).toBeInstanceOf(AndroidDeliveryError);
    expect(error.kind).toBe("upstream");
    expect(error.message).not.toContain(serviceAccountEmail);
    expect(error.message).toContain("[email]");
  });
});
