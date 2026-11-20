import { Schema } from "effect";
import type {
  AdmxElementKind,
  AdmxElementValue,
  AdmxPolicyState,
  AdmxTranslation,
  AdmxTranslationIssue,
} from "./types.js";

/**
 * Translation from an ADMX policy to a Policy CSP (`Config`) payload.
 *
 * Two delivery paths share this translation:
 *
 * - Microsoft in-box templates are already exposed by the catalogue under
 *   `./Device/Vendor/MSFT/Policy/Config/ADMX_<area>/<PolicyName>`.
 * - Vendor templates are ingested first with `ADMXInstall`, then written to
 *   `./Device/Vendor/MSFT/Policy/Config/<AppName>~Policy~<CategoryPath>/<PolicyName>`.
 *
 * The value is the same in both cases: `<enabled/>` or `<disabled/>` followed
 * by one `<data id="..." value="..."/>` per configured element.
 */

/** The root the Policy CSP uses for machine-scoped policies. */
export const ADMX_DEVICE_ROOT = "./Device";

/** The root the Policy CSP uses for user-scoped policies. */
export const ADMX_USER_ROOT = "./User";

/** The device-scoped node that installs a vendor ADMX file. */
export const admxInstallOmaUri = (appName: string, fileId: string) =>
  `./Device/Vendor/MSFT/Policy/ConfigOperations/ADMXInstall/${appName}/Policy/${fileId}`;

/** Characters allowed in the path segments the CSP requires. */
export const admxSegment = (value: string, fallback = "ADMX") => {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");

  return (cleaned || fallback).slice(0, 64);
};

/** The `~Policy~` area name for an ingested vendor ADMX policy. */
export const admxVendorArea = (appName: string, categoryPath: readonly string[]) =>
  [admxSegment(appName), "Policy", ...categoryPath.map((name) => admxSegment(name))]
    .join("~")
    .slice(0, 400);

/** The `Config` URI for a vendor policy that was ingested with `ADMXInstall`. */
export const admxVendorPolicyOmaUri = (options: {
  readonly appName: string;
  readonly categoryPath: readonly string[];
  readonly policyName: string;
  readonly scope: "device" | "user";
}) =>
  `${options.scope === "user" ? ADMX_USER_ROOT : ADMX_DEVICE_ROOT}/Vendor/MSFT/Policy/Config/${admxVendorArea(options.appName, options.categoryPath)}/${admxSegment(options.policyName, "Policy")}`;

/** The `Config` URI for a policy the in-box catalogue already exposes. */
export const admxInboxPolicyOmaUri = (options: {
  readonly area: string;
  readonly policyName: string;
  readonly scope: "device" | "user";
}) =>
  `${options.scope === "user" ? ADMX_USER_ROOT : ADMX_DEVICE_ROOT}/Vendor/MSFT/Policy/Config/${options.area}/${options.policyName}`;

/** The app name for an ingested template, derived from its namespace or file. */
export const admxAppName = (options: {
  readonly namespace?: string;
  readonly prefix?: string;
  readonly fileName: string;
}) => {
  const fromNamespace = options.namespace?.split(".").filter(Boolean).pop();
  const fromPrefix = options.prefix;
  const fromFile = options.fileName.replace(/\.admx$/i, "");

  return admxSegment(fromNamespace || fromPrefix || fromFile, "Vendor");
};

/** The unique file id within one app; kept stable across re-imports. */
export const admxFileId = (fileName: string) =>
  `${admxSegment(fileName.replace(/\.admx$/i, ""), "ADMX")}Admx`;

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r\n", "&#10;")
    .replaceAll("\r", "&#10;")
    .replaceAll("\n", "&#10;")
    // The CSP separates List and MultiText entries with Unicode private-use
    // character 0xF000; an attribute cannot carry it literally.
    .replaceAll("\u{F000}", "&#xF000;");

const DECIMAL = /^-?\d+$/;

/** The CSP expects ADMX boolean data as the strings true/false. */
const booleanValue = (value: AdmxElementValue): string | undefined => {
  if (value === true || value === 1) return "true";

  if (value === false || value === 0) return "false";

  if (Schema.is(Schema.String)(value)) {
    const normalised = value.trim().toLowerCase();

    if (normalised === "true" || normalised === "1") return "true";

    if (normalised === "false" || normalised === "0") return "false";
  }

  return undefined;
};

/** List and MultiText entries are separated by U+F000. */
const LIST_SEPARATOR = "\u{F000}";

const listValue = (value: AdmxElementValue): string | undefined => {
  if (Schema.is(Schema.Array(Schema.String))(value))
    return value.map((entry) => String(entry)).join(LIST_SEPARATOR);

  // A textarea (or a hand-written value) may use newlines instead of the
  // separator; normalise both to the character the CSP expects.
  if (Schema.is(Schema.String)(value)) return value.split(/\r?\n/).join(LIST_SEPARATOR);

  if (Schema.is(Schema.Number)(value) || Schema.is(Schema.Boolean)(value)) return String(value);

  return undefined;
};

/** Serialize one element value the way the Policy CSP expects it. */
export const admxDataValue = (
  kind: AdmxElementKind,
  value: AdmxElementValue,
): string | undefined => {
  switch (kind) {
    case "boolean":
      return booleanValue(value);
    case "decimal":
    case "longDecimal": {
      const text = String(value).trim();

      return DECIMAL.test(text) ? text : undefined;
    }

    case "list":
    case "multiText":
      return listValue(value);
    case "enum":
    case "text":
      return String(value);
  }
};

export type AdmxPolicySpec = {
  readonly elements?: ReadonlyArray<{
    readonly id: string;
    readonly kind: AdmxElementKind;
    readonly required?: boolean;
  }>;
};

/**
 * Build the `<enabled/>`/`<disabled/>` payload for one policy.
 *
 * Disabled policies deliberately drop element values: the CSP ignores them, and
 * including them would suggest a value is applied when it is not.
 */
export const translateAdmxPolicy = (
  spec: AdmxPolicySpec,
  state: AdmxPolicyState,
): AdmxTranslation => {
  const issues: AdmxTranslationIssue[] = [];

  if (!state.enabled) return { payload: "<disabled/>", issues };

  const parts = ["<enabled/>"];

  for (const element of spec.elements ?? []) {
    const raw = state.values?.[element.id];

    if (raw === undefined || raw === null || raw === "") {
      if (element.required)
        issues.push({
          severity: "warning",
          elementId: element.id,
          message: `Element "${element.id}" is required by the template but has no value.`,
        });

      continue;
    }

    const value = admxDataValue(element.kind, raw);

    if (value === undefined) {
      issues.push({
        severity: "error",
        elementId: element.id,
        message: `Element "${element.id}" has a value that is not valid for a ${element.kind} element.`,
      });

      continue;
    }

    parts.push(`<data id="${escapeAttribute(element.id)}" value="${escapeAttribute(value)}"/>`);
  }

  return { payload: parts.join(""), issues };
};
