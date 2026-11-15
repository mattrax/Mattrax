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
import { shouldApplyReportedName } from "@mattrax/enterprise-domain";
import type { DeviceApplicationRecord } from "@mattrax/enterprise-core";

/** How often a device is asked for a fresh inventory snapshot. */
export const WINDOWS_INVENTORY_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * How often a device is asked for a fresh installed-application snapshot.
 * App inventory returns one item per app, so it is much larger than the
 * DevDetail nodes and gets its own daily cadence.
 */
export const WINDOWS_APPLICATION_INVENTORY_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Stable command id prefix so a `Results` entry can be correlated by `CmdRef`. */
export const WINDOWS_INVENTORY_COMMAND_ID_PREFIX = "windows-inventory-";

export const WINDOWS_APPLICATION_INVENTORY_COMMAND_ID_PREFIX = "windows-app-inventory-";

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

/** Installed-application inventory OMA-URIs. */
export const WINDOWS_APPLICATION_INVENTORY_URI = {
  /**
   * `Win32AppInventory` enumerates every Win32/MSI program in Add/Remove
   * Programs. `?list=StructData` returns one `Results` item per leaf node, so
   * the whole inventory arrives in a single `Get`.
   */
  win32: "./Vendor/MSFT/Win32AppInventory/Win32InstalledProgram/InstalledProgram?list=StructData",
  /** Applications deployed through `EnterpriseDesktopAppManagement` (MSI). */
  msi: "./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI?list=StructData",
} as const;

/** The application inventory request set, emitted on its own daily cadence. */
export const WINDOWS_APPLICATION_INVENTORY_REQUESTS: ReadonlyArray<WindowsInventoryRequest> = [
  {
    cmdID: `${WINDOWS_APPLICATION_INVENTORY_COMMAND_ID_PREFIX}win32`,
    locURI: WINDOWS_APPLICATION_INVENTORY_URI.win32,
  },
  {
    cmdID: `${WINDOWS_APPLICATION_INVENTORY_COMMAND_ID_PREFIX}msi`,
    locURI: WINDOWS_APPLICATION_INVENTORY_URI.msi,
  },
];

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
  [...WINDOWS_INVENTORY_REQUESTS, ...WINDOWS_APPLICATION_INVENTORY_REQUESTS].map((entry) => [
    entry.cmdID,
    entry.locURI,
  ]),
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
} & { physicalName?: string };

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
export const parseWindowsInventory = (values: ReadonlyMap<string, string>): WindowsInventory => {
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
 * answers cannot make every check-in enqueue the same `Get` commands.
 */
const inventoryDue = (input: {
  readonly lastUpdatedAt?: Date | string | null;
  readonly lastRequestedAt?: Date | string | null;
  readonly now: Date;
  readonly refreshMs: number;
}): boolean => {
  const elapsed = (value: Date | string | null | undefined): number | null => {
    if (!value) return null;
    const parsed = Schema.is(Schema.instanceOf(Date))(value) ? value : new Date(value);

    return Number.isFinite(parsed.getTime()) ? input.now.getTime() - parsed.getTime() : null;
  };

  const updated = elapsed(input.lastUpdatedAt);
  const requested = elapsed(input.lastRequestedAt);

  if (updated !== null && updated < input.refreshMs) return false;

  return requested === null || requested >= input.refreshMs;
};

export const windowsInventoryDue = (input: {
  readonly lastUpdatedAt?: Date | string | null;
  readonly lastRequestedAt?: Date | string | null;
  readonly now: Date;
  readonly refreshMs?: number;
}): boolean =>
  inventoryDue({
    lastUpdatedAt: input.lastUpdatedAt,
    lastRequestedAt: input.lastRequestedAt,
    now: input.now,
    refreshMs: input.refreshMs ?? WINDOWS_INVENTORY_REFRESH_MS,
  });

/** Daily cadence guard for the (much larger) installed-application inventory. */
export const windowsApplicationInventoryDue = (input: {
  readonly lastUpdatedAt?: Date | string | null;
  readonly lastRequestedAt?: Date | string | null;
  readonly now: Date;
  readonly refreshMs?: number;
}): boolean =>
  inventoryDue({
    lastUpdatedAt: input.lastUpdatedAt,
    lastRequestedAt: input.lastRequestedAt,
    now: input.now,
    refreshMs: input.refreshMs ?? WINDOWS_APPLICATION_INVENTORY_REFRESH_MS,
  });

/**
 * Name is the one inventory field administrators also edit. The reported value
 * is always stored as the device's physical name; the management name only
 * follows it while the stored name is still empty or an auto-derived
 * placeholder, so an operator's rename always wins.
 */
export const windowsInventoryUpdate = (
  inventory: WindowsInventory,
  device: {
    readonly name?: string | null;
    readonly dmIdentifier?: string | null;
    readonly serial?: string | null;
    readonly model?: string | null;
    readonly physicalName?: string | null;
  },
): WindowsInventoryPatch => {
  const update: WindowsInventoryPatch = {};

  if (inventory.name) {
    update.physicalName = inventory.name;

    if (
      shouldApplyReportedName({
        currentName: device.name,
        reportedName: inventory.name,
        placeholders: [
          device.dmIdentifier,
          device.serial,
          device.model,
          device.physicalName,
          inventory.model,
          inventory.serial,
        ],
      })
    )
      update.name = inventory.name;
  }

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

// ---------------------------------------------------------------------------
// Installed-application inventory
// ---------------------------------------------------------------------------

/** `Win32InstalledProgram/InstalledProgram/{key}/{field}`. */
const WIN32_APP_PREFIX = "Vendor/MSFT/Win32AppInventory/Win32InstalledProgram/InstalledProgram/";

/** `EnterpriseDesktopAppManagement/MSI/{ProductID}/{field}`. */
const MSI_APP_PREFIX = "Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/";

/**
 * Normalise an OMA-URI for prefix matching. Windows echoes the requested URI,
 * which may be absolute (`./Vendor/...`) or omit the leading `./`; the
 * StructData response adds the child node's path.
 */
const normalizeUri = (uri: string): string => uri.trim().replace(/^\.?\//, "");

/** Percent-decoded path segment; a malformed escape is kept verbatim. */
const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const childPath = (
  uri: string,
  prefix: string,
): { readonly key: string; readonly field: string } | undefined => {
  const normalized = normalizeUri(uri);

  if (!normalized.startsWith(prefix)) return undefined;
  // Dynamic node names are app names, so they may be percent-encoded.
  const parts = normalized.slice(prefix.length).split("/").filter(Boolean).map(decodeSegment);

  if (parts.length < 2) return undefined;

  return { key: parts.slice(0, -1).join("/"), field: parts.at(-1)! };
};

const queryless = (uri: string) => uri.split("?")[0]!;

/**
 * Parse the installed-application inventory from a device's `<Results>`.
 *
 * `Win32AppInventory` covers Add/Remove Programs, including MSI products with
 * their `MsiProductCode`; `EnterpriseDesktopAppManagement` covers the MSI
 * packages this server deployed, which is what makes an app "managed". The two
 * are merged on the MSI product code when both report the same product.
 *
 * `undefined` means the device did not answer an application `Get` (for example
 * a Windows build without the Win32AppInventory CSP); an empty array means it
 * answered and reported no applications.
 */
export const parseWindowsApplications = (
  values: ReadonlyMap<string, string>,
): DeviceApplicationRecord[] | undefined => {
  const win32 = new Map<string, Record<string, string>>();
  const msi = new Map<string, Record<string, string>>();
  let reported = false;

  for (const [uri, value] of values) {
    const bare = queryless(uri);
    const win32Entry = childPath(bare, WIN32_APP_PREFIX);

    if (win32Entry) {
      reported = true;
      const fields = win32.get(win32Entry.key) ?? {};
      fields[win32Entry.field] = value;
      win32.set(win32Entry.key, fields);
      continue;
    }

    const msiEntry = childPath(bare, MSI_APP_PREFIX);

    if (msiEntry && !msiEntry.key.startsWith("UpgradeCode/")) {
      reported = true;
      const fields = msi.get(msiEntry.key) ?? {};
      fields[msiEntry.field] = value;
      msi.set(msiEntry.key, fields);
    }
  }

  if (!reported) return undefined;

  const applications = new Map<string, DeviceApplicationRecord>();

  const text = (value: string | undefined) => {
    const trimmed = value?.trim();

    return trimmed ? clamp(trimmed) : undefined;
  };

  for (const [key, fields] of win32) {
    const bundleId = text(fields["MsiProductCode"]) ?? text(fields["RegKey"]) ?? text(key);

    if (!bundleId) continue;
    applications.set(bundleId, {
      bundleId,
      name: text(fields["Name"]),
      version: text(fields["Version"]),
      publisher: text(fields["Publisher"]),
    });
  }

  // MSI entries describe packages this server deployed, so they are managed
  // even when Win32AppInventory reports the same product code. A package whose
  // enforcement failed is not installed and must not appear as one.
  for (const [productId, fields] of msi) {
    const status = fields["Status"]?.trim();

    if (status && status !== "70") continue;
    const bundleId = text(fields["MsiProductCode"]) ?? text(productId);

    if (!bundleId) continue;
    const previous = applications.get(bundleId);
    applications.set(bundleId, {
      bundleId,
      name: text(fields["Name"]) ?? previous?.name,
      version: text(fields["Version"]) ?? previous?.version,
      publisher: text(fields["Publisher"]) ?? previous?.publisher,
      isManaged: true,
    });
  }

  return [...applications.values()];
};
