import type {
  GroupScopePolicy,
  PolicyScopeDevice,
  PolicyScopeLoss,
  PolicyScopeSummary,
} from "@mattrax/enterprise-domain/client";

/**
 * Presentation for the computed policy and group scope.
 *
 * The API decides reach with the same resolver that builds the device page's
 * trace; this module only turns its structured reasons into copy an operator can
 * act on. Keep the wording aligned with the device Scope tab: "higher priority
 * policy X wins", "excluded by group Y", and so on.
 */

export type PolicyScopeTone = "success" | "warning" | "destructive" | "subtle";

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const winner = (reason: { winnerPolicyName?: string; winnerPolicyId?: string }) =>
  reason.winnerPolicyName ?? reason.winnerPolicyId ?? "another policy";

const exclusionActor = (entry: PolicyScopeDevice) => {
  const exclusion =
    entry.exclusions.find((candidate) => candidate.effective) ?? entry.exclusions[0];

  if (!exclusion) return null;

  switch (exclusion.reason) {
    case "device-exclude":
      return "is excluded directly on the device";
    case "user-exclude":
      return `is excluded for ${exclusion.userNames?.join(", ") ?? "a linked user"}`;
    case "user-group-exclude":
      return `is excluded by directory group ${exclusion.userGroupName ?? "a directory group"}`;
    default:
      return `is excluded by group ${exclusion.groupName ?? "a group"}`;
  }
};

const overrideLossLabel = (loss: PolicyScopeLoss | undefined): string => {
  switch (loss?.reason) {
    case "higher-priority":
      return `Higher priority policy ${winner(loss)} wins`;
    case "newer-updated-at":
      return `Policy ${winner(loss)} was updated more recently and wins`;
    case "lexicographic-id":
      return `Policy ${winner(loss)} wins the id tie-break`;
    case "direct-device-include":
      return "A direct device assignment wins over this group include";
    case "direct-user-include":
      return "A direct user assignment wins over this group include";
    case "device-scope":
      return "A device-scoped policy provides this setting, which beats the user channel";
    default:
      return `Overridden by ${winner(loss ?? {})}`;
  }
};

/** The sentence shown next to one device in the scope table. */
export const policyScopeReasonLabel = (entry: PolicyScopeDevice): string => {
  switch (entry.status) {
    case "applies":
      return "Receives every setting this policy provides";
    case "partial": {
      const reasons: string[] = [];

      if (entry.unsupportedKinds.length > 0)
        reasons.push(
          `${plural(entry.unsupportedKinds.length, "setting needs", "settings need")} a newer OS`,
        );

      if (entry.losses.length > 0)
        reasons.push(
          `${plural(entry.losses.length, "setting is", "settings are")} overridden by ${[
            ...new Set(entry.losses.map((loss) => winner(loss))),
          ].join(", ")}`,
        );

      const receives = `Receives ${plural(entry.kinds.length, "setting", "settings")}`;

      if (reasons.length === 0) return receives;

      return `${receives}; ${reasons.join("; ")}`;
    }

    case "overridden":
      return overrideLossLabel(entry.losses[0]);
    case "excluded":
      return `It ${exclusionActor(entry) ?? "is excluded"}`;
    case "unsupported-os":
      return entry.deviceOs
        ? `${entry.deviceOs} does not support ${
            [...new Set(entry.unsupportedKinds)].join(", ") || "this policy's settings"
          }`
        : "The device's OS does not support this policy's settings";
    case "wrong-scope":
      return entry.channel === "device"
        ? "Only user-scoped settings, which are delivered on a user channel"
        : "Only device-scoped settings, which are delivered on the device channel";
    case "disabled":
      return "The policy is disabled";
    case "no-configurations":
      return "The policy has no configurations";
    default:
      return entry.reason === "no-linked-user"
        ? "No directory user is linked to this device, so the user channel has no target"
        : "No assignment includes this device";
  }
};

export const policyScopeStatusLabel = (entry: PolicyScopeDevice) => {
  switch (entry.status) {
    case "applies":
      return "Applies";
    case "partial":
      return "Partly applies";
    case "overridden":
      return "Overridden";
    case "excluded":
      return "Excluded";
    case "unsupported-os":
      return "Unsupported OS";
    case "wrong-scope":
      return "Wrong scope";
    case "not-included":
      return "Not included";
    case "disabled":
      return "Disabled";
    case "no-configurations":
      return "No settings";
  }
};

export const policyScopeStatusTone = (entry: PolicyScopeDevice): PolicyScopeTone => {
  switch (entry.status) {
    case "applies":
      return "success";
    case "partial":
    case "overridden":
    case "disabled":
      return "warning";
    case "excluded":
    case "unsupported-os":
    case "wrong-scope":
      return "destructive";
    default:
      return "subtle";
  }
};

export const policyScopePlatformLabel = (platform: string) => {
  switch (platform) {
    case "apple":
      return "Apple";
    case "windows":
      return "Windows";
    case "android":
      return "Android";
    default:
      return platform;
  }
};

/**
 * `macOS 14+ · iOS 17+`, or the Windows build range, derived from the policy's
 * configurations. Null means the catalogue carries no metadata; showing nothing
 * is better than a range delivery does not honour.
 */
export const policyOsRangeLabel = (
  scope: Pick<PolicyScopeSummary, "apple" | "windowsMinimum" | "platforms">,
): string | null => {
  const parts = scope.apple.map((version) => `${version.family} ${version.minimum}+`);

  if (scope.windowsMinimum) parts.push(`Windows ${scope.windowsMinimum}+`);

  return parts.length > 0 ? parts.join(" · ") : null;
};

export const policyScopeChannelLabel = (channels: ReadonlyArray<"device" | "user">): string => {
  if (channels.includes("device") && channels.includes("user")) return "Device and user scoped";

  if (channels.includes("user")) return "User scoped";

  if (channels.includes("device")) return "Device scoped";

  return "No scoped settings";
};

export type PolicyScopeWarning = {
  readonly kind: "unsupported-os" | "wrong-scope";
  readonly deviceId: string;
  readonly deviceName: string;
  readonly message: string;
};

/**
 * Warnings for assignments that cannot deliver as configured: the same signals
 * the scope table shows, pulled up so they are not buried under a successful
 * device count.
 */
export const policyScopeWarnings = (
  scope: Pick<PolicyScopeSummary, "devices" | "apple" | "windowsMinimum" | "channels">,
): ReadonlyArray<PolicyScopeWarning> => {
  const range = policyOsRangeLabel({ ...scope, platforms: [] });
  const warnings = new Map<string, PolicyScopeWarning>();

  for (const entry of scope.devices) {
    if (entry.status !== "unsupported-os" && entry.status !== "wrong-scope") continue;

    const key = `${entry.deviceId}:${entry.status}`;

    if (warnings.has(key)) continue;

    const media =
      entry.status === "unsupported-os"
        ? `${entry.deviceOs ?? "This device's OS"} does not support ${
            [...new Set(entry.unsupportedKinds)].join(", ") || "this policy"
          }${range ? ` (requires ${range})` : ""}.`
        : entry.channel === "device"
          ? "This policy only has user-scoped settings, but the device has no user channel to deliver them on."
          : "This policy only has device-scoped settings, so it never applies on the user channel.";

    warnings.set(key, {
      kind: entry.status,
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      message: media,
    });
  }

  return [...warnings.values()];
};

export type PolicyScopeCounts = {
  readonly devices: number;
  readonly applies: number;
  readonly partial: number;
  readonly overridden: number;
  readonly excluded: number;
  readonly unsupported: number;
  readonly wrongScope: number;
  readonly notIncluded: number;
};

/** Distinct devices per outcome, so per-user entries cannot inflate the count. */
export const policyScopeCounts = (devices: ReadonlyArray<PolicyScopeDevice>): PolicyScopeCounts => {
  const statuses = new Map<string, Set<PolicyScopeDevice["status"]>>();

  for (const entry of devices) {
    const list = statuses.get(entry.deviceId) ?? new Set<PolicyScopeDevice["status"]>();

    list.add(entry.status);
    statuses.set(entry.deviceId, list);
  }

  const has = (status: PolicyScopeDevice["status"]) =>
    [...statuses.values()].filter((list) => list.has(status)).length;

  return {
    devices: statuses.size,
    applies: has("applies"),
    partial: has("partial"),
    overridden: has("overridden"),
    excluded: has("excluded"),
    unsupported: has("unsupported-os"),
    wrongScope: has("wrong-scope"),
    notIncluded: has("not-included"),
  };
};

export const policyScopeCountsLabel = (counts: PolicyScopeCounts) => {
  const parts = [`${plural(counts.devices, "device", "devices")} in scope`];

  if (counts.applies > 0) parts.push(`${counts.applies} receive it`);

  if (counts.partial > 0) parts.push(`${counts.partial} partly`);

  if (counts.overridden > 0) parts.push(`${counts.overridden} overridden`);

  if (counts.excluded > 0) parts.push(`${counts.excluded} excluded`);

  if (counts.unsupported > 0) parts.push(`${counts.unsupported} unsupported OS`);

  if (counts.wrongScope > 0) parts.push(`${counts.wrongScope} wrong scope`);

  return parts.join(" · ");
};

/** Devices a group policy actually wins at least one setting on. */
export const groupScopeWinningDeviceIds = (policy: GroupScopePolicy) =>
  [
    ...new Set(
      policy.devices
        .filter((entry) => entry.status === "applies" || entry.status === "partial")
        .map((entry) => entry.deviceId),
    ),
  ].sort();

/** True when the group assignment reaches no device that receives the policy. */
export const groupScopePolicyIsInert = (policy: GroupScopePolicy) =>
  policy.mode === "include" && groupScopeWinningDeviceIds(policy).length === 0;
