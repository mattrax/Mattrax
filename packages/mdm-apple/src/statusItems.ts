import { appleOsFamily, compareOsVersion } from "@mattrax/dm-apple";
import type { AppleOsFamily } from "@mattrax/dm-apple";

/**
 * DDM status subscription planning.
 *
 * Apple does not silently ignore a status item an OS does not know: the
 * subscription declaration is reported invalid, which makes every device look
 * unhealthy for a policy reason that is really a platform mismatch. The legacy
 * app carried `passcode.*` and `mdm.app` commented out with "These erroring out
 * on macOS" for exactly that reason. Apple's schema now states which OS (and
 * from which version) supports each item, so the subscription is built per
 * device instead of being one global list.
 */

/** Items every supported Apple OS answers and Mattrax has always subscribed. */
export const DEVICE_INFORMATION_BASE_STATUS_ITEMS = [
  "device.identifier.serial-number",
  "device.identifier.udid",
  "device.model.family",
  "device.model.identifier",
  "device.model.marketing-name",
  "device.model.number",
  "device.operating-system.build-version",
  "device.operating-system.family",
  "device.operating-system.marketing-name",
  "device.operating-system.supplemental.build-version",
  "device.operating-system.supplemental.extra-version",
  "device.operating-system.version",
  "device.power.battery-health",
  "diskmanagement.filevault.enabled",
  "diskmanagement.storage.available",
  "diskmanagement.storage.total",
  "management.client-capabilities",
  "management.declarations",
] as const;

type AdditionalStatusItem = {
  readonly item: string;
  /** First OS version that reports the item. Absent families do not report it. */
  readonly families: Partial<Record<AppleOsFamily, string>>;
};

/** Every item added by the compliance work, with Apple's support matrix. */
export const ADDITIONAL_STATUS_ITEMS: ReadonlyArray<AdditionalStatusItem> = [
  {
    item: "passcode.is-present",
    // macOS has no device passcode concept; Apple marks it n/a.
    families: { iOS: "16.0", visionOS: "1.1", watchOS: "10.0" },
  },
  {
    item: "passcode.is-compliant",
    families: { iOS: "16.0", visionOS: "1.1", watchOS: "10.0" },
  },
  {
    item: "mdm.app",
    families: { iOS: "16.0", tvOS: "16.0", visionOS: "1.1", watchOS: "10.0" },
  },
  {
    item: "softwareupdate.install-state",
    families: { macOS: "14.0", iOS: "17.0", tvOS: "18.4", visionOS: "26.0" },
  },
  {
    item: "softwareupdate.pending-version",
    families: { macOS: "14.0", iOS: "17.0", tvOS: "18.4", visionOS: "26.0" },
  },
  {
    item: "softwareupdate.failure-reason",
    families: { macOS: "14.0", iOS: "17.0", tvOS: "18.4", visionOS: "26.0" },
  },
  {
    item: "security.certificate.list",
    families: {
      macOS: "14.0",
      iOS: "17.0",
      tvOS: "17.0",
      visionOS: "1.1",
      watchOS: "10.0",
    },
  },
  {
    item: "security.lockdown-mode",
    families: { macOS: "27.0", iOS: "27.0", watchOS: "27.0" },
  },
];

/**
 * The status items to subscribe for one device.
 *
 * An unknown OS family or version only gets the base list: subscribing an item
 * the device may not know invalidates the whole subscription declaration, and
 * the next status report carries the version that unlocks the rest.
 */
export const appleStatusItemsForDevice = (device: {
  readonly osEdition?: string | null;
  readonly osVersion?: string | null;
}): ReadonlyArray<string> => {
  const family = appleOsFamily(device.osEdition);
  const version = device.osVersion?.trim();

  if (!family || !version) return [...DEVICE_INFORMATION_BASE_STATUS_ITEMS];

  const additional = ADDITIONAL_STATUS_ITEMS.flatMap((entry) => {
    const minimum = entry.families[family];

    return minimum !== undefined && compareOsVersion(version, minimum) >= 0 ? [entry.item] : [];
  });

  return [...DEVICE_INFORMATION_BASE_STATUS_ITEMS, ...additional];
};
