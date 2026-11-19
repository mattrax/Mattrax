import { Context, Data, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  Device,
  DeviceList,
  EnrollmentToken,
  Enterprise,
  Operation,
  Policy,
  PolicyList,
  SignupUrl,
} from "./schema.js";
import { GoogleAuth, GoogleAuthLive, type GoogleError } from "./google.js";

export const DEFAULT_ANDROID_MANAGEMENT_BASE_URL = "https://androidmanagement.googleapis.com/v1";

/** Extra validation error for inputs that would produce unsafe API paths. */
export class AndroidManagementValidationError extends Data.TaggedError(
  "AndroidManagementValidationError",
)<{
  message: string;
  field?: string;
}> {}

export type AndroidManagementError = GoogleError | AndroidManagementValidationError;

export type AndroidManagementConfig = {
  readonly serviceAccount: {
    readonly clientEmail: string;
    /** PKCS#8 PEM from the service account JSON (`private_key`). */
    readonly privateKeyPem: string;
    readonly projectId: string;
    readonly tokenUri?: string;
  };
  /** Defaults to `https://androidmanagement.googleapis.com/v1`. */
  readonly baseUrl?: string;
};

export type CreateSignupUrlInput = {
  /** Defaults to `serviceAccount.projectId`. */
  readonly projectId?: string;
  readonly callbackUrl: string;
};

export type CreateEnterpriseInput = {
  /** Defaults to `serviceAccount.projectId`. */
  readonly projectId?: string;
  /** `name` from `createSignupUrl`. */
  readonly signupUrlName: string;
  /** `enterpriseToken` query parameter appended to the signup URL by Google. */
  readonly enterpriseToken: string;
  readonly displayName: string;
  readonly contactEmail: string;
  /** `projects/{project}/topics/{topic}`. */
  readonly pubsubTopic?: string;
  readonly enabledNotificationTypes?: ReadonlyArray<string>;
};

export type CreateEnrollmentTokenInput = {
  readonly enterpriseName: string;
  /** Full `enterprises/{id}/policies/{id}` name, or a bare policy ID. */
  readonly policyName: string;
  readonly additionalData?: string;
  readonly oneTimeOnly?: boolean;
  /** How the provisioned device may be used (work profile vs fully managed). */
  readonly allowPersonalUsage?: string;
  /** Token lifetime as an AMAPI duration string (for example `"3600s"`). */
  readonly duration?: string;
};

export type PatchPolicyInput = {
  readonly enterpriseName: string;
  readonly policyId: string;
  readonly policy: Schema.JsonObject;
  /** Defaults to `"*"` (replace every modifiable field). */
  readonly updateMask?: string;
};

export type PatchDeviceInput = {
  readonly deviceName: string;
  /** Full `enterprises/{id}/policies/{id}` name, or a bare policy ID. */
  readonly policyName: string;
};

export type ListDevicesInput = {
  readonly enterpriseName: string;
  readonly pageToken?: string;
  /** Defaults to 100 (the API maximum). */
  readonly pageSize?: number;
};

export type ListPoliciesInput = {
  readonly enterpriseName: string;
  readonly pageToken?: string;
  /** Defaults to 100 (the API maximum). */
  readonly pageSize?: number;
};

export type ListPoliciesResult = {
  readonly policies: ReadonlyArray<Policy>;
  readonly nextPageToken?: string;
};

/** Fields accepted by `enterprises.devices.issueCommand`. */
export type IssueCommandParams = {
  readonly type: string;
  readonly newPassword?: string;
  readonly resetPasswordFlags?: ReadonlyArray<string>;
  readonly duration?: string;
  readonly clearAppsDataParams?: {
    readonly packageNames?: ReadonlyArray<string>;
  };
  readonly startLostModeParams?: Readonly<Record<string, Schema.Json>>;
  readonly stopLostModeParams?: Readonly<Record<string, Schema.Json>>;
  readonly addEsimParams?: {
    readonly activationCode: string;
    readonly activationState?: string;
  };
  readonly removeEsimParams?: {
    readonly iccId: string;
  };
  readonly requestDeviceInfoParams?: {
    readonly deviceInfo: string;
  };
  readonly wipeParams?: {
    readonly wipeDataFlags?: ReadonlyArray<string>;
    readonly wipeReason?: Readonly<Record<string, Schema.Json>>;
  };
};

export type IssueCommandInput = IssueCommandParams & {
  readonly deviceName: string;
};

export type IssueCommandResult = {
  readonly operationName: string;
};

export type ListDevicesResult = {
  readonly devices: ReadonlyArray<Device>;
  readonly nextPageToken?: string;
};

export interface AndroidManagementService {
  readonly createSignupUrl: (
    input: CreateSignupUrlInput,
  ) => Effect.Effect<SignupUrl, AndroidManagementError>;
  readonly createEnterprise: (
    input: CreateEnterpriseInput,
  ) => Effect.Effect<{ readonly name: string }, AndroidManagementError>;
  /** Reads the Google-side enterprise, including its notification settings. */
  readonly getEnterprise: (input: {
    readonly enterpriseName: string;
  }) => Effect.Effect<Enterprise, AndroidManagementError>;
  /**
   * Update the enterprise itself. Only the notification types are mutable here:
   * they decide which Pub/Sub messages Google sends.
   */
  readonly patchEnterprise: (input: {
    readonly enterpriseName: string;
    readonly enabledNotificationTypes: ReadonlyArray<string>;
  }) => Effect.Effect<Enterprise, AndroidManagementError>;
  /** Deletes the enterprise, its policies and its devices. */
  readonly deleteEnterprise: (input: {
    readonly enterpriseName: string;
  }) => Effect.Effect<void, AndroidManagementError>;
  readonly createEnrollmentToken: (
    input: CreateEnrollmentTokenInput,
  ) => Effect.Effect<EnrollmentToken, AndroidManagementError>;
  readonly patchPolicy: (input: PatchPolicyInput) => Effect.Effect<Policy, AndroidManagementError>;
  readonly listPolicies: (
    input: ListPoliciesInput,
  ) => Effect.Effect<ListPoliciesResult, AndroidManagementError>;
  readonly deletePolicy: (input: {
    readonly enterpriseName: string;
    readonly policyId: string;
  }) => Effect.Effect<void, AndroidManagementError>;
  readonly patchDevice: (input: PatchDeviceInput) => Effect.Effect<Device, AndroidManagementError>;
  readonly listDevices: (
    input: ListDevicesInput,
  ) => Effect.Effect<ListDevicesResult, AndroidManagementError>;
  readonly getDevice: (input: {
    readonly deviceName: string;
  }) => Effect.Effect<Device, AndroidManagementError>;
  readonly issueCommand: (
    input: IssueCommandInput,
  ) => Effect.Effect<IssueCommandResult, AndroidManagementError>;
  readonly deleteDevice: (input: {
    readonly deviceName: string;
  }) => Effect.Effect<void, AndroidManagementError>;
  /** Polls a long-running command operation to learn its terminal state. */
  readonly getOperation: (input: {
    readonly operationName: string;
  }) => Effect.Effect<Operation, AndroidManagementError>;
}

export class AndroidManagement extends Context.Service<
  AndroidManagement,
  AndroidManagementService
>()("AndroidManagement") {}

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

function invalid(field: string, message: string): AndroidManagementValidationError {
  return new AndroidManagementValidationError({ message, field });
}

/**
 * Normalize a Google resource name and reject anything that could escape its
 * path (empty segments, `.`/`..`, query/fragment/colon characters).
 */
function resourceName(
  value: string,
  field: string,
): Effect.Effect<string, AndroidManagementValidationError> {
  return Effect.gen(function* () {
    const trimmed = value.trim().replace(/^\/+|\/+$/g, "");

    if (trimmed === "") {
      return yield* Effect.fail(invalid(field, `${field} must not be empty`));
    }

    const segments = trimmed.split("/");

    for (const segment of segments) {
      if (!SEGMENT_PATTERN.test(segment) || segment === "." || segment === "..") {
        return yield* Effect.fail(
          invalid(field, `${field} contains an invalid path segment: "${segment}"`),
        );
      }
    }

    return segments.join("/");
  });
}

/** Accept `enterprises/{id}` or a bare enterprise ID. */
function enterpriseResourceName(
  value: string,
  field: string,
): Effect.Effect<string, AndroidManagementValidationError> {
  return resourceName(value, field).pipe(
    Effect.map((name) => (name.startsWith("enterprises/") ? name : `enterprises/${name}`)),
  );
}

/** Accept a full device resource name only. */
function deviceResourceName(
  value: string,
): Effect.Effect<string, AndroidManagementValidationError> {
  return resourceName(value, "deviceName").pipe(
    Effect.flatMap((name) =>
      /^enterprises\/[^/]+\/devices\/[^/]+$/.test(name)
        ? Effect.succeed(name)
        : Effect.fail(
            invalid(
              "deviceName",
              "deviceName must be a full resource name (enterprises/{enterpriseId}/devices/{deviceId})",
            ),
          ),
    ),
  );
}

/**
 * Accept a long-running operation resource name only.
 *
 * Command operations live under the device
 * (`enterprises/{id}/devices/{id}/operations/{id}`); enterprise-level
 * operations use `enterprises/{id}/operations/{id}`. Both are accepted, and
 * anything else is rejected so a caller cannot point the request at a
 * different Google resource.
 */
function operationResourceName(
  value: string,
): Effect.Effect<string, AndroidManagementValidationError> {
  return resourceName(value, "operationName").pipe(
    Effect.flatMap((name) =>
      /^enterprises\/[^/]+(\/devices\/[^/]+)?\/operations\/[^/]+$/.test(name)
        ? Effect.succeed(name)
        : Effect.fail(
            invalid("operationName", "operationName must be a full operations resource name"),
          ),
    ),
  );
}

/** Accept a full policy resource name or a bare policy ID. */
function policyResourceName(
  enterpriseName: string,
  policyName: string,
): Effect.Effect<string, AndroidManagementValidationError> {
  return Effect.gen(function* () {
    const policy = yield* resourceName(policyName, "policyName");

    if (policy.includes("/policies/")) return policy;

    if (policy.includes("/")) {
      return yield* Effect.fail(
        invalid("policyName", "policyName must be a policy ID or enterprises/{id}/policies/{id}"),
      );
    }

    return `${enterpriseName}/policies/${policy}`;
  });
}

/**
 * Defensive: never let policy JSON smuggle a different resource name into the
 * request body. `mergeAndroidPolicies` rejects these keys; direct callers may
 * pass a policy fetched from Google, so drop the read-only names here.
 */
function policyBody(policy: Schema.JsonObject): Schema.JsonObject {
  return Object.fromEntries(
    Object.entries(policy).filter(([key]) => key !== "name" && key !== "policyName"),
  );
}

export const AndroidManagementLive = (config: AndroidManagementConfig) => {
  const baseUrl = (config.baseUrl ?? DEFAULT_ANDROID_MANAGEMENT_BASE_URL).replace(/\/+$/, "");
  const defaultProjectId = config.serviceAccount.projectId;

  const apiUrl = (
    path: string,
    query?: Readonly<Record<string, string | number | undefined>>,
  ): string => {
    const url = new URL(`${baseUrl}/${path.replace(/^\/+/, "")}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return url.toString();
  };

  return Layer.effect(
    AndroidManagement,
    Effect.gen(function* () {
      const auth = yield* GoogleAuth;

      const createSignupUrl: AndroidManagementService["createSignupUrl"] = (input) =>
        Effect.gen(function* () {
          const projectId = input.projectId ?? defaultProjectId;

          if (projectId.trim() === "") {
            return yield* Effect.fail(invalid("projectId", "projectId must not be empty"));
          }

          if (input.callbackUrl.trim() === "") {
            return yield* Effect.fail(invalid("callbackUrl", "callbackUrl must not be empty"));
          }

          return yield* auth.authorizedFetch({
            method: "POST",
            url: apiUrl("signupUrls", {
              projectId,
              callbackUrl: input.callbackUrl,
            }),
            schema: SignupUrl,
            label: "createSignupUrl",
          });
        });

      const createEnterprise: AndroidManagementService["createEnterprise"] = (input) =>
        Effect.gen(function* () {
          const projectId = input.projectId ?? defaultProjectId;

          if (projectId.trim() === "") {
            return yield* Effect.fail(invalid("projectId", "projectId must not be empty"));
          }

          const signupUrlName = yield* resourceName(input.signupUrlName, "signupUrlName");

          const enterprise = yield* auth.authorizedFetch({
            method: "POST",
            url: apiUrl("enterprises", {
              projectId,
              signupUrlName,
              enterpriseToken: input.enterpriseToken,
            }),
            body: {
              displayName: input.displayName,
              contactEmail: input.contactEmail,
              pubsubTopic: input.pubsubTopic,
              enabledNotificationTypes: input.enabledNotificationTypes,
            },
            schema: Enterprise,
            label: "createEnterprise",
          });

          return { name: enterprise.name };
        });

      const getEnterprise: AndroidManagementService["getEnterprise"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          return yield* auth.authorizedFetch({
            method: "GET",
            url: apiUrl(enterpriseName),
            schema: Enterprise,
            label: "getEnterprise",
          });
        });

      const patchEnterprise: AndroidManagementService["patchEnterprise"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          return yield* auth.authorizedFetch({
            method: "PATCH",
            url: apiUrl(enterpriseName, { updateMask: "enabledNotificationTypes" }),
            body: { enabledNotificationTypes: [...input.enabledNotificationTypes] },
            schema: Enterprise,
            label: "patchEnterprise",
          });
        });

      const deleteEnterprise: AndroidManagementService["deleteEnterprise"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          yield* auth.authorizedFetchVoid({
            method: "DELETE",
            url: apiUrl(enterpriseName),
            label: "deleteEnterprise",
          });
        });

      const createEnrollmentToken: AndroidManagementService["createEnrollmentToken"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          const policyName = yield* policyResourceName(enterpriseName, input.policyName);

          const token = yield* auth.authorizedFetch({
            method: "POST",
            url: apiUrl(`${enterpriseName}/enrollmentTokens`),
            body: {
              policyName,
              additionalData: input.additionalData,
              oneTimeOnly: input.oneTimeOnly,
              allowPersonalUsage: input.allowPersonalUsage,
              duration: input.duration,
            },
            schema: EnrollmentToken,
            label: "createEnrollmentToken",
          });

          return {
            name: token.name,
            value: token.value,
            qrCode: token.qrCode,
            duration: token.duration,
            expirationTimestamp: token.expirationTimestamp,
            allowPersonalUsage: token.allowPersonalUsage,
          };
        });

      const patchPolicy: AndroidManagementService["patchPolicy"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          const policyId = yield* resourceName(input.policyId, "policyId");

          if (policyId.includes("/")) {
            return yield* Effect.fail(
              invalid("policyId", "policyId must be a single path segment"),
            );
          }

          const body = yield* Schema.decodeUnknownEffect(Policy)(policyBody(input.policy)).pipe(
            Effect.mapError(() => invalid("policy", "policy must be a JSON object")),
          );

          return yield* auth.authorizedFetch({
            method: "PATCH",
            url: apiUrl(`${enterpriseName}/policies/${policyId}`, {
              updateMask: input.updateMask ?? "*",
            }),
            body,
            schema: Policy,
            label: "patchPolicy",
          });
        });

      const listPolicies: AndroidManagementService["listPolicies"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          const list = yield* auth.authorizedFetch({
            method: "GET",
            url: apiUrl(`${enterpriseName}/policies`, {
              pageSize: input.pageSize ?? 100,
              pageToken: input.pageToken,
            }),
            schema: PolicyList,
            label: "listPolicies",
          });

          return {
            policies: list.policies ?? [],
            nextPageToken: list.nextPageToken,
          };
        });

      const deletePolicy: AndroidManagementService["deletePolicy"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          const policyId = yield* resourceName(input.policyId, "policyId");

          if (policyId.includes("/")) {
            return yield* Effect.fail(
              invalid("policyId", "policyId must be a single path segment"),
            );
          }

          yield* auth.authorizedFetchVoid({
            method: "DELETE",
            url: apiUrl(`${enterpriseName}/policies/${policyId}`),
            label: "deletePolicy",
          });
        });

      const patchDevice: AndroidManagementService["patchDevice"] = (input) =>
        Effect.gen(function* () {
          const deviceName = yield* deviceResourceName(input.deviceName);
          const enterpriseName = deviceName.split("/").slice(0, 2).join("/");
          const policyName = yield* policyResourceName(enterpriseName, input.policyName);

          return yield* auth.authorizedFetch({
            method: "PATCH",
            url: apiUrl(deviceName, { updateMask: "policyName" }),
            body: { policyName },
            schema: Device,
            label: "patchDevice",
          });
        });

      const listDevices: AndroidManagementService["listDevices"] = (input) =>
        Effect.gen(function* () {
          const enterpriseName = yield* enterpriseResourceName(
            input.enterpriseName,
            "enterpriseName",
          );

          const list = yield* auth.authorizedFetch({
            method: "GET",
            url: apiUrl(`${enterpriseName}/devices`, {
              pageSize: input.pageSize ?? 100,
              pageToken: input.pageToken,
            }),
            schema: DeviceList,
            label: "listDevices",
          });

          return {
            devices: list.devices ?? [],
            nextPageToken: list.nextPageToken,
          };
        });

      const getDevice: AndroidManagementService["getDevice"] = (input) =>
        Effect.gen(function* () {
          const deviceName = yield* deviceResourceName(input.deviceName);

          return yield* auth.authorizedFetch({
            method: "GET",
            url: apiUrl(deviceName),
            schema: Device,
            label: "getDevice",
          });
        });

      const issueCommand: AndroidManagementService["issueCommand"] = (input) =>
        Effect.gen(function* () {
          const deviceName = yield* deviceResourceName(input.deviceName);

          if (input.type.trim() === "") {
            return yield* Effect.fail(invalid("type", "command type must not be empty"));
          }

          const operation = yield* auth.authorizedFetch({
            method: "POST",
            url: apiUrl(`${deviceName}:issueCommand`),
            body: {
              type: input.type,
              newPassword: input.newPassword,
              resetPasswordFlags: input.resetPasswordFlags,
              duration: input.duration,
              clearAppsDataParams: input.clearAppsDataParams,
              startLostModeParams: input.startLostModeParams,
              stopLostModeParams: input.stopLostModeParams,
              addEsimParams: input.addEsimParams,
              removeEsimParams: input.removeEsimParams,
              requestDeviceInfoParams: input.requestDeviceInfoParams,
              wipeParams: input.wipeParams,
            },
            schema: Operation,
            label: "issueCommand",
          });

          return { operationName: operation.name };
        });

      const deleteDevice: AndroidManagementService["deleteDevice"] = (input) =>
        Effect.gen(function* () {
          const deviceName = yield* deviceResourceName(input.deviceName);
          yield* auth.authorizedFetchVoid({
            method: "DELETE",
            url: apiUrl(deviceName),
            label: "deleteDevice",
          });
        });

      const getOperation: AndroidManagementService["getOperation"] = (input) =>
        Effect.gen(function* () {
          const operationName = yield* operationResourceName(input.operationName);

          return yield* auth.authorizedFetch({
            method: "GET",
            url: apiUrl(operationName),
            schema: Operation,
            label: "getOperation",
          });
        });

      return AndroidManagement.of({
        createSignupUrl,
        createEnterprise,
        getEnterprise,
        patchEnterprise,
        deleteEnterprise,
        createEnrollmentToken,
        patchPolicy,
        listPolicies,
        deletePolicy,
        patchDevice,
        listDevices,
        getDevice,
        issueCommand,
        deleteDevice,
        getOperation,
      });
    }),
  ).pipe(Layer.provide(GoogleAuthLive(config.serviceAccount)));
};

/** `AndroidManagementLive` with the platform fetch client wired in. */
export const AndroidManagementFetchLive = (config: AndroidManagementConfig) =>
  AndroidManagementLive(config).pipe(Layer.provide(FetchHttpClient.layer));
