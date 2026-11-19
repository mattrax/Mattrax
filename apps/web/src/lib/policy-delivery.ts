import type { PolicyDeliveryInfo, PolicyDeliveryState } from "@mattrax/enterprise-domain/client";

/**
 * Presentation for the policy list's delivery and scope columns.
 *
 * The API derives the state from Apple declaration reports (see
 * `derivePolicyDelivery`); this module only turns that state and its counts
 * into a label, tone and an explanation an operator can act on. Keep the copy
 * aligned with the API comment: Windows and Android devices are in scope but
 * are not tracked per device.
 */
export type PolicyDeliveryTone = "success" | "warning" | "destructive" | "outline" | "subtle";

export type PolicyDeliveryPresentation = {
  label: string;
  description: string;
  tone: PolicyDeliveryTone;
  dot?: "success" | "warning" | "destructive" | "neutral";
};

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const untrackedNote = (delivery: PolicyDeliveryInfo) => {
  const nonApple = delivery.scopedDevices - delivery.trackedDevices - delivery.legacyDevices;
  const notes: string[] = [];

  if (nonApple > 0) notes.push("Windows and Android devices do not report declaration status.");

  if (delivery.legacyDevices > 0)
    notes.push(
      `${plural(
        delivery.legacyDevices,
        "Apple device",
        "Apple devices",
      )} ${delivery.legacyDevices === 1 ? "uses" : "use"} legacy profiles, which do not report DDM declarations.`,
    );

  return notes.length > 0 ? ` ${notes.join(" ")}` : "";
};

const overriddenNote = (delivery: PolicyDeliveryInfo) =>
  delivery.overriddenDevices > 0
    ? ` ${plural(
        delivery.overriddenDevices,
        "device does",
        "devices do",
      )} not receive this policy because another policy provides every kind.`
    : "";

const label: Record<PolicyDeliveryState, string> = {
  "never-deployed": "Never deployed",
  "no-devices": "No devices",
  "not-tracked": "Not tracked",
  "no-configurations": "No configurations",
  "user-channel": "User channel",
  "not-applicable": "Not applicable",
  pending: "Pending",
  partial: "Partial",
  failed: "Failed",
  delivered: "Delivered",
};

const tone: Record<PolicyDeliveryState, PolicyDeliveryTone> = {
  "never-deployed": "outline",
  "no-devices": "outline",
  "not-tracked": "subtle",
  "no-configurations": "outline",
  "user-channel": "outline",
  "not-applicable": "subtle",
  pending: "warning",
  partial: "warning",
  failed: "destructive",
  delivered: "success",
};

const dot: Record<PolicyDeliveryState, PolicyDeliveryPresentation["dot"]> = {
  "never-deployed": "neutral",
  "no-devices": "neutral",
  "not-tracked": "neutral",
  "no-configurations": "neutral",
  "user-channel": "neutral",
  "not-applicable": "neutral",
  pending: "warning",
  partial: "warning",
  failed: "destructive",
  delivered: "success",
};

const describe = (delivery: PolicyDeliveryInfo): string => {
  const version = delivery.version === null ? "the current version" : `version ${delivery.version}`;
  const untracked = untrackedNote(delivery);
  const applicableDevices = delivery.trackedDevices - delivery.overriddenDevices;

  switch (delivery.state) {
    case "never-deployed":
      return "The policy has no deployment version yet. Save it to create version 1.";
    case "no-devices":
      return "This policy's assignments match no devices.";
    case "not-tracked":
      return `This policy only reaches devices that do not report DDM declaration status (Windows, Android or legacy Apple profiles).${untracked}`;
    case "no-configurations":
      return `The policy has no declarable Apple configurations to deliver. Application installs are imperative and do not publish declarations.${untracked}`;
    case "user-channel":
      return `This policy only has user-scoped settings. They are delivered on each linked login's Apple user channel, so they are not part of the device declaration rollup.${untracked}`;
    case "not-applicable":
      return `Every declaration-tracked Apple device in scope is provided by a higher-priority policy, so this policy never wins a configuration kind.${overriddenNote(
        delivery,
      )}${untracked}`;
    case "pending":
      return `No applicable Apple device has reported ${version} yet. Devices converge on their next check-in; a configuration the device's OS does not support may never report.${untracked}${overriddenNote(
        delivery,
      )}`;
    case "partial":
      return `${delivery.deliveredDevices} of ${plural(
        applicableDevices,
        "Apple device",
        "Apple devices",
      )} report ${version}; ${delivery.failedDevices} failed and ${delivery.pendingDevices} pending.${untracked}${overriddenNote(
        delivery,
      )}`;
    case "failed":
      return `No Apple device reports ${version} as delivered; ${delivery.failedDevices} of ${applicableDevices} report an invalid declaration.${untracked}${overriddenNote(
        delivery,
      )}`;
    case "delivered":
      return `Every applicable Apple device in scope (${applicableDevices}) reports ${version} as valid and active.${untracked}${overriddenNote(
        delivery,
      )}`;
  }
};

export const policyDeliveryPresentation = (
  delivery: PolicyDeliveryInfo,
): PolicyDeliveryPresentation => ({
  label: label[delivery.state],
  description: describe(delivery),
  tone: tone[delivery.state],
  dot: dot[delivery.state],
});

/** Action-needed first, so a default ascending sort surfaces broken policies. */
const sortRank: Record<PolicyDeliveryState, number> = {
  failed: 0,
  partial: 1,
  pending: 2,
  delivered: 3,
  "no-configurations": 4,
  "user-channel": 5,
  "not-applicable": 6,
  "not-tracked": 7,
  "no-devices": 8,
  "never-deployed": 9,
};

export const policyDeliverySortRank = (state: PolicyDeliveryState | undefined) =>
  state === undefined ? Number.MAX_SAFE_INTEGER : sortRank[state];

/**
 * A policy is enabled unless the API explicitly says otherwise. Older
 * responses predate the flag, so an absent value must not disable a policy.
 */
export const isPolicyEnabled = (policy: { readonly enabled?: boolean }) =>
  policy.enabled !== false;

/** Label, tone and explanation for a policy's enable/disable state. */
export const policyStatePresentation = (policy: { readonly enabled?: boolean }) =>
  isPolicyEnabled(policy)
    ? {
        label: "Enabled",
        tone: "success" as const,
        description: "The policy's settings are delivered to devices in its scope.",
      }
    : {
        label: "Disabled",
        tone: "warning" as const,
        description:
          "Delivery is paused and the policy's settings have been withdrawn from devices. Its configuration and assignments are kept; enabling it deploys them again.",
      };

/**
 * Delivery presentation for a policy row. Disabled wins over the derived
 * delivery rollup: a disabled policy keeps its last declaration rows, so it
 * would otherwise keep reading "Delivered" after delivery stopped.
 */
export const policyRowDeliveryPresentation = (policy: {
  readonly enabled?: boolean;
  readonly delivery?: PolicyDeliveryInfo;
}) =>
  isPolicyEnabled(policy)
    ? policy.delivery
      ? policyDeliveryPresentation(policy.delivery)
      : undefined
    : { ...policyStatePresentation(policy), dot: "warning" as const };

/**
 * Scope tooltip for the device and user counts. The device number is the
 * distinct device set after group and direct exclusions; the user number is
 * the directory users that still contribute after user/group exclusions.
 */
export const policyScopePresentation = (counts: { deviceCount?: number; userCount?: number }) => {
  const devices = counts.deviceCount ?? 0;
  const users = counts.userCount ?? 0;
  const devicesKnown = counts.deviceCount !== undefined;
  const usersKnown = counts.userCount !== undefined;

  const deviceLabel = devicesKnown
    ? `${plural(devices, "device", "devices")} in scope`
    : "Device count not reported";

  const userLabel = usersKnown
    ? `${plural(users, "user", "users")} assigned`
    : "User count not reported";

  const deviceDescription = devicesKnown
    ? `${plural(
        devices,
        "device",
        "devices",
      )} are in this policy's assignment scope. Direct device exclusions and group exclusions are applied.`
    : "This API response does not include a scoped device count. Refresh after the server is updated.";

  const userDescription = usersKnown
    ? `${plural(
        users,
        "user",
        "users",
      )} are assigned directly or through a directory group. User and directory-group exclusions are applied.`
    : "This API response does not include a scoped user count. Refresh after the server is updated.";

  return {
    label: `${deviceLabel}, ${userLabel.toLowerCase()}`,
    description: `${deviceDescription} ${userDescription}`,
    devices: { label: deviceLabel, description: deviceDescription },
    users: { label: userLabel, description: userDescription },
  };
};
