import { Schema } from "effect";
import { ATTRIBUTE_KEY_PATTERN } from "./attributes.js";

/**
 * Policy variables.
 *
 * Configuration payloads may reference a small, closed set of contexts:
 *
 *   ${device.name}        device display name
 *   ${device.serial}      hardware serial
 *   ${device.model}       model name as reported by the device
 *   ${tenant.name}        tenant (organisation) name
 *   ${attribute.<key>}    a tenant-defined device attribute
 *
 * Variables are resolved per device when a policy is compiled for delivery
 * (Apple declarations, legacy mobileconfig profiles and Windows SyncML nodes
 * all share the resolver). They are never sent to the device unresolved:
 * validation refuses unknown names when a policy is saved, and an attribute
 * that has no value for a specific device resolves to an empty string.
 *
 * `$${...}` is an escape and renders the literal text `${...}`. There is no
 * way to reference secrets: only the contexts above resolve, so a name such as
 * `${device.recoveryKey}` is rejected.
 */

export const POLICY_VARIABLE_NAMESPACES = ["device", "tenant", "attribute"] as const;

/** Variables that are available to every policy, independent of the registry. */
export const POLICY_BUILT_IN_VARIABLES = [
  "device.name",
  "device.serial",
  "device.model",
  "tenant.name",
] as const;

export type PolicyBuiltInVariable = (typeof POLICY_BUILT_IN_VARIABLES)[number];

export const POLICY_ATTRIBUTE_VARIABLE_PREFIX = "attribute.";

export const policyAttributeVariable = (key: string) => `${POLICY_ATTRIBUTE_VARIABLE_PREFIX}${key}`;

/** Every variable name a tenant can use, for the editor's hint list. */
export const policyVariableNames = (attributeKeys: ReadonlyArray<string>): Array<string> => [
  ...POLICY_BUILT_IN_VARIABLES,
  ...attributeKeys.flatMap((key) =>
    ATTRIBUTE_KEY_PATTERN.test(key) ? [policyAttributeVariable(key)] : [],
  ),
];

export type PolicyVariableContext = {
  readonly device?: {
    readonly name?: string | null;
    readonly serial?: string | null;
    readonly model?: string | null;
  } | null;
  readonly tenant?: { readonly name?: string | null } | null;
  /** Attribute values keyed by definition key. */
  readonly attributes?: Readonly<Record<string, string | null | undefined>> | null;
};

const BUILT_IN_VARIABLES: ReadonlySet<string> = new Set(POLICY_BUILT_IN_VARIABLES);

const isKnownVariable = (name: string, attributeKeys: ReadonlySet<string>) => {
  if (BUILT_IN_VARIABLES.has(name)) return true;

  if (name.startsWith(POLICY_ATTRIBUTE_VARIABLE_PREFIX)) {
    const key = name.slice(POLICY_ATTRIBUTE_VARIABLE_PREFIX.length);

    return ATTRIBUTE_KEY_PATTERN.test(key) && attributeKeys.has(key);
  }

  return false;
};

type ScanResult =
  | {
      readonly ok: true;
      /** Variable names found outside escaped spans. */
      readonly variables: Array<string>;
      readonly rendered: string;
    }
  | { readonly ok: false; readonly error: string };

const scan = (
  input: string,
  attributeKeys: ReadonlySet<string>,
  resolve: (name: string) => string | null,
  validate: boolean,
): ScanResult => {
  let output = "";
  const variables: Array<string> = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index]!;

    // `$${...}` is an escape: copy the literal `${...}` span verbatim.
    if (character === "$" && input[index + 1] === "$" && input[index + 2] === "{") {
      const end = input.indexOf("}", index + 3);

      if (end === -1)
        return { ok: false, error: "An escaped variable is missing its closing brace: $${...}" };

      output += input.slice(index + 1, end + 1);
      index = end + 1;

      continue;
    }

    if (character === "$" && input[index + 1] === "{") {
      const end = input.indexOf("}", index + 2);

      if (end === -1)
        return { ok: false, error: "A policy variable is missing its closing brace: ${...}" };

      const name = input.slice(index + 2, end).trim();

      if (!name) return { ok: false, error: "A policy variable has an empty name: ${}" };

      if (name.includes("${"))
        return { ok: false, error: `Nested policy variables are not supported: \${${name}}` };

      if (validate && !isKnownVariable(name, attributeKeys)) {
        const suggestion = name.startsWith(POLICY_ATTRIBUTE_VARIABLE_PREFIX)
          ? ` Register the attribute first, or use one of: ${[
              ...POLICY_BUILT_IN_VARIABLES,
              ...(attributeKeys.size ? [...attributeKeys].map(policyAttributeVariable) : []),
            ].join(", ")}.`
          : ` Use one of: ${[...POLICY_BUILT_IN_VARIABLES].join(", ")}.`;

        return {
          ok: false,
          error: `Unknown policy variable "\${${name}}".${suggestion}`,
        };
      }

      variables.push(name);
      const replacement = resolve(name);

      // An unknown name at compile time (for example after an attribute was
      // deleted) must never ship as literal text.
      output += replacement ?? "";
      index = end + 1;

      continue;
    }

    output += character;
    index++;
  }

  return { ok: true, variables, rendered: output };
};

/** Every variable referenced by a single string, with escapes honoured. */
export const extractPolicyVariables = (input: string): Array<string> => {
  const result = scan(input, new Set(), () => null, false);

  return result.ok ? result.variables : [];
};

/** Validate one string. Returns a human-readable problem or null. */
export const policyVariableProblem = (
  input: string,
  attributeKeys: ReadonlyArray<string>,
): string | null => {
  const result = scan(input, new Set(attributeKeys), () => null, true);

  return result.ok ? null : result.error;
};

/**
 * Validate every string in a configuration payload. The first problem is
 * returned with the JSON path so the editor can point at the field.
 */
export const policyConfigurationVariableProblem = (
  value: Schema.Json,
  attributeKeys: ReadonlyArray<string>,
  path: ReadonlyArray<string> = [],
): string | null => {
  if (Schema.is(Schema.String)(value)) {
    const problem = policyVariableProblem(value, attributeKeys);

    return problem ? `${formatPath(path)}: ${problem}` : null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const problem = policyConfigurationVariableProblem(item, attributeKeys, [
        ...path,
        String(index),
      ]);

      if (problem) return problem;
    }

    return null;
  }

  if (Schema.is(Schema.JsonObject)(value)) {
    for (const [key, item] of Object.entries(value)) {
      const problem = policyConfigurationVariableProblem(item, attributeKeys, [...path, key]);

      if (problem) return problem;
    }
  }

  return null;
};

const formatPath = (path: ReadonlyArray<string>) =>
  path.reduce(
    (accumulator, segment) =>
      /^\d+$/.test(segment) ? `${accumulator}[${segment}]` : `${accumulator}.${segment}`,
    "Configuration",
  );

const valueFor = (name: string, context: PolicyVariableContext): string => {
  if (name.startsWith(POLICY_ATTRIBUTE_VARIABLE_PREFIX))
    return context.attributes?.[name.slice(POLICY_ATTRIBUTE_VARIABLE_PREFIX.length)] ?? "";

  switch (name) {
    case "device.name":
      return context.device?.name ?? "";
    case "device.serial":
      return context.device?.serial ?? "";
    case "device.model":
      return context.device?.model ?? "";
    case "tenant.name":
      return context.tenant?.name ?? "";
    default:
      return "";
  }
};

/** Resolve every variable in one string. Escapes survive as literal text. */
export const substitutePolicyVariablesInString = (
  input: string,
  context: PolicyVariableContext,
): string => {
  const result = scan(input, new Set(), (name) => valueFor(name, context), false);

  return result.ok ? result.rendered : input;
};

/** Whether a payload contains anything the resolver needs to process. */
export const containsPolicyVariables = (value: Schema.Json): boolean => {
  if (Schema.is(Schema.String)(value)) return value.includes("${");

  if (Array.isArray(value)) return value.some(containsPolicyVariables);

  if (Schema.is(Schema.JsonObject)(value))
    return Object.values(value).some((item) => containsPolicyVariables(item));

  return false;
};

/**
 * Resolve every string in a configuration payload. Object keys are left
 * untouched: a variable in a key would change the payload's shape.
 */
export const substitutePolicyVariables = (
  value: Schema.Json,
  context: PolicyVariableContext,
): Schema.Json => {
  if (Schema.is(Schema.String)(value)) return substitutePolicyVariablesInString(value, context);

  if (Array.isArray(value)) return value.map((item) => substitutePolicyVariables(item, context));

  if (Schema.is(Schema.JsonObject)(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitutePolicyVariables(item, context)]),
    );

  return value;
};

/** Payload used by the policy editor to render variable hints. */
export const PolicyVariableInfo = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
});

export type PolicyVariableInfo = typeof PolicyVariableInfo.Type;

export const PolicyVariablesResponse = Schema.Struct({
  /** Every resolvable variable name, including registered attribute keys. */
  variables: Schema.Array(PolicyVariableInfo),
  /** Escaping and missing-value rules, verbatim for the editor. */
  notes: Schema.Array(Schema.String),
});

export type PolicyVariablesResponse = typeof PolicyVariablesResponse.Type;

const BUILT_IN_DESCRIPTIONS = new Map<string, string>(
  Object.entries({
    "device.name": "The device's display name in this tenant.",
    "device.serial": "The hardware serial reported at enrollment.",
    "device.model": "The model name reported by the device.",
    "tenant.name": "The tenant (organisation) name.",
  }),
);

export const policyVariableInfo = (
  attributeKeys: ReadonlyArray<string>,
  attributes: ReadonlyArray<{ readonly key: string; readonly label: string }> = [],
): Array<PolicyVariableInfo> => {
  const labels = new Map(attributes.map((attribute) => [attribute.key, attribute.label]));

  return policyVariableNames(attributeKeys).map((name) => {
    if (name.startsWith(POLICY_ATTRIBUTE_VARIABLE_PREFIX)) {
      const key = name.slice(POLICY_ATTRIBUTE_VARIABLE_PREFIX.length);

      return {
        name: `\${${name}}`,
        description: `Device attribute "${labels.get(key) ?? key}". Empty when the device has no value.`,
      };
    }

    return {
      name: `\${${name}}`,
      description: BUILT_IN_DESCRIPTIONS.get(name) ?? "A built-in device or tenant value.",
    };
  });
};

export const POLICY_VARIABLE_NOTES = [
  "Variables resolve per device when a policy is compiled for delivery.",
  "Unknown variables are rejected when the policy is saved.",
  "Write $${...} to render a literal ${...} without resolving it.",
  "Secrets are never available: only the device, tenant and attribute contexts resolve.",
] as const;
