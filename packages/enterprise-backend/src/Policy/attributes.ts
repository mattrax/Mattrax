import { Effect, Option, Schema } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import type { AttributeDefinitionRow, EnrollmentQuestion } from "@mattrax/enterprise-domain";
import {
  ATTRIBUTE_LABEL_MAX,
  ATTRIBUTE_OPTIONS_MAX,
  attributeKeyProblem,
  isEmptyAttributeValue,
  parseCsvRecords,
  reservedAttributeKeyProblem,
  validateAttributeValue,
} from "@mattrax/enterprise-domain";
import type { AttributeType } from "@mattrax/enterprise-domain";
import { writeSystemAudit } from "@mattrax/mdm-apple";

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
  deviceCount?: number,
): AttributeDefinitionRow => {
  const result: AttributeDefinitionRow = {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    options: row.options ?? null,
    required: row.required,
    visibility: row.visibility,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (deviceCount !== undefined) Object.assign(result, { deviceCount });

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
 * registered key that is absent from `values`. The result is a keyed map the
 * caller writes row by row, so the dashboard, CSV import and API all share the
 * same rules.
 */
export const mergeAttributeValues = (input: {
  readonly existing: Readonly<Record<string, string>>;
  readonly values: Readonly<Record<string, string | null | undefined>>;
  readonly definitions: ReadonlyArray<{ readonly key: string }>;
  readonly replace?: boolean;
}): Record<string, string | null> => {
  const merged = new Map<string, string | null>(Object.entries(input.existing));

  for (const [key, value] of Object.entries(input.values))
    merged.set(key, value === null || value === undefined || value === "" ? null : value);

  if (input.replace) {
    for (const definition of input.definitions)
      if (!(definition.key in input.values)) merged.set(definition.key, null);
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
