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

const untrackedNote = (delivery: PolicyDeliveryInfo) =>
  delivery.scopedDevices > delivery.trackedDevices
    ? " Windows and Android devices do not report declaration status."
    : "";

const label: Record<PolicyDeliveryState, string> = {
  "never-deployed": "Never deployed",
  "no-devices": "No devices",
  "not-tracked": "Not tracked",
  "no-configurations": "No configurations",
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
  pending: "warning",
  partial: "warning",
  failed: "destructive",
  delivered: "success",
};

const describe = (delivery: PolicyDeliveryInfo): string => {
  const version = delivery.version === null ? "the current version" : `version ${delivery.version}`;
  const untracked = untrackedNote(delivery);

  switch (delivery.state) {
    case "never-deployed":
      return "The policy has no deployment version yet. Save it to create version 1.";
    case "no-devices":
      return "This policy's assignments match no devices.";
    case "not-tracked":
      return "This policy only reaches Windows or Android devices. Mattrax does not track per-device declaration status for those platforms.";
    case "no-configurations":
      return `The policy has no Apple configurations to deliver.${untracked}`;
    case "pending":
      return `No Apple device in scope has reported ${version} yet. Devices converge on their next check-in.${untracked}`;
    case "partial":
      return `${delivery.deliveredDevices} of ${plural(
        delivery.trackedDevices,
        "Apple device",
        "Apple devices",
      )} report ${version}; ${delivery.failedDevices} failed and ${delivery.pendingDevices} pending.${untracked}`;
    case "failed":
      return `No Apple device reports ${version} as delivered; ${delivery.failedDevices} of ${delivery.trackedDevices} report an invalid declaration.${untracked}`;
    case "delivered":
      return `Every Apple device in scope (${delivery.trackedDevices}) reports ${version} as valid and active.${untracked}`;
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
  "not-tracked": 5,
  "no-devices": 6,
  "never-deployed": 7,
};

export const policyDeliverySortRank = (state: PolicyDeliveryState | undefined) =>
  state === undefined ? Number.MAX_SAFE_INTEGER : sortRank[state];

/**
 * Scope tooltip for the device and user counts. The device number is the
 * distinct device set after group and direct exclusions; the user number is
 * the directory users that still contribute after user/group exclusions.
 */
export const policyScopePresentation = (counts: { deviceCount?: number; userCount?: number }) => {
  const devices = counts.deviceCount ?? 0;
  const users = counts.userCount ?? 0;

  return {
    label: `${plural(devices, "device", "devices")} in scope, ${plural(
      users,
      "user",
      "users",
    )} assigned`,
    description: `${plural(devices, "device", "devices")} are in this policy's assignment scope and ${plural(
      users,
      "directory user",
      "directory users",
    )} are assigned directly or through a directory group. Direct and group exclusions are applied.`,
    devices: {
      label: `${plural(devices, "device", "devices")} in scope`,
      description: `${plural(
        devices,
        "device",
        "devices",
      )} are in this policy's assignment scope. Direct device exclusions and group exclusions are applied.`,
    },
    users: {
      label: `${plural(users, "user", "users")} assigned`,
      description: `${plural(
        users,
        "user",
        "users",
      )} are assigned directly or through a directory group. User and directory-group exclusions are applied.`,
    },
  };
};
