import { Effect, Layer, Schema } from "effect";
import {
  AndroidManagement,
  AndroidManagementFetchLive,
  GoogleApiError,
  type GoogleError,
} from "@mattrax/dm-android";
import type { AndroidDeliveryConfig } from "@mattrax/enterprise-backend";
import { env as apiEnv } from "./env.js";

const ServiceAccountJson = Schema.Struct({
  client_email: Schema.String,
  private_key: Schema.String,
  project_id: Schema.optional(Schema.String),
  token_uri: Schema.optional(Schema.String),
});

/**
 * Parse the deployment's Android Management credentials.
 *
 * The service-account JSON is supplied as a Worker secret. Parsing failures
 * return `undefined` (fail closed) and never echo the credential material.
 * Only the client email and project id reach the database or the UI. The
 * result is cached per isolate because environment bindings are static.
 */
let cachedAndroidConfig: AndroidDeliveryConfig | null | undefined;

export const androidDeliveryConfig = (): AndroidDeliveryConfig | undefined => {
  if (cachedAndroidConfig !== undefined) return cachedAndroidConfig ?? undefined;
  const raw = apiEnv.ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) {
    cachedAndroidConfig = null;
    return undefined;
  }
  if (!/^\s*[{[]/.test(raw)) {
    console.warn(
      "Android Management is disabled: ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON is not JSON",
    );
    cachedAndroidConfig = null;
    return undefined;
  }
  let decoded: typeof ServiceAccountJson.Type;
  try {
    decoded = Schema.decodeUnknownSync(ServiceAccountJson)(JSON.parse(raw) as unknown);
  } catch {
    console.warn(
      "Android Management is disabled: ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON is not a valid service account",
    );
    cachedAndroidConfig = null;
    return undefined;
  }
  const projectId = apiEnv.ANDROID_MANAGEMENT_PROJECT_ID ?? decoded.project_id;
  if (!projectId?.trim() || !decoded.client_email.trim() || !decoded.private_key.trim()) {
    console.warn("Android Management is disabled: service account fields are incomplete");
    cachedAndroidConfig = null;
    return undefined;
  }
  const parsed = {
    serviceAccount: {
      clientEmail: decoded.client_email,
      privateKeyPem: decoded.private_key,
      projectId,
      ...(decoded.token_uri ? { tokenUri: decoded.token_uri } : {}),
    },
    ...(apiEnv.ANDROID_MANAGEMENT_PUBSUB_TOPIC
      ? { pubsubTopic: apiEnv.ANDROID_MANAGEMENT_PUBSUB_TOPIC }
      : {}),
    ...(apiEnv.ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION
      ? { pubsubSubscription: apiEnv.ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION }
      : {}),
    ...(apiEnv.ANDROID_MANAGEMENT_PUBSUB_AUDIENCE
      ? { pubsubAudience: apiEnv.ANDROID_MANAGEMENT_PUBSUB_AUDIENCE }
      : {}),
    ...(apiEnv.ANDROID_MANAGEMENT_PUBSUB_JWKS_URI
      ? { jwksUri: apiEnv.ANDROID_MANAGEMENT_PUBSUB_JWKS_URI }
      : {}),
  } satisfies AndroidDeliveryConfig;
  cachedAndroidConfig = parsed;
  return parsed;
};

const unavailable = (label: string) =>
  Effect.fail(
    new GoogleApiError({
      message: `Android Management is not configured (${label}).`,
    }),
  ) as Effect.Effect<never, GoogleError>;

/**
 * Always provide `AndroidManagement` so the HttpApi handler layer type is
 * satisfied. Unconfigured deployments get a stub whose methods fail closed;
 * every API path checks `isAndroidConfigured` before calling it.
 */
export const androidManagementLayer = (
  config?: AndroidDeliveryConfig,
): Layer.Layer<AndroidManagement> =>
  config
    ? AndroidManagementFetchLive({ serviceAccount: config.serviceAccount })
    : Layer.succeed(
        AndroidManagement,
        AndroidManagement.of({
          createSignupUrl: () => unavailable("createSignupUrl"),
          createEnterprise: () => unavailable("createEnterprise"),
          createEnrollmentToken: () => unavailable("createEnrollmentToken"),
          patchPolicy: () => unavailable("patchPolicy"),
          patchDevice: () => unavailable("patchDevice"),
          listDevices: () => unavailable("listDevices"),
          issueCommand: () => unavailable("issueCommand"),
          deleteDevice: () => unavailable("deleteDevice"),
        }),
      );
