/**
 * The ADMX/ADML model.
 *
 * Microsoft's Administrative Template format has two halves: the `.admx` file
 * carries the machine-readable policy definitions (registry keys, values and
 * element types), and the language-specific `.adml` file carries every
 * human-readable string and presentation element. We keep them as one model
 * because a policy cannot be shown without both, and because a missing ADML is
 * a display problem rather than a parse failure.
 *
 * These types are deliberately plain data: the parser never keeps DOM nodes,
 * so a parsed bundle can be stored, compared in tests and translated without a
 * DOM implementation.
 */

/** Whether a policy writes the machine or user hive. */
export type AdmxPolicyClass = "user" | "machine" | "both";

/** The element kinds the Policy CSP ADMX payload understands. */
export type AdmxElementKind =
  | "boolean"
  | "decimal"
  | "longDecimal"
  | "text"
  | "enum"
  | "list"
  | "multiText";

/** A registry value written by `enabledValue`, `disabledValue` or an element item. */
export type AdmxRegistryValue =
  | { readonly kind: "decimal"; readonly value: string }
  | { readonly kind: "longDecimal"; readonly value: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: string }
  | { readonly kind: "delete" };

/** One registry value in an `enabledList`/`disabledList`. */
export type AdmxRegistryItem = {
  readonly key?: string;
  readonly valueName: string;
  readonly value: AdmxRegistryValue;
};

/** One option of an `enum` element, in ADMX order. */
export type AdmxEnumItem = {
  readonly displayName: string;
  readonly value: AdmxRegistryValue;
};

/** A configurable element inside a policy definition. */
export type AdmxElement = {
  /** The `id` used as `<data id="...">` in the Policy CSP payload. */
  readonly id: string;
  readonly kind: AdmxElementKind;
  /** Human label from the ADML presentation, falling back to the element id. */
  readonly label: string;
  /** Static help text from the ADML presentation, if the template has any. */
  readonly description: string;
  readonly key?: string;
  readonly valueName?: string;
  readonly required: boolean;
  readonly minValue?: string;
  readonly maxValue?: string;
  /** Zero-based default from the ADML `dropdownList`/`comboBox`. */
  readonly defaultItem?: number;
  /** Default text from the ADML `textBox`/`decimalTextBox`, when present. */
  readonly defaultValue?: string;
  /** `enum` and `list` options, in template order. */
  readonly items?: readonly AdmxEnumItem[];
  /** Constructs we could parse but cannot represent in an MDM payload. */
  readonly unsupported?: readonly string[];
};

/** One ADML presentation element, kept in template order. */
export type AdmxPresentationPart = {
  readonly kind:
    | "text"
    | "checkBox"
    | "textBox"
    | "decimalTextBox"
    | "longDecimalTextBox"
    | "dropdownList"
    | "comboBox"
    | "listBox"
    | "multiTextBox";
  readonly refId?: string;
  readonly label?: string;
  /** Text content, used by `text` and `checkBox` labels. */
  readonly text?: string;
  readonly defaultChecked?: boolean;
  readonly defaultValue?: string;
  readonly defaultItem?: number;
  readonly items?: readonly string[];
};

/** A parsed `<policy>` definition. */
export type AdmxPolicy = {
  readonly name: string;
  readonly className: AdmxPolicyClass;
  readonly displayName: string;
  readonly description: string;
  /** Registry key the policy writes to. Informational; MDM sends the payload. */
  readonly key: string;
  readonly valueName?: string;
  /** Category names from the root, as used in the Policy CSP area name. */
  readonly categoryPath: readonly string[];
  /** Localized category labels, root first, for display only. */
  readonly categoryDisplayPath: readonly string[];
  readonly presentations: readonly AdmxPresentationPart[];
  readonly elements: readonly AdmxElement[];
  readonly enabledValue?: AdmxRegistryValue;
  readonly disabledValue?: AdmxRegistryValue;
  readonly enabledList?: readonly AdmxRegistryItem[];
  readonly disabledList?: readonly AdmxRegistryItem[];
  readonly supportedOn?: string;
  /** Reasons this policy cannot be translated into an MDM payload. */
  readonly unsupported: readonly string[];
};

/** A parsed `.admx` file, with its `.adml` strings already applied. */
export type AdmxFile = {
  readonly fileName: string;
  /** `<policyNamespaces><target namespace>`, for example Microsoft.Policies.SrmFci. */
  readonly namespace?: string;
  /** `<policyNamespaces><target prefix>`, for example srmfci. */
  readonly prefix?: string;
  readonly policies: readonly AdmxPolicy[];
  /** String ids the ADML did not define. Bounded, so a bad file cannot grow unbounded. */
  readonly unresolvedStrings: readonly string[];
  /** Display-level problems, for example a missing ADML. */
  readonly warnings: readonly string[];
};

/** The three states a policy has in Group Policy, expressed for the CSP payload. */
export type AdmxPolicyState = {
  readonly enabled: boolean;
  /**
   * Element id to the value the administrator chose. Values are normalised by
   * kind when translated (booleans become 1/0, lists become newline-separated).
   */
  readonly values?: Readonly<Record<string, AdmxElementValue | undefined>>;
};

export type AdmxElementValue = string | number | boolean | readonly string[];

export type AdmxTranslationIssue = {
  readonly severity: "warning" | "error";
  readonly elementId?: string;
  readonly message: string;
};

export type AdmxTranslation = {
  readonly payload: string;
  readonly issues: readonly AdmxTranslationIssue[];
};

/** A file that was read from a picker, a drop or a zip. */
export type AdmxInputFile = {
  readonly name: string;
  readonly text: string;
};

/** One catalogue address an in-box ADMX policy is already exposed under. */
export type AdmxCatalogueEntry = {
  readonly area: string;
  readonly scope: "device" | "user";
  readonly collectionId: string;
  readonly policyName: string;
};

/** Compact lookup generated from `data/catalog/windows.json` at split time. */
export type AdmxCatalogueIndex = {
  readonly version: 1;
  /** Lowercased ADMX policy name to every catalogue address that exposes it. */
  readonly policies: Readonly<Record<string, readonly AdmxCatalogueEntry[]>>;
};

export type AdmxCatalogueMatch =
  | { readonly status: "matched"; readonly entry: AdmxCatalogueEntry }
  | { readonly status: "unmatched"; readonly reason: string };

/** One policy discovered by an import, with the delivery target resolved. */
export type AdmxDiscoveredPolicy = {
  readonly policy: AdmxPolicy;
  readonly admxFileName: string;
  /** Microsoft in-box policies map to the catalogue; vendor policies are ingested. */
  readonly source: "inbox" | "vendor";
  readonly appName: string;
  readonly fileId: string;
  readonly scope: "device" | "user";
  /** The Policy CSP `Config` URI the payload is written to. */
  readonly omaUri: string;
  /** The `ADMXInstall` URI, vendor policies only. */
  readonly ingestionUri?: string;
  /** The original ADMX text, vendor policies only. */
  readonly admxPayload?: string;
  readonly catalogueEntry?: AdmxCatalogueEntry;
  /** Why this policy cannot be added to a policy, when it cannot. */
  readonly unmappable?: string;
};

export type AdmxImportIssue = {
  readonly severity: "error" | "warning";
  readonly fileName?: string;
  readonly message: string;
};

export type AdmxFileSummary = {
  readonly fileName: string;
  readonly policyCount: number;
  readonly error?: string;
};

export type AdmxBundle = {
  readonly files: readonly AdmxFileSummary[];
  readonly policies: readonly AdmxDiscoveredPolicy[];
  readonly issues: readonly AdmxImportIssue[];
  /** True when the bundle exceeded the policy cap and was cut short. */
  readonly truncated: boolean;
};
