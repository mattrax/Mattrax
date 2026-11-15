import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";
import {
  AndroidManagement,
  AndroidManagementLive,
  AndroidManagementValidationError,
  GoogleApiError,
  type AndroidManagementConfig,
} from "../src/index.js";
import {
  emptyResponse,
  jsonBody,
  jsonResponse,
  makeServiceAccount,
  mockFetch,
  type RecordedRequest,
  type ServiceAccountFixture,
} from "./helpers.js";

let account: ServiceAccountFixture;

const baseUrl = "https://android.test/v1";
const tokenUri = "https://oauth.test/token";
const enterprise = "enterprises/LC123";
const device = `${enterprise}/devices/device-1`;

function config(): AndroidManagementConfig {
  return {
    baseUrl,
    serviceAccount: {
      clientEmail: account.clientEmail,
      privateKeyPem: account.privateKeyPem,
      projectId: account.projectId,
      tokenUri,
    },
  };
}

function router(request: RecordedRequest): Response {
  const { pathname, method } = request;

  if (pathname === "/token") {
    return jsonResponse({ access_token: "ya29.service", expires_in: 3600, token_type: "Bearer" });
  }

  if (method === "POST" && pathname === "/v1/signupUrls") {
    return jsonResponse({ name: "signups/abc123", url: "https://enterprise.google.com/signup" });
  }

  if (method === "POST" && pathname === "/v1/enterprises") {
    const body = jsonBody(request);

    const displayName = Schema.is(Schema.JsonObject)(body) ? body["displayName"] : undefined;

    return jsonResponse(displayName === undefined ? { name: enterprise } : { name: enterprise, displayName });
  }

  if (method === "POST" && pathname === `/v1/${enterprise}/enrollmentTokens`) {
    return jsonResponse({
      name: `${enterprise}/enrollmentTokens/token-1`,
      value: "ENROLLMENT-TOKEN-VALUE",
      qrCode: "QR-CODE-DATA",
      expirationTimestamp: "2026-11-11T00:00:00Z",
    });
  }

  if (method === "PATCH" && pathname === `/v1/${enterprise}/policies/default`) {
    const body = jsonBody(request);

    const response: Record<string, Schema.Json> = {};

    if (Schema.is(Schema.JsonObject)(body)) {
      for (const [key, value] of Object.entries(body)) response[key] = value;
    }

    response["name"] = `${enterprise}/policies/default`;
    response["version"] = "7";

    return jsonResponse(response);
  }

  if (method === "PATCH" && pathname === `/v1/${device}`) {
    const body = jsonBody(request);

    const policyName = Schema.is(Schema.JsonObject)(body) ? body["policyName"] : undefined;

    return jsonResponse(policyName === undefined ? { name: device } : { name: device, policyName });
  }

  if (method === "GET" && pathname === `/v1/${enterprise}/devices`) {
    const pageToken = request.searchParams.get("pageToken");

    return pageToken === "next"
      ? jsonResponse({ devices: [{ name: `${enterprise}/devices/device-2` }] })
      : jsonResponse({
          devices: [{ name: `${enterprise}/devices/device-1` }],
          nextPageToken: "next",
        });
  }

  if (method === "POST" && pathname === `/v1/${device}:issueCommand`) {
    return jsonResponse({ name: `${device}/operations/op-1`, done: false });
  }

  if (method === "DELETE" && pathname === `/v1/${device}`) {
    return emptyResponse(204);
  }

  return jsonResponse({ error: { code: 404, message: "Enterprise not found" } }, 404);
}

function harness() {
  const mock = mockFetch(router);
  const layer = AndroidManagementLive(config()).pipe(Layer.provide(mock.layer));

  const run = <A, E>(effect: Effect.Effect<A, E, AndroidManagement>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));

  return { mock, layer, run };
}

function tokenRequests(mock: { requests: ReadonlyArray<RecordedRequest> }) {
  return mock.requests.filter((request) => request.pathname === "/token");
}

describe("AndroidManagement service", () => {
  beforeAll(async () => {
    account = await makeServiceAccount();
  });

  it("creates a signup URL with project and callback parameters", async () => {
    const { mock, run } = harness();

    const result = await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;

        return yield* android.createSignupUrl({
          callbackUrl: "https://mattrax.test/android/callback",
        });
      }),
    );

    expect(result).toEqual({
      name: "signups/abc123",
      url: "https://enterprise.google.com/signup",
    });
    const request = mock.requests.find((item) => item.pathname === "/v1/signupUrls");
    expect(request?.method).toBe("POST");
    expect(request?.searchParams.get("projectId")).toBe(account.projectId);
    expect(request?.searchParams.get("callbackUrl")).toBe("https://mattrax.test/android/callback");
    expect(tokenRequests(mock)).toHaveLength(1);
  });

  it("creates an enterprise from a signup URL", async () => {
    const { mock, run } = harness();

    const result = await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;

        return yield* android.createEnterprise({
          signupUrlName: "signups/abc123",
          enterpriseToken: "ENTERPRISE-TOKEN",
          displayName: "Acme",
          contactEmail: "it@acme.test",
          pubsubTopic: "projects/test-project/topics/android",
          enabledNotificationTypes: ["ENROLLMENT", "STATUS_REPORT"],
        });
      }),
    );

    expect(result).toEqual({ name: enterprise });
    const request = mock.requests.find((item) => item.pathname === "/v1/enterprises");
    expect(request?.searchParams.get("projectId")).toBe(account.projectId);
    expect(request?.searchParams.get("signupUrlName")).toBe("signups/abc123");
    expect(request?.searchParams.get("enterpriseToken")).toBe("ENTERPRISE-TOKEN");
    expect(jsonBody(request!)).toMatchObject({
      displayName: "Acme",
      contactEmail: "it@acme.test",
      pubsubTopic: "projects/test-project/topics/android",
      enabledNotificationTypes: ["ENROLLMENT", "STATUS_REPORT"],
    });
  });

  it("creates an enrollment token and expands a bare policy ID", async () => {
    const { mock, run } = harness();

    const result = await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;

        return yield* android.createEnrollmentToken({
          enterpriseName: enterprise,
          policyName: "default",
          additionalData: "user-42",
          oneTimeOnly: true,
        });
      }),
    );

    expect(result).toEqual({
      name: `${enterprise}/enrollmentTokens/token-1`,
      value: "ENROLLMENT-TOKEN-VALUE",
      qrCode: "QR-CODE-DATA",
      expirationTimestamp: "2026-11-11T00:00:00Z",
    });
    const request = mock.requests.find((item) => item.pathname.endsWith("/enrollmentTokens"));
    expect(request?.pathname).toBe(`/v1/${enterprise}/enrollmentTokens`);
    expect(jsonBody(request!)).toEqual({
      policyName: `${enterprise}/policies/default`,
      additionalData: "user-42",
      oneTimeOnly: true,
    });
  });

  it("patches a policy with updateMask=* and strips resource names", async () => {
    const { mock, run } = harness();

    const policy = {
      name: `${enterprise}/policies/other`,
      policyName: `${enterprise}/policies/other`,
      applications: [{ packageName: "com.example.app", installType: "FORCE_INSTALLED" }],
      screenCaptureDisabled: true,
    };

    const result = await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;

        return yield* android.patchPolicy({
          enterpriseName: enterprise,
          policyId: "default",
          policy,
        });
      }),
    );

    expect(result.version).toBe("7");
    expect(result.name).toBe(`${enterprise}/policies/default`);
    const request = mock.requests.find((item) => item.method === "PATCH");
    expect(request?.pathname).toBe(`/v1/${enterprise}/policies/default`);
    expect(request?.searchParams.get("updateMask")).toBe("*");
    expect(jsonBody(request!)).toEqual({
      applications: [{ packageName: "com.example.app", installType: "FORCE_INSTALLED" }],
      screenCaptureDisabled: true,
    });
  });

  it("patches a device policy", async () => {
    const { mock, run } = harness();

    const result = await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;

        return yield* android.patchDevice({
          deviceName: device,
          policyName: "default",
        });
      }),
    );

    expect(result.name).toBe(device);
    expect(result.policyName).toBe(`${enterprise}/policies/default`);
    const request = mock.requests.find((item) => item.method === "PATCH");
    expect(request?.pathname).toBe(`/v1/${device}`);
    expect(request?.searchParams.get("updateMask")).toBe("policyName");
    expect(jsonBody(request!)).toEqual({ policyName: `${enterprise}/policies/default` });
  });

  it("lists devices across pages", async () => {
    const { mock, run } = harness();

    const result = await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;
        const first = yield* android.listDevices({ enterpriseName: enterprise });

        const second = yield* android.listDevices({
          enterpriseName: enterprise,
          pageToken: first.nextPageToken,
        });

        return { first, second };
      }),
    );

    expect(result.first.devices.map((item) => item.name)).toEqual([device]);
    expect(result.first.nextPageToken).toBe("next");
    expect(result.second.devices.map((item) => item.name)).toEqual([
      `${enterprise}/devices/device-2`,
    ]);
    expect(result.second.nextPageToken).toBeUndefined();

    const listRequests = mock.requests.filter(
      (item) => item.method === "GET" && item.pathname === `/v1/${enterprise}/devices`,
    );

    expect(listRequests[0]?.searchParams.get("pageSize")).toBe("100");
    expect(listRequests[1]?.searchParams.get("pageToken")).toBe("next");
  });

  it("issues a device command without leaking the device name into the body", async () => {
    const { mock, run } = harness();

    const result = await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;

        return yield* android.issueCommand({
          deviceName: device,
          type: "WIPE",
          wipeParams: { wipeDataFlags: ["WIPE_EXTERNAL_STORAGE"] },
        });
      }),
    );

    expect(result).toEqual({ operationName: `${device}/operations/op-1` });
    const request = mock.requests.find((item) => item.pathname.endsWith(":issueCommand"));
    expect(request?.method).toBe("POST");
    expect(jsonBody(request!)).toEqual({
      type: "WIPE",
      wipeParams: { wipeDataFlags: ["WIPE_EXTERNAL_STORAGE"] },
    });
  });

  it("deletes a device and accepts an empty 204 response", async () => {
    const { mock, run } = harness();
    await expect(
      run(
        Effect.gen(function* () {
          const android = yield* AndroidManagement;
          yield* android.deleteDevice({ deviceName: device });
        }),
      ),
    ).resolves.toBeUndefined();
    expect(mock.requests.some((item) => item.method === "DELETE")).toBe(true);
  });

  it("reuses one access token across API calls", async () => {
    const { mock, run } = harness();
    await run(
      Effect.gen(function* () {
        const android = yield* AndroidManagement;
        yield* android.listDevices({ enterpriseName: enterprise });
        yield* android.createSignupUrl({ callbackUrl: "https://mattrax.test/callback" });
        yield* android.deleteDevice({ deviceName: device });
      }),
    );
    expect(tokenRequests(mock)).toHaveLength(1);
  });

  it("surfaces Google API error statuses", async () => {
    const { run } = harness();

    const error = await run(
      Effect.flip(
        Effect.gen(function* () {
          const android = yield* AndroidManagement;

          return yield* android.patchPolicy({
            enterpriseName: "enterprises/LC999",
            policyId: "default",
            policy: {},
          });
        }),
      ),
    );

    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error).toMatchObject({ status: 404 });
    expect(error.message).toContain("Enterprise not found");
  });

  it("rejects device names that are not full resource names", async () => {
    const { run } = harness();

    const error = await run(
      Effect.flip(
        Effect.gen(function* () {
          const android = yield* AndroidManagement;

          return yield* android.deleteDevice({ deviceName: "device-1" });
        }),
      ),
    );

    expect(error).toBeInstanceOf(AndroidManagementValidationError);
    expect(error).toMatchObject({ field: "deviceName" });
  });

  it("rejects path traversal in policy IDs", async () => {
    const { run } = harness();

    const error = await run(
      Effect.flip(
        Effect.gen(function* () {
          const android = yield* AndroidManagement;

          return yield* android.patchPolicy({
            enterpriseName: enterprise,
            policyId: "../other",
            policy: {},
          });
        }),
      ),
    );

    expect(error).toBeInstanceOf(AndroidManagementValidationError);
    expect(error).toMatchObject({ field: "policyId" });
  });
});
