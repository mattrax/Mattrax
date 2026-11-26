import { describe, expect, it } from "vitest";
import type { R2Bucket, R2Object } from "@mattrax/enterprise-core";
import { collectTenantStorageUsage } from "../src/Tenant/storageUsage.ts";

const object = (key: string, size: number, uploaded: string, fileName?: string): R2Object => ({
  key,
  version: "1",
  size,
  etag: "etag",
  httpEtag: "etag",
  uploaded: new Date(uploaded),
  ...(fileName ? { customMetadata: { fileName } } : {}),
});

const makeBucket = (objects: ReadonlyArray<R2Object>): R2Bucket => ({
  head: async () => null,
  get: async () => null,
  put: async () => {
    throw new Error("not used");
  },
  delete: async () => undefined,
  list: async (options) => {
    const matching = objects.filter((entry) => entry.key.startsWith(options?.prefix ?? ""));
    const offset = options?.cursor ? Number(options.cursor) : 0;
    const page = matching.slice(offset, offset + 2);
    const next = offset + page.length;

    return {
      objects: page,
      truncated: next < matching.length,
      cursor: next < matching.length ? String(next) : undefined,
      delimitedPrefixes: [],
    };
  },
});

describe("collectTenantStorageUsage", () => {
  it("sums only the tenant prefixes, groups by category and reports 30-day growth", async () => {
    const bucket = makeBucket([
      object("a/org-1/app-1/aaa", 100, "2026-11-20T10:00:00Z", "App.pkg"),
      object("p/org-1/policy-1/bbb", 300, "2026-10-01T10:00:00Z", "Payload.pkg"),
      object("backups/org-1/2026-11-10.json", 200, "2026-11-10T10:00:00Z"),
      object("handovers/org-1/archive-1.json", 50, "2026-11-21T10:00:00Z"),
      object("a/org-2/app-9/ccc", 999, "2026-11-20T10:00:00Z"),
      object("__readiness/probe", 50, "2026-11-20T10:00:00Z"),
    ]);

    const usage = await collectTenantStorageUsage(
      bucket,
      "org-1",
      new Date("2026-11-22T00:00:00Z"),
    );

    expect(usage.usedBytes).toBe(650);
    expect(usage.objectCount).toBe(4);
    expect(usage.truncated).toBe(false);
    expect(usage.categories).toEqual([
      {
        id: "applications",
        label: "Applications",
        bytes: 100,
        objects: 1,
        growthBytes: 100,
        growthObjects: 1,
      },
      {
        id: "policies",
        label: "Policy packages",
        bytes: 300,
        objects: 1,
        growthBytes: 0,
        growthObjects: 0,
      },
      {
        id: "backups",
        label: "Backups",
        bytes: 200,
        objects: 1,
        growthBytes: 200,
        growthObjects: 1,
      },
      {
        id: "handovers",
        label: "Handover archives",
        bytes: 50,
        objects: 1,
        growthBytes: 50,
        growthObjects: 1,
      },
    ]);
    expect(usage.largest.map((entry) => entry.key)).toEqual([
      "p/org-1/policy-1/bbb",
      "backups/org-1/2026-11-10.json",
      "a/org-1/app-1/aaa",
      "handovers/org-1/archive-1.json",
    ]);
    expect(usage.largest[0]?.fileName).toBe("Payload.pkg");
    expect(usage.largest[2]?.fileName).toBe("App.pkg");
  });
});
