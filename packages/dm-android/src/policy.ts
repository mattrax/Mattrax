import { Data, Effect, Result, Schema } from "effect";
import { Digest } from "effect/crypto";

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

export class AndroidPolicyHashError extends Data.TaggedError("AndroidPolicyHashError")<{
  message: string;
  cause?: unknown;
}> {}

const FORBIDDEN_KEYS = new Set(["name", "policyName"]);

function isPlainObject(value: Schema.Json | PolicyDocumentInput): value is Schema.JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function assertNoForbiddenKeys(
  value: PolicyDocumentInput,
  path: string,
): Result.Result<void, PolicyMergeError> {
  if (!isPlainObject(value)) return Result.succeed(undefined);

  for (const key of Object.keys(value)) {
    if (path === "" && FORBIDDEN_KEYS.has(key)) {
      return Result.fail(
        new PolicyMergeError({
          message: `Policy key "${key}" is not allowed (resource names are managed by Mattrax)`,
          path: key,
          key,
        }),
      );
    }
  }

  return Result.succeed(undefined);
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
): Result.Result<Record<string, Schema.Json>, PolicyMergeError> {
  return Result.gen(function* () {
    for (const [key, value] of Object.entries(source)) {
      if (path === "" && FORBIDDEN_KEYS.has(key)) {
        return yield* Result.fail(
          new PolicyMergeError({
            message: `Policy key "${key}" is not allowed (resource names are managed by Mattrax)`,
            path: key,
            key,
          }),
        );
      }

      if (value === null || value === undefined) continue;
      const childPath = path === "" ? key : `${path}.${key}`;
      const existing = target[key];

      if (Array.isArray(value)) {
        target[key] = uniqueConcat(Array.isArray(existing) ? existing : [], value);
      } else if (isPlainObject(value)) {
        target[key] = yield* mergeInto(
          isPlainObject(existing) ? Object.assign({}, existing) : {},
          value,
          childPath,
        );
      } else {
        target[key] = value;
      }
    }

    return target;
  });
}

/**
 * Keep one `applications` entry per package.
 *
 * AMAPI rejects a policy that lists the same package twice, and the deep merge
 * concatenates arrays, so two fragments that both describe a package would
 * otherwise produce an invalid policy. The later entry wins (matching scalar
 * precedence) while the package keeps its first position so the output stays
 * deterministic. Entries without a package name are left untouched.
 */
function canonicalizeApplications<T extends Record<string, Schema.Json>>(policy: T) {
  const applications = policy["applications"];

  if (!Array.isArray(applications)) return policy;
  const byPackage = new Map<string, Schema.Json>();
  const unnamed: Array<Schema.Json> = [];

  for (const entry of applications) {
    const packageName = isPlainObject(entry) ? entry["packageName"] : undefined;

    if (!Schema.is(Schema.String)(packageName)) {
      unnamed.push(entry);
      continue;
    }

    byPackage.set(packageName, entry);
  }

  return { ...policy, applications: [...byPackage.values(), ...unnamed] };
}

/**
 * Merge Android policies deterministically as a typed `Result`.
 *
 * - later policies win for scalar values
 * - arrays are concatenated, dropping duplicates while preserving first-seen order
 * - objects are merged deeply
 * - `null` / `undefined` values are skipped (they cannot erase an earlier value)
 * - `name` and `policyName` are rejected at the top level
 *
 * The result has recursively sorted keys so identical inputs always produce
 * byte-identical JSON.
 */
export type PolicyDocumentInput = { readonly [key: string]: Schema.Json | undefined };

export function mergeAndroidPolicies(
  policies: ReadonlyArray<PolicyDocumentInput>,
): Result.Result<Schema.JsonObject, PolicyMergeError> {
  return Result.gen(function* () {
    let merged: Record<string, Schema.Json> = {};

    for (const policy of policies) {
      if (!isPlainObject(policy)) {
        return yield* Result.fail(
          new PolicyMergeError({
            message: "Each Android policy must be a plain object",
            path: "",
          }),
        );
      }

      yield* assertNoForbiddenKeys(policy, "");
      merged = yield* mergeInto(merged, policy, "");
    }

    const sorted = sortKeysDeep(canonicalizeApplications(merged));

    if (!isPlainObject(sorted))
      return yield* Result.fail(
        new PolicyMergeError({ message: "Compiled policy must be an object", path: "" }),
      );

    return sorted;
  });
}

/** Typed SHA-256 hash of the canonical JSON representation of a policy. */
export const androidPolicyHash = Effect.fnUntraced(function* (
  policy: Schema.JsonObject,
): Effect.fn.Return<string, AndroidPolicyHashError, Digest.Digest> {
  const digest = yield* Digest.Digest;

  return yield* digest
    .digestHex(Digest.sha256, new TextEncoder().encode(canonicalPolicyJson(policy)))
    .pipe(
      Effect.catchDefect((cause) =>
        Effect.fail(
          new AndroidPolicyHashError({
            message: "Failed to hash the Android policy",
            cause,
          }),
        ),
      ),
    );
});

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
function policyFromConfiguration(
  configuration: AndroidPolicyConfiguration,
): Result.Result<Schema.JsonObject, PolicyMergeError> {
  return Result.gen(function* () {
    const data = configuration.data;

    if (!Schema.is(Schema.Json)(data) || !isPlainObject(data))
      return yield* Result.fail(
        new PolicyMergeError({
          message: `"${configuration.kind}" must be an object`,
          path: configuration.kind,
        }),
      );

    if (data["policy"] !== undefined) {
      const policy = data["policy"];

      if (!Schema.is(Schema.Json)(policy) || !isPlainObject(policy))
        return yield* Result.fail(
          new PolicyMergeError({
            message: `"${configuration.kind}.policy" must be an object`,
            path: `${configuration.kind}.policy`,
          }),
        );

      return policy;
    }

    const policy: Record<string, Schema.Json> = {};

    for (const [key, value] of Object.entries(data)) {
      if (key !== "draft") policy[key] = value;
    }

    return policy;
  });
}

/**
 * Compile every `mttx.android.policy*` configuration into one deterministic
 * AMAPI policy. Non-Android configuration kinds are ignored, so the same
 * resolved policy set used for Apple/Windows can be passed in.
 */
export function compileAndroidPolicy(
  configurations: ReadonlyArray<AndroidPolicyConfiguration>,
): Result.Result<Schema.JsonObject, PolicyMergeError> {
  return Result.gen(function* () {
    const policies: Array<Schema.JsonObject> = [];

    for (const configuration of configurations) {
      if (isAndroidPolicyKind(configuration.kind)) {
        policies.push(yield* policyFromConfiguration(configuration));
      }
    }

    return yield* mergeAndroidPolicies(policies);
  });
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
    .replaceAll(/[^a-z0-9]/g, "")
    .slice(0, 24);

  return `mattrax-${suffix || "default"}`;
}

/** Compile and hash with typed validation and crypto failures. */
export const compileAndroidPolicyWithHash = Effect.fnUntraced(function* (
  configurations: ReadonlyArray<AndroidPolicyConfiguration>,
): Effect.fn.Return<
  { policy: Schema.JsonObject; hash: string },
  PolicyMergeError | AndroidPolicyHashError,
  Digest.Digest
> {
  const compiled = compileAndroidPolicy(configurations);

  if (Result.isFailure(compiled)) return yield* Effect.fail(compiled.failure);

  const policy = compiled.success;

  return { policy, hash: yield* androidPolicyHash(policy) };
});

/** One application assignment the Android management API should apply. */
export type AndroidAssignedApplication = {
  /** Android package name, for example `com.google.android.gm`. */
  readonly packageName: string;
};

/** A valid Android application package name (`com.example.app`). */
export const isAndroidPackageName = (value: string): boolean =>
  /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value);

/**
 * Add assigned Managed Google Play applications to a compiled policy.
 *
 * An application already described by a policy fragment is left exactly as the
 * operator configured it: that fragment may choose a different `installType`
 * (for example `AVAILABLE` or `BLOCKED`), an update mode, or a managed
 * configuration. Only packages the policy does not mention are appended, so the
 * assignment is a floor (installed as required) rather than an override.
 *
 * Removing an application from the assignment list removes it from the policy
 * on the next compile, which is how Google is told to uninstall an app it
 * force-installed.
 */
export function mergeAssignedAndroidApplications(
  policy: Schema.JsonObject,
  applications: ReadonlyArray<AndroidAssignedApplication>,
): Schema.JsonObject {
  const configured = Array.isArray(policy["applications"])
    ? policy["applications"].filter((entry) => Schema.is(Schema.JsonObject)(entry))
    : [];

  const packages = new Set(
    configured.flatMap((entry) => {
      const packageName = entry["packageName"];

      return Schema.is(Schema.String)(packageName) ? [packageName] : [];
    }),
  );

  const assigned = new Set<string>();

  for (const application of applications)
    if (isAndroidPackageName(application.packageName)) assigned.add(application.packageName);

  const added = [...assigned]
    .filter((packageName) => !packages.has(packageName))
    .sort()
    .map((packageName) => ({
      packageName,
      installType: "FORCE_INSTALLED" as const,
      autoUpdateMode: "AUTO_UPDATE_DEFAULT" as const,
    }));

  if (added.length === 0) return policy;

  const existing = Array.isArray(policy["applications"]) ? policy["applications"] : [];
  const applicationsValue: Schema.Json[] = [...existing];

  for (const entry of added) applicationsValue.push(entry);

  return { ...policy, applications: applicationsValue };
}
