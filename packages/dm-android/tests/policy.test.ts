import { describe, expect, it } from "vitest";
import {
  PolicyMergeError,
  androidPolicyHash,
  canonicalPolicyJson,
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
    const merged = mergeAndroidPolicies([
      { cameraDisabled: true, applications: [{ packageName: "a" }] },
      { cameraDisabled: null as unknown as boolean, applications: undefined },
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
    expect(Object.keys(merged["alpha"] as Record<string, unknown>)).toEqual(["beta", "gamma"]);
  });

  it("does not mutate its inputs", () => {
    const first = { applications: [{ packageName: "a" }] };
    const snapshot = JSON.parse(JSON.stringify(first)) as unknown;
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
