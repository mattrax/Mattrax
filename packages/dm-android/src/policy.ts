import { Data } from "effect";

/**
 * Raised when a policy cannot be merged safely.
 *
 * `name` and `policyName` are rejected at every depth: those keys identify the
 * Google-side resource and must never be controlled by policy JSON (path /
 * resource injection).
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
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new PolicyMergeError({
        message: `Policy key "${key}" is not allowed (resource names are managed by Mattrax)`,
        path: path === "" ? key : `${path}.${key}`,
        key,
      });
    }
    assertNoForbiddenKeys(child, path === "" ? key : `${path}.${key}`);
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
    if (FORBIDDEN_KEYS.has(key)) {
      throw new PolicyMergeError({
        message: `Policy key "${key}" is not allowed (resource names are managed by Mattrax)`,
        path: path === "" ? key : `${path}.${key}`,
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
