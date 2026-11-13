import { Data } from "effect";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}

function assertNoForbiddenKeys(value: unknown, path: string): void {
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
export function canonicalPolicyJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);

  if (!isPlainObject(value)) return value;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);

  return sorted;
}

function stableIdentity(value: unknown): string {
  return canonicalPolicyJson(value);
}

function uniqueConcat(
  existing: ReadonlyArray<unknown>,
  incoming: ReadonlyArray<unknown>,
): Array<unknown> {
  const result: Array<unknown> = [];
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
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
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
      target[key] = mergeInto(isPlainObject(existing) ? { ...existing } : {}, value, childPath);
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
export function mergeAndroidPolicies(
  policies: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  let merged: Record<string, unknown> = {};

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

  return sortKeysDeep(merged) as Record<string, unknown>;
}

/** SHA-256 (hex) of the canonical JSON representation of a policy. */
export async function androidPolicyHash(policy: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPolicyJson(policy)),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** True for tenant configuration kinds that contribute to an AMAPI policy. */
export const isAndroidPolicyKind = (kind: string): boolean => kind.startsWith('mttx.android.policy.');

export type AndroidPolicyConfiguration = {
  readonly kind: string;
  readonly data: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract the Google policy document from one stored configuration.
 *
 * The designer stores `{ policy, draft }`; hand-written configurations may be
 * the policy object itself. `draft` is editor state and must never reach
 * Google.
 */
function policyFromConfiguration(
  configuration: AndroidPolicyConfiguration,
): Record<string, unknown> {
  const data = configuration.data;

  if (!isRecord(data))
    throw new PolicyMergeError({
      message: `"${configuration.kind}" must be an object`,
      path: configuration.kind,
    });

  if (data["policy"] !== undefined) {
    if (!isRecord(data["policy"]))
      throw new PolicyMergeError({
        message: `"${configuration.kind}.policy" must be an object`,
        path: `${configuration.kind}.policy`,
      });

    return data["policy"];
  }

  const policy = { ...data };
  delete policy["draft"];

  return policy;
}

/**
 * Compile every `mttx.android.policy*` configuration into one deterministic
 * AMAPI policy. Non-Android configuration kinds are ignored, so the same
 * resolved policy set used for Apple/Windows can be passed in.
 */
export function compileAndroidPolicy(
  configurations: ReadonlyArray<AndroidPolicyConfiguration>,
): Record<string, unknown> {
  const policies = configurations
    .filter((configuration) => isAndroidPolicyKind(configuration.kind))
    .map(policyFromConfiguration);

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
): Promise<{ policy: Record<string, unknown>; hash: string }> {
  const policy = compileAndroidPolicy(configurations);

  return { policy, hash: await androidPolicyHash(policy) };
}
