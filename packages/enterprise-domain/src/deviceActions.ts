import { Schema } from "effect";
import { isMacOsDevice } from "./deviceHealth.js";
import { normalizeAppleDeviceName } from "./deviceInventory.js";
import {
  APPLE_SCHEDULE_OS_UPDATE_REMOVED_MAJOR,
  appleScheduleOsUpdateSupported,
} from "./osPolicy.js";

/**
 * Remote actions a device can be asked to perform.
 *
 * `unenroll` is not part of the command endpoint because it has its own
 * lifecycle endpoint, but it is advertised alongside the command actions so a
 * dashboard can show the same capability-driven control set.
 */
export const DeviceActionName = Schema.Literals([
  "sync",
  "lock",
  "wipe",
  "return-to-service",
  "restart",
  "shutdown",
  "clear-passcode",
  "install-app",
  "collect-security-info",
  "refresh-applications",
  "collect-activation-lock-code",
  "rotate-filevault-key",
  "set-recovery-lock",
  "verify-recovery-lock",
  "start-lost-mode",
  "stop-lost-mode",
  "reset-password",
  "clear-app-data",
  "request-device-info",
  "relinquish-ownership",
  "schedule-os-update",
  "set-device-name",
  "set-lock-screen-message",
  "unenroll",
]);

export type DeviceActionName = typeof DeviceActionName.Type;

/**
 * Actions that address one Apple user channel instead of the device.
 *
 * `sync` re-sends the user's APNs wake-up; `refresh-profiles` queues a
 * `ProfileList` on the user channel so the profiles installed for that user's
 * login context are reported back.
 */
export const AppleUserActionName = Schema.Literals(["sync", "refresh-profiles"]);

export type AppleUserActionName = typeof AppleUserActionName.Type;

export type AppleUserActionInput = {
  /** A push token and push magic are stored for this user channel. */
  readonly configured: boolean;
};

/**
 * The per-user actions a channel supports. A channel without push credentials
 * can still be queried when the user next checks in, but cannot be woken.
 */
export const appleUserAvailableActions = (
  input: AppleUserActionInput,
): ReadonlyArray<AppleUserActionName> => {
  const actions: Array<AppleUserActionName> = ["refresh-profiles"];

  if (input.configured) actions.unshift("sync");

  return actions;
};

export const appleUserSupportsAction = (
  input: AppleUserActionInput,
  action: AppleUserActionName,
): boolean => appleUserAvailableActions(input).includes(action);

const APPLE_ACTIONS: ReadonlyArray<DeviceActionName> = [
  "sync",
  "lock",
  "wipe",
  "return-to-service",
  "restart",
  "shutdown",
  "clear-passcode",
  "install-app",
  "collect-security-info",
  "refresh-applications",
  "collect-activation-lock-code",
  "rotate-filevault-key",
  "set-recovery-lock",
  "verify-recovery-lock",
  "schedule-os-update",
  "set-device-name",
  "set-lock-screen-message",
  "unenroll",
];

/**
 * Windows has no push channel: a command is picked up on the next SyncML poll,
 * so `sync` is deliberately absent. Wipe and restart are delivered as OMA-DM
 * `Exec` commands; unenroll uses `DMClient/Provider/{ProviderID}/Unenroll`.
 */
const WINDOWS_ACTIONS: ReadonlyArray<DeviceActionName> = ["wipe", "restart", "unenroll"];

/**
 * Android Management API commands cover lock, wipe, reboot, lost mode,
 * password resets, clearing managed app data, device information requests and
 * relinquishing ownership. A policy sync is a real push to Google.
 *
 * `relinquish-ownership` is the Android spelling of unenrolment: Google removes
 * the work profile and the device leaves the enterprise. `unenroll` is still
 * accurate when Mattrax deletes the device resource outright.
 */
const ANDROID_ACTIONS: ReadonlyArray<DeviceActionName> = [
  "sync",
  "lock",
  "wipe",
  "restart",
  "start-lost-mode",
  "stop-lost-mode",
  "reset-password",
  "clear-app-data",
  "request-device-info",
  "relinquish-ownership",
];

/**
 * Capability tokens a device may report that name an action directly. Apple's
 * `management.client-capabilities` reports declarative-management features,
 * not remote commands, so this list only narrows the platform set when a
 * device explicitly advertises action capabilities (for example a future
 * platform or a compliance harness).
 */
const ACTION_CAPABILITIES: ReadonlyMap<string, DeviceActionName> = new Map([
  ["sync", "sync"],
  ["lock", "lock"],
  ["wipe", "wipe"],
  ["erase", "wipe"],
  ["return-to-service", "return-to-service"],
  ["returnToService", "return-to-service"],
  ["restart", "restart"],
  ["reboot", "restart"],
  ["shutdown", "shutdown"],
  ["clear-passcode", "clear-passcode"],
  ["install-app", "install-app"],
  ["install-application", "install-app"],
  ["collect-security-info", "collect-security-info"],
  ["security-info", "collect-security-info"],
  ["refresh-applications", "refresh-applications"],
  ["installed-application-list", "refresh-applications"],
  ["activation-lock-bypass-code", "collect-activation-lock-code"],
  ["collect-activation-lock-code", "collect-activation-lock-code"],
  ["rotate-filevault-key", "rotate-filevault-key"],
  ["set-recovery-lock", "set-recovery-lock"],
  ["verify-recovery-lock", "verify-recovery-lock"],
  ["schedule-os-update", "schedule-os-update"],
  ["os-update", "schedule-os-update"],
  ["set-device-name", "set-device-name"],
  ["device-name", "set-device-name"],
  ["rename", "set-device-name"],
  ["set-lock-screen-message", "set-lock-screen-message"],
  ["lock-screen-message", "set-lock-screen-message"],
  ["unenroll", "unenroll"],
]);

const normalizeToken = (value: string) => value.trim().toLowerCase().replaceAll("_", "-");

const capabilityTokens = (capabilities: Schema.Json | null | undefined): ReadonlySet<string> => {
  const tokens = new Set<string>();

  const add = (value: string) => {
    for (const part of value.split(",")) {
      const normalized = normalizeToken(part);

      if (normalized) tokens.add(normalized);
    }
  };

  const walk = (value: Schema.Json) => {
    if (Schema.is(Schema.String)(value)) {
      add(value);

      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);

      return;
    }

    if (Schema.is(Schema.JsonObject)(value)) {
      for (const entry of Object.values(value)) walk(entry);
    }
  };

  if (capabilities !== null && capabilities !== undefined) walk(capabilities);

  return tokens;
};

const platformActions = (proto: string | null | undefined): ReadonlyArray<DeviceActionName> => {
  switch (proto) {
    case "win":
      return WINDOWS_ACTIONS;
    case "android":
      return ANDROID_ACTIONS;
    case "apple":
      return APPLE_ACTIONS;
    default:
      return [];
  }
};

export type DeviceActionInput = {
  readonly proto?: string | null;
  readonly status?: string | null;
  /** Raw client capability list reported by the device, if any. */
  readonly capabilities?: Schema.Json | null;
  /** OS edition/version narrow commands that only newer releases support. */
  readonly osEdition?: string | null;
  readonly osVersion?: string | null;
  readonly model?: string | null;
  /** Apple delivery path recorded on `device_apple`; legacy cannot use DDM. */
  readonly declarationMode?: "ddm" | "legacy" | null;
  /** Apple enrolment mode. User enrolment is BYOD and never supervised. */
  readonly enrollmentMode?: "device" | "user" | null;
  /**
   * Android Management API management mode (`DEVICE_OWNER`, `PROFILE_OWNER`).
   * Unknown or omitted values leave the action available so a stale report
   * cannot hide a valid control.
   */
  readonly managementMode?: string | null;
  /** Android ownership (`COMPANY_OWNED` / `PERSONALLY_OWNED`). */
  readonly ownership?: string | null;
};

const majorOsVersion = (value: string | null | undefined): number | null => {
  const match = /^\s*(\d+)/.exec(value ?? "");

  if (!match) return null;
  const major = Number(match[1]);

  return Number.isFinite(major) ? major : null;
};

/**
 * Return to Service is an `EraseDevice` option on iOS/iPadOS 17+, tvOS 18+ and
 * visionOS 26+. Apple does not support it on macOS at all. An unknown version
 * stays advertised and the handler gives the precise error.
 */
/**
 * Apple only implements the LockScreenMessage command on supervised
 * iPhone/iPadOS devices. The command does not exist on macOS, tvOS or
 * visionOS, and Apple User Enrollment (BYOD) devices are not supervised.
 *
 * Supervision is not reported by Apple, so an Apple device whose OS family is
 * not identifiable (for example a fresh enrollment before its first inventory
 * report) stays eligible: rejecting it would hide a valid control, and the
 * device's command result is the authoritative confirmation.
 */
export const isAppleLockScreenMessageDevice = (input: DeviceActionInput): boolean => {
  if (input.proto !== "apple") return false;
  if (input.enrollmentMode === "user") return false;

  const identity = `${input.osEdition ?? ""} ${input.model ?? ""}`;

  if (/mac/i.test(identity)) return false;
  if (/tvos|apple\s*tv/i.test(identity)) return false;
  if (/visionos|apple\s*vision/i.test(identity)) return false;
  if (/watchos|audioos/i.test(identity)) return false;

  return true;
};

/**
 * Return to Service is an `EraseDevice` option on iOS/iPadOS 17+, tvOS 18+ and
 * visionOS 26+. Apple does not support it on macOS at all. An unknown version
 * stays advertised and the handler gives the precise error.
 */
const supportsReturnToService = (input: DeviceActionInput): boolean => {
  // Only exclude macOS when the device identifies as a Mac. An unknown Apple
  // device stays advertised; the command handler reports the precise limit.
  if (/mac/i.test(input.osEdition ?? "") || /mac/i.test(input.model ?? "")) return false;

  const major = majorOsVersion(input.osVersion);
  const edition = (input.osEdition ?? "").toLowerCase();

  if (major === null) return true;

  if (/tvos/.test(edition)) return major >= 18;

  if (/visionos/.test(edition)) return major >= 26;

  return major >= 17;
};

/**
 * Whether an Android Management API command is valid for the device's
 * management mode and ownership.
 *
 * Google reports both on the device resource. Unknown values (an older status
 * report, or a call site that did not load the Android row) leave the action
 * available rather than hiding a control the operator may need.
 */
const androidActionSupported = (input: DeviceActionInput, action: DeviceActionName): boolean => {
  const ownership = input.ownership?.trim().toUpperCase();
  const managementMode = input.managementMode?.trim().toUpperCase();

  // A profile owner cannot reset the device password on a personally-owned
  // phone; Android only permits it on company-owned devices.
  if (action === "reset-password") return ownership !== "PERSONALLY_OWNED";

  // Relinquishing ownership removes the work profile and hands the device to
  // personal use. Google only supports it for company-owned work profiles, not
  // for fully managed devices and not for BYOD work profiles.
  if (action === "relinquish-ownership")
    return ownership !== "PERSONALLY_OWNED" && managementMode !== "DEVICE_OWNER";

  return true;
};

/**
 * The remote actions a specific device currently supports.
 *
 * Platform and enrollment status are the baseline. A device that reports
 * action capability tokens narrows that baseline, so an operator cannot queue
 * an action the device itself says it cannot run. Unenrollment is advertised
 * on every managed platform: Apple and Windows remove their management profile
 * and Android relinquishes ownership or deletes the device resource.
 *
 * This is a capability decision, not a permission decision: the caller still
 * enforces RBAC separately.
 */
export const deviceAvailableActions = (
  input: DeviceActionInput,
): ReadonlyArray<DeviceActionName> => {
  const status = input.status?.trim();

  const base = platformActions(input.proto)
    .filter((action) => action !== "return-to-service" || supportsReturnToService(input))
    // `ScheduleOSUpdate` is the explicit fallback where the DDM declaration
    // is unavailable; see `supportsScheduleOsUpdate`.
    .filter((action) => action !== "schedule-os-update" || appleScheduleOsUpdateSupported(input))
    // Apple's `Settings` command is supervised-only. A User Enrollment is a
    // BYOD device we know is not supervised, so never advertise the rename.
    .filter(
      (action) =>
        action !== "set-device-name" ||
        (input.proto === "apple" && input.enrollmentMode !== "user"),
    )
    // Apple's LockScreenMessage exists only for supervised iPhone and iPadOS.
    // macOS, tvOS and visionOS have no such command.
    .filter(
      (action) => action !== "set-lock-screen-message" || isAppleLockScreenMessageDevice(input),
    )
    .filter((action) => input.proto !== "android" || androidActionSupported(input, action));

  if (status !== "enrolled" && status !== "unenrolling") return [];

  const reported = capabilityTokens(input.capabilities);
  const narrowed = new Set<DeviceActionName>();

  for (const token of reported) {
    const action = ACTION_CAPABILITIES.get(token);

    if (action) narrowed.add(action);
  }

  const actions = narrowed.size > 0 ? base.filter((action) => narrowed.has(action)) : [...base];

  // Leaving management has its own endpoint and is never reported by a
  // device's command capabilities, so keep it when the platform supports it.
  if (
    status === "enrolled" &&
    ["apple", "win", "android"].includes(input.proto ?? "") &&
    !actions.includes("unenroll")
  )
    actions.push("unenroll");

  if (status === "unenrolling")
    return actions.filter((action) => action === "unenroll" || action === "sync");

  return actions;
};

export const deviceSupportsAction = (input: DeviceActionInput, action: DeviceActionName): boolean =>
  deviceAvailableActions(input).includes(action);

/**
 * Why an action is unavailable, in operator-facing wording. Callers use this
 * for the API error instead of leaking the internal capability model.
 */
export const deviceActionUnavailableReason = (
  input: DeviceActionInput,
  action: DeviceActionName,
): string => {
  if (action === "sync" && input.proto === "win")
    return "Windows devices have no push channel. Changes are applied on the next SyncML check-in; sync is not available.";

  if (input.status !== "enrolled")
    return "This action is only available while the device is enrolled.";

  if (
    input.proto === "android" &&
    action === "reset-password" &&
    input.ownership?.trim().toUpperCase() === "PERSONALLY_OWNED"
  )
    return "Android only permits password resets on company-owned devices.";

  if (input.proto === "android" && action === "relinquish-ownership")
    return "Relinquishing ownership is only available on company-owned work profiles, not on fully managed or personally-owned devices.";

  if (action === "return-to-service" && input.proto === "apple")
    return "Return to Service requires iOS/iPadOS 17 or later, tvOS 18 or later, or visionOS 26 or later. Apple does not support it on macOS.";

  if (action === "schedule-os-update") {
    const major = majorOsVersion(input.osVersion);

    if (major !== null && major >= APPLE_SCHEDULE_OS_UPDATE_REMOVED_MAJOR)
      return `Apple removed the ScheduleOSUpdate command in ${isMacOsDevice(input) ? "macOS" : "iOS/iPadOS"} ${APPLE_SCHEDULE_OS_UPDATE_REMOVED_MAJOR}. Use the DDM software-update enforcement declaration instead.`;

    if (input.enrollmentMode === "user")
      return "ScheduleOSUpdate requires supervision. A user-enrolled (BYOD) device cannot run it.";

    if (/ios|ipados/i.test(input.osEdition ?? ""))
      return "iOS and iPadOS 17 or later use Apple's DDM declaration as the update path; ScheduleOSUpdate is only offered below 17 or on legacy delivery.";

    return "ScheduleOSUpdate is only available for supervised Apple devices.";
  }

  if (action === "set-device-name" && input.proto !== "apple")
    return "Applying a name to the device is only available for Apple devices. Windows and Android name delivery is not implemented yet.";

  if (action === "set-device-name" && input.enrollmentMode === "user")
    return "Apple User Enrollment (BYOD) devices cannot be renamed by the server. Only supervised devices accept the Settings command.";

  if (action === "set-lock-screen-message" && input.proto !== "apple")
    return "Lock screen messages are only available on supervised iPhone and iPad devices. macOS, tvOS, Windows and Android do not accept Apple's LockScreenMessage command.";

  if (action === "set-lock-screen-message" && input.enrollmentMode === "user")
    return "Apple User Enrollment (BYOD) devices are not supervised, so Apple does not accept a lock screen message on them.";

  if (
    action === "set-lock-screen-message" &&
    /mac/i.test(`${input.osEdition ?? ""} ${input.model ?? ""}`)
  )
    return "Apple's LockScreenMessage command is not available on macOS.";

  if (
    action === "set-lock-screen-message" &&
    /tvos|apple\s*tv/i.test(`${input.osEdition ?? ""} ${input.model ?? ""}`)
  )
    return "Apple's LockScreenMessage command is not available on tvOS.";

  if (
    action === "set-lock-screen-message" &&
    /visionos|apple\s*vision|watchos|audioos/i.test(`${input.osEdition ?? ""} ${input.model ?? ""}`)
  )
    return "Apple's LockScreenMessage command is only available on iPhone and iPad, not visionOS, watchOS or audioOS.";

  return `This device does not support the ${action} action.`;
};

/**
 * Apple's `Settings` command that writes the device's own name.
 *
 * The item is the documented shape:
 * `Settings: [{ Item: "DeviceName", DeviceName: "<name>" }]`. It is
 * supervised-only on macOS, iOS, iPadOS and tvOS.
 */
export const appleDeviceNameSettingsPayload = (name: string) => ({
  Settings: [{ Item: "DeviceName", DeviceName: name }],
});

/**
 * Read the `DeviceName` out of a queued `Settings` payload. Used when a
 * command result arrives so the applied name can be recorded without trusting
 * the device's next (possibly stale) inventory report.
 */
export const appleDeviceNameFromSettingsPayload = (
  payload: Schema.Json | null | undefined,
): string | undefined => {
  if (!Schema.is(Schema.JsonObject)(payload)) return undefined;

  const settings = payload["Settings"];

  if (!Array.isArray(settings)) return undefined;

  for (const item of settings) {
    if (!Schema.is(Schema.JsonObject)(item)) continue;

    if (item["Item"] !== "DeviceName") continue;

    const name = item["DeviceName"];

    if (Schema.is(Schema.String)(name)) return normalizeAppleDeviceName(name);
  }

  return undefined;
};

/**
 * Longest message Mattrax sends in Apple's LockScreenMessage command.
 *
 * Apple does not document a hard limit. 500 characters is long enough for a
 * return address and instructions while keeping the dashboard preview legible;
 * rejecting it here gives the administrator a useful error instead of a
 * truncated message on the device.
 */
export const APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH = 500;

/** Policy configuration kind holding a group's default lock screen message. */
export const APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND = "mttx.apple.lockScreenMessage";

/**
 * Apple policy kinds delivered as DDM declarations (or their legacy profile
 * equivalent). A kind outside this list, such as the lock screen default, is
 * an imperative command and never has a declaration report.
 */
export const isDeclarableAppleConfigurationKind = (kind: string): boolean =>
  kind === "mttx.apple.device" || /^mttx\.apple\.(custom|certificate|declaration)\..+/.test(kind);

/** Normalise line endings, trim the message and reject an empty value. */
export const normalizeAppleLockScreenMessage = (
  value: string | null | undefined,
): string | undefined => {
  const message = value?.replaceAll(/\r\n?/g, "\n").trim();

  return message ? message : undefined;
};

/** A policy's lock screen message default. */
export type AppleLockScreenMessageConfiguration = {
  readonly message: string;
  readonly includeAssetTag: boolean;
};

/** Decode the policy configuration payload, tolerating older stored shapes. */
export const parseAppleLockScreenMessageConfiguration = (
  value: unknown,
): AppleLockScreenMessageConfiguration | undefined => {
  if (!Schema.is(Schema.JsonObject)(value)) return undefined;

  const message = value["message"];

  if (!Schema.is(Schema.String)(message)) return undefined;
  const normalized = normalizeAppleLockScreenMessage(message);

  if (!normalized) return undefined;
  const includeAssetTag = value["includeAssetTag"];

  return {
    message: normalized,
    includeAssetTag: Schema.is(Schema.Boolean)(includeAssetTag) ? includeAssetTag : false,
  };
};

/**
 * Why a lock screen message cannot be sent, in operator-facing wording.
 * Undefined means the request is valid.
 */
export const lockScreenMessageProblem = (input: {
  readonly message?: string | null;
  readonly includeAssetTag?: boolean | null;
  readonly assetTag?: string | null;
}): string | undefined => {
  const message = normalizeAppleLockScreenMessage(input.message);

  if (!message) return "Enter a lock screen message.";

  if (message.length > APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH)
    return (
      "The lock screen message must be at most " +
      APPLE_LOCK_SCREEN_MESSAGE_MAX_LENGTH +
      " characters."
    );

  if (input.includeAssetTag === true && !input.assetTag?.trim())
    return "This device has no asset tag. Add one in Edit details, or turn off Include asset tag.";

  return undefined;
};

/** The message one device should show, after the per-device override wins. */
export type AppleLockScreenMessageResolution = {
  readonly message: string | undefined;
  readonly includeAssetTag: boolean;
  readonly source: "device" | "policy" | null;
  /** The policy supplying the default, when the source is policy. */
  readonly policyName?: string;
  /** Why the resolved configuration cannot be delivered, if it cannot. */
  readonly problem?: string;
};

/**
 * Resolve a device's lock screen message.
 *
 * A per-device message wins. A per-device includeAssetTag choice can override
 * the policy default on its own, so an operator can keep shared wording but
 * stop appending the asset tag (or the reverse).
 */
export const resolveAppleLockScreenMessage = (input: {
  readonly deviceMessage?: string | null;
  readonly deviceIncludeAssetTag?: boolean | null;
  readonly policy?: (AppleLockScreenMessageConfiguration & { readonly policyName?: string }) | null;
  readonly assetTag?: string | null;
}): AppleLockScreenMessageResolution => {
  const deviceMessage = normalizeAppleLockScreenMessage(input.deviceMessage);
  const policyMessage = normalizeAppleLockScreenMessage(input.policy?.message);
  const message = deviceMessage ?? policyMessage;
  const includeAssetTag = input.deviceIncludeAssetTag ?? input.policy?.includeAssetTag ?? false;
  const source = deviceMessage ? ("device" as const) : policyMessage ? ("policy" as const) : null;
  const problem = message
    ? lockScreenMessageProblem({ message, includeAssetTag, assetTag: input.assetTag })
    : undefined;

  return {
    message,
    includeAssetTag,
    source,
    ...(source === "policy" && input.policy?.policyName
      ? { policyName: input.policy.policyName }
      : {}),
    ...(problem ? { problem } : {}),
  };
};

/**
 * How long a failed profile install suppresses another automatic retry.
 * Mirrors the device-name push: an OS that rejects the profile must not receive
 * a fresh one on every check-in, while a genuine change is applied immediately.
 */
export const LOCK_SCREEN_MESSAGE_PUSH_RETRY_MS = 24 * 60 * 60 * 1000;
