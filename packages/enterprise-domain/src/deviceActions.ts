import { Schema } from "effect";

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
  "unenroll",
]);

export type DeviceActionName = typeof DeviceActionName.Type;

const APPLE_ACTIONS: ReadonlyArray<DeviceActionName> = [
  "sync",
  "lock",
  "wipe",
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
  "unenroll",
];

/**
 * Windows has no push channel: a command is picked up on the next SyncML poll,
 * so `sync` is deliberately absent. Wipe and restart are delivered as OMA-DM
 * `Exec` commands; unenroll uses `DMClient/Provider/{ProviderID}/Unenroll`.
 */
const WINDOWS_ACTIONS: ReadonlyArray<DeviceActionName> = ["wipe", "restart", "unenroll"];

/**
 * Android Management API commands support lock, wipe and reboot, and a policy
 * sync is a real push to Google. Unenrollment is not implemented for Android.
 */
const ANDROID_ACTIONS: ReadonlyArray<DeviceActionName> = ["sync", "lock", "wipe", "restart"];

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
};

/**
 * The remote actions a specific device currently supports.
 *
 * Platform and enrollment status are the baseline. A device that reports
 * action capability tokens narrows that baseline, so an operator cannot queue
 * an action the device itself says it cannot run. Unenrollment is only
 * advertised where the platform implements it (Apple and Windows) and the
 * device is still managed.
 *
 * This is a capability decision, not a permission decision: the caller still
 * enforces RBAC separately.
 */
export const deviceAvailableActions = (
  input: DeviceActionInput,
): ReadonlyArray<DeviceActionName> => {
  const status = input.status?.trim();
  const base = platformActions(input.proto);

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
    (input.proto === "apple" || input.proto === "win") &&
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

  return `This device does not support the ${action} action.`;
};
