import { Schema } from "effect";
import {
  DEVICE_COMMAND_ACTIVE_STATUSES,
  normalizeDeviceCommandStatus,
  type DeviceCommandStatus,
} from "@mattrax/enterprise-domain";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const BUDGETS = new Map<string, number>([
  // Interactive actions: the administrator is watching the device now.
  ["DeviceLock", 15 * MINUTE],
  ["ClearPasscode", 15 * MINUTE],
  ["AndroidLock", 15 * MINUTE],
  ["RestartDevice", 30 * MINUTE],
  ["ShutdownDevice", 30 * MINUTE],
  ["WindowsReboot", 30 * MINUTE],
  ["AndroidReboot", 30 * MINUTE],
  // Queries: harmless whenever they land, but still bounded.
  ["SecurityInfo", 24 * HOUR],
  ["DeviceInformation", 24 * HOUR],
  ["ActivationLockBypassCode", 24 * HOUR],
  // Legacy policy profiles and FileVault key maintenance.
  ["InstallProfile", 7 * DAY],
  ["RemoveProfile", 7 * DAY],
  ["RotateFileVaultKey", 24 * HOUR],
  ["SetRecoveryLock", 30 * MINUTE],
  ["Settings", 30 * MINUTE],
  ["VerifyRecoveryLock", HOUR],
  // Installs: an app download is allowed a day to complete.
  ["InstallApplication", 24 * HOUR],
  ["InstallEnterpriseApplication", 24 * HOUR],
  ["InstalledApplicationList", 7 * DAY],
  // Destructive actions: a week is long enough for a travelling laptop.
  ["EraseDevice", 7 * DAY],
  ["WindowsWipe", 7 * DAY],
  ["AndroidWipe", 7 * DAY],
]);

/**
 * Delivery budget per request type, measured from when the command is queued.
 * Imperative commands are only meaningful for a short window: a lock queued
 * three weeks ago must not fire the moment the laptop is opened at an airport,
 * while an inventory refresh can wait for a device that roams.
 *
 * Request types without a budget never expire, so a protocol command added by
 * a future platform is not silently dropped.
 */
export const deviceCommandBudget = (requestType: string): number | undefined =>
  BUDGETS.get(requestType);

/** Retry delay for a command the device deferred with `NotNow`. */
export const DEVICE_COMMAND_DEFERRED_RETRY_MS = 10 * MINUTE;

/**
 * Retry delay for a command handed to the device that it never acknowledged.
 * Re-sending the same command UUID is idempotent, so this only stops a lost
 * check-in from dropping an action silently.
 */
export const DEVICE_COMMAND_SENT_RETRY_MS = 30 * MINUTE;

/**
 * How long after delivery a fresh application inventory is trusted as evidence
 * that an `InstallApplication` failed. An App Store download can take minutes
 * on a slow link, and a status subscription can push an inventory while the
 * install is still running; a short window would mark it failed and re-queue a
 * duplicate. Two hours is longer than a normal download but still well inside
 * the 24 hour install budget.
 */
export const DEVICE_COMMAND_INSTALL_SETTLE_MS = 2 * HOUR;

/** Active commands loaded per device when planning delivery. */
export const DEVICE_COMMAND_ACTIVE_LIMIT = 100;

export const ACTIVE_COMMAND_STATUSES = DEVICE_COMMAND_ACTIVE_STATUSES;

export const commandStatusIsActive = (status: string | null | undefined): boolean => {
  const normalized = normalizeDeviceCommandStatus(status);

  return normalized === "queued" || normalized === "sent" || normalized === "deferred";
};

/** Result status recorded when the server, not the device, resolved a command. */
export const RECONCILED_RESULT_STATUS = "Reconciled";

/** Delivery deadline for a command queued at `queuedAt`; null means never. */
export const deviceCommandExpiresAt = (requestType: string, queuedAt: Date): Date | null => {
  const budget = deviceCommandBudget(requestType);

  return budget === undefined ? null : new Date(queuedAt.getTime() + budget);
};

/** A stored command payload (a JSON column value) or `null` for legacy rows. */
export type CommandPayload = Schema.Json | null;

type JsonObject = { readonly [key: string]: Schema.Json };

export function isJsonObject(value: Schema.Json | null | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deterministic JSON with sorted object keys, so the same payload always
 * produces the same de-duplication key regardless of construction order.
 */
export const canonicalCommandPayload = (payload: Schema.Json | null | undefined): string => {
  if (payload === null || payload === undefined) return "null";

  if (Array.isArray(payload)) return `[${payload.map(canonicalCommandPayload).join(",")}]`;

  if (isJsonObject(payload)) {
    const entries = Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonicalCommandPayload(value)}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(payload);
};

/** Stable string hashed into `device_command.dedupe_key`. */
export const commandDedupeSource = (requestType: string, payload: CommandPayload | undefined) =>
  `${requestType}\u0000${canonicalCommandPayload(payload)}`;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Key that identifies identical work for one device while a command is active.
 * Stored on the row so a unique index makes double-clicks safe across
 * concurrent requests.
 */
export const commandDedupeKey = async (
  requestType: string,
  payload: CommandPayload | undefined,
) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(commandDedupeSource(requestType, payload)),
  );

  return hex(new Uint8Array(digest));
};

/** The lifecycle columns every command decision needs. */
export type CommandLifecycleRow = {
  readonly id: string;
  readonly requestType: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt?: Date | null;
};

export type CommandRow = CommandLifecycleRow & {
  readonly payload?: CommandPayload;
};

/** Deadline for a row, deriving one from the budget for legacy rows. */
export const commandDeadline = (
  row: Pick<CommandLifecycleRow, "requestType" | "createdAt" | "expiresAt">,
) => row.expiresAt ?? deviceCommandExpiresAt(row.requestType, row.createdAt);

export const commandIsExpired = (row: CommandLifecycleRow, now: Date) => {
  const deadline = commandDeadline(row);

  return deadline != null && deadline.getTime() <= now.getTime();
};

/**
 * New deadline for a duplicate command that is still active. Clicking the same
 * action again is a fresh intent, so it buys the command a new delivery window
 * instead of leaving it a minute from expiry. A command type without a budget
 * never expires, so it needs no extension (`null` means "leave the row").
 */
export const extendedCommandDeadline = (
  row: Pick<CommandLifecycleRow, "requestType" | "createdAt" | "expiresAt">,
  requestType: string,
  now: Date,
): Date | null => {
  const budgetDeadline = deviceCommandExpiresAt(requestType, now);

  if (budgetDeadline === null) return null;
  const current = commandDeadline(row);

  if (current !== null && current.getTime() >= budgetDeadline.getTime()) return null;

  return budgetDeadline;
};

export const COMMAND_EXPIRED_DETAIL = "The delivery deadline passed before the device ran it.";

export type CommandDeliveryPlan = {
  /** Commands whose budget elapsed; they must never be delivered. */
  readonly expire: ReadonlyArray<string>;
  /** Commands that should be re-queued for another delivery attempt. */
  readonly requeue: ReadonlyArray<string>;
  /** The command to hand to the device now, if any. */
  readonly deliver: CommandRow | null;
};

export type CommandDeliveryBatch = {
  readonly expire: ReadonlyArray<string>;
  readonly requeue: ReadonlyArray<string>;
  /** Every deliverable command, oldest first. */
  readonly deliver: ReadonlyArray<CommandRow>;
};

/**
 * Delivery plan for a protocol that can carry more than one command in a
 * single check-in (Windows SyncML). The rules match `planCommandDelivery`:
 * expired work never leaves the server, deferred/unacknowledged work is
 * retried only inside its budget, and everything else is delivered oldest
 * first.
 */
export const planCommandDeliveryBatch = (
  rows: ReadonlyArray<CommandLifecycleRow>,
  now: Date,
): CommandDeliveryBatch => {
  const expire: string[] = [];
  const requeue: string[] = [];
  const deliver: CommandRow[] = [];

  const ordered = [...rows].sort((left, right) => {
    const delta = left.createdAt.getTime() - right.createdAt.getTime();

    return delta !== 0 ? delta : left.id.localeCompare(right.id);
  });

  for (const row of ordered) {
    if (!commandStatusIsActive(row.status)) continue;

    if (commandIsExpired(row, now)) {
      expire.push(row.id);
      continue;
    }

    const status = normalizeDeviceCommandStatus(row.status);

    if (status === "queued") {
      deliver.push(row);
      continue;
    }

    const retryAfter =
      status === "deferred" ? DEVICE_COMMAND_DEFERRED_RETRY_MS : DEVICE_COMMAND_SENT_RETRY_MS;

    if (now.getTime() - row.updatedAt.getTime() >= retryAfter) {
      requeue.push(row.id);
      deliver.push(row);
    }
  }

  return { expire, requeue, deliver };
};

/**
 * Decide what the check-in loop does with a device's active commands.
 *
 * The oldest deliverable command wins. Commands that the device deferred, or
 * that were sent but never acknowledged, are re-queued only inside their
 * budget, so a device that comes back weeks later is not handed stale work.
 */
export const planCommandDelivery = (
  rows: ReadonlyArray<CommandLifecycleRow>,
  now: Date,
): CommandDeliveryPlan => {
  const batch = planCommandDeliveryBatch(rows, now);

  return {
    expire: batch.expire,
    requeue: batch.requeue,
    deliver: batch.deliver[0] ?? null,
  };
};

/**
 * Request types that are mutually exclusive for a device: queueing a newer one
 * makes every other active command of the same type obsolete (a second lock
 * replaces the first PIN).
 */
const SINGLETON_REQUEST_TYPES: ReadonlySet<string> = new Set([
  "DeviceLock",
  "ClearPasscode",
  "RestartDevice",
  "ShutdownDevice",
  "WindowsReboot",
  "AndroidLock",
  "AndroidReboot",
  "SecurityInfo",
  "ActivationLockBypassCode",
  "InstalledApplicationList",
  "DeviceInformation",
]);

/**
 * Active commands made pointless by `requestType`. A pending wipe erases the
 * device, so every other queued action is moot; a wipe queued after a lock must
 * not let the lock fire on the way out. The wipe replaces a pending wipe too,
 * so repeated clicks leave exactly one erase with one PIN.
 */
export const supersededRequestTypes = (requestType: string): ReadonlyArray<string> => {
  if (
    requestType === "EraseDevice" ||
    requestType === "WindowsWipe" ||
    requestType === "AndroidWipe"
  )
    return [
      "DeviceLock",
      "ClearPasscode",
      "RestartDevice",
      "ShutdownDevice",
      "WindowsReboot",
      "AndroidLock",
      "AndroidReboot",
      "SecurityInfo",
      "ActivationLockBypassCode",
      "InstalledApplicationList",
      "DeviceInformation",
      "InstallApplication",
      "InstallEnterpriseApplication",
      "InstallProfile",
      "RemoveProfile",
      "RotateFileVaultKey",
      "SetRecoveryLock",
      "VerifyRecoveryLock",
      "EraseDevice",
      "WindowsWipe",
      "AndroidWipe",
    ];

  return SINGLETON_REQUEST_TYPES.has(requestType) ? [requestType] : [];
};

export type CommandQueuePlan = {
  /** Identical work that is already queued or in flight. */
  readonly duplicate: CommandRow | null;
  /** Active commands this request makes obsolete. */
  readonly supersedeIds: ReadonlyArray<string>;
};

/**
 * De-duplicate and supersede before inserting a command. Identical work is
 * returned instead of queued twice; a wipe (or a newer singleton command)
 * cancels the work it makes pointless.
 */
export const planCommandQueueing = (
  rows: ReadonlyArray<CommandRow>,
  input: { readonly requestType: string; readonly payload?: CommandPayload; readonly now: Date },
): CommandQueuePlan => {
  const active = rows
    .filter((row) => commandStatusIsActive(row.status) && !commandIsExpired(row, input.now))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  const source = commandDedupeSource(input.requestType, input.payload);

  const duplicate =
    active.find((row) => commandDedupeSource(row.requestType, row.payload) === source) ?? null;

  if (duplicate) return { duplicate, supersedeIds: [] };

  const superseded = supersededRequestTypes(input.requestType);

  return {
    duplicate: null,
    supersedeIds: active.filter((row) => superseded.includes(row.requestType)).map((row) => row.id),
  };
};

export type ReconcilableCommand = CommandLifecycleRow & {
  /** Bundle identifiers targeted by an `InstallApplication` payload. */
  readonly targetBundleIds?: ReadonlyArray<string>;
};

export type ReportedDeviceState = {
  readonly status: "enrolling" | "enrolled" | "unenrolling" | "unenrolled";
  /** When the device last reported its full installed-application inventory. */
  readonly applicationsUpdatedAt: Date | null;
  /** Bundle identifiers in that inventory. */
  readonly installedBundleIds: ReadonlySet<string>;
};

export type ReconciledCommand = {
  readonly id: string;
  readonly status: Extract<DeviceCommandStatus, "succeeded" | "failed" | "expired" | "cancelled">;
  readonly resultStatus: string;
  readonly resultDetail: string;
};

/**
 * Reconcile active commands against what the device reports.
 *
 * A command that the device has already satisfied, or that can never run,
 * must not stay `sent` forever. The rules are deterministic and ordered:
 *
 * 1. A device that left management can never run a command -> `cancelled`.
 * 2. A command past its deadline -> `expired`.
 * 3. An application inventory reported after delivery proves whether an
 *    `InstallApplication` landed: present -> `succeeded`, absent after the
 *    settling window -> `failed`. The same evidence satisfies an
 *    `InstalledApplicationList` query.
 */
export const reconcileDeviceCommands = (
  rows: ReadonlyArray<ReconcilableCommand>,
  device: ReportedDeviceState,
  now: Date,
): ReadonlyArray<ReconciledCommand> => {
  const reconciled: ReconciledCommand[] = [];

  for (const row of rows) {
    if (!commandStatusIsActive(row.status)) continue;

    if (device.status === "unenrolled") {
      reconciled.push({
        id: row.id,
        status: "cancelled",
        resultStatus: RECONCILED_RESULT_STATUS,
        resultDetail: "The device is no longer enrolled, so the command was never delivered.",
      });
      continue;
    }

    if (commandIsExpired(row, now)) {
      reconciled.push({
        id: row.id,
        status: "expired",
        resultStatus: RECONCILED_RESULT_STATUS,
        resultDetail: COMMAND_EXPIRED_DETAIL,
      });
      continue;
    }

    const inventoryAt = device.applicationsUpdatedAt;

    if (!inventoryAt) continue;

    if (row.requestType === "InstalledApplicationList") {
      if (inventoryAt.getTime() > row.updatedAt.getTime())
        reconciled.push({
          id: row.id,
          status: "succeeded",
          resultStatus: RECONCILED_RESULT_STATUS,
          resultDetail: "The device reported a full application inventory after this request.",
        });
      continue;
    }

    if (
      row.requestType !== "InstallApplication" &&
      row.requestType !== "InstallEnterpriseApplication"
    )
      continue;

    // Only a command the device has seen can be judged against its inventory.
    if (normalizeDeviceCommandStatus(row.status) === "queued") continue;

    const bundles = row.targetBundleIds ?? [];

    if (bundles.length === 0) continue;

    if (bundles.some((bundleId) => device.installedBundleIds.has(bundleId))) {
      reconciled.push({
        id: row.id,
        status: "succeeded",
        resultStatus: RECONCILED_RESULT_STATUS,
        resultDetail: "The application is present in the inventory the device reported.",
      });
      continue;
    }

    const settledAt = row.updatedAt.getTime() + DEVICE_COMMAND_INSTALL_SETTLE_MS;

    if (inventoryAt.getTime() >= settledAt)
      reconciled.push({
        id: row.id,
        status: "failed",
        resultStatus: RECONCILED_RESULT_STATUS,
        resultDetail:
          "The application is absent from the inventory the device reported after the install.",
      });
  }

  return reconciled;
};

/**
 * Coordinates for re-queueing an install that is still assigned to the device
 * after reconciliation proved it missing. Bounded so a broken manifest cannot
 * loop forever.
 */
export const DEVICE_COMMAND_INSTALL_MAX_ATTEMPTS = 3;
export const DEVICE_COMMAND_INSTALL_ATTEMPT_WINDOW_MS = DAY;

export type InstallAttemptRow = Pick<CommandRow, "requestType" | "payload" | "createdAt">;

/** Whether another automatic install attempt is still inside the budget. */
export const shouldRetryInstall = (
  history: ReadonlyArray<InstallAttemptRow>,
  input: { readonly requestType: string; readonly payload: CommandPayload; readonly now: Date },
) => {
  const source = commandDedupeSource(input.requestType, input.payload);
  const windowStart = input.now.getTime() - DEVICE_COMMAND_INSTALL_ATTEMPT_WINDOW_MS;

  const attempts = history.filter(
    (row) =>
      row.createdAt.getTime() >= windowStart &&
      commandDedupeSource(row.requestType, row.payload) === source,
  ).length;

  return attempts < DEVICE_COMMAND_INSTALL_MAX_ATTEMPTS;
};

export type InstallApplicationTarget = {
  readonly manifestUrl: string | undefined;
  readonly storeId: string | undefined;
  /** Bundle identifier an inline enterprise manifest installs. */
  readonly bundleId: string | undefined;
  /** The signed package URL an inline enterprise manifest fetches. */
  readonly assetUrl: string | undefined;
};

const textOf = (value: Schema.Json | undefined) => {
  if (Schema.is(Schema.String)(value)) return value;

  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return String(value);

  return undefined;
};

type InlineManifestTarget = {
  readonly bundleId?: string;
  readonly assetUrl?: string;
};

const inlineManifestTarget = (payload: JsonObject): InlineManifestTarget => {
  const manifest = payload["Manifest"];

  if (!isJsonObject(manifest) || !Array.isArray(manifest["items"])) return {};

  const first = manifest["items"][0];

  if (!isJsonObject(first)) return {};

  const metadata = first["metadata"];
  const assets = first["assets"];
  const bundleId = isJsonObject(metadata) ? textOf(metadata["bundle-identifier"]) : undefined;

  const assetUrl = Array.isArray(assets)
    ? assets.flatMap((asset) => {
        if (!isJsonObject(asset)) return [];

        const kind = textOf(asset["kind"]);
        const url = textOf(asset["url"]);

        return kind === "software-package" && url ? [url] : [];
      })[0]
    : undefined;

  return { bundleId, assetUrl };
};

/**
 * Payload keys that identify the application an install command targets.
 * The payload is free-form JSON, so anything unexpected is treated as unknown.
 * Inline enterprise manifests carry the identity in the manifest rather than in
 * a top-level Apple key.
 */
export const installApplicationTarget = (
  payload: CommandPayload | undefined,
): InstallApplicationTarget => {
  if (!isJsonObject(payload))
    return { manifestUrl: undefined, storeId: undefined, bundleId: undefined, assetUrl: undefined };
  const manifest = inlineManifestTarget(payload);

  return {
    manifestUrl: textOf(payload["ManifestURL"]),
    storeId: textOf(payload["iTunesStoreID"]),
    bundleId: manifest.bundleId,
    assetUrl: manifest.assetUrl,
  };
};

/** Whether a command asks the device to install an application. */
export const isApplicationInstallRequest = (requestType: string): boolean =>
  requestType === "InstallApplication" || requestType === "InstallEnterpriseApplication";

/**
 * Whether another automatic attempt at installing `bundleId` is inside the
 * budget. Inline enterprise manifests carry a device-bound URL that changes
 * with the signing window, so matching on the de-duplication source would treat
 * every retry as a fresh application and loop forever; the bundle identity is
 * stable across those retries.
 */
export const shouldRetryInstallBundle = (
  history: ReadonlyArray<InstallAttemptRow>,
  input: { readonly bundleId: string; readonly now: Date },
): boolean => {
  const windowStart = input.now.getTime() - DEVICE_COMMAND_INSTALL_ATTEMPT_WINDOW_MS;

  const attempts = history.filter(
    (row) =>
      isApplicationInstallRequest(row.requestType) &&
      row.createdAt.getTime() >= windowStart &&
      installApplicationTarget(row.payload).bundleId === input.bundleId,
  ).length;

  return attempts < DEVICE_COMMAND_INSTALL_MAX_ATTEMPTS;
};
