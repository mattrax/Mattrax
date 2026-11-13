import { Context, Data, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  Device,
  DeviceList,
  EnrollmentToken,
  Enterprise,
  Operation,
  Policy,
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
};

export type PatchPolicyInput = {
  readonly enterpriseName: string;
  readonly policyId: string;
  readonly policy: Record<string, unknown>;
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

/** Fields accepted by `enterprises.devices.issueCommand`. */
export type IssueCommandParams = {
  readonly type: string;
  readonly newPassword?: string;
  readonly resetPasswordFlags?: ReadonlyArray<string>;
  readonly duration?: string;
  readonly clearAppsDataParams?: {
    readonly packageNames?: ReadonlyArray<string>;
  };
  readonly startLostModeParams?: Readonly<Record<string, unknown>>;
  readonly stopLostModeParams?: Readonly<Record<string, unknown>>;
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
    readonly wipeReason?: Readonly<Record<string, unknown>>;
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

export interface AndroidManagementShape {
  readonly createSignupUrl: (
    input: CreateSignupUrlInput,
  ) => Effect.Effect<SignupUrl, AndroidManagementError>;
  readonly createEnterprise: (
    input: CreateEnterpriseInput,
  ) => Effect.Effect<{ readonly name: string }, AndroidManagementError>;
  readonly createEnrollmentToken: (
    input: CreateEnrollmentTokenInput,
  ) => Effect.Effect<EnrollmentToken, AndroidManagementError>;
  readonly patchPolicy: (input: PatchPolicyInput) => Effect.Effect<Policy, AndroidManagementError>;
  readonly patchDevice: (input: PatchDeviceInput) => Effect.Effect<Device, AndroidManagementError>;
  readonly listDevices: (
    input: ListDevicesInput,
  ) => Effect.Effect<ListDevicesResult, AndroidManagementError>;
  readonly issueCommand: (
    input: IssueCommandInput,
  ) => Effect.Effect<IssueCommandResult, AndroidManagementError>;
  readonly deleteDevice: (input: {
    readonly deviceName: string;
  }) => Effect.Effect<void, AndroidManagementError>;
}

export class AndroidManagement extends Context.Service<AndroidManagement, AndroidManagementShape>()(
  "AndroidManagement",
) {}

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
function policyBody(policy: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(policy)) {
    if (key === "name" || key === "policyName") continue;
    body[key] = value;
  }

  return body;
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

      const createSignupUrl: AndroidManagementShape["createSignupUrl"] = (input) =>
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

      const createEnterprise: AndroidManagementShape["createEnterprise"] = (input) =>
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

      const createEnrollmentToken: AndroidManagementShape["createEnrollmentToken"] = (input) =>
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
            },
            schema: EnrollmentToken,
            label: "createEnrollmentToken",
          });

          return {
            name: token.name,
            value: token.value,
            qrCode: token.qrCode,
            expirationTimestamp: token.expirationTimestamp,
          };
        });

      const patchPolicy: AndroidManagementShape["patchPolicy"] = (input) =>
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

          const body = yield* (
            Schema.decodeUnknownEffect(Policy)(policyBody(input.policy)) as Effect.Effect<
              Policy,
              unknown
            >
          ).pipe(Effect.mapError(() => invalid("policy", "policy must be a JSON object")));

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

      const patchDevice: AndroidManagementShape["patchDevice"] = (input) =>
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

      const listDevices: AndroidManagementShape["listDevices"] = (input) =>
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

      const issueCommand: AndroidManagementShape["issueCommand"] = (input) =>
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

      const deleteDevice: AndroidManagementShape["deleteDevice"] = (input) =>
        Effect.gen(function* () {
          const deviceName = yield* deviceResourceName(input.deviceName);
          yield* auth.authorizedFetchVoid({
            method: "DELETE",
            url: apiUrl(deviceName),
            label: "deleteDevice",
          });
        });

      return AndroidManagement.of({
        createSignupUrl,
        createEnterprise,
        createEnrollmentToken,
        patchPolicy,
        patchDevice,
        listDevices,
        issueCommand,
        deleteDevice,
      });
    }),
  ).pipe(Layer.provide(GoogleAuthLive(config.serviceAccount)));
};

/** `AndroidManagementLive` with the platform fetch client wired in. */
export const AndroidManagementFetchLive = (config: AndroidManagementConfig) =>
  AndroidManagementLive(config).pipe(Layer.provide(FetchHttpClient.layer));
