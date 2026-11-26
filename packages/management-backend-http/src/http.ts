import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  CheckinScope,
  AppleDeviceEvent,
  AppleDeviceEventResult,
  AppleReturnToServiceConfiguration,
  ManagementManifest,
  DdmTokens,
  DdmDeclarationItems,
  ManagementNotSupported,
  UnknownDevice,
  ServerInitiatedUnenrollment,
  InternalServerError,
  WindowsDeviceEvent,
  WindowsDiscoveryRequest,
  WindowsDiscoveryResponse,
  WindowsEnrollmentPolicy,
  WindowsEnrollmentRequest,
  WindowsEnrollmentResult,
  WindowsManagementRequest,
  WindowsManagementResponse,
  WindowsManagementScope,
} from "@mattrax/management-backend";

const signatureSchemeDescription =
  "HMAC-SHA256 signature, lowercase hex, over `${operation}.${timestamp}.${sha256hex(JSON.stringify(body ?? null))}`. `operation` is the bare endpoint identifier (for example `appleManagementCheckin`), not the prefixed `ManagementWebhook.<identifier>` OpenAPI operation id.";

const timestampSchemeDescription =
  "Unix timestamp in seconds. Requests outside a 300 second window are rejected.";

const webhookSecurityRequirement = {
  "x-mattrax-timestamp": [],
  "x-mattrax-signature": [],
} satisfies Record<string, ReadonlyArray<string>>;

const httpMethods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

type WebhookOperation = {
  security?: Array<Record<string, ReadonlyArray<string>>>;
};

type WebhookPathItem = Partial<Record<(typeof httpMethods)[number], WebhookOperation>>;

type WebhookOpenApiDocument = {
  paths?: Readonly<Record<string, WebhookPathItem | undefined>>;
  components?: {
    securitySchemes?: Record<string, OpenApi.OpenAPIApiKeySecurityScheme>;
  };
};

/**
 * Document the two signatures every management webhook request carries.
 *
 * The schemes are documentation only: authentication is still performed by
 * `managementWebhookHandlers` so the generated contract cannot drift from the
 * runtime check.
 */
const applyWebhookSecurity = (document: WebhookOpenApiDocument): WebhookOpenApiDocument => {
  const securitySchemes = ((document.components ??= {}).securitySchemes ??= {});

  securitySchemes["x-mattrax-timestamp"] = {
    type: "apiKey",
    in: "header",
    name: "x-mattrax-timestamp",
    description: timestampSchemeDescription,
  };

  securitySchemes["x-mattrax-signature"] = {
    type: "apiKey",
    in: "header",
    name: "x-mattrax-signature",
    description: signatureSchemeDescription,
  };

  for (const pathItem of Object.values(document.paths ?? {}))
    for (const method of httpMethods) {
      const operation = pathItem?.[method];

      if (operation) operation.security = [webhookSecurityRequirement];
    }

  return document;
};

export const managementWebhookGroup = HttpApiGroup.make("ManagementWebhook")
  .add(
    HttpApiEndpoint.post("appleDeviceEvent", "/apple/event", {
      payload: Schema.Struct({ scope: CheckinScope, event: AppleDeviceEvent }),
      // Older peers return 204 with no body; the profile is only present when
      // this backend has one to hand back. The tuple form keeps both statuses
      // in the contract so the client and OpenAPI accept either.
      success: [AppleDeviceEventResult, HttpApiSchema.NoContent],
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("appleManagementCheckin", "/apple/checkin", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: ManagementManifest,
      error: Schema.Union([
        ManagementNotSupported,
        UnknownDevice,
        ServerInitiatedUnenrollment,
        InternalServerError,
      ]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleBootstrapToken", "/apple/bootstrap-token", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: Schema.NullOr(Schema.String),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("appleReturnToServiceConfiguration", "/apple/return-to-service", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: AppleReturnToServiceConfiguration,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationTokens", "/apple/declaration-tokens", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: DdmTokens,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclarationItems", "/apple/declaration-items", {
      payload: Schema.Struct({ scope: CheckinScope }),
      success: DdmDeclarationItems,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleDeclaration", "/apple/declaration", {
      payload: Schema.Struct({
        scope: CheckinScope,
        type: Schema.String,
        identifier: Schema.String,
      }),
      success: Schema.NullOr(Schema.JsonObject),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleAsset", "/apple/asset", {
      payload: Schema.Struct({
        identityCertificate: Schema.optional(Schema.String),
        identifier: Schema.String,
        token: Schema.optional(Schema.String),
      }),
      success: Schema.NullOr(
        Schema.Struct({
          content: Schema.Uint8ArrayFromBase64,
          contentType: Schema.String,
        }),
      ),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleManifest", "/apple/manifest", {
      payload: Schema.Struct({
        identityCertificate: Schema.optional(Schema.String),
        identifier: Schema.String,
        token: Schema.optional(Schema.String),
      }),
      success: Schema.NullOr(
        Schema.Struct({
          content: Schema.Uint8ArrayFromBase64,
          contentType: Schema.String,
        }),
      ),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getAppleProfile", "/apple/profile", {
      payload: Schema.Struct({
        policyId: Schema.String,
        kind: Schema.String,
        deviceId: Schema.String,
      }),
      success: Schema.NullOr(
        Schema.Struct({
          content: Schema.Uint8ArrayFromBase64,
          contentType: Schema.String,
        }),
      ),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsDiscovery", "/windows/discovery", {
      payload: WindowsDiscoveryRequest,
      success: WindowsDiscoveryResponse,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("getWindowsEnrollmentPolicy", "/windows/policy", {
      payload: Schema.Struct({
        authToken: Schema.String,
        tenantToken: Schema.optional(Schema.String),
        /** Verified enrollment-request address, authenticated by the webhook signature. */
        clientIp: Schema.optional(Schema.String),
        /** Bounded enrollment-request User-Agent, authenticated by the webhook signature. */
        userAgent: Schema.optional(Schema.String),
      }),
      success: WindowsEnrollmentPolicy,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsEnroll", "/windows/enroll", {
      payload: WindowsEnrollmentRequest,
      success: WindowsEnrollmentResult,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsManagementCheckin", "/windows/checkin", {
      payload: Schema.Struct({ scope: WindowsManagementScope, request: WindowsManagementRequest }),
      success: WindowsManagementResponse,
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .add(
    HttpApiEndpoint.post("windowsDeviceEvent", "/windows/event", {
      payload: Schema.Struct({ scope: WindowsManagementScope, event: WindowsDeviceEvent }),
      error: Schema.Union([ManagementNotSupported, UnknownDevice, InternalServerError]),
    }),
  )
  .prefix("/webhook")
  .annotateMerge(
    OpenApi.annotations({
      title: "Management Webhook",
      description:
        "Routes a customer management backend implements for Mattrax. Mattrax signs every request with `x-mattrax-timestamp` and `x-mattrax-signature`.",
    }),
  );

export const managementApi = HttpApi.make("ManagementApi")
  .add(managementWebhookGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Management Webhook",
      version: "1.0.0",
      description:
        "The management webhook contract a customer management backend implements. These routes are served by the management backend, not by the Mattrax Cloud API.",
      servers: [{ url: "/" }],
      transform: applyWebhookSecurity,
    }),
  );
