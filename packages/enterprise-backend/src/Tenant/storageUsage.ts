import type { R2Bucket } from "@mattrax/enterprise-core";
import type {
  StorageCategory,
  StorageCategoryId,
  StorageObject,
  StorageUsageResponse,
} from "@mattrax/enterprise-domain";
import { tenantObjectPrefixes } from "./tenantTeardown.ts";

const PAGE_SIZE = 1_000;

/**
 * A settings read must stay responsive. This caps a scan at 20 pages; a tenant
 * beyond it sees the first 20,000 objects and a truncated flag rather than a
 * request that never finishes.
 */
export const STORAGE_SCAN_MAX_OBJECTS = 20_000;

const LARGEST_LIMIT = 8;
const GROWTH_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

const categoryForPrefix = (prefix: string): StorageCategoryId => {
  if (prefix.startsWith("a/")) return "applications";
  if (prefix.startsWith("p/")) return "policies";
  if (prefix.startsWith("handovers/")) return "handovers";

  return "backups";
};

const categories: ReadonlyArray<{ id: StorageCategoryId; label: string }> = [
  { id: "applications", label: "Applications" },
  { id: "policies", label: "Policy packages" },
  { id: "backups", label: "Backups" },
  { id: "handovers", label: "Handover archives" },
];

type Totals = {
  bytes: number;
  objects: number;
  growthBytes: number;
  growthObjects: number;
};

const emptyTotals = (): Totals => ({ bytes: 0, objects: 0, growthBytes: 0, growthObjects: 0 });

/**
 * Sum the tenant's R2 objects by category and collect the largest few. Keys
 * live under the prefixes owned by the tenant, so listing never touches another
 * tenant's data or the readiness probe.
 */
export const collectTenantStorageUsage = async (
  bucket: R2Bucket,
  organizationId: string,
  now: Date = new Date(),
): Promise<StorageUsageResponse> => {
  const totals = new Map<StorageCategoryId, Totals>(
    categories.map((category) => [category.id, emptyTotals()]),
  );
  const largest: StorageObject[] = [];
  let scanned = 0;
  let truncated = false;

  const growthCutoff = now.getTime() - GROWTH_WINDOW_MS;

  scan: for (const prefix of tenantObjectPrefixes(organizationId)) {
    const category = categoryForPrefix(prefix);
    const categoryTotals = totals.get(category)!;
    let cursor: string | undefined;

    do {
      const page = await bucket.list({
        prefix,
        cursor,
        limit: PAGE_SIZE,
        include: ["customMetadata"],
      });

      for (const object of page.objects) {
        const uploaded = new Date(object.uploaded);
        const recent = !Number.isNaN(uploaded.getTime()) && uploaded.getTime() >= growthCutoff;
        const fileName = object.customMetadata?.fileName?.trim();

        categoryTotals.bytes += object.size;
        categoryTotals.objects += 1;
        scanned += 1;

        if (recent) {
          categoryTotals.growthBytes += object.size;
          categoryTotals.growthObjects += 1;
        }

        largest.push({
          key: object.key,
          ...(fileName ? { fileName } : {}),
          category,
          bytes: object.size,
          uploadedAt: uploaded.toISOString(),
        });

        if (scanned >= STORAGE_SCAN_MAX_OBJECTS) {
          truncated = true;
          break scan;
        }
      }

      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  largest.sort((a, b) => b.bytes - a.bytes || b.uploadedAt.localeCompare(a.uploadedAt));

  const summaries: StorageCategory[] = categories.map(({ id, label }) => ({
    id,
    label,
    ...totals.get(id)!,
  }));

  return {
    usedBytes: summaries.reduce((sum, category) => sum + category.bytes, 0),
    objectCount: scanned,
    categories: summaries,
    largest: largest.slice(0, LARGEST_LIMIT),
    truncated,
    computedAt: now.toISOString(),
  };
};
