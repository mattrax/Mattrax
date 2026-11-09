// Auto-generated from https://github.com/apple/device-management
// Do not edit manually.

import { Schema } from "effect";

/**
 * Authenticate
 * Authenticates a user during MDM payload installation.
 */
export const Authenticate = Schema.Struct({
  DeviceName: Schema.String,
  ModelName: Schema.String,
  Model: Schema.String,
  MessageType: Schema.Literal("Authenticate"),
  Topic: Schema.String,
  UDID: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
  OSVersion: Schema.optional(Schema.String),
  BuildVersion: Schema.optional(Schema.String),
  ProductName: Schema.optional(Schema.String),
  SerialNumber: Schema.optional(Schema.String),
  IMEI: Schema.optional(Schema.String),
  MEID: Schema.optional(Schema.String),
});
export type Authenticate = typeof Authenticate.Type;

/**
 * Declarative Management
 * Sends declarative management requests to the server.
 */
export const CheckinDeclarativemanagement = Schema.Struct({
  MessageType: Schema.Literal("DeclarativeManagement"),
  Endpoint: Schema.String,
  Data: Schema.optional(Schema.String),
  UDID: Schema.String,
  EnrollmentID: Schema.String,
  EnrollmentUserID: Schema.String,
  UserShortName: Schema.optional(Schema.String),
  UserID: Schema.optional(Schema.String),
  UserLongName: Schema.String,
});
export type CheckinDeclarativemanagement = typeof CheckinDeclarativemanagement.Type;

/**
 * Check Out
 * Responds to the removal of the MDM enrollment profile from a device.
 */
export const Checkout = Schema.Struct({
  MessageType: Schema.Literal("CheckOut"),
  Topic: Schema.String,
  UDID: Schema.String,
  EnrollmentID: Schema.String,
});
export type Checkout = typeof Checkout.Type;

/**
 * Get Bootstrap Token
 * Gets the bootstrap token from the server.
 */
export const Getbootstraptoken = Schema.Struct({
  MessageType: Schema.Literal("GetBootstrapToken"),
  AwaitingConfiguration: Schema.optional(Schema.Boolean),
});
export type Getbootstraptoken = typeof Getbootstraptoken.Type;

/**
 * Get Token
 * Gets a token from the server.
 */
export const Gettoken = Schema.Struct({
  MessageType: Schema.Literal("GetToken"),
  TokenServiceType: Schema.Literals(["com.apple.maid", "com.apple.watch.pairing"]),
  TokenParameters: Schema.optional(
    Schema.Struct({
      SecurityToken: Schema.optional(Schema.String),
      PhoneUDID: Schema.optional(Schema.String),
      WatchUDID: Schema.optional(Schema.String),
    }),
  ),
  UDID: Schema.String,
  EnrollmentID: Schema.String,
  EnrollmentUserID: Schema.String,
  UserShortName: Schema.optional(Schema.String),
  UserID: Schema.optional(Schema.String),
  UserLongName: Schema.String,
});
export type Gettoken = typeof Gettoken.Type;

/**
 * Return To Service
 * Gets the return-to-service configuration from the server.
 */
export const Returntoservice = Schema.Struct({
  MessageType: Schema.Literal("ReturnToService"),
  UDID: Schema.String,
});
export type Returntoservice = typeof Returntoservice.Type;

/**
 * Set Bootstrap Token
 * Sends the bootstrap token to the server.
 */
export const Setbootstraptoken = Schema.Struct({
  MessageType: Schema.Literal("SetBootstrapToken"),
  BootstrapToken: Schema.optional(Schema.String),
  AwaitingConfiguration: Schema.optional(Schema.Boolean),
});
export type Setbootstraptoken = typeof Setbootstraptoken.Type;

/**
 * Token Update
 * Updates the token for a device on the server.
 */
export const Tokenupdate = Schema.Struct({
  NotOnConsole: Schema.Boolean,
  MessageType: Schema.Literal("TokenUpdate"),
  Topic: Schema.String,
  UDID: Schema.String,
  EnrollmentID: Schema.String,
  EnrollmentUserID: Schema.String,
  UserShortName: Schema.optional(Schema.String),
  UserID: Schema.optional(Schema.String),
  UserLongName: Schema.String,
  Token: Schema.String,
  PushMagic: Schema.String,
  UnlockToken: Schema.optional(Schema.String),
  AwaitingConfiguration: Schema.optional(Schema.Boolean),
});
export type Tokenupdate = typeof Tokenupdate.Type;

/**
 * User Authenticate
 * Authenticates a user with a two-step authentication protocol.
 */
export const Userauthenticate = Schema.Struct({
  MessageType: Schema.Literal("UserAuthenticate"),
  UDID: Schema.String,
  UserID: Schema.String,
  DigestResponse: Schema.String,
});
export type Userauthenticate = typeof Userauthenticate.Type;
