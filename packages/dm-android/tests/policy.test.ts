import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  PolicyMergeError,
  androidPolicyHash,
  androidPolicyIdForHash,
  canonicalPolicyJson,
  compileAndroidPolicy,
  compileAndroidPolicyWithHash,
  mergeAndroidPolicies,
} from "../src/index.js";

describe("mergeAndroidPolicies", () => {
  it("lets later policies win for scalar values", () => {
    const merged = mergeAndroidPolicies([
      { screenCaptureDisabled: false, minimumApiLevel: 30 },
      { screenCaptureDisabled: true },
    ]);

    expect(merged).toEqual({ minimumApiLevel: 30, screenCaptureDisabled: true });
  });

  it("deeply merges nested objects", () => {
    const merged = mergeAndroidPolicies([
      { statusReportingSettings: { deviceSettingsEnabled: true, softwareInfoEnabled: true } },
      { statusReportingSettings: { softwareInfoEnabled: false } },
    ]);

    expect(merged).toEqual({
      statusReportingSettings: { deviceSettingsEnabled: true, softwareInfoEnabled: false },
    });
  });

  it("concatenates arrays and drops duplicates in first-seen order", () => {
    const merged = mergeAndroidPolicies([
      { accountTypesWithManagementDisabled: ["a", "b"] },
      { accountTypesWithManagementDisabled: ["b", "c"] },
    ]);

    expect(merged).toEqual({ accountTypesWithManagementDisabled: ["a", "b", "c"] });
  });

  it("dedupes arrays of objects by canonical value", () => {
    const app = { packageName: "com.example", installType: "AVAILABLE" };

    const merged = mergeAndroidPolicies([
      { applications: [app] },
      { applications: [{ installType: "AVAILABLE", packageName: "com.example" }] },
    ]);

    expect(merged).toEqual({ applications: [app] });
  });

  it("skips null and undefined instead of erasing earlier values", () => {
    const invalid = { cameraDisabled: null, applications: undefined };

    const merged = mergeAndroidPolicies([
      { cameraDisabled: true, applications: [{ packageName: "a" }] },
      invalid,
    ]);

    expect(merged).toEqual({ applications: [{ packageName: "a" }], cameraDisabled: true });
  });

  it("replaces a scalar with an object and vice versa", () => {
    expect(mergeAndroidPolicies([{ x: { a: 1 } }, { x: { b: 2 } }])).toEqual({ x: { a: 1, b: 2 } });
    expect(mergeAndroidPolicies([{ x: 1 }, { x: { a: 2 } }])).toEqual({ x: { a: 2 } });
    expect(mergeAndroidPolicies([{ x: { a: 2 } }, { x: [1] }])).toEqual({ x: [1] });
  });

  it("sorts keys deterministically", () => {
    const merged = mergeAndroidPolicies([{ zeta: 1, alpha: { beta: 2, gamma: 3 } }]);
    expect(Object.keys(merged)).toEqual(["alpha", "zeta"]);

    const alpha = merged["alpha"];

    if (!Schema.is(Schema.JsonObject)(alpha)) throw new Error("alpha must be a JSON object");

    expect(Object.keys(alpha)).toEqual(["beta", "gamma"]);
  });

  it("does not mutate its inputs", () => {
    const first = { applications: [{ packageName: "a" }] };
    const snapshot = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(first)));
    mergeAndroidPolicies([first, { applications: [{ packageName: "b" }] }]);
    expect(first).toEqual(snapshot);
  });

  it("rejects resource name keys at the top level", () => {
    expect(() => mergeAndroidPolicies([{ name: "enterprises/LC123/policies/other" }])).toThrow(
      PolicyMergeError,
    );
    expect(() => mergeAndroidPolicies([{ policyName: "other" }])).toThrow(PolicyMergeError);
  });

  it("keeps nested application-defined name keys", () => {
    expect(
      mergeAndroidPolicies([
        {
          applications: [{ packageName: "com.example", managedConfiguration: { name: "value" } }],
        },
      ]),
    ).toEqual({
      applications: [{ packageName: "com.example", managedConfiguration: { name: "value" } }],
    });
  });
});

describe("androidPolicyHash", () => {
  it("returns a deterministic 64-character hex digest", async () => {
    const hash = await androidPolicyHash({ screenCaptureDisabled: true });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(androidPolicyHash({ screenCaptureDisabled: true })).resolves.toBe(hash);
  });

  it("is independent of key insertion order", async () => {
    const a = { applications: [{ packageName: "a" }], cameraDisabled: true };
    const b = { cameraDisabled: true, applications: [{ packageName: "a" }] };
    expect(canonicalPolicyJson(a)).toBe(canonicalPolicyJson(b));
    await expect(androidPolicyHash(a)).resolves.toBe(await androidPolicyHash(b));
  });

  it("changes when policy content changes", async () => {
    const a = await androidPolicyHash({ screenCaptureDisabled: true });
    const b = await androidPolicyHash({ screenCaptureDisabled: false });
    expect(a).not.toBe(b);
  });

  it("hashes the merged form consistently", async () => {
    const merged = mergeAndroidPolicies([
      { cameraDisabled: true },
      { screenCaptureDisabled: true },
    ]);

    const reordered = { screenCaptureDisabled: true, cameraDisabled: true };
    await expect(androidPolicyHash(merged)).resolves.toBe(await androidPolicyHash(reordered));
  });
});

describe("compileAndroidPolicy", () => {
  it("unwraps designer configurations and ignores other platforms", () => {
    const policy = compileAndroidPolicy([
      { kind: "mttx.apple.custom.designer", data: { content: "ignored" } },
      {
        kind: "mttx.android.policy.designer",
        data: { policy: { cameraDisabled: true }, draft: { name: "draft" } },
      },
      {
        kind: "mttx.android.policy.handwritten",
        data: { screenCaptureDisabled: true },
      },
    ]);

    expect(policy).toEqual({ cameraDisabled: true, screenCaptureDisabled: true });
    expect(policy).not.toHaveProperty("draft");
    expect(policy).not.toHaveProperty("policy");
  });

  it("returns an empty policy when no Android configuration exists", () => {
    expect(compileAndroidPolicy([])).toEqual({});
    expect(compileAndroidPolicy([{ kind: "mttx.windows.custom.x", data: {} }])).toEqual({});
  });

  it("rejects read-only Google resource fields", () => {
    expect(() =>
      compileAndroidPolicy([
        { kind: "mttx.android.policy.designer", data: { policy: { name: "enterprises/x" } } },
      ]),
    ).toThrow(PolicyMergeError);
  });

  it("renders stable policy ids and hashes", async () => {
    const first = await compileAndroidPolicyWithHash([
      { kind: "mttx.android.policy.a", data: { cameraDisabled: true } },
    ]);

    const second = await compileAndroidPolicyWithHash([
      { kind: "mttx.android.policy.b", data: { cameraDisabled: true } },
    ]);

    expect(first.hash).toBe(second.hash);
    expect(androidPolicyIdForHash(first.hash)).toMatch(/^mattrax-[a-z0-9]+$/);
    expect(androidPolicyIdForHash(first.hash).length).toBeLessThanOrEqual(32);
  });
});
