import { Schema } from "effect";

/**
 * Shape of a Google service account JSON key file.
 *
 * Extra fields emitted by Google (for example `type`, `client_id`) are ignored.
 */
export const ServiceAccount = Schema.Struct({
  client_email: Schema.String,
  private_key: Schema.String,
  project_id: Schema.String,
  token_uri: Schema.optional(Schema.String),
});

export type ServiceAccount = typeof ServiceAccount.Type;

/** A signup URL used to start the Android Enterprise signup flow. */
export const SignupUrl = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
});

export type SignupUrl = typeof SignupUrl.Type;

/** An Android Enterprise (the Google-side tenant). */
export const Enterprise = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    displayName: Schema.optional(Schema.String),
    contactEmail: Schema.optional(Schema.String),
    pubsubTopic: Schema.optional(Schema.String),
    enabledNotificationTypes: Schema.optional(Schema.Array(Schema.String)),
    enterpriseType: Schema.optional(Schema.String),
    googleAuthenticationEnabled: Schema.optional(Schema.Boolean),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export type Enterprise = typeof Enterprise.Type;

/** An enrollment token (and its QR code payload) for a single device. */
export const EnrollmentToken = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    value: Schema.String,
    qrCode: Schema.optional(Schema.String),
    expirationTimestamp: Schema.optional(Schema.String),
    policyName: Schema.optional(Schema.String),
    additionalData: Schema.optional(Schema.String),
    oneTimeOnly: Schema.optional(Schema.Boolean),
    enrollmentTokenType: Schema.optional(Schema.String),
    allowPersonalUsage: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export type EnrollmentToken = typeof EnrollmentToken.Type;

/** A managed Android device. */
export const Device = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    displayName: Schema.optional(Schema.String),
    state: Schema.optional(Schema.String),
    policyName: Schema.optional(Schema.String),
    appliedPolicyName: Schema.optional(Schema.String),
    enrollmentTime: Schema.optional(Schema.String),
    lastStatusReportTime: Schema.optional(Schema.String),
    managementMode: Schema.optional(Schema.String),
    enrollmentTokenName: Schema.optional(Schema.String),
    apiLevel: Schema.optional(Schema.Number),
    manufacturer: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    serialNumber: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export type Device = typeof Device.Type;

/** A page of devices returned by `enterprises.devices.list`. */
export const DeviceList = Schema.Struct({
  devices: Schema.optional(Schema.Array(Device)),
  nextPageToken: Schema.optional(Schema.String),
});

export type DeviceList = typeof DeviceList.Type;

/**
 * An Android Management policy document.
 *
 * Policies are provider-defined JSON, so the schema is deliberately permissive.
 * It still guarantees the value is a JSON object (not an array or scalar).
 */
export const Policy = Schema.Record(Schema.String, Schema.Unknown);

export type Policy = typeof Policy.Type;

/** Google API `Status` attached to a failed long-running operation. */
export const OperationStatus = Schema.Struct({
  code: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  details: Schema.optional(Schema.Unknown),
});

export type OperationStatus = typeof OperationStatus.Type;

/** A long-running operation (for example `issueCommand`). */
export const Operation = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    done: Schema.optional(Schema.Boolean),
    error: Schema.optional(OperationStatus),
    response: Schema.optional(Schema.Unknown),
    metadata: Schema.optional(Schema.Unknown),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export type Operation = typeof Operation.Type;

/** The `message` object of a Pub/Sub push delivery. */
export const PubSubMessage = Schema.Struct({
  data: Schema.optional(Schema.String),
  attributes: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  messageId: Schema.String,
  publishTime: Schema.optional(Schema.String),
  orderingKey: Schema.optional(Schema.String),
});

export type PubSubMessage = typeof PubSubMessage.Type;

/** The JSON body Pub/Sub POSTs to a push subscription endpoint. */
export const PubSubPushEnvelope = Schema.Struct({
  message: PubSubMessage,
  subscription: Schema.String,
});

export type PubSubPushEnvelope = typeof PubSubPushEnvelope.Type;

/**
 * The decoded `data` payload of an Android Management Pub/Sub notification.
 *
 * Kept permissive: Google may add fields, and older/newer notification types
 * populate different subsets.
 */
export const AndroidNotification = Schema.StructWithRest(
  Schema.Struct({
    deviceName: Schema.optional(Schema.String),
    enterpriseName: Schema.optional(Schema.String),
    notificationType: Schema.optional(Schema.String),
    enrollmentState: Schema.optional(Schema.String),
    commandStatus: Schema.optional(Schema.String),
    commandName: Schema.optional(Schema.String),
    device: Schema.optional(Device),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export type AndroidNotification = typeof AndroidNotification.Type;
