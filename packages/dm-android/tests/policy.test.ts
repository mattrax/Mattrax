import { describe, expect, it } from "vitest";
import { Effect, Layer, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
import {
  AndroidPolicyHashError,
  PolicyMergeError,
  androidPolicyHash,
  androidPolicyIdForHash,
  canonicalPolicyJson,
  compileAndroidPolicy,
  compileAndroidPolicyWithHash,
  mergeAndroidPolicies,
  mergeAssignedAndroidApplications,
} from "../src/index.js";
import type { AndroidPolicyConfiguration, PolicyDocumentInput } from "../src/index.js";

const merge = (...policies: ReadonlyArray<PolicyDocumentInput>) =>
  Result.getOrThrow(mergeAndroidPolicies(policies));

const compile = (...configurations: ReadonlyArray<AndroidPolicyConfiguration>) =>
  Result.getOrThrow(compileAndroidPolicy(configurations));

const hash = (policy: Schema.JsonObject) =>
  Effect.runPromise(androidPolicyHash(policy).pipe(Effect.provide(Digest.layerWebCrypto)));

const compileWithHash = (...configurations: ReadonlyArray<AndroidPolicyConfiguration>) =>
  Effect.runPromise(
    compileAndroidPolicyWithHash(configurations).pipe(Effect.provide(Digest.layerWebCrypto)),
  );

describe("mergeAndroidPolicies", () => {
  it("lets later policies win for scalar values", () => {
    const merged = merge(
      { screenCaptureDisabled: false, minimumApiLevel: 30 },
      { screenCaptureDisabled: true },
    );

    expect(merged).toEqual({ minimumApiLevel: 30, screenCaptureDisabled: true });
  });

  it("deeply merges nested objects", () => {
    const merged = merge(
      { statusReportingSettings: { deviceSettingsEnabled: true, softwareInfoEnabled: true } },
      { statusReportingSettings: { softwareInfoEnabled: false } },
    );

    expect(merged).toEqual({
      statusReportingSettings: { deviceSettingsEnabled: true, softwareInfoEnabled: false },
    });
  });

  it("concatenates arrays and drops duplicates in first-seen order", () => {
    const merged = merge(
      { accountTypesWithManagementDisabled: ["a", "b"] },
      { accountTypesWithManagementDisabled: ["b", "c"] },
    );

    expect(merged).toEqual({ accountTypesWithManagementDisabled: ["a", "b", "c"] });
  });

  it("dedupes arrays of objects by canonical value", () => {
    const app = { packageName: "com.example", installType: "AVAILABLE" };

    const merged = merge(
      { applications: [app] },
      { applications: [{ installType: "AVAILABLE", packageName: "com.example" }] },
    );

    expect(merged).toEqual({ applications: [app] });
  });

  it("skips null and undefined instead of erasing earlier values", () => {
    const invalid = { cameraDisabled: null, applications: undefined };

    const merged = merge({ cameraDisabled: true, applications: [{ packageName: "a" }] }, invalid);

    expect(merged).toEqual({ applications: [{ packageName: "a" }], cameraDisabled: true });
  });

  it("replaces a scalar with an object and vice versa", () => {
    expect(merge({ x: { a: 1 } }, { x: { b: 2 } })).toEqual({ x: { a: 1, b: 2 } });
    expect(merge({ x: 1 }, { x: { a: 2 } })).toEqual({ x: { a: 2 } });
    expect(merge({ x: { a: 2 } }, { x: [1] })).toEqual({ x: [1] });
  });

  it("sorts keys deterministically", () => {
    const merged = merge({ zeta: 1, alpha: { beta: 2, gamma: 3 } });
    expect(Object.keys(merged)).toEqual(["alpha", "zeta"]);

    const alpha = merged["alpha"];

    if (!Schema.is(Schema.JsonObject)(alpha)) throw new Error("alpha must be a JSON object");

    expect(Object.keys(alpha)).toEqual(["beta", "gamma"]);
  });

  it("does not mutate its inputs", () => {
    const first = { applications: [{ packageName: "a" }] };
    const snapshot = Schema.decodeUnknownSync(Schema.Json)(structuredClone(first));
    merge(first, { applications: [{ packageName: "b" }] });
    expect(first).toEqual(snapshot);
  });

  it("returns PolicyMergeError as data for resource name keys", () => {
    for (const key of ["name", "policyName"]) {
      const result = mergeAndroidPolicies([{ [key]: "enterprises/LC123/policies/other" }]);

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(PolicyMergeError);
        expect(result.failure).toMatchObject({ key, path: key });
      }
    }
  });

  it("keeps nested application-defined name keys", () => {
    expect(
      merge({
        applications: [{ packageName: "com.example", managedConfiguration: { name: "value" } }],
      }),
    ).toEqual({
      applications: [{ packageName: "com.example", managedConfiguration: { name: "value" } }],
    });
  });
});

describe("compileAndroidPolicy", () => {
  it("unwraps designer configurations and ignores other platforms", () => {
    const policy = compile(
      { kind: "mttx.apple.custom.designer", data: { content: "ignored" } },
      {
        kind: "mttx.android.policy.designer",
        data: { policy: { cameraDisabled: true }, draft: { name: "draft" } },
      },
      { kind: "mttx.android.policy.handwritten", data: { screenCaptureDisabled: true } },
    );

    expect(policy).toEqual({ cameraDisabled: true, screenCaptureDisabled: true });
    expect(policy).not.toHaveProperty("draft");
    expect(policy).not.toHaveProperty("policy");
  });

  it("returns an empty policy when no Android configuration exists", () => {
    expect(compile()).toEqual({});
    expect(compile({ kind: "mttx.windows.custom.x", data: {} })).toEqual({});
  });

  it("returns typed configuration validation failures", () => {
    const result = compileAndroidPolicy([
      { kind: "mttx.android.policy.designer", data: { policy: "not an object" } },
    ]);

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(PolicyMergeError);
      expect(result.failure.path).toBe("mttx.android.policy.designer.policy");
    }
  });

  it("rejects read-only Google resource fields", () => {
    const result = compileAndroidPolicy([
      { kind: "mttx.android.policy.designer", data: { policy: { name: "enterprises/x" } } },
    ]);

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(PolicyMergeError);
  });
});

describe("androidPolicyHash", () => {
  it("returns a deterministic 64-character hex digest", async () => {
    const first = await hash({ screenCaptureDisabled: true });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await expect(hash({ screenCaptureDisabled: true })).resolves.toBe(first);
  });

  it("is independent of key insertion order", async () => {
    const a = { applications: [{ packageName: "a" }], cameraDisabled: true };
    const b = { cameraDisabled: true, applications: [{ packageName: "a" }] };
    expect(canonicalPolicyJson(a)).toBe(canonicalPolicyJson(b));
    await expect(hash(a)).resolves.toBe(await hash(b));
  });

  it("changes when policy content changes", async () => {
    const a = await hash({ screenCaptureDisabled: true });
    const b = await hash({ screenCaptureDisabled: false });
    expect(a).not.toBe(b);
  });

  it("hashes the merged form consistently", async () => {
    const merged = merge({ cameraDisabled: true }, { screenCaptureDisabled: true });
    const reordered = { screenCaptureDisabled: true, cameraDisabled: true };
    await expect(hash(merged)).resolves.toBe(await hash(reordered));
  });

  it("maps crypto defects to AndroidPolicyHashError", async () => {
    const cause = new Error("digest unavailable");
    const digest = Layer.succeed(Digest.Digest, {
      digest: () => Effect.die(cause),
      digestHex: () => Effect.die(cause),
    });

    const error = await Effect.runPromise(
      Effect.flip(androidPolicyHash({ cameraDisabled: true }).pipe(Effect.provide(digest))),
    );

    expect(error).toBeInstanceOf(AndroidPolicyHashError);
    expect(error.cause).toBe(cause);
  });
});

describe("compileAndroidPolicyWithHash", () => {
  it("renders stable policy ids and hashes", async () => {
    const first = await compileWithHash({
      kind: "mttx.android.policy.a",
      data: { cameraDisabled: true },
    });

    const second = await compileWithHash({
      kind: "mttx.android.policy.b",
      data: { cameraDisabled: true },
    });

    expect(first.hash).toBe(second.hash);
    expect(androidPolicyIdForHash(first.hash)).toMatch(/^mattrax-[a-z0-9]+$/);
    expect(androidPolicyIdForHash(first.hash).length).toBeLessThanOrEqual(32);
  });

  it("fails with typed validation errors before hashing", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        compileAndroidPolicyWithHash([
          { kind: "mttx.android.policy.designer", data: { policy: { name: "read-only" } } },
        ]).pipe(Effect.provide(Digest.layerWebCrypto)),
      ),
    );

    expect(error).toBeInstanceOf(PolicyMergeError);
  });
});

describe("mergeAssignedAndroidApplications", () => {
  it("adds assigned packages as required installs", () => {
    expect(
      mergeAssignedAndroidApplications({ cameraDisabled: true }, [
        { packageName: "com.google.android.gm" },
        { packageName: "com.microsoft.teams" },
      ]),
    ).toEqual({
      cameraDisabled: true,
      applications: [
        {
          packageName: "com.google.android.gm",
          installType: "FORCE_INSTALLED",
          autoUpdateMode: "AUTO_UPDATE_DEFAULT",
        },
        {
          packageName: "com.microsoft.teams",
          installType: "FORCE_INSTALLED",
          autoUpdateMode: "AUTO_UPDATE_DEFAULT",
        },
      ],
    });
  });

  it("keeps the install type a policy fragment configured", () => {
    const policy = {
      applications: [
        {
          packageName: "com.google.android.gm",
          installType: "AVAILABLE",
          managedConfiguration: { hostname: "mail.example.com" },
        },
      ],
    };

    expect(
      mergeAssignedAndroidApplications(policy, [{ packageName: "com.google.android.gm" }]),
    ).toBe(policy);
  });

  it("ignores package names Google would reject", () => {
    expect(
      mergeAssignedAndroidApplications({}, [
        { packageName: "not a package" },
        { packageName: "com.example.app" },
      ]).applications,
    ).toHaveLength(1);
  });

  it("is deterministic and removes packages that are no longer assigned", () => {
    const first = mergeAssignedAndroidApplications({}, [
      { packageName: "com.z.example" },
      { packageName: "com.a.example" },
    ]);

    expect(first.applications).toMatchObject([
      { packageName: "com.a.example" },
      { packageName: "com.z.example" },
    ]);
    expect(mergeAssignedAndroidApplications(first, [])).toBe(first);
    expect(
      mergeAssignedAndroidApplications(
        {
          applications: [{ packageName: "com.a.example", installType: "FORCE_INSTALLED" }],
        },
        [],
      ).applications,
    ).toHaveLength(1);
  });
});

describe("applications canonicalisation", () => {
  it("keeps one entry per package with the later definition winning", () => {
    const merged = merge(
      {
        applications: [
          { packageName: "com.example.app", installType: "AVAILABLE" },
          { packageName: "com.example.other", installType: "FORCE_INSTALLED" },
        ],
      },
      {
        applications: [{ packageName: "com.example.app", installType: "BLOCKED" }],
      },
    );

    expect(merged["applications"]).toEqual([
      { installType: "BLOCKED", packageName: "com.example.app" },
      { installType: "FORCE_INSTALLED", packageName: "com.example.other" },
    ]);
  });

  it("preserves entries that carry no package name", () => {
    const merged = merge(
      { applications: [{ installType: "KIOSK" }] },
      { applications: [{ packageName: "com.example.app" }] },
    );

    expect(merged["applications"]).toHaveLength(2);
  });
});
