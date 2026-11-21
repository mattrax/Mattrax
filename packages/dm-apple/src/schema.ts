import { Data, Schema } from "effect";

export { PlistParseError, PlistSerializeError } from "@mattrax/plist";

export class MdmError extends Data.TaggedError("MdmError")<{ message: string; cause?: unknown }> {}

export class DeviceNotFound extends Data.TaggedError("DeviceNotFound")<{ deviceId: string }> {}

// Effect's tagged-error payload is deliberately empty; \`Record<string, never>\`
// changes how it combines with sibling error unions.
// oxlint-disable-next-line typescript/no-empty-object-type -- Effect tagged error with no payload.
export class DeviceUnenrolled extends Data.TaggedError("DeviceUnenrolled")<{}> {}

export class DeclarationNotFound extends Data.TaggedError("DeclarationNotFound")<{
  declarationId: string;
}> {}

/**
 * Device and user identifiers Apple sends on every check-in.
 *
 * A device enrollment reports `UDID`; an Apple User Enrollment (BYOD) reports
 * the per-enrollment `EnrollmentID` instead. The user channel adds a user
 * identifier, which is `UserID` on macOS and Shared iPad and
 * `EnrollmentUserID` for a user enrollment on the user channel.
 */
const CheckinIdentifierFields = {
  UDID: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
};

const UserChannelIdentifierFields = {
  UserID: Schema.optional(Schema.String),
  EnrollmentUserID: Schema.optional(Schema.String),
  UserShortName: Schema.optional(Schema.String),
  UserLongName: Schema.optional(Schema.String),
};

export const AuthenticatePlist = Schema.Struct({
  MessageType: Schema.Literal("Authenticate"),
  Topic: Schema.String,
  ...CheckinIdentifierFields,
  SerialNumber: Schema.optional(Schema.String),
  OSVersion: Schema.optional(Schema.String),
  Model: Schema.optional(Schema.String),
  ModelName: Schema.optional(Schema.String),
  ProductName: Schema.optional(Schema.String),
});

export type AuthenticatePlist = typeof AuthenticatePlist.Type;

export const TokenUpdatePlist = Schema.Struct({
  MessageType: Schema.Literal("TokenUpdate"),
  Topic: Schema.String,
  ...CheckinIdentifierFields,
  ...UserChannelIdentifierFields,
  PushMagic: Schema.String,
  Token: Schema.String,
  UnlockToken: Schema.optional(Schema.String),
  NotOnConsole: Schema.optional(Schema.Boolean),
  AwaitingConfiguration: Schema.optional(Schema.Boolean),
});

export type TokenUpdatePlist = typeof TokenUpdatePlist.Type;

export const CheckOutPlist = Schema.Struct({
  MessageType: Schema.Literal("CheckOut"),
  Topic: Schema.String,
  ...CheckinIdentifierFields,
  ...UserChannelIdentifierFields,
});

export type CheckOutPlist = typeof CheckOutPlist.Type;

/**
 * `UserAuthenticate` is the two-transaction handshake macOS uses before a
 * user-channel session. The first request carries a user identifier and no
 * `DigestResponse`; a second request carries the digest a client computed from
 * a challenge the server returned. User Enrollment sends
 * `EnrollmentUserID` instead of `UserID`, so neither may be required here.
 */
export const UserAuthenticatePlist = Schema.Struct({
  MessageType: Schema.Literal("UserAuthenticate"),
  ...UserChannelIdentifierFields,
  ...CheckinIdentifierFields,
  DigestResponse: Schema.optional(Schema.String),
});

export type UserAuthenticatePlist = typeof UserAuthenticatePlist.Type;

/**
 * `GetToken` asks the server for a token service credential (a Managed Apple
 * Account access token or an Apple Watch pairing token). It is unrelated to
 * the user channel's `AuthToken`.
 */
export const GetTokenPlist = Schema.Struct({
  MessageType: Schema.Literal("GetToken"),
  TokenServiceType: Schema.String,
  TokenParameters: Schema.optional(
    Schema.Struct({
      SecurityToken: Schema.optional(Schema.String),
      PhoneUDID: Schema.optional(Schema.String),
      WatchUDID: Schema.optional(Schema.String),
    }),
  ),
  ...CheckinIdentifierFields,
  ...UserChannelIdentifierFields,
});

export type GetTokenPlist = typeof GetTokenPlist.Type;

export const CommandResultPlist = Schema.Struct({
  ...CheckinIdentifierFields,
  ...UserChannelIdentifierFields,
  Status: Schema.String,
  CommandUUID: Schema.optional(Schema.String),
  Command: Schema.optional(
    Schema.Struct({
      RequestType: Schema.String,
    }),
  ),
  QueryResponses: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  ErrorChain: Schema.optional(
    Schema.Array(
      Schema.Struct({
        ErrorCode: Schema.Number,
        ErrorDomain: Schema.optional(Schema.String),
        localizedDescription: Schema.optional(Schema.String),
      }),
    ),
  ),
});

export type CommandResultPlist = typeof CommandResultPlist.Type;

export const SetBootstrapTokenPlist = Schema.Struct({
  MessageType: Schema.Literal("SetBootstrapToken"),
  // User Enrollment and newer flows identify the device by EnrollmentID.
  UDID: Schema.optional(Schema.String),
  BootstrapToken: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
});

export const GetBootstrapTokenPlist = Schema.Struct({
  MessageType: Schema.Literal("GetBootstrapToken"),
  UDID: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
});

/**
 * The device asks for the Return to Service configuration before erasing.
 * Apple sends this only for ADE devices whose cloud configuration enables
 * return to service (`is_return_to_service`).
 */
export const ReturnToServicePlist = Schema.Struct({
  MessageType: Schema.Literal("ReturnToService"),
  UDID: Schema.optional(Schema.String),
  EnrollmentID: Schema.optional(Schema.String),
});

export type ReturnToServicePlist = typeof ReturnToServicePlist.Type;

export const DDMStatusReport = Schema.Struct({
  /** Flat map of Apple status item paths to their values. */
  StatusItems: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  Errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        StatusItem: Schema.optional(Schema.String),
        Reasons: Schema.optional(
          Schema.Array(
            Schema.Struct({
              Code: Schema.optional(Schema.String),
              Description: Schema.optional(Schema.String),
              Details: Schema.optional(Schema.Unknown),
            }),
          ),
        ),
      }),
    ),
  ),
});

export type DDMStatusReport = typeof DDMStatusReport.Type;

export type CheckinIdentifiers = {
  readonly UDID?: string;
  readonly EnrollmentID?: string;
  readonly UserID?: string;
  readonly EnrollmentUserID?: string;
  readonly UserShortName?: string;
  readonly UserLongName?: string;
};

/**
 * Shared iPad never authenticates the person using it, so Apple sends this
 * sentinel as `UserID` on every user channel. It carries no per-user meaning;
 * the Managed Apple Account identifier in `UserShortName` is the real identity.
 */
export const SHARED_IPAD_USER_ID = "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF";

/** Which connection a check-in arrived on, and the identifiers that came with it. */
export type AppleCheckinChannel =
  | {
      readonly kind: "device";
      readonly deviceIdentifier: string;
      readonly enrollmentId?: string;
    }
  | {
      readonly kind: "user";
      readonly deviceIdentifier: string;
      readonly enrollmentId?: string;
      readonly userId: string;
      /**
       * `user-channel` is the macOS/Shared iPad user channel (`UserID`).
       * `user-enrollment` is Apple User Enrollment on the user channel
       * (`EnrollmentUserID`), where the enrollment itself is the user.
       */
      readonly source: "user-channel" | "user-enrollment";
      readonly userShortName?: string;
      readonly userLongName?: string;
    };

/**
 * Resolve the device and user identity from a check-in plist.
 *
 * Apple sends `UDID` for a device enrollment and `EnrollmentID` for an Apple
 * User Enrollment (BYOD). The user channel is identified by `UserID` on macOS,
 * `EnrollmentUserID` on a user-enrollment user channel, and the Managed Apple
 * Account identifier on Shared iPad.
 *
 * Shared iPad is the exception: Apple sends the same sentinel `UserID` for
 * every login because it never authenticates the user, so keying the channel on
 * it would merge every person on the device into one row. `UserShortName`
 * carries the Managed Apple Account identifier and is required there, so it
 * becomes the key.
 */
export const resolveCheckinChannel = (
  identifiers: CheckinIdentifiers,
): AppleCheckinChannel | null => {
  const deviceIdentifier = identifiers.UDID ?? identifiers.EnrollmentID;

  if (!deviceIdentifier) return null;

  const enrollmentId = identifiers.EnrollmentID;
  const rawUserId = identifiers.UserID ?? identifiers.EnrollmentUserID;

  if (!rawUserId) return { kind: "device", deviceIdentifier, enrollmentId };

  const sharedIpad = rawUserId === SHARED_IPAD_USER_ID;
  const userId = sharedIpad ? (identifiers.UserShortName ?? rawUserId) : rawUserId;

  return {
    kind: "user",
    deviceIdentifier,
    enrollmentId,
    userId,
    source: identifiers.EnrollmentUserID ? "user-enrollment" : "user-channel",
    userShortName: identifiers.UserShortName,
    userLongName: identifiers.UserLongName,
  };
};
