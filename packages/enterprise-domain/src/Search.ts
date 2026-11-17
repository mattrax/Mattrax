import { DynamicGroupKind } from "./dynamicGroups.js";
import { Schema } from "effect";
import { DeviceHealth } from "./Device.js";
import { DeviceProtocol } from "./Device.js";
import { DeviceRelation } from "./Group.js";
import { DeviceRow } from "./Device.js";
import { DeviceStatus } from "./Device.js";
import { GroupNode } from "./Group.js";
import { GroupRelation } from "./Group.js";
import { GroupRow } from "./Group.js";
import { NullableString } from "./Errors.js";
import { PolicyRow } from "./Policy.js";

export const DeviceListResponse = Schema.Struct({ rows: Schema.Array(DeviceRow) });

export const DevicePreRegistrationRow = Schema.Struct({
  id: Schema.String,
  serial: Schema.String,
  name: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  groupId: Schema.optional(NullableString),
  groupName: Schema.optional(NullableString),
  consumedDeviceId: Schema.optional(NullableString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type DevicePreRegistrationRow = typeof DevicePreRegistrationRow.Type;

export const DevicePreRegistrationListResponse = Schema.Struct({
  rows: Schema.Array(DevicePreRegistrationRow),
});

export type DevicePreRegistrationListResponse = typeof DevicePreRegistrationListResponse.Type;

export const DevicePreRegistrationImportRow = Schema.Struct({
  serial: Schema.String,
  name: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  /** Tenant-scoped group id. Mutually exclusive with `groupName` when both resolve. */
  groupId: Schema.optional(NullableString),
  /** Tenant-scoped group name; resolved case-insensitively. */
  groupName: Schema.optional(NullableString),
});

export type DevicePreRegistrationImportRow = typeof DevicePreRegistrationImportRow.Type;

export const DevicePreRegistrationImportRequest = Schema.Struct({
  rows: Schema.Array(DevicePreRegistrationImportRow),
});

export type DevicePreRegistrationImportRequest = typeof DevicePreRegistrationImportRequest.Type;

export const DevicePreRegistrationImportResult = Schema.Struct({
  serial: Schema.String,
  status: Schema.Literals(["created", "updated", "error"]),
  id: Schema.optional(NullableString),
  error: Schema.optional(NullableString),
});

export type DevicePreRegistrationImportResult = typeof DevicePreRegistrationImportResult.Type;

export const DevicePreRegistrationImportResponse = Schema.Struct({
  results: Schema.Array(DevicePreRegistrationImportResult),
  created: Schema.Number,
  updated: Schema.Number,
  failed: Schema.Number,
});

export type DevicePreRegistrationImportResponse = typeof DevicePreRegistrationImportResponse.Type;

export const GroupListResponse = Schema.Struct({ rows: Schema.Array(GroupRow) });

/**
 * Live membership preview. Dynamic groups evaluate their rules without
 * materialising anything, so the dashboard can show a count while the rule
 * builder is being edited.
 */
export const GroupPreviewResponse = Schema.Struct({
  groupId: Schema.String,
  kind: DynamicGroupKind,
  count: Schema.Number,
  devices: Schema.Array(GroupRelation),
  evaluatedAt: Schema.String,
});

export type GroupPreviewResponse = typeof GroupPreviewResponse.Type;

export const PolicyListResponse = Schema.Struct({ rows: Schema.Array(PolicyRow) });

export const DeviceSearchSort = Schema.Literals([
  "name",
  "lastSeenAt",
  "enrolledAt",
  "status",
  /** Worst health first when ascending (critical, attention, unknown, healthy). */
  "health",
]);

export type DeviceSearchSort = typeof DeviceSearchSort.Type;

export const SortDirection = Schema.Literals(["asc", "desc"]);

export type SortDirection = typeof SortDirection.Type;

export const DeviceHealthFilter = Schema.Literals([
  "healthy",
  "attention",
  "critical",
  "unknown",
  "stale",
]);

export type DeviceHealthFilter = typeof DeviceHealthFilter.Type;

/**
 * Server-side device list filters. Every field is optional; the backend applies
 * a bounded default page size and treats an empty query as "all devices".
 */
export const DeviceSearchQuery = Schema.Struct({
  /**
   * Free text, matched case-insensitively against the columns the device table
   * shows: name (management and device-reported), serial, model, model
   * identifier, platform label, status, OS version/edition/build, group names,
   * asset tag, notes, attribute values and `enrolledAt`/`lastSeenAt`.
   *
   * Timestamps are matched in UTC using `YYYY-MM-DD`, `HH:mm`, `DD/MM/YYYY`
   * (either order; slash dates are ambiguous) and month-name forms such as
   * `4 Mar 2026`. A bare number only counts as a date when it is a real
   * four-digit year.
   */
  q: Schema.optional(Schema.String),
  /** Shareable structured filter encoded by `formatDeviceQueryText`. */
  query: Schema.optional(Schema.String),
  status: Schema.optional(DeviceStatus),
  proto: Schema.optional(DeviceProtocol),
  /** Only devices that are members of this group. */
  groupId: Schema.optional(Schema.String),
  /** ISO timestamp; only devices last seen before it. */
  notSeenSince: Schema.optional(Schema.String),
  /** Shorthand for `notSeenSince = now - staleDays`; 0 or omitted disables it. */
  staleDays: Schema.optional(Schema.Number),
  /** Only devices whose derived health rollup matches this level. */
  health: Schema.optional(DeviceHealthFilter),
  /** Only Apple devices whose APNs delivery is failing or has an invalid token. */
  push: Schema.optional(Schema.Literals(["failing", "invalid"])),
  /**
   * ADE setup state. `awaiting` matches devices held in Setup Assistant;
   * `complete` matches devices that were released (or never awaited).
   */
  setup: Schema.optional(Schema.Literals(["awaiting", "complete"])),
  /**
   * JSON object of attribute key → expected value, for example
   * `{"cost_centre":"EMEA"}`. Every entry must match for a device to be
   * returned. Values are compared against the canonical stored form, so use
   * `true`/`false` for booleans and `YYYY-MM-DD` for dates. Keys must be
   * registered attributes; unknown keys are rejected.
   */
  attributes: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  sort: Schema.optional(DeviceSearchSort),
  direction: Schema.optional(SortDirection),
});

export type DeviceSearchQuery = typeof DeviceSearchQuery.Type;

/** A device row plus its group memberships, populated by the search endpoint. */
export const DeviceSearchRow = Schema.Struct({
  ...DeviceRow.fields,
  groups: Schema.Array(DeviceRelation),
  /** Always present on search rows: the table renders it as a column. */
  health: Schema.suspend(() => DeviceHealth),
});

export type DeviceSearchRow = typeof DeviceSearchRow.Type;

export const DeviceSearchResponse = Schema.Struct({
  devices: Schema.Array(DeviceSearchRow),
  total: Schema.Number,
});

export type DeviceSearchResponse = typeof DeviceSearchResponse.Type;

export const NodeResponse = Schema.Union([DeviceRow, GroupNode, PolicyRow]);

export type NodeResponse = typeof NodeResponse.Type;
