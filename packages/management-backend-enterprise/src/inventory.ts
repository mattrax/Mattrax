/**
 * DDM status-item ingestion.
 *
 * Apple reports subscribed status items as a nested path tree, but some clients
 * (and older protocol shims) flatten the keys into a single object. Both shapes
 * are accepted here so a reporting change never silently drops inventory.
 *
 * Pure functions only: `updateInventoryFromStatus` owns persistence.
 */

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
  readonly capabilities?: unknown;
  readonly diskTotal?: string;
  readonly diskUsed?: string;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Resolve a dotted path, falling back to a flattened key on the root object. */
export const statusItemValue = (statusItems: unknown, path: string): unknown => {
  const root = record(statusItems);

  if (!root) return undefined;
  let current: unknown = root;

  for (const part of path.split(".")) {
    current = record(current)?.[part];

    if (current === undefined) break;
  }

  if (current !== undefined) return current;

  return root[path];
};

const text = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed === "" ? undefined : trimmed;
  }

  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const nested = record(value);

  if (nested) {
    for (const key of ["value", "Value", "text", "string"]) {
      const candidate = text(nested[key]);

      if (candidate !== undefined) return candidate;
    }
  }

  return undefined;
};

const BOOLEAN_TRUE = new Set(["enabled", "true", "yes", "on", "1"]);
const BOOLEAN_FALSE = new Set(["disabled", "false", "no", "off", "0"]);

/** Normalise `Enabled` / `Disabled` / booleans / `{ enabled }` wrappers. */
export const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (value === 1) return true;

    if (value === 0) return false;

    return undefined;
  }

  if (typeof value === "string") {
    const text = value.trim().toLowerCase();

    if (BOOLEAN_TRUE.has(text)) return true;

    if (BOOLEAN_FALSE.has(text)) return false;

    return undefined;
  }

  const nested = record(value);

  if (nested) {
    for (const key of ["enabled", "Enabled", "value", "Value", "state", "status"]) {
      if (!(key in nested)) continue;
      const parsed = normalizeBoolean(nested[key]);

      if (parsed !== undefined) return parsed;
    }
  }

  return undefined;
};

const BATTERY_LABELS: Record<string, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  unknown: "Unknown",
  "service recommended": "Service Recommended",
  "service battery": "Service Battery",
  "replace soon": "Replace Soon",
  "replace now": "Replace Now",
};

/** Canonicalise the battery condition strings macOS reports. */
export const normalizeBatteryHealth = (value: unknown): string | undefined => {
  const raw = text(value);

  if (!raw) return undefined;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const canonical = BATTERY_LABELS[collapsed.toLowerCase()];

  if (canonical) return canonical;

  // Preserve an unknown vendor value but keep it tidy and capitalised.
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
};

const capabilityLabel = (entry: unknown): string | undefined => {
  if (typeof entry === "string") return text(entry);
  const nested = record(entry);

  if (!nested) return text(entry);

  for (const key of ["capability", "name", "identifier", "code", "id"]) {
    const label = text(nested[key]);

    if (label) return label;
  }

  return undefined;
};

/**
 * Capabilities arrive as an array of strings, an array of dictionaries, a
 * comma-separated string, or (some clients) a `{ capabilities: [...] }`
 * envelope. Arrays of dictionaries become a de-duplicated label list; an
 * unrecognised shape is preserved verbatim so nothing is lost.
 */
export const normalizeCapabilities = (value: unknown): unknown => {
  if (value == null) return undefined;

  if (typeof value === "string") {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    return parts.length > 0 ? [...new Set(parts)] : undefined;
  }

  if (Array.isArray(value)) {
    const labels = value
      .map(capabilityLabel)
      .filter((label): label is string => label !== undefined);

    if (labels.length === value.length) return [...new Set(labels)];

    return value;
  }

  const nested = record(value);

  if (nested) {
    for (const key of ["capabilities", "items", "values"]) {
      if (key in nested) {
        const parsed = normalizeCapabilities(nested[key]);

        if (parsed !== undefined) return parsed;
      }
    }

    return nested;
  }

  return undefined;
};

const byteCount = (value: unknown): number | undefined => {
  const raw = text(value);

  if (!raw) return undefined;

  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Merge the status items into a normalised inventory fragment. */
export const parseDeviceInventory = (statusItems: unknown): DeviceInventory => {
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
