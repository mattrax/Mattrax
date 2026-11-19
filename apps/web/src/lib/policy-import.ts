import { Effect, Option, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import {
  PortablePolicy,
  PortablePolicyDocument,
  type PolicyRow,
} from "@mattrax/enterprise-domain/client";

/**
 * Policy import: turn a portable policy document or a `.mobileconfig` into the
 * configuration patch the existing save endpoints accept.
 *
 * The planning here is pure so the preview and the save cannot disagree: the
 * dialog renders the plan and sends `plan.payload` unchanged.
 */

/** Same ceiling as a single stored profile; a larger file is not a policy. */
export const POLICY_IMPORT_MAX_CHARS = 8 * 1024 * 1024;

const CUSTOM_KIND = /^mttx\.apple\.custom\.(.+)$/;

const base64Prefix = /^data:[^;]+;base64,/;

const base64Body = /^[A-Za-z0-9+/=\s]+$/;

const JsonObject = Schema.Record(Schema.String, Schema.Json);

/** Stored configuration payloads, as the policy row exposes them. */
type ConfigurationMap = NonNullable<PolicyRow["configurations"]>;

type ConfigurationValue = ConfigurationMap[string];

export type PolicyImportScope = "device" | "user";

export type PolicyImportSource = "document" | "mobileconfig";

/** What to do when the target policy already has the imported kind. */
export type PolicyImportConflict = "skip" | "overwrite";

/** The subset of a policy the planner needs; a full `PolicyRow` satisfies it. */
export type PolicyImportTarget = {
  readonly name: string;
  readonly notes?: string | null;
  readonly configurations?: ConfigurationMap;
  readonly configurationScopes?: Record<string, PolicyImportScope>;
};

export type PolicyImportAction = "add" | "overwrite" | "unchanged" | "skip";

export type PolicyImportConfiguration = {
  readonly kind: string;
  readonly data: Schema.Json;
  readonly scope: PolicyImportScope;
  readonly action: PolicyImportAction;
};

export type PolicyImportPlan = {
  readonly source: PolicyImportSource;
  /** Policy name used when the import creates the policy. */
  readonly name: string;
  readonly notes: string | null;
  readonly priority: number | undefined;
  readonly enabled: boolean | undefined;
  readonly configurations: ReadonlyArray<PolicyImportConfiguration>;
  readonly warnings: ReadonlyArray<string>;
  /**
   * Exactly what the save sends. Kinds reported as `skip` or `unchanged` are
   * absent, so a save cannot silently overwrite what the preview said it would
   * leave alone.
   */
  readonly payload: {
    readonly configurations: Record<string, Schema.Json>;
    readonly configurationScopes: Record<string, PolicyImportScope>;
  };
};

/** The stored shape of one uploaded profile. */
export type MobileconfigSource = {
  readonly content: string;
  readonly signed: boolean;
};

const asJsonObject = (value: Schema.Json) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(JsonObject)(value));

/** Compare payloads regardless of object key order. */
export const stableJson = (value: Schema.Json): string =>
  JSON.stringify(value, (_key, nested) => {
    const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(nested));
    const record = decoded === undefined ? undefined : asJsonObject(decoded);

    if (!record) return nested;

    return Object.fromEntries(
      Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
    );
  });

const decodePolicy = (value: Schema.Json) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(PortablePolicy)(value));

/**
 * Parse a policy exported by `mattrax policies export` (YAML or JSON) or a
 * bare policy object pasted from `GET /policies/:id`.
 *
 * The document may contain several policies, but an import is policy-level:
 * creating still imports a single policy, and merging needs exactly one.
 */
export const parsePolicyImportText = (
  text: string,
  source = "policy document",
): Effect.Effect<PortablePolicy, string> =>
  Effect.gen(function* () {
    const trimmed = text.trim();

    if (!trimmed) return yield* Effect.fail("Paste a policy document or choose a file.");

    if (trimmed.length > POLICY_IMPORT_MAX_CHARS)
      return yield* Effect.fail("The policy document is too large to import.");

    const decoded = yield* Effect.try({
      try: () => Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(parseYaml(trimmed))),
      catch: () => `${source} is not valid JSON or YAML.`,
    });

    if (decoded === undefined) return yield* Effect.fail(`${source} is not valid JSON or YAML.`);

    const record = asJsonObject(decoded);

    if (record && "policies" in record) {
      const document = Option.getOrUndefined(
        Schema.decodeUnknownOption(PortablePolicyDocument)(record),
      );

      if (!document)
        return yield* Effect.fail(
          `${source} is not a Mattrax policy document. Expected \`version: 1\` and a \`policies\` array.`,
        );

      if (document.policies.length === 0)
        return yield* Effect.fail(`${source} does not contain a policy.`);

      if (document.policies.length > 1)
        return yield* Effect.fail(
          `${source} contains ${document.policies.length} policies. Import one at a time, for example \`mattrax policies export --id <policy-id> --format json\`.`,
        );

      return document.policies[0]!;
    }

    const policy = decodePolicy(decoded);

    if (!policy)
      return yield* Effect.fail(
        `${source} is not a Mattrax policy. Expected \`{ version: 1, policies: [...] }\` or a single policy with a \`name\`.`,
      );

    return policy;
  });

const mobileconfigKinds = (existing: PolicyImportTarget | undefined): ReadonlyArray<string> =>
  Object.keys(existing?.configurations ?? {}).filter((kind) => CUSTOM_KIND.test(kind));

/** The stored `content` of a custom profile configuration, when it has one. */
const customContent = (data: ConfigurationValue): string | undefined => {
  const json = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(data));

  if (json === undefined) return undefined;
  const record = asJsonObject(json);

  if (!record) return undefined;

  return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(record.content));
};

const existingCustomContent = (existing: PolicyImportTarget | undefined): Map<string, string> => {
  const contents = new Map<string, string>();

  for (const [kind, data] of Object.entries(existing?.configurations ?? {})) {
    const content = customContent(data);

    if (CUSTOM_KIND.test(kind) && content !== undefined) contents.set(kind, content);
  }

  return contents;
};

/** Pick an unused `mttx.apple.custom.<id>` that the editor will recognise. */
export const nextMobileconfigKind = (existing: PolicyImportTarget | undefined): string => {
  const kinds = new Set(mobileconfigKinds(existing));

  if (!kinds.has("mttx.apple.custom.imported")) return "mttx.apple.custom.imported";

  for (let index = 2; ; index++) {
    const kind = `mttx.apple.custom.imported${index}`;

    if (!kinds.has(kind)) return kind;
  }
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const profileText = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim();

const looksLikeProfileText = (text: string) =>
  text.startsWith("<?xml") || text.startsWith("<plist");

const looksLikePem = (text: string) => /-----BEGIN (?:PKCS7|CMS)-----/.test(text);

/**
 * Normalise a pasted `.mobileconfig` or uploaded profile bytes to the stored
 * representation (base64 `content` plus a `signed` hint).
 *
 * `content` is either raw plist/PEM text or base64. Signed profiles are kept
 * byte-for-byte: the device verifies the signature, so the import never rewrites
 * them.
 */
export const normalizeMobileconfig = (input: {
  readonly content: string;
  readonly fileName?: string;
}): MobileconfigSource => {
  const raw = input.content.trim();

  if (!raw) throw new Error("The mobileconfig is empty.");

  if (raw.length > POLICY_IMPORT_MAX_CHARS)
    throw new Error("The mobileconfig is too large to import.");

  // Pasted or uploaded plist text: encode it the way the editor stores it.
  if (looksLikeProfileText(raw))
    return { content: bytesToBase64(new TextEncoder().encode(raw)), signed: false };

  // A PEM-wrapped CMS signature is signed content; keep the PEM bytes.
  if (looksLikePem(raw))
    return { content: bytesToBase64(new TextEncoder().encode(raw)), signed: true };

  const content = raw.replace(base64Prefix, "").replace(/\s/g, "");

  if (!base64Body.test(content) || content.length === 0)
    throw new Error("This file is not a .mobileconfig profile.");

  let bytes: Uint8Array;

  try {
    bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("This file is not a .mobileconfig profile.");
  }

  // DER-encoded PKCS#7 starts with a SEQUENCE; plist text is always XML.
  if (bytes[0] === 0x30) return { content, signed: true };

  const text = profileText(bytes);

  if (looksLikeProfileText(text)) return { content, signed: false };

  if (looksLikePem(text)) return { content, signed: true };

  throw new Error("This file is not a .mobileconfig profile.");
};

type ConfigurationEntry = {
  readonly kind: string;
  readonly data: Schema.Json;
  readonly scope: PolicyImportScope;
};

const planConfigurations = (input: {
  readonly configurations: ReadonlyArray<ConfigurationEntry>;
  readonly existing: PolicyImportTarget | undefined;
  readonly conflict: PolicyImportConflict;
}) => {
  const existingConfigurations = input.existing?.configurations ?? {};
  const written: Record<string, Schema.Json> = {};
  const scopes: Record<string, PolicyImportScope> = {};
  const configurations: PolicyImportConfiguration[] = [];

  for (const entry of input.configurations) {
    const stored = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Json)(existingConfigurations[entry.kind]),
    );

    const scope = entry.scope;

    if (stored === undefined) {
      configurations.push({ ...entry, scope, action: "add" });
      written[entry.kind] = entry.data;
      scopes[entry.kind] = scope;
      continue;
    }

    if (stableJson(stored) === stableJson(entry.data)) {
      configurations.push({ ...entry, scope, action: "unchanged" });
      continue;
    }

    if (input.conflict === "overwrite") {
      configurations.push({ ...entry, scope, action: "overwrite" });
      written[entry.kind] = entry.data;
      scopes[entry.kind] = scope;
      continue;
    }

    configurations.push({ ...entry, scope, action: "skip" });
  }

  return { configurations, payload: { configurations: written, configurationScopes: scopes } };
};

/**
 * Plan a portable policy document import. When `existing` is supplied the
 * import only adds or overwrites configurations: metadata and assignments stay
 * with the target policy, and an omitted scope keeps the stored channel.
 */
export const planPolicyImport = (input: {
  readonly policy: PortablePolicy;
  readonly existing?: PolicyImportTarget;
  readonly conflict?: PolicyImportConflict;
}): PolicyImportPlan => {
  const conflict = input.conflict ?? "skip";
  const warnings: string[] = [];
  const entries: ConfigurationEntry[] = [];

  for (const [kind, value] of Object.entries(input.policy.configurations ?? {})) {
    if (value === null) {
      warnings.push(`"${kind}" is null in the document; an import cannot delete configurations.`);
      continue;
    }

    const data = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(value));

    if (data === undefined) {
      warnings.push(`"${kind}" is not valid JSON and was skipped.`);

      continue;
    }

    entries.push({
      kind,
      data,
      scope:
        input.policy.configurationScopes?.[kind] ??
        input.existing?.configurationScopes?.[kind] ??
        "device",
    });
  }

  if (entries.length === 0) warnings.push("The document does not contain any configurations.");

  if (input.existing && input.policy.name !== input.existing.name)
    warnings.push(
      `The document names the policy "${input.policy.name}". Only its configurations are imported into "${input.existing.name}".`,
    );

  if (input.existing && (input.policy.notes || input.policy.priority !== undefined))
    warnings.push("Notes and priority are kept from the existing policy.");

  if (!input.existing && input.policy.enabled === false)
    warnings.push("The document is disabled, so the policy is created disabled.");

  const { configurations, payload } = planConfigurations({
    configurations: entries,
    existing: input.existing,
    conflict,
  });

  return {
    source: "document",
    name: input.existing?.name ?? input.policy.name,
    notes: input.policy.notes ?? null,
    priority: input.policy.priority,
    enabled: input.policy.enabled,
    configurations,
    warnings,
    payload,
  };
};

/**
 * Plan a single `.mobileconfig` import. A profile with the same content already
 * on the policy is reported as unchanged instead of duplicated, and a new one
 * gets the next free `mttx.apple.custom.imported` kind.
 */
export const planMobileconfigImport = (input: {
  readonly content: string;
  readonly fileName?: string;
  readonly signed: boolean;
  readonly displayName?: string;
  readonly description?: string;
  /** Top-level `PayloadScope` reported by the preview endpoint. */
  readonly scope?: PolicyImportScope;
  readonly existing?: PolicyImportTarget;
  readonly conflict?: PolicyImportConflict;
  readonly name?: string;
}): PolicyImportPlan => {
  const conflict = input.conflict ?? "skip";
  const warnings: string[] = [];

  const matchingKind = [...existingCustomContent(input.existing)].find(
    ([, content]) => content === input.content,
  )?.[0];

  // The dialog imports one profile at a time, so a matching kind is the only
  // one already taken.
  const kind = matchingKind ?? nextMobileconfigKind(input.existing);

  if (matchingKind)
    warnings.push("This profile is already on the policy; nothing will be imported.");

  if (input.signed)
    warnings.push(
      "Signed profile: it is deployed byte-for-byte and its signature is verified by the device, not by Mattrax.",
    );

  if ((input.scope ?? "device") === "user")
    warnings.push("This profile is user-scoped; it is delivered on the Apple user channel.");

  const data: Schema.Json = input.fileName
    ? { content: input.content, fileName: input.fileName, signed: input.signed }
    : { content: input.content, signed: input.signed };

  const { configurations, payload } = planConfigurations({
    configurations: [{ kind, data, scope: input.scope ?? "device" }],
    existing: matchingKind ? input.existing : undefined,
    conflict,
  });

  return {
    source: "mobileconfig",
    name:
      input.existing?.name ??
      input.name ??
      input.displayName ??
      stripExtension(input.fileName) ??
      "Imported policy",
    notes: input.existing?.notes ?? input.description ?? null,
    priority: undefined,
    enabled: undefined,
    configurations,
    warnings,
    payload,
  };
};

const stripExtension = (fileName: string | undefined) =>
  fileName?.replace(/\.(mobileconfig|plist)$/i, "").trim() || undefined;

/** Bytes read from a file input, normalised for planning. */
export const mobileconfigFromBytes = (bytes: Uint8Array, fileName?: string): MobileconfigSource =>
  normalizeMobileconfig({ content: bytesToBase64(bytes), fileName });

export const policyImportActionLabel = (action: PolicyImportAction): string => {
  switch (action) {
    case "add":
      return "Added";
    case "overwrite":
      return "Replaced";
    case "unchanged":
      return "Unchanged";
    case "skip":
      return "Skipped";
  }
};
