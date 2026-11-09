import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

const NullableString = Schema.NullOr(Schema.String);

export class PlatformUnauthorized extends Schema.TaggedError<PlatformUnauthorized>()(
  "PlatformUnauthorized",
  { message: Schema.String },
) {}
export class PlatformBadRequest extends Schema.TaggedError<PlatformBadRequest>()(
  "PlatformBadRequest",
  { message: Schema.String },
) {}
export class PlatformNotFound extends Schema.TaggedError<PlatformNotFound>()("PlatformNotFound", {
  message: Schema.String,
}) {}

const authErrors = [PlatformUnauthorized.pipe(HttpApiSchema.status(401))] as const;
const writeErrors = [
  ...authErrors,
  PlatformBadRequest.pipe(HttpApiSchema.status(400)),
  PlatformNotFound.pipe(HttpApiSchema.status(404)),
] as const;

export const InstanceStatus = Schema.Literals(["active", "inactive", "revoked"]);
export const InstanceInfo = Schema.Struct({
  id: Schema.String,
  keyPrefix: Schema.String,
  description: Schema.optional(NullableString),
  userCount: Schema.Number,
  deviceCount: Schema.Number,
  status: InstanceStatus,
  createdAt: Schema.String,
  lastSeenAt: Schema.optional(NullableString),
  revokedAt: Schema.optional(NullableString),
});
export type InstanceInfo = typeof InstanceInfo.Type;

export const InstanceListResponse = Schema.Struct({ instances: Schema.Array(InstanceInfo) });
export const CreateInstanceRequest = Schema.Struct({
  description: Schema.optional(NullableString),
});
export const CreateInstanceResponse = Schema.Struct({
  instance: InstanceInfo,
  /** The product key. Returned exactly once. */
  key: Schema.String,
});
export const UpdateInstanceRequest = Schema.Struct({
  description: Schema.optional(NullableString),
});

/** Used by self-hosted licence monitors. Signed with the product key. */
export const VerifyInstanceRequest = Schema.Struct({
  userCount: Schema.optional(Schema.Number),
  deviceCount: Schema.optional(Schema.Number),
});
export const VerifyInstanceResponse = Schema.Struct({
  valid: Schema.Boolean,
  revoked: Schema.Boolean,
});

/** Cloud signing of a self-hosted instance's APNs CSR. */
export const SignInstanceCsrRequest = Schema.Struct({ csrDer: Schema.String });
export const SignInstanceCsrResponse = Schema.Struct({
  /** PEM certificate chain, one entry per certificate. */
  pushCertCertificateChain: Schema.Array(Schema.String),
  /** Base64 DER PKCS#1 v1.5 signature. */
  pushCertSignature: Schema.String,
});

export const platformApi = HttpApiGroup.make("PlatformApi")
  .add(
    HttpApiEndpoint.get("status", "/status", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.get("listInstances", "/instances", {
      error: authErrors,
      success: InstanceListResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("createInstance", "/instances", {
      error: authErrors,
      payload: CreateInstanceRequest,
      success: CreateInstanceResponse,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateInstance", "/instances/:instanceId", {
      error: writeErrors,
      params: { instanceId: Schema.String },
      payload: UpdateInstanceRequest,
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.delete("revokeInstance", "/instances/:instanceId", {
      error: writeErrors,
      params: { instanceId: Schema.String },
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyInstance", "/instances/verify", {
      error: writeErrors,
      payload: VerifyInstanceRequest,
      success: VerifyInstanceResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("signInstanceCsr", "/instances/apns/sign", {
      error: writeErrors,
      payload: SignInstanceCsrRequest,
      success: SignInstanceCsrResponse,
    }),
  )
  .prefix("/api/platform")
  .annotateMerge(
    OpenApi.annotations({
      title: "Mattrax Platform API",
      description: "Licensing and instance management for self-hosted deployments.",
    }),
  );
