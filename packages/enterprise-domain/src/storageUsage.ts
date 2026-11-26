import { Schema } from "effect";

/** The object families Mattrax writes under a tenant prefix. */
export const StorageCategoryId = Schema.Literals([
  "applications",
  "policies",
  "backups",
  "handovers",
]);

export type StorageCategoryId = typeof StorageCategoryId.Type;

export const StorageCategory = Schema.Struct({
  id: StorageCategoryId,
  label: Schema.String,
  bytes: Schema.Number,
  objects: Schema.Number,
  /** Bytes added in the last 30 days, from R2's upload timestamp. */
  growthBytes: Schema.Number,
  growthObjects: Schema.Number,
});

export type StorageCategory = typeof StorageCategory.Type;

export const StorageObject = Schema.Struct({
  key: Schema.String,
  /** Original upload name when the object carries one (applications, packages). */
  fileName: Schema.optional(Schema.String),
  category: StorageCategoryId,
  bytes: Schema.Number,
  uploadedAt: Schema.String,
});

export type StorageObject = typeof StorageObject.Type;

export const StorageUsageResponse = Schema.Struct({
  usedBytes: Schema.Number,
  objectCount: Schema.Number,
  categories: Schema.Array(StorageCategory),
  /** The largest objects, newest upload wins ties. */
  largest: Schema.Array(StorageObject),
  /** True when the scan stopped at the safety cap. */
  truncated: Schema.Boolean,
  computedAt: Schema.String,
});

export type StorageUsageResponse = typeof StorageUsageResponse.Type;
