import { Schema } from "effect";
import { DeviceQuery } from "./deviceQuery.js";

/** Widgets supported by the dashboard grid. */
export const DashboardWidgetType = Schema.Literals(["table", "pie", "stat", "markdown"]);

export type DashboardWidgetType = typeof DashboardWidgetType.Type;

/** Datasets a query widget can project. */
export const DashboardDataset = Schema.Literals(["devices", "software"]);

export type DashboardDataset = typeof DashboardDataset.Type;

/**
 * Widget configuration is intentionally open-ended JSON so new widget options
 * do not require a migration. The backend normalises and validates it per
 * widget type before writing.
 */
export const DashboardWidget = Schema.Struct({
  id: Schema.String,
  type: DashboardWidgetType,
  title: Schema.String,
  config: Schema.Unknown,
  x: Schema.Number,
  y: Schema.Number,
  w: Schema.Number,
  h: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type DashboardWidget = typeof DashboardWidget.Type;

export const DashboardSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  isDefault: Schema.Boolean,
  widgetCount: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type DashboardSummary = typeof DashboardSummary.Type;

export const Dashboard = Schema.Struct({
  ...DashboardSummary.fields,
  widgets: Schema.Array(DashboardWidget),
});

export type Dashboard = typeof Dashboard.Type;

export const DashboardListResponse = Schema.Struct({
  dashboards: Schema.Array(DashboardSummary),
});

export type DashboardListResponse = typeof DashboardListResponse.Type;

export const CreateDashboardRequest = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  /** Seed a new dashboard with the default overview widgets. */
  template: Schema.optional(Schema.Literal("overview")),
});

export type CreateDashboardRequest = typeof CreateDashboardRequest.Type;

/** Every field is optional; only the supplied fields are written. */
export const PatchDashboardRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  isDefault: Schema.optional(Schema.Boolean),
});

export type PatchDashboardRequest = typeof PatchDashboardRequest.Type;

export const CreateDashboardWidgetRequest = Schema.Struct({
  type: DashboardWidgetType,
  title: Schema.String,
  config: Schema.Unknown,
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  w: Schema.optional(Schema.Number),
  h: Schema.optional(Schema.Number),
});

export type CreateDashboardWidgetRequest = typeof CreateDashboardWidgetRequest.Type;

/**
 * Partial widget update. Layout fields can be sent by the drag/resize path and
 * content fields by the settings form, so two administrators editing different
 * widgets (or different properties) do not overwrite each other.
 */
export const PatchDashboardWidgetRequest = Schema.Struct({
  type: Schema.optional(DashboardWidgetType),
  title: Schema.optional(Schema.String),
  config: Schema.optional(Schema.Unknown),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  w: Schema.optional(Schema.Number),
  h: Schema.optional(Schema.Number),
});

export type PatchDashboardWidgetRequest = typeof PatchDashboardWidgetRequest.Type;

export const DashboardLayoutRequest = Schema.Struct({
  widgets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      x: Schema.optional(Schema.Number),
      y: Schema.optional(Schema.Number),
      w: Schema.optional(Schema.Number),
      h: Schema.optional(Schema.Number),
    }),
  ),
});

export type DashboardLayoutRequest = typeof DashboardLayoutRequest.Type;

export const DashboardQueryRequest = Schema.Struct({
  dataset: DashboardDataset,
  query: DeviceQuery,
  /** Bucket dimension for pie widgets. */
  groupBy: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  /**
   * Stat widgets only need the total. The backend may then skip work that is
   * only used to project or bucket rows (for example application inventory).
   * `rows` and `buckets` are empty in the response.
   */
  countOnly: Schema.optional(Schema.Boolean),
});

export type DashboardQueryRequest = typeof DashboardQueryRequest.Type;

/**
 * One normalised row. Device and software projections share the row shape so
 * table widgets can render either without knowing the dataset.
 */
export const DashboardQueryRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.optional(Schema.NullOr(Schema.String)),
  osVersion: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  serial: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  health: Schema.optional(Schema.NullOr(Schema.String)),
  lastSeenAt: Schema.optional(Schema.NullOr(Schema.String)),
  enrolledAt: Schema.optional(Schema.NullOr(Schema.String)),
  managed: Schema.optional(Schema.NullOr(Schema.Boolean)),
  version: Schema.optional(Schema.NullOr(Schema.String)),
  bundleId: Schema.optional(Schema.NullOr(Schema.String)),
  deviceCount: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type DashboardQueryRow = typeof DashboardQueryRow.Type;

export const DashboardQueryBucket = Schema.Struct({
  label: Schema.String,
  value: Schema.Number,
});

export type DashboardQueryBucket = typeof DashboardQueryBucket.Type;

export const DashboardQueryResponse = Schema.Struct({
  total: Schema.Number,
  rows: Schema.Array(DashboardQueryRow),
  buckets: Schema.Array(DashboardQueryBucket),
});

export type DashboardQueryResponse = typeof DashboardQueryResponse.Type;

/**
 * Several widget queries in one request.
 *
 * A dashboard renders several independent widgets, and each one previously
 * fetched its own devices, health and (for tables) application inventory. The
 * batch endpoint evaluates them against one snapshot of the tenant, so the
 * device read happens once per page instead of once per widget.
 */
export const DashboardQueryBatchRequest = Schema.Struct({
  queries: Schema.Array(DashboardQueryRequest).check(Schema.isMaxLength(24)),
});

export type DashboardQueryBatchRequest = typeof DashboardQueryBatchRequest.Type;

export const DashboardQueryBatchResponse = Schema.Struct({
  results: Schema.Array(DashboardQueryResponse),
});

export type DashboardQueryBatchResponse = typeof DashboardQueryBatchResponse.Type;

/** Typed views of the open-ended widget config used by the UI. */
export type DashboardQueryConfig = {
  dataset: DashboardDataset;
  query: DeviceQuery;
  columns?: ReadonlyArray<string>;
  limit?: number;
};

export type DashboardPieConfig = {
  dataset: DashboardDataset;
  query: DeviceQuery;
  dimension: string;
};

export type DashboardStatConfig = {
  dataset: DashboardDataset;
  query: DeviceQuery;
  label?: string;
};

export type DashboardMarkdownConfig = { markdown: string };

/** Fallback dashboard used when a tenant has not created one yet. */
export const defaultOverviewWidgets = (): ReadonlyArray<{
  type: DashboardWidgetType;
  title: string;
  config: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
}> => [
  {
    type: "stat",
    title: "Managed devices",
    config: { dataset: "devices", query: { all: [] }, label: "devices" },
    x: 0,
    y: 0,
    w: 3,
    h: 2,
  },
  {
    type: "stat",
    title: "Devices needing attention",
    config: {
      dataset: "devices",
      query: { all: [{ field: "health", op: "eq", value: "attention" }] },
      label: "need attention",
    },
    x: 3,
    y: 0,
    w: 3,
    h: 2,
  },
  {
    type: "stat",
    title: "Critical devices",
    config: {
      dataset: "devices",
      query: { all: [{ field: "health", op: "eq", value: "critical" }] },
      label: "critical",
    },
    x: 6,
    y: 0,
    w: 3,
    h: 2,
  },
  {
    type: "stat",
    title: "Stale devices",
    config: {
      dataset: "devices",
      query: { all: [{ field: "health", op: "eq", value: "stale" }] },
      label: "stale",
    },
    x: 9,
    y: 0,
    w: 3,
    h: 2,
  },
  {
    type: "pie",
    title: "Fleet by platform",
    config: {
      dataset: "devices",
      query: { all: [] },
      dimension: "platform",
    },
    x: 0,
    y: 2,
    w: 6,
    h: 5,
  },
  {
    type: "table",
    title: "Attention queue",
    config: {
      dataset: "devices",
      query: { all: [{ field: "health", op: "eq", value: "attention" }] },
      columns: ["name", "platform", "osVersion", "status", "lastSeenAt"],
      limit: 10,
    },
    x: 6,
    y: 2,
    w: 6,
    h: 5,
  },
  {
    type: "markdown",
    title: "Welcome",
    config: {
      markdown:
        "## Your fleet at a glance\n\nThis dashboard is shared with everyone in the tenant. Add widgets, resize the grid, or write team notes and links from the dashboard editor.",
    },
    x: 0,
    y: 7,
    w: 12,
    h: 3,
  },
];
