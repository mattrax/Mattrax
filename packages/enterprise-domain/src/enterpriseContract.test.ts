import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AppleDeviceUsersResponse,
  AppleUserActionRequest,
  EnterpriseInternal,
  UpdateMeRequest,
  enterpriseAccountApi,
  enterpriseApi,
  enterpriseApprovalApi,
  enterpriseAttributeApi,
  enterpriseGroupApi,
  enterpriseIdentityApi,
  enterpriseUserApi,
  enterpriseSoftwareUpdateApi,
  enterpriseOsPolicyApi,
} from "./enterprise.ts";
import { EnterpriseNotConfigured, EnterpriseUpstreamError } from "./Errors.js";
import { Registration } from "./auth.js";
import { StepUpRequired } from "./stepUp.js";

const endpoints = {
  ...enterpriseAccountApi.endpoints,
  ...enterpriseApi.endpoints,
  ...enterpriseApprovalApi.endpoints,
  ...enterpriseGroupApi.endpoints,
  ...enterpriseAttributeApi.endpoints,
  ...enterpriseIdentityApi.endpoints,
  ...enterpriseUserApi.endpoints,
  ...enterpriseSoftwareUpdateApi.endpoints,
  ...enterpriseOsPolicyApi.endpoints,
};

describe("enterprise API error contract", () => {
  it("gives every endpoint a serializable internal fallback", () => {
    const internal = new EnterpriseInternal({
      message: "Something went wrong on our side. Try again shortly.",
    });

    for (const [identifier, endpoint] of Object.entries(endpoints)) {
      const schemas = [...endpoint.error];
      expect(schemas.length, `${identifier} declares no errors`).toBeGreaterThan(0);
      const union = Schema.Union(schemas);
      expect(
        Schema.is(union)(internal),
        `${identifier} does not declare EnterpriseInternal as an error`,
      ).toBe(true);
    }
  });

  it("declares the errors Android device commands can produce", () => {
    const stepUp = new StepUpRequired({
      message: "Confirm this action",
      action: "device-command",
      methods: ["passkey"],
    });

    const notConfigured = new EnterpriseNotConfigured({ message: "Android is not connected" });

    const upstream = new EnterpriseUpstreamError({ message: "Google rejected the request" });

    for (const identifier of ["deviceAction", "deviceUnenroll"] as const) {
      const endpoint = endpoints[identifier];
      expect(endpoint, `${identifier} is missing`).toBeDefined();
      const union = Schema.Union([...endpoint.error]);

      for (const [name, error] of [
        ["StepUpRequired", stepUp],
        ["EnterpriseNotConfigured", notConfigured],
        ["EnterpriseUpstreamError", upstream],
      ] as const)
        expect(Schema.is(union)(error), `${identifier} does not encode ${name}`).toBe(true);
    }
  });

  it("keeps successful identifiers stable and unique", () => {
    const names = Object.keys(endpoints);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("searchDevices");
    expect(names).toContain("createPolicy");
    expect(names).not.toContain("deleteMeAccount");
  });
});

describe("account profile contract", () => {
  const decodeUpdateMe = Schema.decodeUnknownSync(UpdateMeRequest);
  const decodeRegistration = Schema.decodeUnknownSync(Registration);
  const atLimit = "a".repeat(120);
  const overLimit = "a".repeat(121);

  it("caps the display name at the registration limit", () => {
    expect(decodeUpdateMe({ name: atLimit }).name).toBe(atLimit);
    expect(() => decodeUpdateMe({ name: overLimit })).toThrow();

    // Keep the two account-name schemas in lockstep.
    expect(decodeRegistration({ name: atLimit, email: "user@example.com" }).name).toBe(atLimit);
    expect(() => decodeRegistration({ name: overLimit, email: "user@example.com" })).toThrow();
  });

  it("still allows omitting the name or changing only the image", () => {
    expect(decodeUpdateMe({})).toEqual({});
    expect(decodeUpdateMe({ image: null })).toEqual({ image: null });
  });
});

describe("Apple user channel contract", () => {
  const decodeUsers = Schema.decodeUnknownSync(AppleDeviceUsersResponse);
  const decodeAction = Schema.decodeUnknownSync(AppleUserActionRequest);

  it("decodes the users payload the dashboard renders", () => {
    const response = decodeUsers({
      enrollmentMode: "user",
      users: [
        {
          platformUserId: "user-1",
          shortName: "oscar",
          longName: "Oscar Beaumont",
          binding: "authenticated",
          configured: true,
          authenticatedAt: "2026-11-16T10:00:00.000Z",
          lastSeenAt: "2026-11-16T10:05:00.000Z",
          push: {
            configured: true,
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastError: null,
            lastErrorCode: null,
            consecutiveFailures: 0,
            invalidToken: false,
          },
          profiles: [{ identifier: "com.acme.wifi", displayName: "Acme Wi-Fi", managed: true }],
          actions: ["sync", "refresh-profiles"],
        },
      ],
    });

    expect(response.users[0]?.binding).toBe("authenticated");
  });

  it("accepts only the per-user actions the server implements", () => {
    expect(decodeAction({ action: "sync" })).toEqual({ action: "sync" });
    expect(decodeAction({ action: "refresh-profiles" })).toEqual({ action: "refresh-profiles" });
    expect(() => decodeAction({ action: "erase" })).toThrow();
  });
});
