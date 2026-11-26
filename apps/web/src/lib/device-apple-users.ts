import type { AppleDeviceUser } from "@mattrax/enterprise-domain/client";

/**
 * Display helpers for the Apple per-user channel panel.
 *
 * The raw payload is device data (`UserShortName`, push outcomes), so the
 * wording is centralised here and covered by tests instead of being repeated
 * in JSX branches.
 */
export type AppleUserPushSummary = Pick<
  AppleDeviceUser["push"],
  "configured" | "consecutiveFailures" | "invalidToken" | "lastError"
>;

/** The human name Apple reported, falling back to its opaque user identifier. */
export const appleUserDisplayName = (
  user: Pick<AppleDeviceUser, "longName" | "shortName" | "platformUserId">,
): string => user.longName ?? user.shortName ?? user.platformUserId;

/** The login name, when it differs from the display name. */
export const appleUserLoginName = (
  user: Pick<AppleDeviceUser, "longName" | "shortName" | "platformUserId">,
): string => user.shortName ?? user.platformUserId;

export const appleUserBindingLabel = (binding: AppleDeviceUser["binding"]): string => {
  switch (binding) {
    case "authenticated":
      return "Authenticated";
    case "enrollment":
      return "User enrollment";
    default:
      return "Not authenticated";
  }
};

/**
 * One line describing whether the channel can be woken. `invalidToken` is
 * reported separately because only a re-enrollment fixes it.
 */
export const appleUserPushLabel = (push: AppleUserPushSummary): string => {
  if (!push.configured) return "No push token yet";

  if (push.invalidToken) return "Push token rejected — user must sign in again";

  if (push.consecutiveFailures > 0)
    return `Push failing${push.lastError ? `: ${push.lastError}` : ""}`;

  return "Push ready";
};

export const appleUserPushTone = (
  push: AppleUserPushSummary,
): "success" | "warning" | "danger" | "muted" => {
  if (!push.configured) return "muted";

  if (push.invalidToken) return "danger";

  if (push.consecutiveFailures > 0) return "warning";

  return "success";
};

export const appleUserEnrollmentLabel = (mode: "device" | "user" | null | undefined): string =>
  mode === "user" ? "BYOD (User Enrollment)" : "Device enrollment";

/** How a user channel's directory identity was established. */
export const appleUserIdentitySourceLabel = (
  source: "certificate" | "managed-apple-account" | "byod-sign-in" | "manual",
): string => {
  switch (source) {
    case "certificate":
      return "Certificate verified";
    case "managed-apple-account":
      return "Managed Apple Account";
    case "byod-sign-in":
      return "BYOD sign-in";
    default:
      return "Linked manually";
  }
};
