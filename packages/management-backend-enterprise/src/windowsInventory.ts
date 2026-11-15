/**
 * Windows device inventory (OMA-DM `Get` requests and result parsing).
 *
 * Windows exposes inventory through the DevDetail and DevInfo management
 * objects. Values arrive in a `<Results>` SyncML block on a later session, one
 * `Item` per requested OMA-URI, so the commands and the parser share the URI
 * constants below.
 *
 * Pure functions only: `windowsManagementCheckin` owns persistence.
 */

import { Option, Schema } from "effect";

/** How often a device is asked for a fresh inventory snapshot. */
export const WINDOWS_INVENTORY_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Stable command id prefix so a `Results` entry can be correlated by `CmdRef`. */
export const WINDOWS_INVENTORY_COMMAND_ID_PREFIX = "windows-inventory-";

export const WINDOWS_INVENTORY_URI = {
  /** `MajorVersion.MinorVersion.BuildNumber.QFEnumber`. */
  osVersion: "./DevDetail/SwV",
  /** System product name; used as a model fallback. */
  deviceType: "./DevDetail/DevTyp",
  deviceName: "./DevDetail/Ext/Microsoft/DeviceName",
  serial: "./DevDetail/Ext/Microsoft/SMBIOSSerialNumber",
  /** Windows product name, for example `Windows 10 Pro`. */
  osPlatform: "./DevDetail/Ext/Microsoft/OSPlatform",
  systemSKU: "./DevDetail/Ext/Microsoft/SystemSKU",
  /** Total size of the first internal drive, in MB. */
  totalStorage: "./DevDetail/Ext/Microsoft/TotalStorage",
  /** Free space on the first internal drive, in MB. */
  freeStorage: "./DevDetail/Ext/Microsoft/FreeStorage",
  /** Hardware model (SystemProductName) from the OMA DevInfo object. */
  model: "./DevInfo/Mod",
} as const;

export type WindowsInventoryRequest = {
  readonly cmdID: string;
  readonly locURI: string;
};

const request = (name: string, locURI: string): WindowsInventoryRequest => ({
  cmdID: `${WINDOWS_INVENTORY_COMMAND_ID_PREFIX}${name}`,
  locURI,
});

/**
 * The full inventory request set. Every entry is a leaf node: requesting an
 * interior node only returns the names of its children, not their values.
 */
export const WINDOWS_INVENTORY_REQUESTS: ReadonlyArray<WindowsInventoryRequest> = [
  request("os-version", WINDOWS_INVENTORY_URI.osVersion),
  request("device-type", WINDOWS_INVENTORY_URI.deviceType),
  request("device-name", WINDOWS_INVENTORY_URI.deviceName),
  request("serial", WINDOWS_INVENTORY_URI.serial),
  request("os-platform", WINDOWS_INVENTORY_URI.osPlatform),
  request("system-sku", WINDOWS_INVENTORY_URI.systemSKU),
  request("total-storage", WINDOWS_INVENTORY_URI.totalStorage),
  request("free-storage", WINDOWS_INVENTORY_URI.freeStorage),
  request("model", WINDOWS_INVENTORY_URI.model),
];

/** `CmdRef` -> OMA-URI, for devices that omit `Item/Source` in a result. */
const REQUESTED_URI_BY_COMMAND_ID = new Map(
  WINDOWS_INVENTORY_REQUESTS.map((entry) => [entry.cmdID, entry.locURI]),
);

const MAX_TEXT_LENGTH = 255;
const MEBIBYTE = 1024 * 1024;

/**
 * Serial numbers that hardware vendors use as placeholders. Storing one would
 * collide with every other device from the same vendor (the device table has a
 * per-tenant unique serial index) and hide the real value.
 */
const PLACEHOLDER_SERIALS = new Set([
  "0",
  "default string",
  "none",
  "not applicable",
  "not specified",
  "oem",
  "serial number",
  "system serial number",
  "to be filled by o.e.m.",
  "to be filled by oem",
  "unknown",
]);

const ResultsItem = Schema.Struct({
  source: Schema.optional(
    Schema.Struct({ locURI: Schema.optional(Schema.Json) }).pipe(
      Schema.annotate({ identifier: "ResultSource" }),
    ),
  ),
  target: Schema.optional(
    Schema.Struct({ locURI: Schema.optional(Schema.Json) }).pipe(
      Schema.annotate({ identifier: "ResultTarget" }),
    ),
  ),
  data: Schema.optional(Schema.Json),
});

const ResultsEntry = Schema.Struct({
  cmdRef: Schema.optional(Schema.Json),
  items: Schema.optional(Schema.Array(ResultsItem)),
});

const textValue = (value: Schema.Json | undefined): string | undefined => {
  if (Schema.is(Schema.String)(value)) {
    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return String(value);

  return undefined;
};

const locURI = (value: Schema.Json | undefined): string | undefined => {
  const parsed = Schema.decodeUnknownOption(
    Schema.Struct({ locURI: Schema.optional(Schema.Json) }),
  )(value);

  return Option.isSome(parsed) ? textValue(parsed.value.locURI) : undefined;
};

/**
 * Flatten the device's `<Results>` blocks into an OMA-URI -> value map.
 *
 * A result item normally carries `Source/LocURI`; when it does not, the server
 * `CmdRef` identifies which inventory `Get` produced it because those command
 * ids are deterministic. Unknown entries are ignored rather than failing the
 * check-in, so one malformed item cannot drop the rest of the report.
 */
export const windowsInventoryValues = (
  results: ReadonlyArray<unknown> | undefined,
): ReadonlyMap<string, string> => {
  const values = new Map<string, string>();

  for (const entry of results ?? []) {
    const parsed = Schema.decodeUnknownOption(ResultsEntry)(entry);

    if (Option.isNone(parsed)) continue;
    const commandId = textValue(parsed.value.cmdRef);
    const fallbackURI = commandId ? REQUESTED_URI_BY_COMMAND_ID.get(commandId) : undefined;

    for (const item of parsed.value.items ?? []) {
      const uri = locURI(item.source) ?? locURI(item.target) ?? fallbackURI;
      const data = textValue(item.data);

      if (!uri || !data) continue;
      values.set(uri, data);
    }
  }

  return values;
};

export type WindowsInventory = {
  readonly name?: string;
  readonly model?: string;
  readonly modelIdentifier?: string;
  readonly serial?: string;
  readonly osEdition?: string;
  readonly osVersion?: string;
  readonly osBuild?: string;
  readonly diskTotal?: string;
  readonly diskUsed?: string;
};

/** Mutable subset used for the `device` column patch. */
export type WindowsInventoryPatch = {
  -readonly [K in keyof WindowsInventory]?: WindowsInventory[K];
};

const clamp = (value: string): string =>
  value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;

const isPlaceholderSerial = (value: string): boolean =>
  PLACEHOLDER_SERIALS.has(value.trim().toLowerCase());

const byteCount = (value: string | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/**
 * `SwV` is `MajorVersion.MinorVersion.BuildNumber.QFEnumber`. Keep the product
 * version (`10.0.19045`) separate from the build plus update revision
 * (`19045.3803`) so filters can compare versions without the QFE suffix.
 */
export const parseWindowsOsVersion = (
  value: string | undefined,
): { readonly version: string; readonly build?: string } | undefined => {
  if (!value) return undefined;
  const parts = value.trim().split(".");

  if (parts.length < 3 || !parts.every((part) => /^\d+$/.test(part))) return { version: value };

  return {
    version: parts.slice(0, 3).join("."),
    build: parts.slice(2).join("."),
  };
};

/** Merge the reported OMA-URI values into a normalised inventory fragment. */
export const parseWindowsInventory = (
  values: ReadonlyMap<string, string>,
): WindowsInventory => {
  const at = (uri: string) => values.get(uri);

  const inventory: {
    -readonly [K in keyof WindowsInventory]: WindowsInventory[K];
  } = {};

  const name = at(WINDOWS_INVENTORY_URI.deviceName);
  const model = at(WINDOWS_INVENTORY_URI.model) ?? at(WINDOWS_INVENTORY_URI.deviceType);
  const modelIdentifier = at(WINDOWS_INVENTORY_URI.systemSKU);
  const serial = at(WINDOWS_INVENTORY_URI.serial);
  const osEdition = at(WINDOWS_INVENTORY_URI.osPlatform);
  const osVersion = parseWindowsOsVersion(at(WINDOWS_INVENTORY_URI.osVersion));

  if (name) inventory.name = clamp(name);

  if (model) inventory.model = clamp(model);

  if (modelIdentifier) inventory.modelIdentifier = clamp(modelIdentifier);

  if (serial && !isPlaceholderSerial(serial)) inventory.serial = clamp(serial);

  if (osEdition) inventory.osEdition = clamp(osEdition);

  if (osVersion?.version) inventory.osVersion = clamp(osVersion.version);

  if (osVersion?.build) inventory.osBuild = clamp(osVersion.build);

  // Both figures are reported in MB. When they disagree (free > total) the
  // report is internally inconsistent: store neither so health does not pair a
  // new total with a stale used value. A reported total of zero is treated as
  // unavailable (desktop Windows only reports TotalStorage on mobile devices).
  const total = byteCount(at(WINDOWS_INVENTORY_URI.totalStorage));
  const free = byteCount(at(WINDOWS_INVENTORY_URI.freeStorage));

  if (total !== undefined && total > 0 && free !== undefined && free > total) return inventory;

  if (total !== undefined && total > 0) inventory.diskTotal = String(total * MEBIBYTE);

  if (total !== undefined && total > 0 && free !== undefined)
    inventory.diskUsed = String((total - free) * MEBIBYTE);

  return inventory;
};

/** True when at least one column can be written from the parsed report. */
export const hasWindowsInventory = (inventory: WindowsInventory): boolean =>
  inventory.name !== undefined ||
  inventory.model !== undefined ||
  inventory.modelIdentifier !== undefined ||
  inventory.serial !== undefined ||
  inventory.osEdition !== undefined ||
  inventory.osVersion !== undefined ||
  inventory.osBuild !== undefined ||
  inventory.diskTotal !== undefined ||
  inventory.diskUsed !== undefined;

/**
 * Cadence guard: request a snapshot when the last successful report and the
 * last request are both older than the refresh interval. The request clock is
 * persisted separately from `inventoryUpdatedAt` so a device that never
 * answers cannot make every check-in enqueue the same nine `Get` commands.
 */
export const windowsInventoryDue = (input: {
  readonly lastUpdatedAt?: Date | string | null;
  readonly lastRequestedAt?: Date | string | null;
  readonly now: Date;
  readonly refreshMs?: number;
}): boolean => {
  const refreshMs = input.refreshMs ?? WINDOWS_INVENTORY_REFRESH_MS;

  const elapsed = (value: Date | string | null | undefined): number | null => {
    if (!value) return null;
    const parsed = Schema.is(Schema.instanceOf(Date))(value) ? value : new Date(value);

    return Number.isFinite(parsed.getTime()) ? input.now.getTime() - parsed.getTime() : null;
  };

  const updated = elapsed(input.lastUpdatedAt);
  const requested = elapsed(input.lastRequestedAt);

  if (updated !== null && updated < refreshMs) return false;

  return requested === null || requested >= refreshMs;
};

/**
 * Name is the one inventory field administrators also edit. Only fill it when
 * the row still has no name or is still showing the Windows DeviceID that
 * enrollment used as a placeholder; never replace an operator-chosen name.
 */
export const shouldApplyInventoryName = (device: {
  readonly name?: string | null;
  readonly dmIdentifier?: string | null;
}): boolean => {
  const current = device.name?.trim() ?? "";

  if (!current) return true;

  return Boolean(device.dmIdentifier) && current === device.dmIdentifier?.trim();
};

/**
 * Build the `device` column patch for a parsed snapshot. Serial uniqueness is
 * checked by the caller, which has database access.
 */
export const windowsInventoryUpdate = (
  inventory: WindowsInventory,
  device: { readonly name?: string | null; readonly dmIdentifier?: string | null },
): WindowsInventoryPatch => {
  const update: WindowsInventoryPatch = {};

  if (inventory.name && shouldApplyInventoryName(device)) update.name = inventory.name;

  if (inventory.model) update.model = inventory.model;

  if (inventory.modelIdentifier) update.modelIdentifier = inventory.modelIdentifier;

  if (inventory.serial) update.serial = inventory.serial;

  if (inventory.osEdition) update.osEdition = inventory.osEdition;

  if (inventory.osVersion) update.osVersion = inventory.osVersion;

  if (inventory.osBuild) update.osBuild = inventory.osBuild;

  if (inventory.diskTotal) update.diskTotal = inventory.diskTotal;

  if (inventory.diskUsed) update.diskUsed = inventory.diskUsed;

  return update;
};
