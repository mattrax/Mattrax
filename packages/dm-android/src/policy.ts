import { Data, Schema } from "effect";

/**
 * Raised when a policy cannot be merged safely.
 *
 * `name` and `policyName` are rejected at the top level only: those keys
 * identify the Google-side resource. Nested maps such as
 * `applications[].managedConfiguration` are application-defined and may use
 * any key.
 */
export class PolicyMergeError extends Data.TaggedError("PolicyMergeError")<{
  message: string;
  path: string;
  key?: string;
}> {}

const FORBIDDEN_KEYS = new Set(["name", "policyName"]);

function isPlainObject(value: Schema.Json | PolicyDocumentInput): value is Schema.JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function assertNoForbiddenKeys(value: PolicyDocumentInput, path: string): void {
  if (!isPlainObject(value)) return;

  for (const key of Object.keys(value)) {
    if (path === "" && FORBIDDEN_KEYS.has(key)) {
      throw new PolicyMergeError({
        message: `Policy key "${key}" is not allowed (resource names are managed by Mattrax)`,
        path: key,
        key,
      });
    }
  }
}

/** Stable JSON representation: object keys sorted recursively, arrays kept in order. */
export function canonicalPolicyJson(value: Schema.Json): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: Schema.Json): Schema.Json {
  if (Array.isArray(value)) return value.map(sortKeysDeep);

  if (!isPlainObject(value)) return value;
  const sorted: Record<string, Schema.Json> = {};

  for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);

  return sorted;
}

function stableIdentity(value: Schema.Json): string {
  return canonicalPolicyJson(value);
}

function uniqueConcat(
  existing: ReadonlyArray<Schema.Json>,
  incoming: ReadonlyArray<Schema.Json>,
): Array<Schema.Json> {
  const result: Array<Schema.Json> = [];
  const seen = new Set<string>();

  for (const item of [...existing, ...incoming]) {
    const identity = stableIdentity(item);

    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(item);
  }

  return result;
}

function mergeInto(
  target: Record<string, Schema.Json>,
  source: PolicyDocumentInput,
  path: string,
): Record<string, Schema.Json> {
  for (const [key, value] of Object.entries(source)) {
    if (path === "" && FORBIDDEN_KEYS.has(key)) {
      throw new PolicyMergeError({
        message: `Policy key "${key}" is not allowed (resource names are managed by Mattrax)`,
        path: key,
        key,
      });
    }

    if (value === null || value === undefined) continue;
    const childPath = path === "" ? key : `${path}.${key}`;
    const existing = target[key];

    if (Array.isArray(value)) {
      target[key] = uniqueConcat(Array.isArray(existing) ? existing : [], value);
    } else if (isPlainObject(value)) {
      target[key] = mergeInto(
        isPlainObject(existing) ? Object.assign({}, existing) : {},
        value,
        childPath,
      );
    } else {
      target[key] = value;
    }
  }

  return target;
}

/**
 * Merge Android policies deterministically.
 *
 * - later policies win for scalar values
 * - arrays are concatenated, dropping duplicates while preserving first-seen order
 * - objects are merged deeply
 * - `null` / `undefined` values are skipped (they cannot erase an earlier value)
 * - `name` and `policyName` are rejected anywhere in the tree
 *
 * The result has recursively sorted keys so identical inputs always produce
 * byte-identical JSON.
 */
export type PolicyDocumentInput = { readonly [key: string]: Schema.Json | undefined };

export function mergeAndroidPolicies(
  policies: ReadonlyArray<PolicyDocumentInput>,
): Schema.JsonObject {
  let merged: Record<string, Schema.Json> = {};

  for (const policy of policies) {
    if (!isPlainObject(policy)) {
      throw new PolicyMergeError({
        message: "Each Android policy must be a plain object",
        path: "",
      });
    }

    assertNoForbiddenKeys(policy, "");
    merged = mergeInto(merged, policy, "");
  }

  const sorted = sortKeysDeep(merged);

  if (!isPlainObject(sorted))
    throw new PolicyMergeError({ message: "Compiled policy must be an object", path: "" });

  return sorted;
}

/** SHA-256 (hex) of the canonical JSON representation of a policy. */
export async function androidPolicyHash(policy: Schema.JsonObject): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPolicyJson(policy)),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** True for tenant configuration kinds that contribute to an AMAPI policy. */
export const isAndroidPolicyKind = (kind: string): boolean =>
  kind.startsWith("mttx.android.policy.");

export type AndroidPolicyConfiguration = {
  readonly kind: string;
  readonly data: unknown;
};

/**
 * Extract the Google policy document from one stored configuration.
 *
 * The designer stores `{ policy, draft }`; hand-written configurations may be
 * the policy object itself. `draft` is editor state and must never reach
 * Google.
 */
function policyFromConfiguration(configuration: AndroidPolicyConfiguration): Schema.JsonObject {
  const data = configuration.data;

  if (!Schema.is(Schema.Json)(data) || !isPlainObject(data))
    throw new PolicyMergeError({
      message: `"${configuration.kind}" must be an object`,
      path: configuration.kind,
    });

  if (data["policy"] !== undefined) {
    const policy = data["policy"];

    if (!Schema.is(Schema.Json)(policy) || !isPlainObject(policy))
      throw new PolicyMergeError({
        message: `"${configuration.kind}.policy" must be an object`,
        path: `${configuration.kind}.policy`,
      });

    return policy;
  }

  const policy: Record<string, Schema.Json> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key !== "draft") policy[key] = value;
  }

  return policy;
}

/**
 * Compile every `mttx.android.policy*` configuration into one deterministic
 * AMAPI policy. Non-Android configuration kinds are ignored, so the same
 * resolved policy set used for Apple/Windows can be passed in.
 */
export function compileAndroidPolicy(
  configurations: ReadonlyArray<AndroidPolicyConfiguration>,
): Schema.JsonObject {
  const policies = configurations.flatMap((configuration) =>
    isAndroidPolicyKind(configuration.kind) ? [policyFromConfiguration(configuration)] : [],
  );

  return mergeAndroidPolicies(policies);
}

/**
 * Stable AMAPI policy id derived from the compiled policy hash.
 *
 * Policy ids accept letters, digits, hyphens and underscores; starting with a
 * letter also satisfies stricter Google-side validation.
 */
export function androidPolicyIdForHash(hash: string): string {
  const suffix = hash
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24);

  return `mattrax-${suffix || "default"}`;
}

/** Compile and hash in one step; the hash identifies the policy id. */
export async function compileAndroidPolicyWithHash(
  configurations: ReadonlyArray<AndroidPolicyConfiguration>,
): Promise<{ policy: Schema.JsonObject; hash: string }> {
  const policy = compileAndroidPolicy(configurations);

  return { policy, hash: await androidPolicyHash(policy) };
}
