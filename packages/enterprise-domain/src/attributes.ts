import { Schema } from "effect";

/**
 * Tenant-defined device attributes.
 *
 * A definition is the schema (key, label, type, options, required, visibility)
 * and a `device_attribute` row is one value. Both the dashboard and the public
 * API validate through the helpers here so the canonical string form is the
 * same everywhere: booleans are `true`/`false`, dates are `YYYY-MM-DD` and
 * numbers are normalised through `Number`.
 */

export const AttributeType = Schema.Literals(["text", "number", "boolean", "date", "select"]);

export type AttributeType = typeof AttributeType.Type;

export const AttributeVisibility = Schema.Literals(["visible", "hidden"]);

export type AttributeVisibility = typeof AttributeVisibility.Type;

/**
 * Who owns an attribute's values.
 *
 * `script` attributes are written only by the bound script's reported result
 * and reject manual edits. `directory` is reserved for a directory connector:
 * it is part of the model so bindings can be planned, but nothing collects it
 * yet, so it still accepts manual values.
 */
export const AttributeSource = Schema.Literals(["manual", "script", "directory"]);

export type AttributeSource = typeof AttributeSource.Type;

/**
 * Attribute keys become policy variables (`${attribute.<key>}`) and CSV
 * headers, so they are restricted to a lowercase, variable-safe identifier.
 */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const attributeKeyProblem = (key: string): string | null => {
  if (!key) return "The attribute key is required.";

  if (ATTRIBUTE_KEY_PATTERN.test(key)) return null;

  return "Keys must start with a lowercase letter and contain only lowercase letters, numbers and underscores (maximum 64 characters).";
};

/** Keys that would collide with a built-in policy variable namespace. */
const RESERVED_KEYS = new Set(["device", "tenant", "attribute", "secret", "password", "token"]);

export const reservedAttributeKeyProblem = (key: string): string | null =>
  RESERVED_KEYS.has(key)
    ? `"${key}" is reserved. Choose a key that describes the field, for example "${key}_id".`
    : null;

const NullOrString = Schema.NullOr(Schema.String);

export const ATTRIBUTE_LABEL_MAX = 120;

export const ATTRIBUTE_VALUE_MAX = 4096;

export const ATTRIBUTE_OPTIONS_MAX = 100;

/** One option of a `select` definition. */
export const AttributeOption = Schema.String.check(Schema.isMinLength(1));

export const isEmptyAttributeValue = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

const canonicalBoolean = (value: string): string | null => {
  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return "true";
    case "false":
    case "0":
    case "no":
    case "off":
      return "false";
    default:
      return null;
  }
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const canonicalDate = (value: string): string | null => {
  const match = ISO_DATE.exec(value.trim());

  if (!match) return null;
  const [, year, month, day] = match;

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  )
    return null;

  return `${year}-${month}-${day}`;
};

export type AttributeValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

/**
 * Validate and canonicalise one value against its definition.
 *
 * An empty value is a clear request: it is allowed when the definition is
 * optional and rejected when it is required. Validation is pure so the same
 * rules apply to the dashboard, CSV import, enrollment questions and API.
 */
export const validateAttributeValue = (
  definition: {
    readonly key: string;
    readonly label?: string;
    readonly type: AttributeType;
    readonly options?: ReadonlyArray<string> | null;
    readonly required?: boolean;
  },
  raw: string | null | undefined,
): AttributeValidation => {
  const name = definition.label ?? definition.key;
  const empty = isEmptyAttributeValue(raw);

  if (empty) {
    if (definition.required) return { ok: false, error: `${name} is required for this device.` };

    return { ok: true, value: "" };
  }

  const value = raw!.trim();

  if (value.length > ATTRIBUTE_VALUE_MAX)
    return { ok: false, error: `${name} must be ${ATTRIBUTE_VALUE_MAX} characters or fewer.` };

  switch (definition.type) {
    case "text":
      return { ok: true, value };

    case "number": {
      const parsed = Number(value);

      if (value === "" || !Number.isFinite(parsed))
        return { ok: false, error: `${name} must be a number.` };

      return { ok: true, value: String(parsed) };
    }

    case "boolean": {
      const parsed = canonicalBoolean(value);

      if (parsed === null) return { ok: false, error: `${name} must be true or false.` };

      return { ok: true, value: parsed };
    }

    case "date": {
      const parsed = canonicalDate(value);

      if (parsed === null)
        return { ok: false, error: `${name} must be a date in YYYY-MM-DD form.` };

      return { ok: true, value: parsed };
    }

    case "select": {
      const options = definition.options ?? [];

      if (!options.includes(value))
        return {
          ok: false,
          error: `${name} must be one of: ${options.join(", ") || "(no options configured)"}.`,
        };

      return { ok: true, value };
    }
  }
};

/**
 * One attribute a script collects, in the order its owner bound them.
 *
 * `outputKey` names a key in the stdout JSON object and defaults to the
 * attribute key. `line` is the 1-based position used when the script prints one
 * value per line instead.
 */
export type ScriptAttributeBinding = {
  readonly key: string;
  readonly label?: string;
  readonly type: AttributeType;
  readonly options?: ReadonlyArray<string> | null;
  readonly outputKey?: string | null;
  readonly line: number;
};

export type ScriptAttributeReading =
  | { readonly key: string; readonly ok: true; readonly value: string }
  | { readonly key: string; readonly ok: false; readonly error: string };

/** A value parsed from the script's stdout object. */
type ScriptJsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<ScriptJsonValue>
  | { readonly [key: string]: ScriptJsonValue };

/**
 * Accept only the scalar JSON values an attribute can hold. A nested object or
 * array is a mistake in the script, not a value worth stringifying.
 */
const scriptJsonCell = (value: unknown): string | null => {
  if (typeof value === "string") return value;

  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;

  if (typeof value === "boolean") return value ? "true" : "false";

  return null;
};

/**
 * Read a script's stdout against the attributes bound to it.
 *
 * The contract is deliberately small: either one JSON object whose keys match
 * the bindings (or the configured output keys), or one value per line in
 * binding order. Anything else is reported per attribute instead of failing the
 * whole run, so one bad value cannot discard the others.
 *
 * Values are validated with the definition's type, options and length rules
 * before they are written. An empty value is a collection error rather than a
 * clear: a script that prints nothing did not report "no value".
 */
export const parseScriptAttributeOutput = (
  bindings: ReadonlyArray<ScriptAttributeBinding>,
  output: string,
): ReadonlyArray<ScriptAttributeReading> => {
  const ordered = [...bindings].sort((left, right) => left.line - right.line);
  const trimmed = output.trim();

  const failure = (message: string): ReadonlyArray<ScriptAttributeReading> =>
    ordered.map((binding) => ({ key: binding.key, ok: false, error: message }));

  if (ordered.length === 0) return [];

  if (!trimmed)
    return failure("The script printed nothing, so no attribute values were collected.");

  const nameOf = (binding: ScriptAttributeBinding) => binding.outputKey?.trim() || binding.key;

  const validate = (binding: ScriptAttributeBinding, raw: string): ScriptAttributeReading => {
    const name = binding.label ?? binding.key;

    if (isEmptyAttributeValue(raw))
      return { key: binding.key, ok: false, error: `${name} was empty in the script output.` };

    // Empty is rejected above, so `required` never adds a second error here.
    const result = validateAttributeValue({ ...binding, required: false }, raw);

    return result.ok
      ? { key: binding.key, ok: true, value: result.value }
      : { key: binding.key, ok: false, error: result.error };
  };

  const readings: Array<ScriptAttributeReading> = [];

  // A stdout object is unambiguous, so a leading "{" selects JSON mode. A text
  // attribute that legitimately starts with "{" must use line mode instead.
  if (trimmed.startsWith("{")) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return failure("The script printed a JSON object that could not be parsed.");
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return failure("The script must print a JSON object or one value per line.");

    const object = parsed as { readonly [key: string]: ScriptJsonValue };

    for (const binding of ordered) {
      const name = nameOf(binding);
      const cell = scriptJsonCell(object[name]);

      if (cell !== null) {
        readings.push(validate(binding, cell));

        continue;
      }

      readings.push(
        Object.hasOwn(object, name)
          ? {
              key: binding.key,
              ok: false,
              error: `${binding.label ?? binding.key} must be a string, number or boolean in the script output.`,
            }
          : {
              key: binding.key,
              ok: false,
              error: `The script output has no "${name}" key.`,
            },
      );
    }

    return readings;
  }

  // Split the raw output, not the trimmed form: a leading or middle blank line
  // is an empty value for its position and must be reported as one rather than
  // shifting every later attribute. Only one trailing newline is dropped, which
  // is the newline a script's final `echo` leaves behind.
  const lines = output.replace(/\r?\n$/, "").split(/\r?\n/);

  for (const binding of ordered) {
    const line = lines[binding.line - 1];

    if (line === undefined) {
      readings.push({
        key: binding.key,
        ok: false,
        error: `The script printed ${lines.length} line${lines.length === 1 ? "" : "s"} but ${binding.label ?? binding.key} is line ${binding.line}.`,
      });

      continue;
    }

    readings.push(validate(binding, line));
  }

  return readings;
};

/** Format a stored value for a human-readable table or CSV cell. */
export const attributeValueLabel = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "";

  return value;
};

export const AttributeDefinitionRow = Schema.Struct({
  id: Schema.String,
  /** Stable identifier used by the API, CSV import and policy variables. */
  key: Schema.String,
  label: Schema.String,
  type: AttributeType,
  options: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  required: Schema.Boolean,
  visibility: AttributeVisibility,
  /** Who owns the values; `script` attributes reject manual writes. */
  source: AttributeSource,
  /** Script that collects a `script`-sourced value. */
  scriptId: Schema.optional(Schema.NullOr(Schema.String)),
  /** JSON key on the script's stdout; null means the attribute key. */
  scriptOutputKey: Schema.optional(Schema.NullOr(Schema.String)),
  /** Resolved binding label, so the dashboard does not need a second request. */
  scriptName: Schema.optional(Schema.NullOr(Schema.String)),
  sortOrder: Schema.Number,
  /** Devices with a value, when the list endpoint was asked to count. */
  deviceCount: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type AttributeDefinitionRow = typeof AttributeDefinitionRow.Type;

export const AttributeDefinitionListResponse = Schema.Struct({
  rows: Schema.Array(AttributeDefinitionRow),
});

export type AttributeDefinitionListResponse = typeof AttributeDefinitionListResponse.Type;

const AttributeOptions = Schema.optional(Schema.NullOr(Schema.Array(Schema.String)));

const AttributeBindingFields = {
  /** Defaults to `manual`. `script` requires `scriptId`. */
  source: Schema.optional(AttributeSource),
  /** Script bound to a `script` attribute; ignored for other sources. */
  scriptId: Schema.optional(Schema.NullOr(Schema.String)),
  /** JSON key on stdout; omit to use the attribute key. */
  scriptOutputKey: Schema.optional(Schema.NullOr(Schema.String)),
};

export const CreateAttributeRequest = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  type: AttributeType,
  options: AttributeOptions,
  required: Schema.optional(Schema.Boolean),
  visibility: Schema.optional(AttributeVisibility),
  sortOrder: Schema.optional(Schema.Number),
  ...AttributeBindingFields,
});

export type CreateAttributeRequest = typeof CreateAttributeRequest.Type;

export const PatchAttributeRequest = Schema.Struct({
  label: Schema.optional(Schema.String),
  type: Schema.optional(AttributeType),
  options: AttributeOptions,
  required: Schema.optional(Schema.Boolean),
  visibility: Schema.optional(AttributeVisibility),
  sortOrder: Schema.optional(Schema.Number),
  ...AttributeBindingFields,
});

export type PatchAttributeRequest = typeof PatchAttributeRequest.Type;

/** Attribute values keyed by definition key. `null` clears the value. */
export const DeviceAttributeValues = Schema.Record(Schema.String, Schema.NullOr(Schema.String));

export type DeviceAttributeValues = typeof DeviceAttributeValues.Type;

export const SetDeviceAttributesRequest = Schema.Struct({
  /**
   * Merge semantics: every key in `values` is written, a `null` value clears
   * that key, and keys that are absent are left untouched. Set `replace` to
   * also clear every registered key that is absent from `values`.
   */
  values: DeviceAttributeValues,
  replace: Schema.optional(Schema.Boolean),
});

export type SetDeviceAttributesRequest = typeof SetDeviceAttributesRequest.Type;

/**
 * The last collection attempt for one device attribute, keyed by attribute key
 * on the device detail payload. Present only after a bound script has reported
 * for that device.
 */
export const DeviceAttributeCollectionState = Schema.Struct({
  source: AttributeSource,
  /** Last successful collection; a later failure leaves it unchanged. */
  lastCollectedAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** Most recent failure, in operator wording. */
  lastError: Schema.optional(Schema.NullOr(Schema.String)),
  lastErrorAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DeviceAttributeCollectionState = typeof DeviceAttributeCollectionState.Type;

export const DeviceAttributeCollectionResponse = Schema.Struct({
  /** Collection state keyed by attribute key; absent until a first attempt. */
  collection: Schema.Record(Schema.String, DeviceAttributeCollectionState),
});

export type DeviceAttributeCollectionResponse = typeof DeviceAttributeCollectionResponse.Type;

export const CollectDeviceAttributeResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Queued execution the device will collect on its next poll. */
  executionId: Schema.String,
});

export type CollectDeviceAttributeResponse = typeof CollectDeviceAttributeResponse.Type;

export const ImportDeviceAttributesRequest = Schema.Struct({
  /** RFC 4180 CSV with a `serial` column and one `attribute:<key>` column per attribute. */
  csv: Schema.String,
});

export type ImportDeviceAttributesRequest = typeof ImportDeviceAttributesRequest.Type;

export const DeviceAttributeImportResult = Schema.Struct({
  /** 1-based CSV record number, excluding the header. */
  row: Schema.Number,
  serial: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.Literals(["updated", "unchanged", "skipped", "error"]),
  deviceId: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DeviceAttributeImportResult = typeof DeviceAttributeImportResult.Type;

export const DeviceAttributeImportResponse = Schema.Struct({
  results: Schema.Array(DeviceAttributeImportResult),
  updated: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
});

export type DeviceAttributeImportResponse = typeof DeviceAttributeImportResponse.Type;

/** One custom question on the public enrollment page. */
export const EnrollmentQuestion = Schema.Struct({
  /** Attribute key the answer is written to. */
  key: Schema.String,
  label: Schema.String,
  type: AttributeType,
  options: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  required: Schema.Boolean,
  sortOrder: Schema.Number,
});

export type EnrollmentQuestion = typeof EnrollmentQuestion.Type;

export const EnrollmentQuestionRow = Schema.Struct({
  ...EnrollmentQuestion.fields,
  id: Schema.String,
  attributeId: Schema.String,
});

export type EnrollmentQuestionRow = typeof EnrollmentQuestionRow.Type;

export const EnrollmentQuestionListResponse = Schema.Struct({
  rows: Schema.Array(EnrollmentQuestionRow),
});

export type EnrollmentQuestionListResponse = typeof EnrollmentQuestionListResponse.Type;

export const EnrollmentQuestionInput = Schema.Struct({
  key: Schema.String,
  prompt: Schema.optional(Schema.NullOr(Schema.String)),
  required: Schema.optional(Schema.NullOr(Schema.Boolean)),
  sortOrder: Schema.optional(Schema.Number),
});

export type EnrollmentQuestionInput = typeof EnrollmentQuestionInput.Type;

/** Replaces the tenant's question list in one write. */
export const PatchEnrollmentQuestionsRequest = Schema.Struct({
  questions: Schema.Array(EnrollmentQuestionInput),
});

export type PatchEnrollmentQuestionsRequest = typeof PatchEnrollmentQuestionsRequest.Type;

export const SubmitEnrollmentAnswersRequest = Schema.Struct({
  /** Enrollment password, when the tenant configured one. */
  code: Schema.optional(NullOrString),
  /** Hardware serial the answers belong to; matched at the first check-in. */
  serial: Schema.String,
  /** Optional device name applied to an existing pre-registration row. */
  name: Schema.optional(NullOrString),
  /** Optional asset tag applied to an existing pre-registration row. */
  assetTag: Schema.optional(NullOrString),
  answers: Schema.Record(Schema.String, Schema.String),
});

export type SubmitEnrollmentAnswersRequest = typeof SubmitEnrollmentAnswersRequest.Type;

export const SubmitEnrollmentAnswersResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Number of answers stored; they are applied when the device checks in. */
  stored: Schema.Number,
});

export type SubmitEnrollmentAnswersResponse = typeof SubmitEnrollmentAnswersResponse.Type;
