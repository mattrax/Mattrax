import { WINDOWS_LAPS_MIN_BUILD } from "@mattrax/enterprise-domain";
import { parseConfigurationKind } from "./configuration.ts";
import type { ConfigurationKind } from "./configuration.ts";
import { resolveEffectivePolicy } from "./policyResolution.ts";
import type {
  ConfigurationScope,
  EffectivePolicy,
  PolicyChannel,
  PolicyResolutionConfiguration,
  PolicyResolutionGroup,
  PolicyResolutionGroupAssignment,
  PolicyResolutionPolicy,
  PolicyResolutionUser,
  PolicyResolutionUserAssignment,
  PolicyResolutionUserGroup,
  PolicyResolutionUserGroupAssignment,
} from "./policyResolution.ts";
import { scopeConfigurationsToDevice, windowsConfigurationMinimumBuild } from "./policySupport.ts";
import type { AppleOsFamily, PolicySupportOptions } from "./policySupport.ts";
import { compareOsVersion } from "./version.ts";

/**
 * Hard cap on the device entries a scope response returns.
 *
 * A tenant can hold far more devices than a page can render, and the resolver
 * does real work per device. Responses stay bounded; `deviceCount` and
 * `truncated` tell the caller how much was left out.
 */
export const MAX_SCOPE_DEVICES = 500;

/**
 * Policy → device scope.
 *
 * `resolveEffectivePolicyForDevice` answers "what does this device get". This
 * module answers the reverse question: for one policy (or one group), which
 * devices does it actually reach, and for the devices it does not, why not.
 *
 * It deliberately does not reimplement precedence. Every device is run through
 * the same `resolveEffectivePolicy` the delivery path uses, and the target
 * policy is then read out of that result. Anything else would eventually drift
 * from what devices receive.
 *
 * Device-scoped and user-scoped configurations are resolved on their own
 * channels: a user policy applies to a linked user's Apple user channel, not to
 * the device channel. `channel` on each entry records which one it came from.
 * Windows has no per-login channel, so user-scoped configurations for a Windows
 * device are resolved on the device channel, exactly as delivery does.
 */

export type PolicyPlatform = "apple" | "windows" | "android";

export type PolicyScopeStatus =
  | "applies"
  | "partial"
  | "overridden"
  | "excluded"
  | "unsupported-os"
  | "wrong-scope"
  | "not-included"
  | "disabled"
  | "no-configurations";

export type PolicyScopeReason =
  | "applies"
  | "partial"
  | "higher-priority"
  | "newer-updated-at"
  | "lexicographic-id"
  | "direct-device-include"
  | "direct-user-include"
  | "device-scope"
  | "device-exclude"
  | "group-exclude"
  | "user-exclude"
  | "user-group-exclude"
  | "os-unsupported"
  | "wrong-scope"
  | "not-included"
  | "no-verified-user-channel"
  | "disabled"
  | "no-configurations";

export type PolicyScopeLoss = {
  readonly kind: string;
  readonly reason: PolicyScopeReason;
  readonly winnerPolicyId?: string;
  readonly winnerPolicyName?: string;
  readonly winnerPriority?: number;
};

export type PolicyScopeExclusion = {
  readonly reason: PolicyScopeReason;
  readonly groupId?: string;
  readonly groupName?: string;
  readonly userNames?: ReadonlyArray<string>;
  readonly userGroupId?: string;
  readonly userGroupName?: string;
  /** True when the exclusion removed an assignment that would otherwise apply. */
  readonly effective: boolean;
};

export type PolicyScopeDeviceEntry = {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: PolicyPlatform;
  /** Reported OS name and version, when inventory has arrived. */
  readonly deviceOs: string | null;
  readonly channel: PolicyChannel;
  /** Set for entries resolved on a user's Apple channel. */
  readonly userId?: string;
  readonly userName?: string;
  readonly status: PolicyScopeStatus;
  readonly reason: PolicyScopeReason;
  /** Configuration kinds the device (or user channel) actually receives. */
  readonly kinds: ReadonlyArray<string>;
  /** Kinds won by the policy that the device's OS cannot apply. */
  readonly unsupportedKinds: ReadonlyArray<string>;
  readonly losses: ReadonlyArray<PolicyScopeLoss>;
  readonly exclusions: ReadonlyArray<PolicyScopeExclusion>;
};

export type PolicyPlatformSupport = {
  readonly platforms: ReadonlyArray<PolicyPlatform>;
  /** Minimum OS per Apple family, derived from the payload support metadata. */
  readonly apple: ReadonlyArray<{ readonly family: AppleOsFamily; readonly minimum: string }>;
  readonly windowsMinimum: string | null;
  /** Configuration scopes the policy actually provides. */
  readonly channels: ReadonlyArray<PolicyChannel>;
};

export type PolicyScopeSummary = {
  readonly policyId: string;
  readonly platforms: ReadonlyArray<PolicyPlatform>;
  readonly apple: ReadonlyArray<{ readonly family: AppleOsFamily; readonly minimum: string }>;
  readonly windowsMinimum: string | null;
  readonly channels: ReadonlyArray<PolicyChannel>;
  /** Devices considered by the request, before per-channel classification. */
  readonly deviceCount: number;
  /** True when `devices` is a capped prefix of the real result. */
  readonly truncated: boolean;
  readonly devices: ReadonlyArray<PolicyScopeDeviceEntry>;
};

export type GroupScopePolicy = {
  readonly policyId: string;
  readonly policyName: string;
  readonly mode: "include" | "exclude";
  readonly devices: ReadonlyArray<PolicyScopeDeviceEntry>;
};

export type GroupScopeSummary = {
  readonly groupId: string;
  readonly memberCount: number;
  /** True when a per-policy device list (or the member set) hit the cap. */
  readonly truncated: boolean;
  readonly policies: ReadonlyArray<GroupScopePolicy>;
};

export type PolicyScopeDevice = {
  readonly id: string;
  readonly name: string;
  readonly proto: string;
  readonly osEdition?: string | null;
  readonly osVersion?: string | null;
  readonly osBuild?: string | null;
  readonly declarationMode?: string | null;
};

export type PolicyScopeDeviceAssignment = {
  readonly deviceId: string;
  readonly policyId: string;
  readonly mode?: "include" | "exclude";
};

export type PolicyScopeResolutionInput = {
  readonly policies: ReadonlyArray<PolicyResolutionPolicy>;
  readonly configurations: ReadonlyArray<PolicyResolutionConfiguration>;
  readonly devices: ReadonlyArray<PolicyScopeDevice>;
  /** Candidate devices before the loader applied its cap. */
  readonly deviceCount?: number;
  /** True when `devices` is a capped prefix of the candidate set. */
  readonly truncated?: boolean;
  readonly groups: ReadonlyArray<PolicyResolutionGroup>;
  readonly groupAssignments: ReadonlyArray<PolicyResolutionGroupAssignment>;
  readonly groupMembers: ReadonlyArray<{ readonly groupId: string; readonly deviceId: string }>;
  /** People excluded from a group's user-scoped delivery. */
  readonly groupUserExclusions?: ReadonlyArray<{
    readonly groupId: string;
    readonly userId: string;
  }>;
  readonly deviceAssignments: ReadonlyArray<PolicyScopeDeviceAssignment>;
  readonly users: ReadonlyArray<PolicyResolutionUser>;
  /** Directory users linked to each device. */
  readonly deviceUsers: ReadonlyArray<{ readonly deviceId: string; readonly userId: string }>;
  readonly userGroups: ReadonlyArray<PolicyResolutionUserGroup>;
  readonly userGroupMembers: ReadonlyArray<{ readonly groupId: string; readonly userId: string }>;
  readonly userAssignments: ReadonlyArray<PolicyResolutionUserAssignment>;
  readonly userGroupAssignments: ReadonlyArray<PolicyResolutionUserGroupAssignment>;
};

const compareText = (left: string, right: string) => left.localeCompare(right);

const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const scopeOf = (configuration: Pick<PolicyResolutionConfiguration, "scope">): ConfigurationScope =>
  configuration.scope ?? "device";

const platformOf = (kind: ConfigurationKind): PolicyPlatform | null => {
  switch (kind.type) {
    case "android":
      return "android";
    case "windows":
    case "windows-laps":
      return "windows";
    case "application":
    case "certificate":
    case "appleMail":
    case "custom":
    case "declaration":
    case "device":
    case "lockScreenMessage":
      return "apple";
    case "windowsCertificate":
      return "windows";
    case "androidCertificate":
      return "android";
    case "pkcs":
    case "pfx":
      return kind.platform;
    default:
      return null;
  }
};

const devicePlatform = (device: PolicyScopeDevice): PolicyPlatform => {
  switch (device.proto) {
    case "win":
      return "windows";
    case "android":
      return "android";
    default:
      return "apple";
  }
};

const isApple = (device: PolicyScopeDevice) => devicePlatform(device) === "apple";

const isWindows = (device: PolicyScopeDevice) => devicePlatform(device) === "windows";

const deviceOsLabel = (device: PolicyScopeDevice): string | null => {
  const edition = device.osEdition?.trim();
  const version = device.osVersion?.trim();

  if (edition && version) return `${edition} ${version}`;

  if (version) return version;

  if (edition) return edition;

  return null;
};

/** Fold `iPadOS` into `iOS`, matching `applePayloadSupportForDevice`. */
const normalizeAppleFamily = (family: string): AppleOsFamily | null => {
  switch (family.toLowerCase()) {
    case "ipados":
    case "ios":
      return "iOS";
    case "macos":
      return "macOS";
    case "tvos":
      return "tvOS";
    case "watchos":
      return "watchOS";
    case "visionos":
      return "visionOS";
    default:
      return null;
  }
};

const OS_FAMILY_ORDER: ReadonlyArray<AppleOsFamily> = [
  "macOS",
  "iOS",
  "tvOS",
  "watchOS",
  "visionOS",
];

/**
 * Derive the platforms and minimum OS range a policy's configurations support.
 *
 * Apple families are intersected within one configuration (every payload in a
 * mobileconfig has to support the OS) and unioned across configurations: a
 * macOS-only setting and an iOS-only setting make a policy that targets both,
 * not one that targets neither. A family whose payload Apple has removed is
 * dropped, because `${minimum}+` would advertise an OS that can no longer
 * apply it. Custom payloads with no metadata do not narrow the range (the
 * delivery path trusts them too), and a policy with no metadata reports no
 * minimum rather than guessing one.
 */
export const derivePolicyPlatformSupport = async (
  configurations: ReadonlyArray<Pick<PolicyResolutionConfiguration, "kind" | "data" | "scope">>,
  options: PolicySupportOptions = {},
): Promise<PolicyPlatformSupport> => {
  const platforms = new Set<PolicyPlatform>();
  const channels = new Set<PolicyChannel>();
  const appleFamilies = new Set<AppleOsFamily>();
  const appleMinimums = new Map<AppleOsFamily, string>();
  let windowsMinimum: string | null = null;

  for (const configuration of configurations) {
    if (scopeOf(configuration) === "user") channels.add("user");
    else channels.add("device");

    const parsed = parseConfigurationKind(configuration.kind);
    const platform = platformOf(parsed);

    if (!platform) continue;
    platforms.add(platform);

    if (platform === "windows") {
      const minimum =
        parsed.type === "windows-laps"
          ? "10.0." + WINDOWS_LAPS_MIN_BUILD
          : windowsConfigurationMinimumBuild(configuration.data);

      if (minimum && (windowsMinimum === null || compareOsVersion(minimum, windowsMinimum) > 0))
        windowsMinimum = minimum;
      continue;
    }

    if (platform !== "apple") continue;

    const payloadTypes = options.apple
      ? await options.apple.payloadTypes(configuration.kind, configuration.data ?? null)
      : [];

    if (payloadTypes.length === 0) continue;

    let configurationFamilies: Set<AppleOsFamily> | null = null;
    const configurationMinimums = new Map<AppleOsFamily, string>();

    for (const payloadType of payloadTypes) {
      const versions = options.apple!.payloadVersions(payloadType);

      if (versions.length === 0) continue;
      const families = new Set<AppleOsFamily>();

      for (const version of versions) {
        const family: AppleOsFamily | null = normalizeAppleFamily(version);

        if (!family) continue;

        // A removed payload cannot be advertised as a `minimum+` range.
        if (options.apple!.payloadRemoved(payloadType, family)) continue;
        families.add(family);
      }

      if (families.size === 0) continue;

      if (configurationFamilies === null) configurationFamilies = families;
      else {
        const narrowed = new Set<AppleOsFamily>();

        for (const family of configurationFamilies) if (families.has(family)) narrowed.add(family);
        configurationFamilies = narrowed;
      }

      for (const family of families) {
        const minimum = options.apple!.payloadMinimum(payloadType, family);

        if (!minimum) continue;
        const existing = configurationMinimums.get(family);

        if (!existing || compareOsVersion(minimum, existing) > 0)
          configurationMinimums.set(family, minimum);
      }
    }

    for (const family of configurationFamilies ?? []) {
      appleFamilies.add(family);
      const minimum = configurationMinimums.get(family);

      if (!minimum) continue;
      const existing = appleMinimums.get(family);

      if (!existing || compareOsVersion(minimum, existing) > 0) appleMinimums.set(family, minimum);
    }
  }

  const apple = [...appleFamilies]
    .sort((left, right) => OS_FAMILY_ORDER.indexOf(left) - OS_FAMILY_ORDER.indexOf(right))
    .flatMap((family) => {
      const minimum = appleMinimums.get(family);

      return minimum ? [{ family, minimum }] : [];
    });

  return {
    platforms: [...platforms].sort(compareText),
    apple,
    windowsMinimum,
    channels: (["device", "user"] as const).filter((channel) => channels.has(channel)),
  };
};

type ScopeIndex = {
  readonly groups: Map<string, PolicyResolutionGroup>;
  readonly groupAssignments: Map<string, Array<PolicyResolutionGroupAssignment>>;
  readonly groupIdsByDevice: Map<string, Array<string>>;
  readonly deviceAssignments: Map<
    string,
    Array<{ policyId: string; mode?: "include" | "exclude" }>
  >;
  readonly users: Map<string, PolicyResolutionUser>;
  readonly userIdsByDevice: Map<string, Array<string>>;
  readonly userGroups: Map<string, PolicyResolutionUserGroup>;
  readonly userGroupIdsByUser: Map<string, Array<string>>;
  readonly userIdsByGroup: Map<string, Array<string>>;
  readonly userAssignments: Map<string, Array<PolicyResolutionUserAssignment>>;
  readonly userGroupAssignments: Map<string, Array<PolicyResolutionUserGroupAssignment>>;
};

const pushTo = <A>(map: Map<string, Array<A>>, key: string, value: A) => {
  const list = map.get(key) ?? [];

  list.push(value);
  map.set(key, list);
};

/**
 * Index the tenant-wide input once. Building facts per device from these maps
 * keeps a large page linear instead of scanning every assignment per device.
 */
const scopeIndex = (input: PolicyScopeResolutionInput): ScopeIndex => {
  const index: ScopeIndex = {
    groups: new Map(),
    groupAssignments: new Map(),
    groupIdsByDevice: new Map(),
    deviceAssignments: new Map(),
    users: new Map(),
    userIdsByDevice: new Map(),
    userGroups: new Map(),
    userGroupIdsByUser: new Map(),
    userIdsByGroup: new Map(),
    userAssignments: new Map(),
    userGroupAssignments: new Map(),
  };

  for (const group of input.groups) index.groups.set(group.id, group);

  for (const group of input.userGroups) index.userGroups.set(group.id, group);

  for (const user of input.users) index.users.set(user.id, user);

  for (const assignment of input.groupAssignments)
    pushTo(index.groupAssignments, assignment.groupId, assignment);

  for (const member of input.groupMembers)
    pushTo(index.groupIdsByDevice, member.deviceId, member.groupId);

  for (const assignment of input.deviceAssignments)
    pushTo(index.deviceAssignments, assignment.deviceId, {
      policyId: assignment.policyId,
      ...(assignment.mode ? { mode: assignment.mode } : {}),
    });

  for (const link of input.deviceUsers) pushTo(index.userIdsByDevice, link.deviceId, link.userId);

  for (const member of input.userGroupMembers) {
    pushTo(index.userGroupIdsByUser, member.userId, member.groupId);
    pushTo(index.userIdsByGroup, member.groupId, member.userId);
  }

  for (const assignment of input.userAssignments)
    pushTo(index.userAssignments, assignment.userId, assignment);

  for (const assignment of input.userGroupAssignments)
    pushTo(index.userGroupAssignments, assignment.groupId, assignment);

  return index;
};

type DeviceFacts = {
  readonly device: PolicyScopeDevice;
  readonly groups: ReadonlyArray<PolicyResolutionGroup>;
  readonly groupAssignments: ReadonlyArray<PolicyResolutionGroupAssignment>;
  readonly deviceAssignments: ReadonlyArray<{ policyId: string; mode?: "include" | "exclude" }>;
  readonly users: ReadonlyArray<PolicyResolutionUser>;
  readonly userGroups: ReadonlyArray<PolicyResolutionUserGroup>;
  readonly userGroupMembers: ReadonlyArray<{ groupId: string; userId: string }>;
  readonly userAssignments: ReadonlyArray<PolicyResolutionUserAssignment>;
  readonly userGroupAssignments: ReadonlyArray<PolicyResolutionUserGroupAssignment>;
  /** One resolution per channel (and user) so a group page reuses it per policy. */
  readonly results: Map<string, EffectivePolicy>;
};

const factsFor = (index: ScopeIndex, device: PolicyScopeDevice): DeviceFacts => {
  const groupIds = index.groupIdsByDevice.get(device.id) ?? [];
  const userIds = index.userIdsByDevice.get(device.id) ?? [];
  const userIdSet = new Set(userIds);

  const userGroupIds = new Set(
    userIds.flatMap((userId) => index.userGroupIdsByUser.get(userId) ?? []),
  );

  const groups = groupIds.flatMap((groupId) => {
    const group = index.groups.get(groupId);

    return group ? [group] : [];
  });

  const users = userIds.flatMap((userId) => {
    const user = index.users.get(userId);

    return user ? [user] : [];
  });

  const userGroups = [...userGroupIds].flatMap((groupId) => {
    const group = index.userGroups.get(groupId);

    return group ? [group] : [];
  });

  return {
    device,
    groups,
    groupAssignments: groupIds.flatMap((groupId) => index.groupAssignments.get(groupId) ?? []),
    deviceAssignments: index.deviceAssignments.get(device.id) ?? [],
    users,
    userGroups,
    userGroupMembers: [...userGroupIds].flatMap((groupId) =>
      (index.userIdsByGroup.get(groupId) ?? [])
        .filter((userId) => userIdSet.has(userId))
        .map((userId) => ({ groupId, userId })),
    ),
    userAssignments: userIds.flatMap((userId) => index.userAssignments.get(userId) ?? []),
    userGroupAssignments: [...userGroupIds].flatMap(
      (groupId) => index.userGroupAssignments.get(groupId) ?? [],
    ),
    results: new Map<string, EffectivePolicy>(),
  };
};

const resolutionInput = (
  input: PolicyScopeResolutionInput,
  facts: DeviceFacts,
  channel: PolicyChannel,
  options: { forUserId?: string } = {},
) => ({
  deviceId: facts.device.id,
  channel,
  ...(options.forUserId ? { forUserId: options.forUserId } : {}),
  ...(channel === "device" && isWindows(facts.device) ? { includeUserScoped: true } : {}),
  groups: facts.groups,
  groupAssignments: facts.groupAssignments,
  deviceAssignments: facts.deviceAssignments,
  ...(input.groupUserExclusions ? { groupUserExclusions: input.groupUserExclusions } : {}),
  users: facts.users,
  userGroups: facts.userGroups,
  userGroupMembers: facts.userGroupMembers,
  userAssignments: facts.userAssignments,
  userGroupAssignments: facts.userGroupAssignments,
  policies: input.policies,
  configurations: input.configurations,
});

/**
 * Resolve once per device/channel and reuse it for every policy on the page.
 * A group with several policies otherwise re-runs the same resolution for each.
 */
const resolutionFor = (
  input: PolicyScopeResolutionInput,
  facts: DeviceFacts,
  channel: PolicyChannel,
  forUserId?: string,
): EffectivePolicy => {
  const key = `${channel}:${forUserId ?? ""}`;
  const cached = facts.results.get(key);

  if (cached) return cached;

  const result = resolveEffectivePolicy(
    resolutionInput(input, facts, channel, forUserId ? { forUserId } : {}),
  );

  facts.results.set(key, result);

  return result;
};

const overrideReason = (reason: string): PolicyScopeReason => {
  switch (reason) {
    case "lower-priority":
      return "higher-priority";
    case "older-updated-at":
      return "newer-updated-at";
    case "lexicographic-id":
      return "lexicographic-id";
    case "direct-device-include":
      return "direct-device-include";
    case "direct-user-include":
      return "direct-user-include";
    case "device-scope":
      return "device-scope";
    default:
      return "higher-priority";
  }
};

const exclusionReason = (reason: string): PolicyScopeReason => {
  switch (reason) {
    case "device-exclude":
      return "device-exclude";
    case "group-exclude":
      return "group-exclude";
    case "user-exclude":
      return "user-exclude";
    case "user-group-exclude":
      return "user-group-exclude";
    default:
      return "group-exclude";
  }
};

/** The reason shown when the policy lost a kind: direct assignments outrank others. */
const reasonRank: Record<PolicyScopeReason, number> = {
  "direct-device-include": 0,
  "direct-user-include": 1,
  "device-scope": 2,
  "higher-priority": 3,
  "newer-updated-at": 4,
  "lexicographic-id": 5,
  "group-exclude": 6,
  "device-exclude": 7,
  "user-exclude": 8,
  "user-group-exclude": 9,
  applies: 10,
  partial: 10,
  "os-unsupported": 11,
  "wrong-scope": 12,
  "not-included": 13,
  "no-verified-user-channel": 14,
  disabled: 15,
  "no-configurations": 16,
};

const primaryReason = (reasons: ReadonlyArray<PolicyScopeReason>): PolicyScopeReason =>
  [...reasons].sort((left, right) => reasonRank[left] - reasonRank[right])[0] ?? "not-included";

const appliesToChannel = (
  configuration: PolicyResolutionConfiguration,
  channel: PolicyChannel,
  device: PolicyScopeDevice,
) => {
  const configurationScope = scopeOf(configuration);

  if (channel === "user") return configurationScope === "user";

  return configurationScope === "device" || (isWindows(device) && configurationScope === "user");
};

type ChannelClassification = {
  readonly status: PolicyScopeStatus;
  readonly reason: PolicyScopeReason;
  readonly kinds: ReadonlyArray<string>;
  readonly unsupportedKinds: ReadonlyArray<string>;
  readonly losses: ReadonlyArray<PolicyScopeLoss>;
  readonly exclusions: ReadonlyArray<PolicyScopeExclusion>;
};

const classifyPolicyOnChannel = async (args: {
  readonly policy: PolicyResolutionPolicy;
  readonly configurations: ReadonlyArray<PolicyResolutionConfiguration>;
  readonly result: EffectivePolicy;
  readonly device: PolicyScopeDevice;
  readonly channel: PolicyChannel;
  readonly apple?: PolicySupportOptions["apple"];
}): Promise<ChannelClassification> => {
  const { policy, configurations, result, device, channel } = args;

  const targetKinds = new Set(
    configurations
      .filter((configuration) => configuration.policyId === policy.id)
      .filter((configuration) => appliesToChannel(configuration, channel, device))
      .map((configuration) => configuration.kind),
  );

  const winning = result.configurations.filter(
    (configuration) =>
      configuration.policyId === policy.id &&
      targetKinds.has(configuration.kind) &&
      appliesToChannel(
        {
          policyId: configuration.policyId,
          kind: configuration.kind,
          scope: configuration.configurationScope,
        },
        channel,
        device,
      ),
  );

  const losses: Array<PolicyScopeLoss> = result.overridden
    .filter((override) => override.policyId === policy.id && targetKinds.has(override.kind))
    .map((override) => {
      const winner = result.configurations.find(
        (configuration) => configuration.kind === override.kind,
      );

      return {
        kind: override.kind,
        reason: overrideReason(override.reason),
        ...(winner ? { winnerPolicyId: winner.policyId } : {}),
        ...(winner ? { winnerPolicyName: winner.policyName } : {}),
        ...(winner ? { winnerPriority: winner.priority } : {}),
      };
    });

  const exclusions: Array<PolicyScopeExclusion> = result.exclusions
    .filter((exclusion) => exclusion.policyId === policy.id)
    .filter((exclusion) => exclusion.kinds.some((kind) => targetKinds.has(kind)))
    .map((exclusion) => ({
      reason: exclusionReason(exclusion.reason),
      ...(exclusion.groupId ? { groupId: exclusion.groupId } : {}),
      ...(exclusion.groupName ? { groupName: exclusion.groupName } : {}),
      ...(exclusion.userNames ? { userNames: exclusion.userNames } : {}),
      ...(exclusion.userGroupId ? { userGroupId: exclusion.userGroupId } : {}),
      ...(exclusion.userGroupName ? { userGroupName: exclusion.userGroupName } : {}),
      effective: exclusion.effective,
    }));

  if (targetKinds.size === 0)
    return {
      status: "wrong-scope",
      reason: "wrong-scope",
      kinds: [],
      unsupportedKinds: [],
      losses,
      exclusions,
    };

  let unsupportedKinds: ReadonlyArray<string> = [];
  let deliveredKinds = winning.map((configuration) => configuration.kind);

  if (winning.length > 0) {
    const scoped = await scopeConfigurationsToDevice(
      winning.map((configuration) => ({
        policyId: configuration.policyId,
        kind: configuration.kind,
        data: configuration.data,
        hash: configuration.hash ?? "",
        groupId: "",
      })),
      {
        proto: device.proto,
        osEdition: device.osEdition,
        osVersion: device.osVersion,
        osBuild: device.osBuild,
      },
      devicePlatform(device) === "apple"
        ? device.declarationMode === "legacy"
          ? "legacy"
          : "ddm"
        : "none",
      { apple: args.apple },
    );

    deliveredKinds = scoped.delivered.map((configuration) => configuration.kind);
    unsupportedKinds = scoped.skipped.map((configuration) => configuration.kind);
  }

  if (winning.length === 0) {
    // An inert exclusion still explains the device: the assignment graph
    // reaches it, but nothing was there to remove. Prefer one that actually
    // removed a would-be include when both exist.
    const exclusion = exclusions.find((candidate) => candidate.effective) ?? exclusions[0];

    if (exclusion)
      return {
        status: "excluded",
        reason: exclusion.reason,
        kinds: [],
        unsupportedKinds: [],
        losses,
        exclusions,
      };

    if (losses.length > 0)
      return {
        status: "overridden",
        reason: primaryReason(losses.map((loss) => loss.reason)),
        kinds: [],
        unsupportedKinds: [],
        losses,
        exclusions,
      };

    return {
      status: "not-included",
      reason: "not-included",
      kinds: [],
      unsupportedKinds: [],
      losses,
      exclusions,
    };
  }

  if (deliveredKinds.length === 0)
    return {
      status: "unsupported-os",
      reason: "os-unsupported",
      kinds: [],
      unsupportedKinds,
      losses,
      exclusions,
    };

  if (unsupportedKinds.length > 0 || losses.length > 0)
    return {
      status: "partial",
      reason:
        losses.length > 0
          ? primaryReason(losses.map((loss) => loss.reason))
          : unsupportedKinds.length > 0
            ? "os-unsupported"
            : "partial",
      kinds: deliveredKinds,
      unsupportedKinds,
      losses,
      exclusions,
    };

  return {
    status: "applies",
    reason: "applies",
    kinds: deliveredKinds,
    unsupportedKinds: [],
    losses,
    exclusions,
  };
};

const entriesForPolicyOnDevice = async (args: {
  readonly input: PolicyScopeResolutionInput;
  readonly facts: DeviceFacts;
  readonly policy: PolicyResolutionPolicy;
  readonly channels: ReadonlyArray<PolicyChannel>;
  readonly apple?: PolicySupportOptions["apple"];
}): Promise<Array<PolicyScopeDeviceEntry>> => {
  const { input, facts, policy, channels } = args;

  if (policy.enabled === false)
    return channels.map((channel) => ({
      deviceId: facts.device.id,
      deviceName: facts.device.name,
      deviceOs: deviceOsLabel(facts.device),
      platform: devicePlatform(facts.device),
      channel,
      status: "disabled" as const,
      reason: "disabled" as const,
      kinds: [],
      unsupportedKinds: [],
      losses: [],
      exclusions: [],
    }));

  const configurations = input.configurations.filter(
    (configuration) => configuration.policyId === policy.id,
  );

  if (configurations.length === 0)
    return channels.map((channel) => ({
      deviceId: facts.device.id,
      deviceName: facts.device.name,
      deviceOs: deviceOsLabel(facts.device),
      platform: devicePlatform(facts.device),
      channel,
      status: "no-configurations" as const,
      reason: "no-configurations" as const,
      kinds: [],
      unsupportedKinds: [],
      losses: [],
      exclusions: [],
    }));

  const entries: Array<PolicyScopeDeviceEntry> = [];

  // Windows has no per-login channel, so a user-scoped configuration is
  // resolved on the device channel with `includeUserScoped`, exactly as
  // delivery does.
  if (channels.includes("device") || (isWindows(facts.device) && channels.includes("user"))) {
    const result = resolutionFor(input, facts, "device");

    const classification = await classifyPolicyOnChannel({
      policy,
      configurations,
      result,
      device: facts.device,
      channel: "device",
      apple: args.apple,
    });

    entries.push({
      deviceId: facts.device.id,
      deviceName: facts.device.name,
      deviceOs: deviceOsLabel(facts.device),
      platform: devicePlatform(facts.device),
      channel: "device",
      ...classification,
    });
  }

  if (channels.includes("user")) {
    // Windows has no per-login channel; its user-scoped configurations are
    // already classified on the device channel above.
    if (!isApple(facts.device)) {
      if (!channels.includes("device") && !isWindows(facts.device))
        entries.push({
          deviceId: facts.device.id,
          deviceName: facts.device.name,
          deviceOs: deviceOsLabel(facts.device),
          platform: devicePlatform(facts.device),
          channel: "user",
          status: "wrong-scope",
          reason: "wrong-scope",
          kinds: [],
          unsupportedKinds: [],
          losses: [],
          exclusions: [],
        });
    } else if (facts.users.length === 0) {
      entries.push({
        deviceId: facts.device.id,
        deviceName: facts.device.name,
        deviceOs: deviceOsLabel(facts.device),
        platform: "apple",
        channel: "user",
        status: "not-included",
        reason: "no-verified-user-channel",
        kinds: [],
        unsupportedKinds: [],
        losses: [],
        exclusions: [],
      });
    } else {
      for (const user of facts.users) {
        const result = resolutionFor(input, facts, "user", user.id);

        const classification = await classifyPolicyOnChannel({
          policy,
          configurations,
          result,
          device: facts.device,
          channel: "user",
          apple: args.apple,
        });

        entries.push({
          deviceId: facts.device.id,
          deviceName: facts.device.name,
          deviceOs: deviceOsLabel(facts.device),
          platform: "apple",
          channel: "user",
          userId: user.id,
          userName: user.name ?? user.email ?? user.id,
          ...classification,
        });
      }
    }
  }

  return entries;
};

const policyChannels = (
  configurations: ReadonlyArray<PolicyResolutionConfiguration>,
  policyId: string,
): ReadonlyArray<PolicyChannel> => {
  const scopes = new Set<ConfigurationScope>();

  for (const configuration of configurations)
    if (configuration.policyId === policyId) scopes.add(scopeOf(configuration));

  // A policy with assignments but no settings is still device-scoped as far as
  // its assignments are concerned. Without this fallback it would produce no
  // entry and the page would claim no device is assigned.
  if (scopes.size === 0) return ["device"];

  return (["device", "user"] as const).filter((channel) => scopes.has(channel));
};

/**
 * Resolve one policy's reach across `input.devices`.
 *
 * `input.devices` is expected to contain the candidate devices only (the loader
 * computes that set from the policy's assignment edges), so every returned
 * entry is either a device that receives the policy or one with a concrete
 * reason it does not.
 */
export const resolvePolicyScope = async (
  input: PolicyScopeResolutionInput,
  policyId: string,
  options: PolicySupportOptions = {},
): Promise<PolicyScopeSummary> => {
  const policy = input.policies.find((candidate) => candidate.id === policyId);

  if (!policy)
    return {
      policyId,
      platforms: [],
      apple: [],
      windowsMinimum: null,
      channels: [],
      deviceCount: 0,
      truncated: false,
      devices: [],
    };

  const configurations = input.configurations.filter(
    (configuration) => configuration.policyId === policyId,
  );

  const support = await derivePolicyPlatformSupport(configurations, options);

  const channels = policyChannels(configurations, policyId);
  const index = scopeIndex(input);
  const entries: Array<PolicyScopeDeviceEntry> = [];

  for (const device of input.devices) {
    const facts = factsFor(index, device);
    entries.push(
      ...(await entriesForPolicyOnDevice({
        input,
        facts,
        policy,
        channels,
        apple: options.apple,
      })),
    );
  }

  const sorted = entries.sort(
    (left, right) =>
      compareText(left.deviceName, right.deviceName) ||
      compareText(left.channel, right.channel) ||
      compareText(left.userName ?? "", right.userName ?? "") ||
      compareId(left.deviceId, right.deviceId),
  );

  const deviceCount = input.deviceCount ?? input.devices.length;

  return {
    policyId,
    platforms: support.platforms,
    apple: support.apple,
    windowsMinimum: support.windowsMinimum,
    channels: support.channels.length > 0 ? support.channels : channels,
    deviceCount,
    truncated:
      (input.truncated ?? false) ||
      deviceCount > input.devices.length ||
      sorted.length > MAX_SCOPE_DEVICES,
    devices: sorted.slice(0, MAX_SCOPE_DEVICES),
  };
};

/**
 * Resolve the policies a group carries for its member devices.
 *
 * Dynamic groups are already materialised into `groupMembers` by the caller, so
 * this sees exactly the devices the group reaches. Every device is resolved with
 * all of its own groups and assignments, which is what makes the result show
 * whether the group's policy actually wins rather than only that it is assigned.
 */
export const resolveGroupScope = async (
  input: PolicyScopeResolutionInput,
  groupId: string,
  options: PolicySupportOptions = {},
): Promise<GroupScopeSummary> => {
  const assigned = input.groupAssignments.filter((assignment) => assignment.groupId === groupId);
  const members = input.groupMembers.filter((member) => member.groupId === groupId);
  const policyById = new Map(input.policies.map((policy) => [policy.id, policy]));

  const memberById = new Map(input.devices.map((device) => [device.id, device]));
  const index = scopeIndex(input);

  // Build each member's facts once: every policy below reads the same groups,
  // linked users and resolutions.
  const memberFacts = members.flatMap((member) => {
    const device = memberById.get(member.deviceId);

    return device ? [factsFor(index, device)] : [];
  });

  const policies: Array<GroupScopePolicy> = [];
  let truncated = input.truncated ?? false;

  for (const assignment of assigned) {
    const policy = policyById.get(assignment.policyId);

    if (!policy) continue;

    const configurations = input.configurations.filter(
      (configuration) => configuration.policyId === policy.id,
    );

    const channels = policyChannels(configurations, policy.id);

    const devices: Array<PolicyScopeDeviceEntry> = [];

    for (const facts of memberFacts) {
      devices.push(
        ...(await entriesForPolicyOnDevice({
          input,
          facts,
          policy,
          channels,
          apple: options.apple,
        })),
      );
    }

    const sorted = devices.sort(
      (left, right) =>
        compareText(left.deviceName, right.deviceName) ||
        compareText(left.channel, right.channel) ||
        compareText(left.userName ?? "", right.userName ?? "") ||
        compareId(left.deviceId, right.deviceId),
    );

    if (sorted.length > MAX_SCOPE_DEVICES) truncated = true;

    policies.push({
      policyId: policy.id,
      policyName: policy.name,
      mode: assignment.mode ?? "include",
      devices: sorted.slice(0, MAX_SCOPE_DEVICES),
    });
  }

  const memberCount = input.deviceCount ?? members.length;

  return {
    groupId,
    memberCount,
    truncated: truncated || memberCount > members.length,
    policies: policies.sort((left, right) => compareText(left.policyName, right.policyName)),
  };
};
