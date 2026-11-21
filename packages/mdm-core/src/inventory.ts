/**
 * DDM status-item ingestion.
 *
 * Apple reports subscribed status items as a nested path tree, but some clients
 * (and older protocol shims) flatten the keys into a single object. Both forms
 * are accepted here so a reporting change never silently drops inventory.
 *
 * Pure functions only: `updateInventoryFromStatus` owns persistence.
 */

import { Schema } from "effect";
import type { PlistValue } from "@mattrax/plist";
import {
  isPlistArray,
  isPlistObject,
  plistStatusBoolean,
  plistText,
} from "./internal/plistValue.js";
import type { PlistInput } from "./internal/plistValue.js";

export type DeviceInventory = {
  readonly serial?: string;
  readonly model?: string;
  readonly modelIdentifier?: string;
  readonly modelNumber?: string;
  readonly osEdition?: string;
  readonly osVersion?: string;
  readonly osBuild?: string;
  /** `null` means the report explicitly says the value is unavailable. */
  readonly fileVaultEnabled?: boolean | null;
  readonly batteryHealth?: string | null;
  readonly capabilities?: PlistValue | null;
  readonly diskTotal?: string;
  readonly diskUsed?: string;
  readonly passcodePresent?: boolean | null;
  readonly passcodeCompliant?: boolean | null;
  readonly osUpdateInstallState?: string | null;
  readonly osUpdatePendingVersion?: string | null;
  readonly osUpdatePendingBuild?: string | null;
  readonly osUpdateFailureReason?: string | null;
  readonly osUpdateFailureCount?: number | null;
  readonly osUpdateFailedAt?: Date | null;
  readonly securityLockdownMode?: boolean | null;
  readonly managedCertificateCount?: number | null;
  readonly managementApps?: ReadonlyArray<ManagementAppStatus> | null;
};

/** One entry of the `mdm.app` status item. */
export type ManagementAppStatus = {
  readonly identifier: string;
  readonly state: string | null;
  readonly version: string | null;
  readonly shortVersion: string | null;
};

/** Apple's documented `softwareupdate.install-state` values. */
export const OS_UPDATE_INSTALL_STATES = [
  "none",
  "downloading",
  "prepared",
  "installing",
  "failed",
] as const;

const OS_UPDATE_INSTALL_STATE_SET: ReadonlySet<string> = new Set(OS_UPDATE_INSTALL_STATES);

const MAX_STATUS_ENTRIES = 200;

const MAX_STATUS_TEXT = 255;

const clampText = (value: string): string =>
  value.length > MAX_STATUS_TEXT ? value.slice(0, MAX_STATUS_TEXT) : value;

/** Resolve a dotted path, falling back to a flattened key on the root object. */
export const statusItemValue = (statusItems: PlistInput, path: string): PlistInput => {
  if (!isPlistObject(statusItems)) return undefined;
  let current: PlistInput = statusItems;

  for (const part of path.split(".")) {
    current = isPlistObject(current) ? current[part] : undefined;

    if (current === undefined) break;
  }

  if (current !== undefined) return current;

  return statusItems[path];
};

const text = (value: PlistInput): string | undefined => {
  const direct = plistText(value);

  if (direct !== undefined) return direct;

  if (!isPlistObject(value)) return undefined;

  for (const key of ["value", "Value", "text", "string"]) {
    const candidate = text(value[key]);

    if (candidate !== undefined) return candidate;
  }

  return undefined;
};

const BATTERY_LABELS = new Map([
  ["good", "Good"],
  ["fair", "Fair"],
  ["poor", "Poor"],
  ["unknown", "Unknown"],
  ["service recommended", "Service Recommended"],
  ["service battery", "Service Battery"],
  ["replace soon", "Replace Soon"],
  ["replace now", "Replace Now"],
]);

/** Normalise `Enabled` / `Disabled` / booleans / `{ enabled }` wrappers. */
export const normalizeBoolean = (value: PlistInput): boolean | undefined => {
  const direct = plistStatusBoolean(value);

  if (direct !== undefined) return direct;

  if (!isPlistObject(value)) return undefined;

  for (const key of ["enabled", "Enabled", "value", "Value", "state", "status"]) {
    if (!(key in value)) continue;
    const parsed = normalizeBoolean(value[key]);

    if (parsed !== undefined) return parsed;
  }

  return undefined;
};

/** Canonicalise the battery condition strings macOS reports. */
export const normalizeBatteryHealth = (value: PlistInput): string | undefined => {
  const raw = text(value);

  if (!raw) return undefined;
  const collapsed = raw.replaceAll(/\s+/g, " ").trim();
  const canonical = BATTERY_LABELS.get(collapsed.toLowerCase());

  if (canonical) return canonical;

  // Preserve an unknown vendor value but keep it tidy and capitalised.
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
};

const capabilityLabel = (entry: PlistInput): string | undefined => {
  if (Schema.is(Schema.String)(entry)) return text(entry);

  if (!isPlistObject(entry)) return text(entry);

  for (const key of ["capability", "name", "identifier", "code", "id"]) {
    const label = text(entry[key]);

    if (label) return label;
  }

  return undefined;
};

/**
 * Capabilities arrive as an array of strings, an array of dictionaries, a
 * comma-separated string, or (some clients) a `{ capabilities: [...] }`
 * envelope. Arrays of dictionaries become a de-duplicated label list; an
 * unrecognised value is preserved verbatim so nothing is lost.
 */
export const normalizeCapabilities = (value: PlistInput): PlistInput => {
  if (value === null || value === undefined) return undefined;

  if (Schema.is(Schema.String)(value)) {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    return parts.length > 0 ? [...new Set(parts)] : undefined;
  }

  if (isPlistArray(value)) {
    const labels = value
      .map(capabilityLabel)
      .filter((label): label is string => label !== undefined);

    if (labels.length === value.length) return [...new Set(labels)];

    return value;
  }

  if (isPlistObject(value)) {
    for (const key of ["capabilities", "items", "values"]) {
      if (key in value) {
        const parsed = normalizeCapabilities(value[key]);

        if (parsed !== undefined) return parsed;
      }
    }

    return value;
  }

  return undefined;
};

const byteCount = (value: PlistInput): number | undefined => {
  const raw = text(value);

  if (!raw) return undefined;

  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Status entries are sometimes wrapped in `{ status_value: {...} }`. */
const statusEntry = (value: PlistInput) =>
  isPlistObject(value) && isPlistObject(value.status_value) ? value.status_value : value;

const timestampValue = (value: PlistInput): Date | null => {
  const raw = text(value);

  if (!raw) return null;
  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** `mdm.app` lists MDM-installed apps; DDM-managed apps are excluded by Apple. */
const managementApps = (value: PlistInput): ManagementAppStatus[] | undefined => {
  const entries = isPlistObject(value) && isPlistArray(value["mdm.app"]) ? value["mdm.app"] : value;

  if (!isPlistArray(entries)) return undefined;

  const apps: ManagementAppStatus[] = [];

  for (const raw of entries.slice(0, MAX_STATUS_ENTRIES)) {
    const entry = statusEntry(raw);

    if (!isPlistObject(entry)) continue;
    const identifier = text(entry.identifier);

    if (!identifier) continue;
    apps.push({
      identifier: clampText(identifier),
      state: text(entry.state) ? clampText(text(entry.state)!) : null,
      version: text(entry.version) ? clampText(text(entry.version)!) : null,
      shortVersion: text(entry["short-version"]) ? clampText(text(entry["short-version"])!) : null,
    });
  }

  if (apps.length === 0 && !isPlistArray(entries)) return undefined;

  return apps.sort((left, right) => left.identifier.localeCompare(right.identifier));
};

/** Merge the status items into a normalised inventory fragment. */
export const parseDeviceInventory = (statusItems: PlistInput): DeviceInventory => {
  const at = (path: string) => statusItemValue(statusItems, path);

  const inventory: {
    -readonly [K in keyof DeviceInventory]: DeviceInventory[K];
  } = {};

  const serial = text(at("device.identifier.serial-number"));
  const model = text(at("device.model.marketing-name"));
  const modelIdentifier = text(at("device.model.identifier"));
  const modelNumber = text(at("device.model.number"));
  const osEdition = text(at("device.operating-system.marketing-name"));
  const osVersion = text(at("device.operating-system.version"));
  const osBuild = text(at("device.operating-system.build-version"));

  if (serial) inventory.serial = serial;

  if (model) inventory.model = model;

  if (modelIdentifier) inventory.modelIdentifier = modelIdentifier;

  if (modelNumber) inventory.modelNumber = modelNumber;

  if (osEdition) inventory.osEdition = osEdition;

  if (osVersion) inventory.osVersion = osVersion;

  if (osBuild) inventory.osBuild = osBuild;

  const fileVault = at("diskmanagement.filevault.enabled");

  if (fileVault !== undefined) inventory.fileVaultEnabled = normalizeBoolean(fileVault) ?? null;

  const battery = at("device.power.battery-health");

  if (battery !== undefined) inventory.batteryHealth = normalizeBatteryHealth(battery) ?? null;

  const capabilities = at("management.client-capabilities");

  if (capabilities !== undefined)
    inventory.capabilities = normalizeCapabilities(capabilities) ?? null;

  // The status items below are only subscribed on OS versions that report them,
  // so an absent value means "not reported", not "false".
  const passcode = at("passcode.is-present");

  if (passcode !== undefined) inventory.passcodePresent = normalizeBoolean(passcode) ?? null;

  const passcodeCompliance = at("passcode.is-compliant");

  if (passcodeCompliance !== undefined)
    inventory.passcodeCompliant = normalizeBoolean(passcodeCompliance) ?? null;

  const installState = text(at("softwareupdate.install-state"));

  if (installState !== undefined) {
    const normalised = installState.trim().toLowerCase();

    inventory.osUpdateInstallState = OS_UPDATE_INSTALL_STATE_SET.has(normalised)
      ? normalised
      : null;
  }

  const pending = at("softwareupdate.pending-version");

  if (pending !== undefined) {
    const version = text(isPlistObject(pending) ? pending["os-version"] : pending);
    const build = text(isPlistObject(pending) ? pending["build-version"] : undefined);

    // Apple sends an empty string when nothing is pending.
    inventory.osUpdatePendingVersion = version?.trim() ? clampText(version.trim()) : null;
    inventory.osUpdatePendingBuild = build?.trim() ? clampText(build.trim()) : null;
  }

  const failure = at("softwareupdate.failure-reason");

  if (failure !== undefined) {
    const count = isPlistObject(failure) ? byteCount(failure.count) : undefined;
    const reason = text(isPlistObject(failure) ? failure.reason : undefined);
    const failedAt = isPlistObject(failure) ? timestampValue(failure.timestamp) : null;

    inventory.osUpdateFailureCount = count ?? null;
    inventory.osUpdateFailureReason = reason?.trim() ? clampText(reason.trim()) : null;
    inventory.osUpdateFailedAt = failedAt;
  }

  const lockdown = at("security.lockdown-mode");

  if (lockdown !== undefined) inventory.securityLockdownMode = normalizeBoolean(lockdown) ?? null;

  const certificates = statusEntry(at("security.certificate.list"));

  if (isPlistArray(certificates)) inventory.managedCertificateCount = certificates.length;

  const apps = at("mdm.app");

  if (apps !== undefined) inventory.managementApps = managementApps(apps) ?? null;

  // Apple reports both storage figures in bytes. `diskTotal`/`diskUsed` are
  // stored as decimal strings for portability across MySQL int widths. When the
  // figures disagree (available > total) the report is internally inconsistent:
  // update neither field so a stale `diskUsed` is not paired with a new total.
  const total = byteCount(at("diskmanagement.storage.total"));
  const available = byteCount(at("diskmanagement.storage.available"));

  if (total !== undefined && available !== undefined && available > total) return inventory;

  if (total !== undefined) inventory.diskTotal = String(total);

  if (total !== undefined && available !== undefined)
    inventory.diskUsed = String(total - available);

  return inventory;
};
