import { GroupId } from "@mattrax/crypto";
import { Option, Schema } from "effect";
import { DeviceHealth } from "./Device.js";
import { DeviceProtocol } from "./Device.js";
import { DeviceRelation } from "./Group.js";
import { DeviceRow } from "./Device.js";
import { DeviceStatus } from "./Device.js";
import { GroupNode } from "./Group.js";
import { GroupMembershipKind } from "./Group.js";
import { GroupRelation } from "./Group.js";
import { GroupRow } from "./Group.js";
import { NullableString } from "./Errors.js";
import { PolicyRow } from "./Policy.js";
import { ApplicationRow } from "./Application.js";
import { WindowsActivationStatus } from "./deviceInventory.js";

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
 * A group named by another group's rules, with the membership the preview
 * resolved. `problem` explains a circular, missing or skipped reference.
 */
export const GroupPreviewReference = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  count: Schema.Number,
  problem: Schema.optional(NullableString),
});

export type GroupPreviewReference = typeof GroupPreviewReference.Type;

/**
 * Live membership preview. Dynamic groups evaluate their rules without
 * materialising anything, so the dashboard can show a count while the rule
 * builder is being edited.
 */
export const GroupPreviewResponse = Schema.Struct({
  groupId: GroupId.schema,
  kind: GroupMembershipKind,
  count: Schema.Number,
  devices: Schema.Array(GroupRelation),
  evaluatedAt: Schema.String,
  /** Why the group was skipped, for example a circular group reference. */
  problem: Schema.optional(NullableString),
  references: Schema.optional(Schema.Array(GroupPreviewReference)),
});

export type GroupPreviewResponse = typeof GroupPreviewResponse.Type;

export const SortDirection = Schema.Literals(["asc", "desc"]);

export type SortDirection = typeof SortDirection.Type;

export const PolicyListResponse = Schema.Struct({ rows: Schema.Array(PolicyRow) });

/**
 * Server-side entity list pagination.
 *
 * The three catalogue lists share one query shape: a bounded offset page with
 * a deterministic order, free-text search and the table's encoded filter
 * conditions. Each entity narrows `sort` to the columns it can order in SQL.
 */
const EntityListQueryFields = {
  /** Free text, matched against the columns the table shows. */
  q: Schema.optional(Schema.String),
  /** Shareable conditions encoded by `formatEntityQuery`. */
  query: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  direction: Schema.optional(SortDirection),
};

export const POLICY_LIST_SORTS = ["name", "priority", "updatedAt", "createdAt"] as const;

export const PolicyListSort = Schema.Literals(POLICY_LIST_SORTS);

export type PolicyListSort = typeof PolicyListSort.Type;

export const PolicySearchQuery = Schema.Struct({
  ...EntityListQueryFields,
  sort: Schema.optional(PolicyListSort),
});

export type PolicySearchQuery = typeof PolicySearchQuery.Type;

export const PolicySearchResponse = Schema.Struct({
  policies: Schema.Array(PolicyRow),
  total: Schema.Number,
});

export type PolicySearchResponse = typeof PolicySearchResponse.Type;

export const GROUP_LIST_SORTS = ["name", "kind", "updatedAt", "createdAt"] as const;

export const GroupListSort = Schema.Literals(GROUP_LIST_SORTS);

export type GroupListSort = typeof GroupListSort.Type;

export const GroupSearchQuery = Schema.Struct({
  ...EntityListQueryFields,
  sort: Schema.optional(GroupListSort),
});

export type GroupSearchQuery = typeof GroupSearchQuery.Type;

export const GroupSearchResponse = Schema.Struct({
  groups: Schema.Array(GroupRow),
  total: Schema.Number,
});

export type GroupSearchResponse = typeof GroupSearchResponse.Type;

export const APPLICATION_LIST_SORTS = [
  "name",
  "platform",
  "source",
  "updatedAt",
  "createdAt",
] as const;

export const ApplicationListSort = Schema.Literals(APPLICATION_LIST_SORTS);

export type ApplicationListSort = typeof ApplicationListSort.Type;

export const ApplicationSearchQuery = Schema.Struct({
  ...EntityListQueryFields,
  sort: Schema.optional(ApplicationListSort),
});

export type ApplicationSearchQuery = typeof ApplicationSearchQuery.Type;

export const ApplicationSearchResponse = Schema.Struct({
  applications: Schema.Array(ApplicationRow),
  total: Schema.Number,
});

export type ApplicationSearchResponse = typeof ApplicationSearchResponse.Type;

export const DeviceSearchSort = Schema.Literals([
  "name",
  "lastSeenAt",
  "enrolledAt",
  "status",
  /** Worst health first when ascending (critical, missing, attention, unknown, healthy). */
  "health",
  /** Windows activation: unreported first, then activated, not-activated, unknown. */
  "activation",
]);

export type DeviceSearchSort = typeof DeviceSearchSort.Type;

export const DeviceHealthFilter = Schema.Literals([
  "healthy",
  "attention",
  "missing",
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
  /** Only Apple devices currently in Lost Mode (or explicitly not in it). */
  lostMode: Schema.optional(Schema.String),
  /**
   * macOS local-account risk filters. `multiple-admins` and
   * `unmanaged-admin` only match accounts whose administrator status is
   * known: Apple's `UserList` normally does not report it.
   */
  localAccount: Schema.optional(Schema.String),
  /**
   * ADE setup state. `awaiting` matches devices held in Setup Assistant;
   * `complete` matches devices that were released (or never awaited).
   */
  setup: Schema.optional(Schema.Literals(["awaiting", "complete"])),
  /**
   * Windows activation state reported by mattraxd. Only Windows
   * devices can match; `unknown` includes Windows devices that have not
   * reported yet. Other platforms never match.
   */
  activation: Schema.optional(WindowsActivationStatus),
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

/**
 * A reusable device-list view saves the exact query a table URL would carry.
 *
 * The web table is still driven by the URL; applying a view writes these
 * values into search params. `limit`/`offset` are deliberately absent: the
 * view stores the page size, and a copied link still starts at page one.
 */
export const DeviceViewQuery = Schema.Struct({
  q: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  status: Schema.optional(DeviceStatus),
  proto: Schema.optional(DeviceProtocol),
  groupId: Schema.optional(Schema.String),
  notSeenSince: Schema.optional(Schema.String),
  staleDays: Schema.optional(Schema.Number),
  health: Schema.optional(DeviceHealthFilter),
  push: Schema.optional(Schema.Literals(["failing", "invalid"])),
  lostMode: Schema.optional(Schema.String),
  localAccount: Schema.optional(Schema.String),
  setup: Schema.optional(Schema.Literals(["awaiting", "complete"])),
  activation: Schema.optional(WindowsActivationStatus),
  attributes: Schema.optional(Schema.String),
  sort: Schema.optional(DeviceSearchSort),
  direction: Schema.optional(SortDirection),
  /** Visible table column ids, in display order. */
  columns: Schema.Array(Schema.String),
  /** Rows per page; the backend clamps this to its search maximum. */
  pageSize: Schema.optional(Schema.Number),
});

export type DeviceViewQuery = typeof DeviceViewQuery.Type;

export const DEVICE_VIEW_VISIBILITIES = ["private", "tenant"] as const;

export const DeviceViewVisibility = Schema.Literals(DEVICE_VIEW_VISIBILITIES);

export type DeviceViewVisibility = typeof DeviceViewVisibility.Type;

/**
 * Table columns the device table renders without an attribute definition.
 * Attribute columns use `attribute:<key>` and are reconciled separately.
 */
export const DEVICE_VIEW_COLUMN_IDS = [
  "name",
  "status",
  "health",
  "osUpdate",
  "platform",
  "activation",
  "serial",
  "model",
  "assetTag",
  "groups",
  "notes",
  "lastSeen",
  "enrolledAt",
] as const;

export type DeviceViewColumnId = (typeof DEVICE_VIEW_COLUMN_IDS)[number];

export const DEVICE_VIEW_DEFAULT_PAGE_SIZE = 50;

/** Mirrors the device search endpoint's maximum page size. */
export const DEVICE_VIEW_MAX_PAGE_SIZE = 200;

export const DeviceView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  visibility: DeviceViewVisibility,
  query: DeviceViewQuery,
  /** Missing when the owning account was deleted; the view survives. */
  createdByAccountId: Schema.optional(Schema.NullOr(Schema.String)),
  isOwner: Schema.Boolean,
  /** The caller's per-member default. At most one view is true. */
  isDefault: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type DeviceView = typeof DeviceView.Type;

export const DeviceViewListResponse = Schema.Struct({
  views: Schema.Array(DeviceView),
});

export type DeviceViewListResponse = typeof DeviceViewListResponse.Type;

export const CreateDeviceViewRequest = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  /** Private unless the caller can publish to the tenant. */
  visibility: Schema.optional(DeviceViewVisibility),
  query: DeviceViewQuery,
});

export type CreateDeviceViewRequest = typeof CreateDeviceViewRequest.Type;

/** Every field is optional; only the supplied fields are written. */
export const PatchDeviceViewRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  visibility: Schema.optional(DeviceViewVisibility),
  query: Schema.optional(DeviceViewQuery),
});

export type PatchDeviceViewRequest = typeof PatchDeviceViewRequest.Type;

/** `viewId: null` clears the member's default and restores the built-in list. */
export const SetDefaultDeviceViewRequest = Schema.Struct({
  viewId: Schema.NullOr(Schema.String),
});

export type SetDefaultDeviceViewRequest = typeof SetDefaultDeviceViewRequest.Type;

/**
 * Drop references that no longer resolve so opening an old view degrades to a
 * wider result instead of an empty or failing one.
 *
 * Known sets are optional so a caller can reconcile before the group and
 * attribute lists have loaded; absent sets leave those references untouched.
 */
export type DeviceViewReconciliation = {
  query: DeviceViewQuery;
  droppedGroup: boolean;
  droppedAttributes: ReadonlyArray<string>;
  droppedColumns: ReadonlyArray<string>;
};

export const reconcileDeviceViewQuery = (
  query: DeviceViewQuery,
  known: {
    readonly groupIds?: ReadonlySet<string>;
    readonly attributeKeys?: ReadonlySet<string>;
  } = {},
): DeviceViewReconciliation => {
  const droppedAttributes: string[] = [];
  let next = query;

  if (query.groupId && known.groupIds && !known.groupIds.has(query.groupId)) {
    const { groupId: _dropped, ...rest } = next;
    next = rest;
  }

  if (query.attributes && known.attributeKeys) {
    try {
      const decoded: unknown = JSON.parse(query.attributes);
      const attributes = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String))(
        decoded,
      );

      if (Option.isSome(attributes)) {
        const kept: Record<string, string> = {};

        for (const [key, value] of Object.entries(attributes.value)) {
          if (known.attributeKeys.has(key)) kept[key] = value;
          else droppedAttributes.push(key);
        }

        const { attributes: _attributes, ...rest } = next;
        next = Object.keys(kept).length ? { ...rest, attributes: JSON.stringify(kept) } : rest;
      }
    } catch {
      // A malformed filter is left for the search endpoint to report; the view
      // is still readable and the rest of its settings apply.
    }
  }

  const droppedColumns: string[] = [];
  const columns = query.columns.filter((column) => {
    if (column.startsWith("attribute:")) {
      const key = column.slice("attribute:".length);

      if (!known.attributeKeys || known.attributeKeys.has(key)) return true;

      droppedColumns.push(column);

      return false;
    }

    if ((DEVICE_VIEW_COLUMN_IDS as ReadonlyArray<string>).includes(column)) return true;

    droppedColumns.push(column);

    return false;
  });

  return {
    query: { ...next, columns },
    droppedGroup: Boolean(query.groupId && known.groupIds && !known.groupIds.has(query.groupId)),
    droppedAttributes,
    droppedColumns,
  };
};

export const NodeResponse = Schema.Union([DeviceRow, GroupNode, PolicyRow]);

export type NodeResponse = typeof NodeResponse.Type;
