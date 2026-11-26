import { Effect, Option, Schema } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import type {
  AttributeDefinitionRow,
  DeviceAttributeCollectionState,
  EnrollmentQuestion,
  ScriptAttributeReading,
} from "@mattrax/enterprise-domain";
import {
  ATTRIBUTE_LABEL_MAX,
  ATTRIBUTE_OPTIONS_MAX,
  attributeKeyProblem,
  isEmptyAttributeValue,
  parseCsvRecords,
  parseScriptAttributeOutput,
  reservedAttributeKeyProblem,
  validateAttributeValue,
} from "@mattrax/enterprise-domain";
import type { AttributeSource, AttributeType } from "@mattrax/enterprise-domain";
import { writeSystemAudit } from "@mattrax/mdm-core";

/**
 * Device attributes: registry validation, value canonicalisation, CSV
 * import/export and the enrollment-answer hand-off.
 *
 * Everything here is tenant-scoped by an explicit organization id. The
 * handlers own request/audit context; this module owns the rules so they can
 * be unit tested without a database.
 */

export type AttributeDefinition = typeof schema.attributeDefinition.$inferSelect;

export const ATTRIBUTE_IMPORT_MAX_ROWS = 1000;

export const definitionInputProblem = (input: {
  readonly key: string;
  readonly label: string;
  readonly type: AttributeType;
  readonly options?: ReadonlyArray<string> | null;
  readonly source?: AttributeSource;
  readonly scriptId?: string | null;
  readonly scriptOutputKey?: string | null;
}): string | null => {
  const source = input.source ?? "manual";
  const scriptId = input.scriptId?.trim() || null;
  const shapeProblem = definitionShapeProblem(input);

  if (shapeProblem) return shapeProblem;

  // A patch can change only the binding, so the source rules are checked after
  // the shape: an attribute cannot promise values from a script it does not
  // name, and a non-script attribute must not keep a stale binding.
  if (source === "script" && !scriptId)
    return "Choose the script that reports this attribute's value.";

  if (source !== "script" && scriptId)
    return "Only script-sourced attributes can have a bound script.";

  if (source !== "script" && input.scriptOutputKey)
    return "Only script-sourced attributes can name an output key.";

  if ((input.scriptOutputKey ?? "").length > ATTRIBUTE_LABEL_MAX)
    return `The output key must be ${ATTRIBUTE_LABEL_MAX} characters or fewer.`;

  return null;
};

const definitionShapeProblem = (input: {
  readonly key: string;
  readonly label: string;
  readonly type: AttributeType;
  readonly options?: ReadonlyArray<string> | null;
}): string | null => {
  const keyProblem = attributeKeyProblem(input.key) ?? reservedAttributeKeyProblem(input.key);

  if (keyProblem) return keyProblem;

  const label = input.label.trim();

  if (!label) return "The attribute label is required.";

  if (label.length > ATTRIBUTE_LABEL_MAX)
    return `The label must be ${ATTRIBUTE_LABEL_MAX} characters or fewer.`;

  if (input.type !== "select") {
    if (input.options?.length) return "Only select attributes can define options.";

    return null;
  }

  const options = (input.options ?? []).map((option) => option.trim()).filter(Boolean);

  if (options.length === 0) return "A select attribute needs at least one option.";

  if (options.length > ATTRIBUTE_OPTIONS_MAX)
    return `A select attribute can have at most ${ATTRIBUTE_OPTIONS_MAX} options.`;

  if (new Set(options).size !== options.length) return "Select options must be unique.";

  const tooLong = options.find((option) => option.length > 255);

  if (tooLong) return "Select options must be 255 characters or fewer.";

  return null;
};

export const normalizeDefinitionOptions = (
  type: AttributeType,
  options: ReadonlyArray<string> | null | undefined,
): string[] | null => {
  if (type !== "select") return null;

  const normalized = (options ?? []).map((option) => option.trim()).filter(Boolean);

  return normalized.length ? normalized : null;
};

export const attributeDefinitionRow = (
  row: AttributeDefinition,
  options: { readonly deviceCount?: number; readonly scriptName?: string | null } = {},
): AttributeDefinitionRow => {
  const result: AttributeDefinitionRow = {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    options: row.options ?? null,
    required: row.required,
    visibility: row.visibility,
    source: row.source,
    scriptId: row.scriptId ?? null,
    scriptOutputKey: row.scriptOutputKey ?? null,
    scriptName: options.scriptName ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (options.deviceCount !== undefined)
    Object.assign(result, { deviceCount: options.deviceCount });

  return result;
};

/** Definitions in display order. One query per tenant read. */
export const listAttributeDefinitions = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<Array<AttributeDefinition>, unknown> =>
  db
    .select()
    .from(schema.attributeDefinition)
    .where(eq(schema.attributeDefinition.organizationId, organizationId))
    .orderBy(schema.attributeDefinition.sortOrder, schema.attributeDefinition.label);

/**
 * Attribute values for a bounded set of devices, keyed by device id and then
 * attribute key. One join instead of a query per device.
 */
export const loadDeviceAttributes = (
  db: EnterpriseDb,
  organizationId: string,
  deviceIds: ReadonlyArray<string>,
): Effect.Effect<Map<string, Record<string, string>>, unknown> =>
  Effect.gen(function* () {
    const values = new Map<string, Record<string, string>>();

    if (deviceIds.length === 0) return values;

    const rows = yield* db
      .select({
        deviceId: schema.deviceAttribute.deviceId,
        key: schema.attributeDefinition.key,
        value: schema.deviceAttribute.value,
      })
      .from(schema.deviceAttribute)
      .innerJoin(
        schema.attributeDefinition,
        eq(schema.attributeDefinition.id, schema.deviceAttribute.attributeId),
      )
      .where(
        and(
          eq(schema.deviceAttribute.organizationId, organizationId),
          inArray(schema.deviceAttribute.deviceId, [...deviceIds]),
        ),
      );

    for (const row of rows) {
      const existing = values.get(row.deviceId) ?? {};
      existing[row.key] = row.value;
      values.set(row.deviceId, existing);
    }

    return values;
  });

export type AttributeValueProblem = {
  readonly key: string;
  readonly message: string;
};

/**
 * Validate a keyed value map against the tenant registry.
 *
 * Unknown keys are rejected rather than ignored so a typo in an API call or a
 * stale CSV header cannot silently drop a value. Empty values are clear
 * requests and are validated like any other value (required attributes reject
 * them).
 */
export const attributeValuesProblem = (
  definitions: ReadonlyArray<AttributeDefinition>,
  values: Readonly<Record<string, string | null | undefined>>,
): AttributeValueProblem | null => {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  for (const [key, value] of Object.entries(values)) {
    const definition = byKey.get(key);

    if (!definition)
      return {
        key,
        message: `"${key}" is not a registered attribute in this tenant.`,
      };

    // A script attribute's value belongs to the script's next report, so a
    // dashboard or API write would either be overwritten or silently claimed.
    if (definition.source === "script")
      return {
        key,
        message: `"${definition.label}" is collected from a script and cannot be edited manually.`,
      };

    const result = validateAttributeValue(definition, value);

    if (!result.ok) return { key, message: result.error };
  }

  return null;
};

/** Canonical stored value for a key, or null when the value should be cleared. */
export const canonicalAttributeValue = (
  definitions: ReadonlyArray<AttributeDefinition>,
  key: string,
  value: string | null | undefined,
): string | null => {
  const definition = definitions.find((candidate) => candidate.key === key);

  if (!definition || isEmptyAttributeValue(value)) return null;
  const result = validateAttributeValue(definition, value);

  return result.ok ? result.value : null;
};

/**
 * Apply merge/clear semantics to one device's current values.
 *
 * Listed keys are written, `null` (or an empty string) clears that key, and
 * unlisted keys are left untouched unless `replace` is true, which clears every
 * registered key that is absent from `values` — except script-owned keys, which
 * this path may not write at all. The result is a keyed map the caller writes
 * row by row, so the dashboard, CSV import and API all share the same rules.
 */
export const mergeAttributeValues = (input: {
  readonly existing: Readonly<Record<string, string>>;
  readonly values: Readonly<Record<string, string | null | undefined>>;
  readonly definitions: ReadonlyArray<{ readonly key: string; readonly source?: string }>;
  readonly replace?: boolean;
}): Record<string, string | null> => {
  const merged = new Map<string, string | null>(Object.entries(input.existing));

  for (const [key, value] of Object.entries(input.values))
    merged.set(key, value === null || value === undefined || value === "" ? null : value);

  if (input.replace) {
    for (const definition of input.definitions)
      // `replace` clears the manual fields the caller omitted. A script-owned
      // value is not the caller's to clear, and clearing it would be a manual
      // write through the back door.
      if (definition.source !== "script" && !(definition.key in input.values))
        merged.set(definition.key, null);
  }

  return Object.fromEntries(merged);
};

const visibleDefinitions = (definitions: ReadonlyArray<AttributeDefinition>) =>
  definitions.flatMap((definition) => (definition.visibility === "visible" ? [definition] : []));

/** CSV columns for the tenant's visible attributes, after the standard columns. */
export const attributeCsvHeaders = (definitions: ReadonlyArray<AttributeDefinition>) =>
  visibleDefinitions(definitions).map((definition) => `attribute:${definition.key}`);

export const attributeCsvCells = (
  definitions: ReadonlyArray<AttributeDefinition>,
  values: Readonly<Record<string, string>> | undefined,
) => visibleDefinitions(definitions).map((definition) => values?.[definition.key] ?? "");

export type AttributeCsvRow = {
  /** 1-based record number excluding the header. */
  readonly row: number;
  readonly serial: string;
  readonly values: Record<string, string | null>;
};

export type AttributeCsvParse = {
  readonly rows: ReadonlyArray<AttributeCsvRow>;
  readonly issues: ReadonlyArray<{ readonly row: number; readonly message: string }>;
};

const SERIAL_HEADERS = new Set(["serial", "serial_number", "serialnumber", "serial number"]);

const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, "_");

/**
 * Parse a device-attribute CSV.
 *
 * The header must contain `serial` (or an alias) and at least one
 * `attribute:<key>` column. A bare key or the human label is accepted too, so
 * an export can be edited and re-imported without renaming columns. Unknown
 * columns are reported instead of dropped. Duplicate serials are rejected so
 * the result of an import does not depend on row order.
 */
export const parseAttributeCsv = (
  definitions: ReadonlyArray<AttributeDefinition>,
  csv: string,
): AttributeCsvParse => {
  const records = parseCsvRecords(csv);
  const issues: Array<{ row: number; message: string }> = [];

  if (records.length === 0) return { rows: [], issues: [{ row: 0, message: "The CSV is empty." }] };

  const header = records[0].map(normalizeHeader);
  const serialIndex = header.findIndex((cell) => SERIAL_HEADERS.has(cell));

  if (serialIndex === -1)
    return { rows: [], issues: [{ row: 0, message: 'The CSV needs a "serial" column.' }] };

  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  const byLabel = new Map(
    definitions.map((definition) => [definition.label.trim().toLowerCase(), definition]),
  );

  const columns: Array<{ index: number; definition: AttributeDefinition }> = [];
  const seen = new Set<string>();

  for (const [index, cell] of header.entries()) {
    if (index === serialIndex) continue;

    const prefixed = cell.startsWith("attribute:") ? cell.slice("attribute:".length) : cell;
    const definition = byKey.get(prefixed) ?? byLabel.get(prefixed.trim().toLowerCase());

    if (!definition) {
      issues.push({
        row: 0,
        message: `Column "${records[0][index].trim()}" is not a registered attribute key.`,
      });

      continue;
    }

    if (seen.has(definition.key)) {
      issues.push({ row: 0, message: `Column for "${definition.key}" appears twice.` });

      continue;
    }

    seen.add(definition.key);
    columns.push({ index, definition });
  }

  if (columns.length === 0)
    issues.push({
      row: 0,
      message: 'Add at least one attribute column, for example "attribute:cost_centre".',
    });

  const rows: Array<AttributeCsvRow> = [];
  const serials = new Set<string>();

  for (const [index, record] of records.slice(1).entries()) {
    const rowNumber = index + 1;

    if (rowNumber > ATTRIBUTE_IMPORT_MAX_ROWS) {
      issues.push({
        row: rowNumber,
        message: `Imports are limited to ${ATTRIBUTE_IMPORT_MAX_ROWS} rows. Split the file.`,
      });

      break;
    }

    const serial = (record[serialIndex] ?? "").trim();

    if (!serial) {
      issues.push({ row: rowNumber, message: "The serial is required." });

      continue;
    }

    if (serials.has(serial)) {
      issues.push({ row: rowNumber, message: `Serial ${serial} appears more than once.` });

      continue;
    }

    serials.add(serial);
    const values: Record<string, string | null> = {};

    for (const column of columns) {
      const raw = record[column.index] ?? "";

      // A script column is exported for visibility but the script owns it, so
      // an edit-and-reimport round trip must neither write nor clear it.
      if (column.definition.source === "script") continue;

      if (isEmptyAttributeValue(raw)) {
        if (column.definition.required) {
          issues.push({
            row: rowNumber,
            message: `${column.definition.label} is required for this device.`,
          });

          continue;
        }

        values[column.definition.key] = null;

        continue;
      }

      const result = validateAttributeValue(column.definition, raw);

      if (!result.ok) {
        issues.push({ row: rowNumber, message: result.error });

        continue;
      }

      values[column.definition.key] = result.value;
    }

    rows.push({ row: rowNumber, serial, values });
  }

  return { rows, issues };
};

/**
 * Apply answers submitted on the public enrollment page to devices that now
 * exist with the same serial. Called when devices are read (list, search,
 * detail, export), so an enrolled device picks up its answers on first sight.
 *
 * Idempotent: consumed rows are deleted in the same effect, and the unique
 * device/attribute key makes concurrent claims converge on the same value.
 */
export const claimEnrollmentAnswers = (
  db: EnterpriseDb,
  organizationId: string,
  devices: ReadonlyArray<{ readonly id: string; readonly serial: string | null }>,
) =>
  Effect.gen(function* () {
    const bySerial = new Map<string, string>();

    for (const device of devices) {
      const serial = device.serial?.trim();

      if (serial) bySerial.set(serial, device.id);
    }

    if (bySerial.size === 0) return;

    const answers = yield* db
      .select()
      .from(schema.enrollmentAnswer)
      .where(
        and(
          eq(schema.enrollmentAnswer.organizationId, organizationId),
          inArray(schema.enrollmentAnswer.serial, [...bySerial.keys()]),
        ),
      );

    if (answers.length === 0) return;

    const definitions = yield* db
      .select()
      .from(schema.attributeDefinition)
      .where(
        and(
          eq(schema.attributeDefinition.organizationId, organizationId),
          inArray(
            schema.attributeDefinition.id,
            answers.map((answer) => answer.attributeId),
          ),
        ),
      );

    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const timestamp = new Date();
    const claimed: Array<typeof schema.enrollmentAnswer.$inferSelect> = [];
    const mentioned = new Map<string, Set<string>>();

    for (const answer of answers) {
      const deviceId = bySerial.get(answer.serial);

      if (!deviceId) continue;

      // The answer was validated at submission; re-check against the current
      // definition because an administrator may have edited options since.
      const definition = definitionsById.get(answer.attributeId);

      if (!definition) continue;

      // A script owns its attribute's values, so an enrollment answer must not
      // become a value the next collection silently overwrites.
      if (definition.source === "script") continue;

      const result = validateAttributeValue({ ...definition, required: false }, answer.value);

      if (!result.ok) continue;

      yield* db
        .insert(schema.deviceAttribute)
        .values({
          deviceId,
          attributeId: definition.id,
          organizationId,
          value: result.value,
          updatedByAccountId: null,
          updatedAt: timestamp,
        })
        .onDuplicateKeyUpdate({ set: { value: result.value, updatedAt: timestamp } });

      claimed.push(answer);
      const keys = mentioned.get(deviceId) ?? new Set<string>();
      keys.add(definition.key);
      mentioned.set(deviceId, keys);
    }

    if (claimed.length === 0) return;

    yield* db.delete(schema.enrollmentAnswer).where(
      and(
        eq(schema.enrollmentAnswer.organizationId, organizationId),
        inArray(
          schema.enrollmentAnswer.id,
          claimed.map((answer) => answer.id),
        ),
      ),
    );

    for (const [deviceId, keys] of mentioned)
      yield* writeSystemAudit(db, {
        organizationId,
        action: "device.attributes_updated",
        targetType: "device",
        targetId: deviceId,
        metadata: { source: "enrollment", keys: [...keys].sort() },
      });
  });

/** Public enrollment questions in display order, joined to their definitions. */
export const loadEnrollmentQuestions = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<Array<EnrollmentQuestion>, unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({
        key: schema.attributeDefinition.key,
        label: schema.attributeDefinition.label,
        type: schema.attributeDefinition.type,
        options: schema.attributeDefinition.options,
        attributeRequired: schema.attributeDefinition.required,
        required: schema.enrollmentQuestion.required,
        prompt: schema.enrollmentQuestion.prompt,
        sortOrder: schema.enrollmentQuestion.sortOrder,
      })
      .from(schema.enrollmentQuestion)
      .innerJoin(
        schema.attributeDefinition,
        eq(schema.attributeDefinition.id, schema.enrollmentQuestion.attributeId),
      )
      .where(eq(schema.enrollmentQuestion.organizationId, organizationId))
      .orderBy(schema.enrollmentQuestion.sortOrder, schema.attributeDefinition.label);

    return rows.map((row) => ({
      key: row.key,
      label: row.prompt?.trim() || row.label,
      type: row.type,
      options: row.options ?? null,
      required: row.required ?? row.attributeRequired,
      sortOrder: row.sortOrder,
    }));
  });

/** Decode an attribute-filter query string into a keyed value map. */
export const decodeAttributeFilter = (
  value: string | undefined,
): Record<string, string> | undefined => {
  if (!value) return undefined;

  let decoded: Schema.Json;

  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("attribute filters must be valid JSON");
  }

  const filter = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String))(decoded);

  if (Option.isNone(filter))
    throw new Error("attribute filters must be a JSON object of key/value strings");

  return filter.value;
};

/** One row's worth of canonical values, used by the import handler. */
export const canonicalCsvValues = (
  definitions: ReadonlyArray<AttributeDefinition>,
  values: Readonly<Record<string, string | null>>,
): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value === null ? null : (canonicalAttributeValue(definitions, key, value) ?? ""),
    ]),
  );

// ─── Script collection ────────────────────────────────────────────

export type ScriptAttributeCollection = {
  /** Attribute keys whose value was written, sorted. */
  readonly written: Array<string>;
  /** Per-attribute failures. The previous value is kept on a failure. */
  readonly errors: Array<{ readonly key: string; readonly message: string }>;
};

/**
 * Apply one script result to the attributes bound to that script.
 *
 * Only attributes the tenant declared as `source: "script"` and bound to this
 * exact script can be written, so a script cannot invent a column by printing
 * an unexpected key. A type or validation failure records an error on the
 * device/attribute row and leaves the previous value alone.
 *
 * The caller owns the run lifecycle; this only persists values and collection
 * state. It is called from agent result ingestion, which is also the path
 * "Collect now" uses.
 */
export const collectScriptAttributeValues = (
  db: EnterpriseDb,
  input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly script: { readonly id: string; readonly name: string };
    readonly executionId: string;
    /** Capped and redacted stdout from the run. */
    readonly stdout: string;
    /** Set when the run failed; every bound attribute records it. */
    readonly failure?: string | null;
    readonly now: Date;
  },
): Effect.Effect<ScriptAttributeCollection, unknown> =>
  Effect.gen(function* () {
    const bindings = yield* (
      db
        .select()
        .from(schema.attributeDefinition)
        .where(
          and(
            eq(schema.attributeDefinition.organizationId, input.organizationId),
            eq(schema.attributeDefinition.source, "script"),
            eq(schema.attributeDefinition.scriptId, input.script.id),
          ),
        )
        // Same order as the settings list: the line contract is the order an
        // operator sees, which is sort order then label.
        .orderBy(schema.attributeDefinition.sortOrder, schema.attributeDefinition.label)
    );

    if (bindings.length === 0) return { written: [], errors: [] };

    const readings: ReadonlyArray<ScriptAttributeReading> = input.failure
      ? bindings.map((binding) => ({ key: binding.key, ok: false, error: input.failure! }))
      : parseScriptAttributeOutput(
          bindings.map((binding, index) => ({
            key: binding.key,
            label: binding.label,
            type: binding.type,
            options: binding.options ?? null,
            outputKey: binding.scriptOutputKey,
            line: index + 1,
          })),
          input.stdout,
        );

    // Only a changed value is written, so a scheduled run that reports the
    // same value does not churn the row or produce an audit entry.
    const current = yield* db
      .select({
        attributeId: schema.deviceAttribute.attributeId,
        value: schema.deviceAttribute.value,
      })
      .from(schema.deviceAttribute)
      .where(
        and(
          eq(schema.deviceAttribute.organizationId, input.organizationId),
          eq(schema.deviceAttribute.deviceId, input.deviceId),
          inArray(
            schema.deviceAttribute.attributeId,
            bindings.map((binding) => binding.id),
          ),
        ),
      );

    const currentValues = new Map(current.map((row) => [row.attributeId, row.value]));
    const byKey = new Map(readings.map((reading) => [reading.key, reading]));
    const written: Array<string> = [];
    const errors: Array<{ key: string; message: string }> = [];

    for (const binding of bindings) {
      const reading = byKey.get(binding.key);

      if (!reading) continue;

      if (reading.ok) {
        if (currentValues.get(binding.id) !== reading.value) {
          written.push(binding.key);

          yield* db
            .insert(schema.deviceAttribute)
            .values({
              deviceId: input.deviceId,
              attributeId: binding.id,
              organizationId: input.organizationId,
              value: reading.value,
              // No account wrote this value; the audit entry names the run.
              updatedByAccountId: null,
              updatedAt: input.now,
            })
            .onDuplicateKeyUpdate({
              set: { value: reading.value, updatedByAccountId: null, updatedAt: input.now },
            });
        }
      } else {
        errors.push({ key: binding.key, message: reading.error });
      }

      // A success clears the error and moves the timestamp; a failure records
      // the error and leaves `lastCollectedAt` at the last good collection.
      const state = reading.ok
        ? {
            source: "script" as const,
            scriptId: input.script.id,
            lastCollectedAt: input.now,
            lastError: null,
            lastErrorAt: null,
            updatedAt: input.now,
          }
        : {
            source: "script" as const,
            scriptId: input.script.id,
            lastError: reading.error,
            lastErrorAt: input.now,
            updatedAt: input.now,
          };

      yield* db
        .insert(schema.attributeCollection)
        .values({
          deviceId: input.deviceId,
          attributeId: binding.id,
          organizationId: input.organizationId,
          source: "script" as const,
          scriptId: input.script.id,
          lastCollectedAt: reading.ok ? input.now : null,
          lastError: reading.ok ? null : reading.error,
          lastErrorAt: reading.ok ? null : input.now,
          updatedAt: input.now,
        })
        .onDuplicateKeyUpdate({ set: state });
    }

    if (written.length === 0) return { written, errors };

    yield* writeSystemAudit(db, {
      organizationId: input.organizationId,
      action: "device.attributes_updated",
      targetType: "device",
      targetId: input.deviceId,
      metadata: {
        source: "script",
        scriptId: input.script.id,
        scriptName: input.script.name,
        executionId: input.executionId,
        written: [...written].sort(),
        // Key names only: the messages live on the collection rows.
        failed: errors.map((error) => error.key).sort(),
      },
    });

    return { written, errors };
  });

/**
 * Collection state for one device, keyed by attribute key.
 *
 * Only attributes with an attempted collection appear, so a script-sourced
 * attribute that has never reported is absent rather than shown as "never
 * collected".
 */
export const loadDeviceAttributeCollection = (
  db: EnterpriseDb,
  organizationId: string,
  deviceId: string,
): Effect.Effect<Record<string, DeviceAttributeCollectionState>, unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({
        key: schema.attributeDefinition.key,
        source: schema.attributeCollection.source,
        lastCollectedAt: schema.attributeCollection.lastCollectedAt,
        lastError: schema.attributeCollection.lastError,
        lastErrorAt: schema.attributeCollection.lastErrorAt,
      })
      .from(schema.attributeCollection)
      .innerJoin(
        schema.attributeDefinition,
        eq(schema.attributeDefinition.id, schema.attributeCollection.attributeId),
      )
      .where(
        and(
          eq(schema.attributeCollection.organizationId, organizationId),
          eq(schema.attributeCollection.deviceId, deviceId),
        ),
      );

    return Object.fromEntries(
      rows.map((row) => [
        row.key,
        {
          source: row.source,
          lastCollectedAt: row.lastCollectedAt ? row.lastCollectedAt.toISOString() : null,
          lastError: row.lastError ?? null,
          lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
        },
      ]),
    );
  });
