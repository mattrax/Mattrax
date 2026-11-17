import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
  AndroidManagement,
  base64UrlEncode,
  clearJwksCache,
  GoogleApiError,
  type AndroidManagementService,
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
  mergeAndroidDevice,
  mergeAndroidDeviceInfo,
  parseAndroidDeviceResource,
  syncAndroidPoliciesForTenant,
  withStatusReporting,
  type AndroidDeliveryConfig,
} from "../src/Device/android.ts";
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

/** A JWKS public key: WebCrypto's JWK plus the key id the JWKS document advertises. */
type PublicJwk = JsonWebKey & { kid?: string };

let publicJwk: PublicJwk;

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

/** Claim overrides layered onto the signed push token. */
type JwtClaimOverrides = Readonly<Record<string, Schema.Json>>;

async function sign(overrides: JwtClaimOverrides = {}): Promise<string> {
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
  })) satisfies typeof globalThis.fetch;

function base64Json(value: Schema.Json): string {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function pushBody(data: Schema.Json, type: string, messageId = "message-1") {
  return {
    message: {
      data: base64Json(data),
      attributes: { notificationType: type },
      messageId,
    },
    subscription: "projects/test-project/subscriptions/mattrax-android",
  };
}

/** Inputs the fake Android Management service recorded, by call site. */
type CreateEnterpriseInput = Parameters<AndroidManagementService["createEnterprise"]>[0];

type PatchPolicyInput = Parameters<AndroidManagementService["patchPolicy"]>[0];

type AndroidCalls = {
  signupUrls: Array<{ callbackUrl: string }>;
  enterprises: Array<CreateEnterpriseInput>;
  policies: Array<{ enterpriseName: string; policyId: string; policy: PatchPolicyInput["policy"] }>;
  devices: Array<{ deviceName: string; policyName: string }>;
  commands: Array<{ deviceName: string; type: string }>;
};

function makeAndroid(overrides: Partial<AndroidManagementService> = {}) {
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
  service: AndroidManagementService,
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

/** The `device` row that `mergeAndroidDevice` merges a report into. */
type AndroidDeviceRow = NonNullable<Parameters<typeof mergeAndroidDevice>[0]["existing"]>;

function androidDeviceRow() {
  return {
    id: "device-1",
    organizationId,
    proto: "android" as const,
    status: "enrolled" as const,
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
    inventoryRequestedAt: null,
    applicationsRequestedAt: null,
    dmIdentifier: deviceName,
    dmCertHash: null,
    dmIdentityFingerprint: null,
    ddmDeclarationsToken: null,
    // Columns shared by the other platforms; the Android merge never reads
    // them, but a complete `device` row must carry them.
    bitLockerEnabled: null,
    bitLockerStatus: null,
    domainName: null,
    entraDeviceId: null,
    managedCertificateCount: null,
    managementApps: null,
    osUpdateFailedAt: null,
    osUpdateFailureCount: null,
    osUpdateFailureReason: null,
    osUpdateInstallState: null,
    osUpdatePendingBuild: null,
    osUpdatePendingVersion: null,
    passcodeCompliant: null,
    passcodePresent: null,
    secureBootState: null,
    securityLockdownMode: null,
    securityUpdatedAt: null,
    tpmVersion: null,
    windowsPolicyApplied: null,
    windowsPolicyDelivered: null,
    windowsPolicyFailures: null,
    windowsPolicyRevertedAt: null,
    windowsPolicyReverting: null,
    windowsPolicyUpdatedAt: null,
  };
}

describe("Android Enterprise delivery", () => {
  beforeAll(async () => {
    // SAFETY: WebCrypto returns a `CryptoKeyPair` for the RSA key pair it was
    // asked to generate; the DOM runtime type is wider than that overload.
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

    const { service } = makeAndroid();

    const configError = await provideAndroid(
      Effect.flip(
        createAndroidSignup({
          db,
          origin: "https://mattrax.test",
          authSecret: "secret",
          organization: { id: organizationId, name: "Acme" },
        }),
      ),
      service,
    );

    expect(configError.kind).toBe("not_configured");

    const sync = await provideAndroid(
      syncAndroidPoliciesForTenant({ db, organizationId }),
      service,
    );

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
      statusReportingSettings: { softwareInfoEnabled: true, applicationReportsEnabled: true },
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

  it("adds assigned Managed Google Play apps and removes unassigned ones", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [activeEnterpriseRow()],
      device: [androidDeviceRow()],
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
              applications: [{ packageName: "com.microsoft.teams", installType: "AVAILABLE" }],
            },
          },
          hash: "hash-1",
        },
      ],
      device_policy: [{ deviceId: "device-1", policyId: "policy-1", mode: "include" }],
      application: [
        {
          id: "app-1",
          organizationId,
          name: "Gmail",
          platform: "android",
          bundleId: "com.google.android.gm",
        },
        {
          id: "app-2",
          organizationId,
          name: "Teams",
          platform: "android",
          bundleId: "com.microsoft.teams",
        },
        {
          id: "app-3",
          organizationId,
          name: "Apple only",
          platform: "apple",
          bundleId: "com.example.ios",
        },
      ],
      application_device: [
        { deviceId: "device-1", applicationId: "app-1" },
        { deviceId: "device-1", applicationId: "app-3" },
      ],
      application_group: [{ groupId: "group-1", applicationId: "app-2" }],
      group_device: [{ groupId: "group-1", deviceId: "device-1" }],
    });

    const { service, calls } = makeAndroid();

    await provideAndroid(syncAndroidPoliciesForTenant({ db, config, organizationId }), service);

    expect(calls.policies[0]!.policy.applications).toEqual([
      // The explicit policy fragment keeps its install type.
      { packageName: "com.microsoft.teams", installType: "AVAILABLE" },
      // The direct assignment is added as a required install. The Apple entry
      // in the same catalogue never reaches a Google policy.
      {
        packageName: "com.google.android.gm",
        installType: "FORCE_INSTALLED",
        autoUpdateMode: "AUTO_UPDATE_DEFAULT",
      },
    ]);

    // Unassigning the app removes it from the compiled policy, which is how
    // Google is told to uninstall it.
    db.store.application_device = [];

    await provideAndroid(syncAndroidPoliciesForTenant({ db, config, organizationId }), service);

    expect(calls.policies[1]!.policy.applications).toEqual([
      { packageName: "com.microsoft.teams", installType: "AVAILABLE" },
    ]);
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
        Effect.fail(
          new GoogleApiError({ message: `permission denied for ${serviceAccountEmail}` }),
        ),
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

describe("Android device inventory", () => {
  const statusReportTime = "2026-11-11T00:05:00Z";

  const fullResource = {
    name: deviceName,
    enterpriseName,
    state: "ACTIVE",
    managementMode: "DEVICE_OWNER",
    ownership: "COMPANY_OWNED",
    apiLevel: 34,
    appliedPolicyName: `${enterpriseName}/policies/mattrax-abc123`,
    appliedPolicyVersion: "7",
    enrollmentTokenName: `${enterpriseName}/enrollmentTokens/t1`,
    disabledReason: { localizedMessage: "Contact IT" },
    hardwareInfo: {
      brand: "google",
      hardware: "husky",
      manufacturer: "Google",
      model: "Pixel 8 Pro",
      serialNumber: "SER-1",
    },
    softwareInfo: {
      androidVersion: "14",
      androidBuildNumber: "UQ1A.240205.004",
      securityPatchLevel: "2024-02-05",
    },
    memoryInfo: { totalRam: "12345678901", totalInternalStorage: "128000000000" },
    networkInfo: { networkOperatorName: "Vodafone" },
    applicationReports: [
      {
        packageName: "com.example.work",
        displayName: "Work App",
        versionName: "3.2.1",
        state: "INSTALLED",
      },
      {
        packageName: "com.example.gone",
        displayName: "Gone",
        versionName: "1.0.0",
        state: "REMOVED",
      },
    ],
    enrollmentTime: "2026-11-10T00:00:00Z",
    lastStatusReportTime: statusReportTime,
  };

  it("parses the whole device resource", () => {
    const resource = parseAndroidDeviceResource(fullResource, enterpriseName);

    expect(resource).toMatchObject({
      name: deviceName,
      state: "ACTIVE",
      managementMode: "DEVICE_OWNER",
      ownership: "COMPANY_OWNED",
      apiLevel: 34,
      appliedPolicyName: `${enterpriseName}/policies/mattrax-abc123`,
      appliedPolicyVersion: "7",
      enrollmentTokenName: `${enterpriseName}/enrollmentTokens/t1`,
      disabledReason: "Contact IT",
      hardwareName: "husky",
      model: "Pixel 8 Pro",
      manufacturer: "Google",
      serial: "SER-1",
      osVersion: "14",
      buildNumber: "UQ1A.240205.004",
      securityPatchLevel: "2024-02-05",
      networkOperator: "Vodafone",
      totalRam: 12345678901,
      totalInternalStorage: 128000000000,
      hasInventory: true,
    });
    expect(resource!.lastSeenAt.toISOString()).toBe("2026-11-11T00:05:00.000Z");
    // Removed packages are not installed, so they are not inventoried.
    expect(resource!.applications).toEqual([
      { bundleId: "com.example.work", name: "Work App", version: "3.2.1" },
    ]);
  });

  it("reports a partial resource without inventory", () => {
    const resource = parseAndroidDeviceResource(
      { name: deviceName, state: "ACTIVE", lastStatusReportTime: statusReportTime },
      enterpriseName,
    );

    expect(resource).toMatchObject({ name: deviceName, state: "ACTIVE", hasInventory: false });
    expect(resource!.model).toBeUndefined();
    expect(resource!.applications).toBeUndefined();
  });

  it("never blanks a known value with a partial notification", () => {
    const full = parseAndroidDeviceResource(fullResource, enterpriseName)!;
    const at = new Date("2026-11-11T00:05:00.000Z");

    const first = mergeAndroidDevice({
      resource: full,
      serial: "SER-1",
      status: "enrolled",
      now: at,
    });

    expect(first).toMatchObject({
      name: "Pixel 8 Pro",
      physicalName: "Pixel 8 Pro",
      model: "Pixel 8 Pro",
      modelIdentifier: "husky",
      osVersion: "14",
      osBuild: "UQ1A.240205.004",
      diskTotal: "128000000000",
      serial: "SER-1",
      inventoryUpdatedAt: at,
    });

    // The fixture is the complete `device` row shape this merge is written for;
    // `Object.assign` keeps its required columns while the patch overrides the
    // ones the merge produced.
    const existing: AndroidDeviceRow = Object.assign(androidDeviceRow(), first);

    const partial = parseAndroidDeviceResource(
      { name: deviceName, state: "ACTIVE", lastStatusReportTime: statusReportTime },
      enterpriseName,
    )!;

    const merged = mergeAndroidDevice({
      existing,
      resource: partial,
      serial: null,
      status: "enrolled",
      now: new Date("2026-11-12T00:00:00.000Z"),
    });

    expect(merged).toMatchObject({
      name: "Pixel 8 Pro",
      model: "Pixel 8 Pro",
      modelIdentifier: "husky",
      serial: "SER-1",
      osVersion: "14",
      osBuild: "UQ1A.240205.004",
      diskTotal: "128000000000",
      // A report with no inventory must not move the inventory clock.
      inventoryUpdatedAt: at,
    });

    // Operator renames survive the next reported name.
    const renamed = { ...existing, name: "Warehouse scanner" };
    expect(
      mergeAndroidDevice({
        existing: renamed,
        resource: parseAndroidDeviceResource(
          { ...fullResource, hardwareInfo: { ...fullResource.hardwareInfo, model: "Pixel 9" } },
          enterpriseName,
        )!,
        serial: "SER-1",
        status: "enrolled",
        now: at,
      }),
    ).toMatchObject({ name: "Warehouse scanner", physicalName: "Pixel 9" });
  });

  it("merges the android_device columns without clearing them", () => {
    const full = parseAndroidDeviceResource(fullResource, enterpriseName)!;

    expect(mergeAndroidDeviceInfo(full)).toMatchObject({
      managementMode: "DEVICE_OWNER",
      ownership: "COMPANY_OWNED",
      apiLevel: 34,
      securityPatchLevel: "2024-02-05",
      appliedPolicyName: `${enterpriseName}/policies/mattrax-abc123`,
      enrollmentTokenName: `${enterpriseName}/enrollmentTokens/t1`,
      disabledReason: "Contact IT",
      networkOperator: "Vodafone",
      totalRam: 12345678901,
    });

    const partial = parseAndroidDeviceResource(
      { name: deviceName, state: "ACTIVE" },
      enterpriseName,
    )!;

    // Omitted fields are absent from the patch, so an update cannot null them.
    expect(mergeAndroidDeviceInfo(partial)).toEqual({ state: "ACTIVE" });
  });

  it("persists inventory and application reports across notifications", async () => {
    const db = makeDb({
      organization: [organizationRow(organizationId, "Acme")],
      android_enterprise: [activeEnterpriseRow()],
    });

    const { service } = makeAndroid();
    const token = await sign();

    const deliver = (body: Schema.Json, messageId: string) =>
      provideAndroid(
        handleAndroidPubSub({
          db,
          config,
          authSecret: "test-secret",
          origin: "https://mattrax.test",
          authorization: `Bearer ${token}`,
          body: pushBody(body, "STATUS_REPORT", messageId),
          fetch: jwksFetch,
        }),
        service,
      );

    expect((await deliver(fullResource, "message-1")).status).toBe("ok");

    expect(db.store.device![0]).toMatchObject({
      proto: "android",
      status: "enrolled",
      name: "Pixel 8 Pro",
      physicalName: "Pixel 8 Pro",
      model: "Pixel 8 Pro",
      modelIdentifier: "husky",
      serial: "SER-1",
      osEdition: "Android",
      osVersion: "14",
      osBuild: "UQ1A.240205.004",
      diskTotal: "128000000000",
    });
    expect(db.store.device![0]!.inventoryUpdatedAt).toBeInstanceOf(Date);
    expect(db.store.device![0]!.applicationsUpdatedAt).toBeInstanceOf(Date);

    expect(db.store.android_device![0]).toMatchObject({
      managementMode: "DEVICE_OWNER",
      ownership: "COMPANY_OWNED",
      apiLevel: 34,
      securityPatchLevel: "2024-02-05",
      appliedPolicyName: `${enterpriseName}/policies/mattrax-abc123`,
      enrollmentTokenName: `${enterpriseName}/enrollmentTokens/t1`,
      state: "ACTIVE",
    });

    expect(db.store.device_application!.map((row: any) => row.bundleId)).toEqual([
      "com.example.work",
    ]);
    expect(db.store.device_application![0]).toMatchObject({
      name: "Work App",
      version: "3.2.1",
      organizationId,
      deviceId: db.store.device![0]!.id,
    });

    // A later status report that omits hardwareInfo must keep everything the
    // first report established.
    await deliver(
      { name: deviceName, state: "ACTIVE", lastStatusReportTime: "2026-11-12T00:00:00Z" },
      "message-2",
    );

    expect(db.store.device![0]).toMatchObject({
      name: "Pixel 8 Pro",
      model: "Pixel 8 Pro",
      serial: "SER-1",
      osVersion: "14",
      osBuild: "UQ1A.240205.004",
    });
    expect(db.store.android_device![0]).toMatchObject({ managementMode: "DEVICE_OWNER" });
    // The app inventory is untouched because the report carried none.
    expect(db.store.device_application).toHaveLength(1);

    // A newer full report replaces the application list.
    await deliver(
      {
        ...fullResource,
        lastStatusReportTime: "2026-11-13T00:00:00Z",
        applicationReports: [
          { packageName: "com.example.work", displayName: "Work App", versionName: "4.0.0" },
          { packageName: "com.example.mail", displayName: "Mail", versionName: "1.0.0" },
        ],
      },
      "message-3",
    );

    expect(
      db.store
        .device_application!.map((row: any) => row.bundleId)
        .sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual(["com.example.mail", "com.example.work"]);

    // Repeating the same list refreshes the report clock without duplicating
    // rows or rewriting the inventory.
    await deliver(
      {
        ...fullResource,
        lastStatusReportTime: "2026-11-14T00:00:00Z",
        applicationReports: [
          { packageName: "com.example.work", displayName: "Work App", versionName: "4.0.0" },
          { packageName: "com.example.mail", displayName: "Mail", versionName: "1.0.0" },
        ],
      },
      "message-4",
    );

    expect(db.store.device_application).toHaveLength(2);
  });

  it("keeps application reporting on in every compiled policy", () => {
    expect(withStatusReporting({ cameraDisabled: true })).toEqual({
      cameraDisabled: true,
      statusReportingSettings: { softwareInfoEnabled: true, applicationReportsEnabled: true },
    });

    // An explicit tenant value still wins.
    expect(
      withStatusReporting({
        statusReportingSettings: { applicationReportsEnabled: false },
      }),
    ).toEqual({
      statusReportingSettings: { applicationReportsEnabled: false, softwareInfoEnabled: true },
    });
  });
});
