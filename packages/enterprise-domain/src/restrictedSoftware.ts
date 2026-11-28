import { DeviceId, RuleId } from "@mattrax/crypto";
import { Schema } from "effect";

/**
 * Tenant deny-listing for applications.
 *
 * A restricted software record is deliberately independent of the install
 * catalogue: the catalogue says what Mattrax *may* install, a restricted
 * software rule says what must not run. Detection is always available; the
 * enforcement capability depends on the platform and is stated explicitly so
 * the dashboard never promises a remote action the platform cannot perform.
 */

export const RESTRICTED_SOFTWARE_PLATFORMS = ["apple", "win", "android"] as const;
export type RestrictedSoftwarePlatform = (typeof RESTRICTED_SOFTWARE_PLATFORMS)[number];
export const RestrictedSoftwarePlatform = Schema.Literals(RESTRICTED_SOFTWARE_PLATFORMS);

export const RESTRICTED_SOFTWARE_MATCH_TYPES = [
  "bundle-id",
  "process-name",
  "msi-product-code",
  "android-package",
] as const;
export type RestrictedSoftwareMatchType = (typeof RESTRICTED_SOFTWARE_MATCH_TYPES)[number];
export const RestrictedSoftwareMatchType = Schema.Literals(RESTRICTED_SOFTWARE_MATCH_TYPES);

export const RESTRICTED_SOFTWARE_ACTIONS = ["block-install", "kill-process", "delete-app"] as const;
export type RestrictedSoftwareAction = (typeof RESTRICTED_SOFTWARE_ACTIONS)[number];
export const RestrictedSoftwareAction = Schema.Literals(RESTRICTED_SOFTWARE_ACTIONS);

export const RESTRICTED_SOFTWARE_PLATFORM_LABELS: Record<RestrictedSoftwarePlatform, string> = {
  apple: "macOS",
  win: "Windows",
  android: "Android",
};

export const RESTRICTED_SOFTWARE_MATCH_LABELS: Record<RestrictedSoftwareMatchType, string> = {
  "bundle-id": "Bundle identifier",
  "process-name": "Executable / process name",
  "msi-product-code": "MSI ProductCode",
  "android-package": "Android package",
};

export const RESTRICTED_SOFTWARE_ACTION_LABELS: Record<RestrictedSoftwareAction, string> = {
  "block-install": "Block installation",
  "kill-process": "Kill process",
  "delete-app": "Delete app",
};

/**
 * Identifiers that make sense on a platform. Honest validation matters here:
 * storing an MSI ProductCode on an Android rule would silently never match.
 */
export const RESTRICTED_SOFTWARE_MATCH_TYPES_BY_PLATFORM: Record<
  RestrictedSoftwarePlatform,
  ReadonlyArray<RestrictedSoftwareMatchType>
> = {
  apple: ["bundle-id", "process-name"],
  win: ["msi-product-code", "process-name"],
  android: ["android-package"],
};

export type RestrictedSoftwareEnforcementMode = "policy" | "agent" | "detection-only";

export type RestrictedSoftwareCapability = {
  readonly mode: RestrictedSoftwareEnforcementMode;
  /** One-line state shown in the editor and on a violation. */
  readonly label: string;
  /** Why the action is or is not enforced on this platform. */
  readonly detail: string;
};

/**
 * What a platform can actually do for an action.
 *
 * - Android compiles `installType: BLOCKED` into the Managed Google Play
 *   policy. There is no remote process-kill or app-delete command.
 * - macOS has a signed on-device agent. It can terminate a process and remove
 *   an app bundle on a schedule; it cannot prevent an installation before it
 *   happens (no pre-install hook).
 * - Windows has no deployed agent in this codebase. OMA-DM cannot kill a
 *   process, so every action is detection-only rather than a false promise.
 */
export const restrictedSoftwareCapability = (
  platform: RestrictedSoftwarePlatform,
  action: RestrictedSoftwareAction,
): RestrictedSoftwareCapability => {
  if (platform === "android" && action === "block-install")
    return {
      mode: "policy",
      label: "Blocked in Managed Google Play",
      detail:
        "The package is added to the device's Android policy with installType BLOCKED, which prevents installation on the next policy sync.",
    };

  if (platform === "apple" && (action === "kill-process" || action === "delete-app"))
    return {
      mode: "agent",
      label: "Enforced by mattraxd",
      detail:
        "mattraxd checks the rule on its schedule, terminates matching processes or removes the app bundle, and reports the result back to Mattrax.",
    };

  if (platform === "apple")
    return {
      mode: "detection-only",
      label: "Detection only",
      detail:
        "macOS has no pre-install hook, so Mattrax cannot prevent an installation. Choose Kill process or Delete app to act after the app appears.",
    };

  if (platform === "win")
    return {
      mode: "detection-only",
      label: "Detection only",
      detail:
        "No Windows agent is deployed for this tenant. OMA-DM cannot terminate a process or remove an installed application, so Mattrax records the violation without claiming enforcement.",
    };

  return {
    mode: "detection-only",
    label: "Detection only",
    detail:
      "The Managed Google Play policy cannot kill a process or remove an installed package. Only Block installation is enforced on Android.",
  };
};

/**
 * Why an agent result must be rejected, or null when it is valid.
 *
 * The bearer token proves the device; it does not prove the rule is one this
 * platform can enforce. iOS and detection-only actions must not be able to
 * write an "enforced" violation.
 */
export const restrictedSoftwareAgentResultRejection = (input: {
  readonly capabilityMode: string;
  readonly osEdition?: string | null;
  readonly ruleAction: string;
  readonly reportedAction: string;
}): string | null => {
  if (!input.osEdition?.toLowerCase().includes("macos"))
    return "Only macOS devices enforce restricted software through the agent.";

  if (input.capabilityMode !== "agent")
    return "This rule is detection-only on this device and cannot report enforcement.";

  if (input.ruleAction !== input.reportedAction)
    return "The reported action does not match the rule.";

  return null;
};

/** Bounds applied by the API and documented for operators. */
export const RESTRICTED_SOFTWARE_LIMITS = {
  maxRulesPerTenant: 100,
  maxAssignmentsPerRule: 500,
  maxNotificationEmails: 10,
  maxNameLength: 120,
  maxMessageLength: 2_000,
  maxMatchValueLength: 255,
  maxViolationList: 500,
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);

    return code < 32 || code === 127;
  });

const GUID = /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/;

const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9._-]+$/;

/**
 * Process names the agent must never kill: PID 1, the daemon itself and the
 * system processes whose termination would take the Mac down. A rule that
 * names one is rejected before it reaches a device.
 */
export const DANGEROUS_PROCESS_NAMES: ReadonlySet<string> = new Set([
  "launchd",
  "kernel_task",
  "windowserver",
  "loginwindow",
  "mattraxd",
  "securityd",
  "configd",
  "opendirectoryd",
  "syslogd",
  "notifyd",
  "powerd",
  "coreaudiod",
  "runningboardd",
  "springboard",
  "backboardd",
  "logd",
  "watchdogd",
  "sandboxd",
  "tccd",
  "authd",
  "cfprefsd",
  "diskarbitrationd",
  "coreservicesd",
  "launchservicesd",
]);

/** Strip the .app suffix and lower-case a process name. */
export const normaliseRestrictedSoftwareProcessName = (value: string): string => {
  const trimmed = value.trim();
  const withoutApp = trimmed.toLowerCase().endsWith(".app") ? trimmed.slice(0, -4) : trimmed;

  return withoutApp.toLowerCase();
};

const processName = normaliseRestrictedSoftwareProcessName;

/** Normalise an identifier once so matching and uniqueness agree. */
export const normaliseRestrictedSoftwareMatch = (value: string, matchType?: string): string => {
  if (matchType === "process-name") return normaliseRestrictedSoftwareProcessName(value);

  if (matchType === "msi-product-code")
    return value.trim().toLowerCase().replaceAll("{", "").replaceAll("}", "");

  return value.trim().toLowerCase();
};

/** The canonical stored value for an identifier. */
export const normaliseRestrictedSoftwareMatchValue = (matchType: string, value: string): string =>
  matchType === "process-name" ? normaliseRestrictedSoftwareProcessName(value) : value.trim();

/**
 * Validate one draft. Returns a single operator-facing problem, or null.
 *
 * Platform validation is intentionally narrow: a rule that cannot match is
 * worse than no rule, because it looks like protection that is not there.
 */
export const restrictedSoftwareProblem = (input: {
  readonly name: string;
  readonly platform: string;
  readonly matchType: string;
  readonly matchValue: string;
  readonly action: string;
  readonly message?: string | null;
  readonly notificationEmails?: ReadonlyArray<string> | null;
}): string | null => {
  const name = input.name.trim();

  if (!name) return "Enter a name for the rule.";
  if (name.length > RESTRICTED_SOFTWARE_LIMITS.maxNameLength)
    return `The name must be ${RESTRICTED_SOFTWARE_LIMITS.maxNameLength} characters or fewer.`;

  if (!Schema.is(RestrictedSoftwarePlatform)(input.platform))
    return "Choose macOS, Windows or Android.";

  if (!Schema.is(RestrictedSoftwareMatchType)(input.matchType)) return "Choose an identifier type.";

  if (!Schema.is(RestrictedSoftwareAction)(input.action)) return "Choose an action.";

  const allowed = RESTRICTED_SOFTWARE_MATCH_TYPES_BY_PLATFORM[input.platform];

  if (!allowed.includes(input.matchType))
    return `${RESTRICTED_SOFTWARE_MATCH_LABELS[input.matchType]} is not a valid identifier for ${RESTRICTED_SOFTWARE_PLATFORM_LABELS[input.platform]}.`;

  const value = input.matchValue.trim();

  if (!value) return "Enter the value to match.";
  if (value.length > RESTRICTED_SOFTWARE_LIMITS.maxMatchValueLength)
    return `The value must be ${RESTRICTED_SOFTWARE_LIMITS.maxMatchValueLength} characters or fewer.`;
  if (hasControlCharacter(value)) return "The value contains an invalid character.";

  switch (input.matchType) {
    case "bundle-id":
      if (!BUNDLE_ID.test(value))
        return "Enter a bundle identifier such as com.example.App (no spaces or slashes).";
      if (value.toLowerCase().startsWith("com.apple."))
        return "Apple system applications cannot be restricted.";
      break;
    case "android-package":
      if (!ANDROID_PACKAGE.test(value))
        return "Enter an Android package name such as com.example.app.";
      break;
    case "msi-product-code":
      if (!GUID.test(value))
        return "Enter the MSI ProductCode GUID, for example {12345678-1234-1234-1234-123456789ABC}.";
      break;
    case "process-name": {
      if (value.includes("/") || value.includes("\\"))
        return "Enter only the executable or process name, not a path.";

      const name = normaliseRestrictedSoftwareProcessName(value);

      if (!name) return "Enter the process name without the .app suffix.";
      if (name.length > 128) return "The process name must be 128 characters or fewer.";

      if (input.action !== "block-install" && DANGEROUS_PROCESS_NAMES.has(name))
        return "This is a macOS system process. Restricting it would destabilise the device.";

      break;
    }
  }

  // The macOS agent locates a bundle by identifier; it cannot turn a process
  // name into an app path. Windows delete-app is detection-only, so the
  // combination is only rejected where it would be enforced.
  if (
    input.platform === "apple" &&
    input.action === "delete-app" &&
    input.matchType === "process-name"
  )
    return "Delete app on macOS needs a bundle identifier so mattraxd knows which application to remove.";

  const message = input.message?.trim() ?? "";

  if (message.length > RESTRICTED_SOFTWARE_LIMITS.maxMessageLength)
    return `The user message must be ${RESTRICTED_SOFTWARE_LIMITS.maxMessageLength} characters or fewer.`;

  const emails = (input.notificationEmails ?? []).map((email) => email.trim()).filter(Boolean);

  if (emails.length > RESTRICTED_SOFTWARE_LIMITS.maxNotificationEmails)
    return `Add at most ${RESTRICTED_SOFTWARE_LIMITS.maxNotificationEmails} notification recipients.`;

  for (const email of emails)
    if (!EMAIL.test(email)) return `"${email}" is not a valid email address.`;

  return null;
};

export type RestrictedSoftwareRuleForMatch = {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly matchType: string;
  readonly matchValue: string;
  readonly matchKey: string;
  readonly action: string;
  readonly enabled: boolean;
};

export type InventoryApplication = {
  readonly bundleId: string;
  readonly name?: string | null;
  readonly version?: string | null;
};

/**
 * Whether one inventory row matches a rule.
 *
 * `process-name` falls back to the last bundle-id segment because macOS
 * inventory reports a display name and a bundle id, not the executable name.
 * The agent uses the real process table when it enforces; this fallback only
 * decides whether a violation is recorded.
 */
export const inventoryApplicationMatches = (
  rule: Pick<RestrictedSoftwareRuleForMatch, "matchType" | "matchKey">,
  application: InventoryApplication,
): boolean => {
  const bundleId = application.bundleId.trim().toLowerCase();

  if (!bundleId) return false;

  if (rule.matchType === "process-name") {
    const candidates = [
      processName(application.name ?? ""),
      processName(bundleId.split(".").at(-1) ?? ""),
    ];

    return candidates.includes(processName(rule.matchKey));
  }

  // MSI ProductCodes are case-insensitive GUIDs and may be reported with or
  // without braces, so compare the canonical form rather than the raw text.
  if (rule.matchType === "msi-product-code")
    return (
      normaliseRestrictedSoftwareMatch(bundleId).replaceAll("{", "").replaceAll("}", "") ===
      normaliseRestrictedSoftwareMatch(rule.matchKey).replaceAll("{", "").replaceAll("}", "")
    );

  return bundleId === normaliseRestrictedSoftwareMatch(rule.matchKey);
};

/** First matching inventory row, deterministic by bundle id. */
export const findRestrictedSoftwareMatch = (
  rule: Pick<RestrictedSoftwareRuleForMatch, "matchType" | "matchKey">,
  applications: ReadonlyArray<InventoryApplication>,
): InventoryApplication | null => {
  const matches = applications
    .filter((application) => inventoryApplicationMatches(rule, application))
    .sort((left, right) => left.bundleId.localeCompare(right.bundleId));

  return matches[0] ?? null;
};

export type RestrictedSoftwareAssignmentForScope = {
  readonly targetType: string;
  readonly targetId: string;
  readonly mode: string;
};

/**
 * Resolve include/exclude scope for one device.
 *
 * Mirrors policy scope: a direct device exclude is final; a direct device
 * include wins over a group exclude; otherwise a group include applies unless
 * a group exclude vetoes it.
 */
export const restrictedSoftwareScopeApplies = (
  assignments: ReadonlyArray<RestrictedSoftwareAssignmentForScope>,
  input: { readonly deviceId: string; readonly groupIds: ReadonlySet<string> },
): boolean => {
  let directInclude = false;
  let directExclude = false;
  let groupInclude = false;
  let groupExclude = false;

  for (const assignment of assignments) {
    if (assignment.targetType === "device") {
      if (assignment.targetId !== input.deviceId) continue;

      if (assignment.mode === "exclude") directExclude = true;
      else directInclude = true;
    } else if (assignment.targetType === "group") {
      if (!input.groupIds.has(assignment.targetId)) continue;

      if (assignment.mode === "exclude") groupExclude = true;
      else groupInclude = true;
    }
  }

  if (directExclude) return false;

  return directInclude || (groupInclude && !groupExclude);
};

/** Assignment target shape used by the API and handler. */
export const RestrictedSoftwareAssignmentTarget = Schema.Struct({
  targetType: Schema.Literals(["device", "group"]),
  targetId: Schema.String,
  mode: Schema.optional(Schema.Literals(["include", "exclude"])),
});

export type RestrictedSoftwareAssignmentTarget = typeof RestrictedSoftwareAssignmentTarget.Type;

export const RESTRICTED_SOFTWARE_VIOLATION_STATUSES = ["open", "resolved"] as const;
export const RESTRICTED_SOFTWARE_ENFORCEMENT_STATES = [
  "detection-only",
  "pending",
  "enforced",
  "failed",
] as const;

export type RestrictedSoftwareViolationStatus =
  (typeof RESTRICTED_SOFTWARE_VIOLATION_STATUSES)[number];
export type RestrictedSoftwareEnforcementState =
  (typeof RESTRICTED_SOFTWARE_ENFORCEMENT_STATES)[number];

export const RestrictedSoftwareRuleInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: RestrictedSoftwarePlatform,
  matchType: RestrictedSoftwareMatchType,
  matchValue: Schema.String,
  action: RestrictedSoftwareAction,
  message: Schema.optional(Schema.NullOr(Schema.String)),
  notificationEmails: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
  /** Direct device assignments; excludes included. */
  deviceCount: Schema.Number,
  /** Group assignments; excludes included. */
  groupCount: Schema.Number,
  /** Enrolled devices the rule currently resolves to. */
  assignedDeviceCount: Schema.Number,
  /** Violations currently open across the fleet. */
  openViolationCount: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type RestrictedSoftwareRuleInfo = typeof RestrictedSoftwareRuleInfo.Type;

export const RestrictedSoftwareListResponse = Schema.Struct({
  rules: Schema.Array(RestrictedSoftwareRuleInfo),
  limits: Schema.Struct({ maxRules: Schema.Number }),
});

export type RestrictedSoftwareListResponse = typeof RestrictedSoftwareListResponse.Type;

export const CreateRestrictedSoftwareRequest = Schema.Struct({
  name: Schema.String,
  platform: RestrictedSoftwarePlatform,
  matchType: RestrictedSoftwareMatchType,
  matchValue: Schema.String,
  action: RestrictedSoftwareAction,
  message: Schema.optional(Schema.NullOr(Schema.String)),
  notificationEmails: Schema.optional(Schema.Array(Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
});

export type CreateRestrictedSoftwareRequest = typeof CreateRestrictedSoftwareRequest.Type;

export const PatchRestrictedSoftwareRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  platform: Schema.optional(RestrictedSoftwarePlatform),
  matchType: Schema.optional(RestrictedSoftwareMatchType),
  matchValue: Schema.optional(Schema.String),
  action: Schema.optional(RestrictedSoftwareAction),
  message: Schema.optional(Schema.NullOr(Schema.String)),
  notificationEmails: Schema.optional(Schema.Array(Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
  expectedUpdatedAt: Schema.optional(Schema.String),
});

export type PatchRestrictedSoftwareRequest = typeof PatchRestrictedSoftwareRequest.Type;

export const RestrictedSoftwareAssignmentInfo = Schema.Struct({
  targetType: Schema.Literals(["device", "group"]),
  targetId: Schema.String,
  mode: Schema.Literals(["include", "exclude"]),
  /** Device or group display name, resolved for the editor. */
  name: Schema.String,
});

export type RestrictedSoftwareAssignmentInfo = typeof RestrictedSoftwareAssignmentInfo.Type;

export const RestrictedSoftwareDetail = Schema.Struct({
  rule: RestrictedSoftwareRuleInfo,
  assignments: Schema.Array(RestrictedSoftwareAssignmentInfo),
});

export type RestrictedSoftwareDetail = typeof RestrictedSoftwareDetail.Type;

export const PatchRestrictedSoftwareAssignmentsRequest = Schema.Struct({
  assign: Schema.optional(Schema.Array(RestrictedSoftwareAssignmentTarget)),
  unassign: Schema.optional(Schema.Array(RestrictedSoftwareAssignmentTarget)),
});

export type PatchRestrictedSoftwareAssignmentsRequest =
  typeof PatchRestrictedSoftwareAssignmentsRequest.Type;

export const RestrictedSoftwareViolationInfo = Schema.Struct({
  id: Schema.String,
  ruleId: RuleId.schema,
  ruleName: Schema.String,
  action: RestrictedSoftwareAction,
  platform: RestrictedSoftwarePlatform,
  matchType: RestrictedSoftwareMatchType,
  matchValue: Schema.String,
  deviceId: DeviceId.schema,
  deviceName: Schema.String,
  matchedBundleId: Schema.String,
  applicationName: Schema.optional(Schema.NullOr(Schema.String)),
  applicationVersion: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.Literals(RESTRICTED_SOFTWARE_VIOLATION_STATUSES),
  enforcementState: Schema.Literals(RESTRICTED_SOFTWARE_ENFORCEMENT_STATES),
  enforcementDetail: Schema.optional(Schema.NullOr(Schema.String)),
  occurrenceCount: Schema.Number,
  firstDetectedAt: Schema.String,
  lastDetectedAt: Schema.String,
  lastEnforcedAt: Schema.optional(Schema.NullOr(Schema.String)),
  resolvedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export type RestrictedSoftwareViolationInfo = typeof RestrictedSoftwareViolationInfo.Type;

export const RestrictedSoftwareViolationsResponse = Schema.Struct({
  violations: Schema.Array(RestrictedSoftwareViolationInfo),
  summary: Schema.Struct({
    open: Schema.Number,
    resolved: Schema.Number,
    enforced: Schema.Number,
    detectionOnly: Schema.Number,
    failed: Schema.Number,
  }),
});

export type RestrictedSoftwareViolationsResponse = typeof RestrictedSoftwareViolationsResponse.Type;

/** The violations and applicable rules shown on one device page. */
export const DeviceRestrictedSoftwareResponse = Schema.Struct({
  violations: Schema.Array(RestrictedSoftwareViolationInfo),
  rules: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      action: RestrictedSoftwareAction,
      matchType: RestrictedSoftwareMatchType,
      matchValue: Schema.String,
      enforcement: Schema.Struct({
        mode: Schema.Literals(["policy", "agent", "detection-only"]),
        label: Schema.String,
        detail: Schema.String,
      }),
    }),
  ),
});

export type DeviceRestrictedSoftwareResponse = typeof DeviceRestrictedSoftwareResponse.Type;

/**
 * Result posted by mattraxd after an enforcement pass.
 *
 * `status` is `succeeded` only when the requested effect happened or there was
 * nothing to do. `detail` is bounded by the server before it is stored.
 */
export const RestrictedSoftwareAgentResultRequest = Schema.Struct({
  ruleId: RuleId.schema,
  action: RestrictedSoftwareAction,
  status: Schema.Literals(["succeeded", "failed", "skipped"]),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  killedProcesses: Schema.optional(Schema.Number),
  removedApplications: Schema.optional(Schema.Number),
  occurredAt: Schema.optional(Schema.String),
});

export type RestrictedSoftwareAgentResultRequest = typeof RestrictedSoftwareAgentResultRequest.Type;

export const RestrictedSoftwareAgentResultResponse = Schema.Struct({
  status: Schema.Literal("ok"),
});

export type RestrictedSoftwareAgentResultResponse =
  typeof RestrictedSoftwareAgentResultResponse.Type;
