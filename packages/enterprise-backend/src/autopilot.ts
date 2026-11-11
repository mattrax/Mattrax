import { Data, Effect } from "effect";
import { and, asc, eq } from "drizzle-orm";
import type {
  AutopilotDeploymentProfileInput,
  AzureGraphService,
  GraphAutopilotDevice,
} from "@mattrax/azure-graph";
import { schema, type EnterpriseDb } from "./schema.ts";

/** Upper bound for a single hardware-hash import request. */
export const AUTOPILOT_IMPORT_MAX_ROWS = 500;
/** Upper bound for the raw CSV/text body accepted by the API. */
export const AUTOPILOT_IMPORT_MAX_BYTES = 1_000_000;

export type AutopilotFailureReason = "not_configured" | "invalid" | "graph" | "database";

export class AutopilotError extends Data.TaggedError("AutopilotError")<{
  readonly reason: AutopilotFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const fail = (reason: AutopilotFailureReason, message: string, cause?: unknown) =>
  new AutopilotError({ reason, message, ...(cause !== undefined ? { cause } : {}) });

export type AutopilotImportRow = {
  readonly serial: string;
  readonly hardwareHash: string;
  readonly groupTag?: string;
};

export type AutopilotCsvParseResult = {
  readonly rows: ReadonlyArray<AutopilotImportRow>;
  /** Human-readable row errors, capped by the caller for display. */
  readonly errors: ReadonlyArray<string>;
  /** Duplicate serials and rows beyond the cap. */
  readonly skipped: number;
  /** True when more valid rows existed than `maxRows`. */
  readonly truncated: boolean;
};

export const normalizeAutopilotSerial = (value: string): string =>
  value.trim().replace(/^"|"$/g, "").toUpperCase();

const normalizeHardwareHash = (value: string): string =>
  value.trim().replace(/^"|"$/g, "").replace(/\s+/g, "");

const HARDWARE_HASH_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

/** Split one CSV line, honouring double-quoted fields and `""` escapes. */
const splitCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current);
  return fields;
};

const headerKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const SERIAL_HEADERS = new Set([
  "serial",
  "serialnumber",
  "deviceserialnumber",
  "hardwareserialnumber",
  "hardwareserial",
]);
const HASH_HEADERS = new Set(["hardwarehash", "hardwareidentifier", "hash", "devicehardwarehash"]);
const GROUP_TAG_HEADERS = new Set(["grouptag", "group", "devicegrouptag"]);

const headerIndex = (headers: ReadonlyArray<string>, candidates: ReadonlySet<string>) =>
  headers.findIndex((header) => candidates.has(headerKey(header)));

/**
 * Parse the CSV/TSV-ish payload administrators paste from the Intune
 * "Windows Autopilot devices" export. The canonical columns are
 * `Device Serial Number`, `Hardware Hash` and optional `Group Tag`; a
 * headerless `serial,hash[,groupTag]` form is accepted too.
 */
export const parseAutopilotCsv = (
  input: string,
  options: { readonly maxRows?: number } = {},
): AutopilotCsvParseResult => {
  const maxRows = Math.max(1, options.maxRows ?? AUTOPILOT_IMPORT_MAX_ROWS);
  const rows: AutopilotImportRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let truncated = false;

  const lines = input
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) return { rows, errors, skipped, truncated };

  const firstFields = splitCsvLine(lines[0]!);
  const headers = firstFields.map(headerKey);
  const serialIndex = headerIndex(headers, SERIAL_HEADERS);
  const hashIndex = headerIndex(headers, HASH_HEADERS);
  const groupTagIndex = headerIndex(headers, GROUP_TAG_HEADERS);
  const hasHeader = serialIndex >= 0 && hashIndex >= 0;
  const body = hasHeader ? lines.slice(1) : lines;
  const serialColumn = hasHeader ? serialIndex : 0;
  const hashColumn = hasHeader ? hashIndex : 1;
  const groupTagColumn = hasHeader ? groupTagIndex : 2;

  for (let index = 0; index < body.length; index++) {
    const lineNumber = index + (hasHeader ? 2 : 1);
    const fields = splitCsvLine(body[index]!);
    const serial = normalizeAutopilotSerial(fields[serialColumn] ?? "");
    const hardwareHash = normalizeHardwareHash(fields[hashColumn] ?? "");
    const groupTag = (fields[groupTagColumn] ?? "").trim();

    if (!serial) {
      errors.push(`Line ${lineNumber}: missing device serial number`);
      continue;
    }
    if (serial.length > 255) {
      errors.push(`Line ${lineNumber}: serial number is longer than 255 characters`);
      continue;
    }
    if (!hardwareHash) {
      errors.push(`Line ${lineNumber}: missing hardware hash for ${serial}`);
      continue;
    }
    if (hardwareHash.length > 16_384 || !HARDWARE_HASH_PATTERN.test(hardwareHash)) {
      errors.push(`Line ${lineNumber}: hardware hash for ${serial} is not valid base64`);
      continue;
    }
    if (seen.has(serial)) {
      skipped++;
      continue;
    }
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    seen.add(serial);
    rows.push({
      serial,
      hardwareHash,
      ...(groupTag ? { groupTag: groupTag.slice(0, 255) } : {}),
    });
  }

  return { rows, errors, skipped, truncated };
};

export type AutopilotProfileValues = {
  readonly name: string;
  readonly description?: string;
  readonly deploymentMode: "userDriven" | "selfDeploying" | "preProvisioned";
  readonly joinType: "azureADJoin" | "azureADJoinUsingDeviceAuth" | "hybridAzureADJoin";
  readonly deviceNameTemplate?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly enableDevicePreparation: boolean;
  readonly assignedGroupId?: string;
};

export type AutopilotProfileValidation =
  | { readonly ok: true; readonly value: AutopilotProfileValues }
  | { readonly ok: false; readonly message: string };

const DEPLOYMENT_MODES = new Set(["userDriven", "selfDeploying", "preProvisioned"]);
const JOIN_TYPES = new Set(["azureADJoin", "azureADJoinUsingDeviceAuth", "hybridAzureADJoin"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/;
const DEVICE_NAME_PATTERN = /^[A-Za-z0-9%_\- ]+$/;

/**
 * Validate Autopilot profile settings before any Graph call. Invalid input
 * never reaches Graph and never creates a local row.
 */
export const validateAutopilotProfileInput = (
  input: Partial<Record<keyof AutopilotProfileValues, unknown>>,
): AutopilotProfileValidation => {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, message: "Profile name is required." };
  if (name.length > 255)
    return { ok: false, message: "Profile name must be 255 characters or fewer." };

  const description =
    typeof input.description === "string" && input.description.trim()
      ? input.description.trim()
      : undefined;
  if (description && description.length > 2_000)
    return { ok: false, message: "Profile description must be 2000 characters or fewer." };

  const deploymentMode =
    typeof input.deploymentMode === "string" ? input.deploymentMode : "userDriven";
  if (!DEPLOYMENT_MODES.has(deploymentMode))
    return {
      ok: false,
      message: "Deployment mode must be userDriven, selfDeploying or preProvisioned.",
    };

  const joinType = typeof input.joinType === "string" ? input.joinType : "azureADJoin";
  if (!JOIN_TYPES.has(joinType))
    return {
      ok: false,
      message: "Join type must be azureADJoin, azureADJoinUsingDeviceAuth or hybridAzureADJoin.",
    };
  if (joinType === "hybridAzureADJoin" && deploymentMode !== "userDriven")
    return {
      ok: false,
      message: "Hybrid Entra join only supports the user-driven deployment mode.",
    };

  const enableDevicePreparation = input.enableDevicePreparation === true;
  if (deploymentMode === "preProvisioned" && !enableDevicePreparation)
    return {
      ok: false,
      message: "Pre-provisioned deployment requires device preparation to be enabled.",
    };

  const deviceNameTemplate =
    typeof input.deviceNameTemplate === "string" && input.deviceNameTemplate.trim()
      ? input.deviceNameTemplate.trim()
      : undefined;
  if (deviceNameTemplate) {
    if (deviceNameTemplate.length > 60)
      return { ok: false, message: "Device name template must be 60 characters or fewer." };
    if (!DEVICE_NAME_PATTERN.test(deviceNameTemplate))
      return {
        ok: false,
        message:
          "Device name template may only contain letters, numbers, spaces, %SERIAL% and hyphens.",
      };
  }

  const locale =
    typeof input.locale === "string" && input.locale.trim() ? input.locale.trim() : undefined;
  if (locale && !LOCALE_PATTERN.test(locale))
    return { ok: false, message: "Locale must look like en-US." };

  const timezone =
    typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : undefined;
  if (timezone && !TIMEZONE_PATTERN.test(timezone))
    return { ok: false, message: "Timezone must be an IANA name such as Australia/Sydney." };

  const assignedGroupId =
    typeof input.assignedGroupId === "string" && input.assignedGroupId.trim()
      ? input.assignedGroupId.trim()
      : undefined;
  if (assignedGroupId && !UUID_PATTERN.test(assignedGroupId))
    return { ok: false, message: "Assigned group must be an Entra group object id." };

  return {
    ok: true,
    value: {
      name,
      ...(description ? { description } : {}),
      deploymentMode: deploymentMode as AutopilotProfileValues["deploymentMode"],
      joinType: joinType as AutopilotProfileValues["joinType"],
      ...(deviceNameTemplate ? { deviceNameTemplate } : {}),
      ...(locale ? { locale } : {}),
      ...(timezone ? { timezone } : {}),
      enableDevicePreparation,
      ...(assignedGroupId ? { assignedGroupId } : {}),
    },
  };
};

export const graphProfileInput = (
  values: AutopilotProfileValues,
): AutopilotDeploymentProfileInput => ({
  displayName: values.name,
  ...(values.description !== undefined ? { description: values.description } : {}),
  deploymentMode: values.deploymentMode,
  joinType: values.joinType,
  ...(values.deviceNameTemplate !== undefined
    ? { deviceNameTemplate: values.deviceNameTemplate }
    : {}),
  ...(values.locale !== undefined ? { locale: values.locale } : {}),
  enableDevicePreparation: values.enableDevicePreparation,
});

const graphFailure = (cause: unknown): AutopilotError => {
  const message =
    typeof cause === "object" && cause !== null && "message" in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);
  return fail("graph", message, cause);
};

const databaseFailure = (cause: unknown): AutopilotError =>
  fail("database", "The Autopilot state could not be saved.", cause);

/** Keep every exported helper on the module's typed error channel. */
const finish = <A>(effect: Effect.Effect<A, unknown>): Effect.Effect<A, AutopilotError> =>
  effect.pipe(
    Effect.mapError((cause) => (cause instanceof AutopilotError ? cause : databaseFailure(cause))),
  );

const rawMetadata = (device: GraphAutopilotDevice): string => {
  try {
    return JSON.stringify(device);
  } catch {
    return "{}";
  }
};

export type AutopilotImportResult = {
  readonly imported: number;
  readonly skipped: number;
  readonly errors: ReadonlyArray<string>;
  readonly truncated: boolean;
};

/**
 * Import parsed hardware hashes into Graph, then mirror them into the tenant's
 * `autopilot_device` cache. Graph is called first: a failed Graph import never
 * leaves local rows that imply the device was registered.
 */
export const importAutopilotDevices = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly rows: ReadonlyArray<AutopilotImportRow>;
  readonly skipped?: number;
  readonly errors?: ReadonlyArray<string>;
  readonly truncated?: boolean;
  readonly now?: Date;
}): Effect.Effect<AutopilotImportResult, AutopilotError> =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId, rows } = options;
    const timestamp = options.now ?? new Date();
    if (rows.length === 0)
      return {
        imported: 0,
        skipped: options.skipped ?? 0,
        errors: options.errors ?? [],
        truncated: options.truncated ?? false,
      };

    const imported = yield* graph
      .importAutopilotDevices(
        azureTenantId,
        rows.map((row) => ({
          serialNumber: row.serial,
          hardwareIdentifier: row.hardwareHash,
          ...(row.groupTag ? { groupTag: row.groupTag } : {}),
          orderIdentifier: `mattrax-${organizationId.slice(0, 24)}`,
        })),
      )
      .pipe(Effect.mapError(graphFailure));

    const bySerial = new Map<string, GraphAutopilotDevice>();
    for (const device of imported)
      if (device.serialNumber) bySerial.set(normalizeAutopilotSerial(device.serialNumber), device);

    for (const row of rows) {
      const device = bySerial.get(row.serial);
      const values = {
        organizationId,
        serial: row.serial,
        hardwareHash: row.hardwareHash,
        groupTag: row.groupTag ?? device?.groupTag ?? null,
        model: device?.model ?? null,
        manufacturer: device?.manufacturer ?? null,
        profileStatus: device?.profileStatus ?? ("unknown" as const),
        enrollmentState: device?.enrollmentState ?? ("unknown" as const),
        lastSyncedAt: timestamp,
        raw: device ? rawMetadata(device) : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      yield* db
        .insert(schema.autopilotDevice)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            hardwareHash: values.hardwareHash,
            ...(values.groupTag ? { groupTag: values.groupTag } : {}),
            ...(values.model ? { model: values.model } : {}),
            ...(values.manufacturer ? { manufacturer: values.manufacturer } : {}),
            profileStatus: values.profileStatus,
            enrollmentState: values.enrollmentState,
            lastSyncedAt: timestamp,
            raw: values.raw,
            updatedAt: timestamp,
          },
        });
    }

    return {
      imported: rows.length,
      skipped: options.skipped ?? 0,
      errors: options.errors ?? [],
      truncated: options.truncated ?? false,
    };
  }).pipe(finish);

export type AutopilotSyncResult = {
  readonly synced: number;
  readonly linked: number;
  readonly pages: number;
};

/**
 * Pull every `windowsAutopilotDeviceIdentity` page and upsert the tenant's
 * cache. Existing `device` rows are linked by normalised serial; a device from
 * another tenant can never match because the lookup is tenant-scoped.
 */
export const syncAutopilotDevices = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly now?: Date;
  readonly maxPages?: number;
}): Effect.Effect<AutopilotSyncResult, AutopilotError> =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId } = options;
    const timestamp = options.now ?? new Date();
    const maxPages = options.maxPages ?? 100;

    const devices = yield* db
      .select({ id: schema.device.id, serial: schema.device.serial })
      .from(schema.device)
      .where(eq(schema.device.organizationId, organizationId));
    const deviceBySerial = new Map<string, string>();
    for (const device of devices) {
      if (!device.serial) continue;
      const serial = normalizeAutopilotSerial(device.serial);
      if (!deviceBySerial.has(serial)) deviceBySerial.set(serial, device.id);
    }

    const graphDevices: GraphAutopilotDevice[] = [];
    let link: string | undefined;
    let pages = 0;
    while (pages < maxPages) {
      const page = yield* graph
        .listAutopilotDevices(azureTenantId, link)
        .pipe(Effect.mapError(graphFailure));
      pages++;
      graphDevices.push(...page.items);
      if (!page.nextLink) break;
      link = page.nextLink;
    }

    let linked = 0;
    for (const device of graphDevices) {
      const serial = device.serialNumber ? normalizeAutopilotSerial(device.serialNumber) : "";
      if (!serial) continue;
      const deviceId = deviceBySerial.get(serial) ?? null;
      if (deviceId) linked++;
      const values = {
        organizationId,
        serial,
        hardwareHash: device.hardwareHash ?? null,
        graphId: device.id || null,
        azureAdDeviceId: device.azureAdDeviceId ?? null,
        groupTag: device.groupTag ?? null,
        model: device.model ?? null,
        manufacturer: device.manufacturer ?? null,
        profileStatus: device.profileStatus,
        enrollmentState: device.enrollmentState,
        deviceId,
        lastSyncedAt: timestamp,
        raw: rawMetadata(device),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      yield* db
        .insert(schema.autopilotDevice)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            ...(values.hardwareHash ? { hardwareHash: values.hardwareHash } : {}),
            ...(values.graphId ? { graphId: values.graphId } : {}),
            ...(values.azureAdDeviceId ? { azureAdDeviceId: values.azureAdDeviceId } : {}),
            ...(values.groupTag ? { groupTag: values.groupTag } : {}),
            ...(values.model ? { model: values.model } : {}),
            ...(values.manufacturer ? { manufacturer: values.manufacturer } : {}),
            profileStatus: values.profileStatus,
            enrollmentState: values.enrollmentState,
            ...(values.deviceId ? { deviceId: values.deviceId } : {}),
            lastSyncedAt: timestamp,
            raw: values.raw,
            updatedAt: timestamp,
          },
        });
    }

    return { synced: graphDevices.length, linked, pages };
  }).pipe(finish);

export type AutopilotDeviceRow = typeof schema.autopilotDevice.$inferSelect;
export type AutopilotProfileRow = typeof schema.autopilotProfile.$inferSelect;

/** Public device view. The hardware hash is deliberately omitted. */
export const autopilotDeviceInfo = (row: AutopilotDeviceRow) => ({
  serial: row.serial,
  graphId: row.graphId,
  azureAdDeviceId: row.azureAdDeviceId,
  groupTag: row.groupTag,
  model: row.model,
  manufacturer: row.manufacturer,
  profileStatus: row.profileStatus,
  enrollmentState: row.enrollmentState,
  profileId: row.profileId,
  deviceId: row.deviceId,
  lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
});

export const autopilotProfileInfo = (row: AutopilotProfileRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  deploymentMode: row.deploymentMode,
  joinType: row.joinType,
  deviceNameTemplate: row.deviceNameTemplate,
  locale: row.locale,
  timezone: row.timezone,
  enableDevicePreparation: row.enableDevicePreparation,
  assignedGroupId: row.assignedGroupId,
  graphProfileId: row.graphProfileId,
  status: row.status,
  lastError: row.lastError,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** List a tenant's profiles newest-first. */
export const listAutopilotProfiles = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<ReadonlyArray<AutopilotProfileRow>, AutopilotError> =>
  finish(
    db
      .select()
      .from(schema.autopilotProfile)
      .where(eq(schema.autopilotProfile.organizationId, organizationId))
      .orderBy(asc(schema.autopilotProfile.name)),
  );

export const createAutopilotProfile = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly values: AutopilotProfileValues;
  readonly now?: Date;
}): Effect.Effect<AutopilotProfileRow, AutopilotError> =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId, values } = options;
    const timestamp = options.now ?? new Date();
    const profile = yield* graph
      .createAutopilotProfile(azureTenantId, graphProfileInput(values))
      .pipe(Effect.mapError(graphFailure));
    if (values.assignedGroupId && profile.id)
      yield* graph
        .assignAutopilotProfile(azureTenantId, profile.id, values.assignedGroupId)
        .pipe(Effect.mapError(graphFailure));
    const id = crypto.randomUUID();
    yield* db.insert(schema.autopilotProfile).values({
      id,
      organizationId,
      name: values.name,
      description: values.description ?? null,
      deploymentMode: values.deploymentMode,
      joinType: values.joinType,
      deviceNameTemplate: values.deviceNameTemplate ?? null,
      locale: values.locale ?? null,
      timezone: values.timezone ?? null,
      enableDevicePreparation: values.enableDevicePreparation,
      assignedGroupId: values.assignedGroupId ?? null,
      graphProfileId: profile.id || null,
      status: "active",
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const [row] = yield* db
      .select()
      .from(schema.autopilotProfile)
      .where(
        and(
          eq(schema.autopilotProfile.id, id),
          eq(schema.autopilotProfile.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return yield* Effect.fail(fail("database", "The Autopilot profile was not saved."));
    return row;
  }).pipe(finish);

export const updateAutopilotProfile = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly profileId: string;
  readonly values: AutopilotProfileValues;
  readonly now?: Date;
}): Effect.Effect<AutopilotProfileRow, AutopilotError> =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId, profileId, values } = options;
    const timestamp = options.now ?? new Date();
    const [existing] = yield* db
      .select()
      .from(schema.autopilotProfile)
      .where(
        and(
          eq(schema.autopilotProfile.id, profileId),
          eq(schema.autopilotProfile.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) return yield* Effect.fail(fail("invalid", "Autopilot profile not found."));

    const profile = existing.graphProfileId
      ? yield* graph
          .updateAutopilotProfile(azureTenantId, existing.graphProfileId, graphProfileInput(values))
          .pipe(Effect.mapError(graphFailure))
      : yield* graph
          .createAutopilotProfile(azureTenantId, graphProfileInput(values))
          .pipe(Effect.mapError(graphFailure));

    if (values.assignedGroupId && profile.id && values.assignedGroupId !== existing.assignedGroupId)
      yield* graph
        .assignAutopilotProfile(azureTenantId, profile.id, values.assignedGroupId)
        .pipe(Effect.mapError(graphFailure));

    yield* db
      .update(schema.autopilotProfile)
      .set({
        name: values.name,
        description: values.description ?? null,
        deploymentMode: values.deploymentMode,
        joinType: values.joinType,
        deviceNameTemplate: values.deviceNameTemplate ?? null,
        locale: values.locale ?? null,
        timezone: values.timezone ?? null,
        enableDevicePreparation: values.enableDevicePreparation,
        assignedGroupId: values.assignedGroupId ?? existing.assignedGroupId,
        graphProfileId: profile.id || existing.graphProfileId,
        status: "active",
        lastError: null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(schema.autopilotProfile.id, profileId),
          eq(schema.autopilotProfile.organizationId, organizationId),
        ),
      );

    const [row] = yield* db
      .select()
      .from(schema.autopilotProfile)
      .where(
        and(
          eq(schema.autopilotProfile.id, profileId),
          eq(schema.autopilotProfile.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return yield* Effect.fail(fail("database", "The Autopilot profile was not saved."));
    return row;
  }).pipe(finish);

export const assignAutopilotProfile = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly profileId: string;
  readonly groupId: string;
  readonly now?: Date;
}): Effect.Effect<AutopilotProfileRow, AutopilotError> =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId, profileId, groupId } = options;
    const timestamp = options.now ?? new Date();
    const [existing] = yield* db
      .select()
      .from(schema.autopilotProfile)
      .where(
        and(
          eq(schema.autopilotProfile.id, profileId),
          eq(schema.autopilotProfile.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) return yield* Effect.fail(fail("invalid", "Autopilot profile not found."));
    if (!existing.graphProfileId)
      return yield* Effect.fail(
        fail("invalid", "The Autopilot profile has not been created in Microsoft Graph yet."),
      );

    yield* graph
      .assignAutopilotProfile(azureTenantId, existing.graphProfileId, groupId)
      .pipe(Effect.mapError(graphFailure));

    yield* db
      .update(schema.autopilotProfile)
      .set({
        assignedGroupId: groupId,
        status: "active",
        lastError: null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(schema.autopilotProfile.id, profileId),
          eq(schema.autopilotProfile.organizationId, organizationId),
        ),
      );

    const [row] = yield* db
      .select()
      .from(schema.autopilotProfile)
      .where(
        and(
          eq(schema.autopilotProfile.id, profileId),
          eq(schema.autopilotProfile.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return yield* Effect.fail(fail("database", "The Autopilot profile was not saved."));
    return row;
  }).pipe(finish);

export const deleteAutopilotDevice = (options: {
  readonly db: EnterpriseDb;
  readonly graph: AzureGraphService;
  readonly organizationId: string;
  readonly azureTenantId: string;
  readonly serial: string;
}): Effect.Effect<boolean, AutopilotError> =>
  Effect.gen(function* () {
    const { db, graph, organizationId, azureTenantId } = options;
    const serial = normalizeAutopilotSerial(options.serial);
    const [existing] = yield* db
      .select()
      .from(schema.autopilotDevice)
      .where(
        and(
          eq(schema.autopilotDevice.organizationId, organizationId),
          eq(schema.autopilotDevice.serial, serial),
        ),
      )
      .limit(1);
    if (!existing) return false;

    if (existing.graphId)
      yield* graph
        .deleteAutopilotDevice(azureTenantId, existing.graphId)
        .pipe(Effect.mapError(graphFailure));

    yield* db
      .delete(schema.autopilotDevice)
      .where(
        and(
          eq(schema.autopilotDevice.organizationId, organizationId),
          eq(schema.autopilotDevice.serial, serial),
        ),
      );
    return true;
  }).pipe(finish);
