import { Option, Schema } from "effect";
import { PlistValue } from "@mattrax/plist";

/**
 * Shared iPad reports this sentinel user id because it never authenticates the
 * user. Apple documents the exact value, so it is treated as "no
 * authentication happened" rather than as an account identifier.
 */
export const SHARED_IPAD_USER_ID = "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF";

/** One configuration profile reported by a user-channel `ProfileList`. */
export const AppleUserProfile = Schema.Struct({
  identifier: Schema.String,
  displayName: Schema.optional(Schema.String),
  payloadType: Schema.optional(Schema.String),
  payloadUuid: Schema.optional(Schema.String),
  managed: Schema.Boolean,
});

export type AppleUserProfile = typeof AppleUserProfile.Type;

/** Bound the list so a device cannot fill the row with a huge response. */
export const APPLE_USER_PROFILE_LIMIT = 200;

/** The subset of a `ProfileList` response the dashboard needs. */
const ProfileListEntry = Schema.Struct({
  PayloadIdentifier: Schema.optional(Schema.String),
  PayloadDisplayName: Schema.optional(Schema.String),
  PayloadType: Schema.optional(Schema.String),
  PayloadUUID: Schema.optional(Schema.String),
  IsManaged: Schema.optional(Schema.Boolean),
});

const ProfileListQueryResponses = Schema.Struct({
  ProfileList: Schema.optional(Schema.Array(Schema.Unknown)),
});

/**
 * Extract the profiles a user channel reports for its login context.
 *
 * `ProfileList` returns `ProfileList: [{ PayloadIdentifier, PayloadDisplayName,
 * PayloadType, PayloadUUID, IsManaged, ... }]`. A payload without an identifier
 * cannot be addressed by a later `RemoveProfile` and is skipped.
 */
export const parseAppleUserProfiles = (
  queryResponses: PlistValue | undefined,
): Array<AppleUserProfile> => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(ProfileListQueryResponses)(queryResponses),
  );

  const entries = decoded?.ProfileList ?? [];

  return entries.slice(0, APPLE_USER_PROFILE_LIMIT).flatMap((entry) => {
    const profile = Option.getOrUndefined(Schema.decodeUnknownOption(ProfileListEntry)(entry));

    if (!profile?.PayloadIdentifier) return [];

    return [
      {
        identifier: profile.PayloadIdentifier,
        displayName: profile.PayloadDisplayName,
        payloadType: profile.PayloadType,
        payloadUuid: profile.PayloadUUID,
        managed: profile.IsManaged === true,
      },
    ];
  });
};
