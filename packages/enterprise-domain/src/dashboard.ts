import { Option, Schema } from "effect";
import { DeviceQuery } from "./deviceQuery.js";

/** Widgets supported by the dashboard grid. */
export const DashboardWidgetType = Schema.Literals(["table", "pie", "stat", "markdown"]);

export type DashboardWidgetType = typeof DashboardWidgetType.Type;

/**
 * Datasets a query widget can project.
 *
 * `users` reads the tenant directory (name, email, status, source) so a
 * dashboard can report on user inventory and active/inactive users without a
 * separate report type.
 */
export const DashboardDataset = Schema.Literals(["devices", "software", "users"]);

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

/** Status filter for the user-inventory dataset. */
export const DashboardUserStatus = Schema.Literals(["active", "disabled"]);

export type DashboardUserStatus = typeof DashboardUserStatus.Type;

export const DashboardUserFilter = Schema.Struct({
  status: Schema.optional(DashboardUserStatus),
  source: Schema.optional(Schema.Literals(["manual", "entra", "scim"])),
});

export type DashboardUserFilter = typeof DashboardUserFilter.Type;

export const DashboardQueryRequest = Schema.Struct({
  dataset: DashboardDataset,
  /**
   * Device filter. Applies to the `devices` dataset and narrows the devices
   * whose installed software is projected for `software`. The `users` dataset
   * ignores it in favour of `userFilter`, and every widget still sends
   * `{ all: [] }` so old clients stay valid.
   */
  query: DeviceQuery,
  /** Directory filter for the `users` dataset. */
  userFilter: Schema.optional(DashboardUserFilter),
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
  /** User-inventory projections. */
  email: Schema.optional(Schema.NullOr(Schema.String)),
  source: Schema.optional(Schema.NullOr(Schema.String)),
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

/** How often a report digest is generated. Weekly is Monday, monthly is the 1st. */
export const DashboardReportFrequency = Schema.Literals(["daily", "weekly", "monthly"]);

export type DashboardReportFrequency = typeof DashboardReportFrequency.Type;

/** What a report is rendered as. The emailed attachment has the same format. */
export const DashboardReportFormat = Schema.Literals(["csv", "pdf"]);

export type DashboardReportFormat = typeof DashboardReportFormat.Type;

export const DashboardReportRunStatus = Schema.Literals(["pending", "sending", "queued", "failed"]);

export type DashboardReportRunStatus = typeof DashboardReportRunStatus.Type;

/** At most this many addresses may receive one report. */
export const DASHBOARD_REPORT_MAX_RECIPIENTS = 20;

/** Bounds the settings panel and the number of work items one dashboard adds. */
export const DASHBOARD_REPORTS_PER_DASHBOARD = 20;

/**
 * Tenant members are stored by account id so a renamed address follows the
 * account. They are re-resolved against the tenant on every send; an external
 * address is stored verbatim and only owners/admins may add one.
 */
export const DashboardReportRecipients = Schema.Struct({
  memberAccountIds: Schema.Array(Schema.String).check(
    Schema.isMaxLength(DASHBOARD_REPORT_MAX_RECIPIENTS),
  ),
  emails: Schema.Array(Schema.String).check(Schema.isMaxLength(DASHBOARD_REPORT_MAX_RECIPIENTS)),
});

export type DashboardReportRecipients = typeof DashboardReportRecipients.Type;

const ReportHour = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 23 }));

export const CreateDashboardReportRequest = Schema.Struct({
  name: Schema.String,
  frequency: DashboardReportFrequency,
  /** UTC hour, 0–23. */
  hourUtc: Schema.optional(ReportHour),
  format: DashboardReportFormat,
  recipients: DashboardReportRecipients,
  enabled: Schema.optional(Schema.Boolean),
});

export type CreateDashboardReportRequest = typeof CreateDashboardReportRequest.Type;

export const PatchDashboardReportRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  frequency: Schema.optional(DashboardReportFrequency),
  hourUtc: Schema.optional(ReportHour),
  format: Schema.optional(DashboardReportFormat),
  recipients: Schema.optional(DashboardReportRecipients),
  enabled: Schema.optional(Schema.Boolean),
});

export type PatchDashboardReportRequest = typeof PatchDashboardReportRequest.Type;

export const DashboardReport = Schema.Struct({
  id: Schema.String,
  dashboardId: Schema.String,
  name: Schema.String,
  frequency: DashboardReportFrequency,
  hourUtc: Schema.Number,
  format: DashboardReportFormat,
  enabled: Schema.Boolean,
  recipients: DashboardReportRecipients,
  lastPeriod: Schema.NullOr(Schema.String),
  lastRunAt: Schema.NullOr(Schema.String),
  nextRunAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type DashboardReport = typeof DashboardReport.Type;

export const DashboardReportListResponse = Schema.Struct({
  reports: Schema.Array(DashboardReport),
});

export type DashboardReportListResponse = typeof DashboardReportListResponse.Type;

export const DashboardReportRun = Schema.Struct({
  id: Schema.String,
  reportId: Schema.String,
  reportName: Schema.String,
  format: DashboardReportFormat,
  period: Schema.String,
  status: DashboardReportRunStatus,
  attempts: Schema.Number,
  recipients: Schema.Array(Schema.String),
  sizeBytes: Schema.Number,
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

export type DashboardReportRun = typeof DashboardReportRun.Type;

export const DashboardReportRunListResponse = Schema.Struct({
  runs: Schema.Array(DashboardReportRun),
});

export type DashboardReportRunListResponse = typeof DashboardReportRunListResponse.Type;

export const DashboardReportExportQuery = Schema.Struct({
  format: Schema.optional(DashboardReportFormat),
});

export type DashboardReportExportQuery = typeof DashboardReportExportQuery.Type;

const WidgetQueryConfig = Schema.Struct({
  dataset: Schema.optional(DashboardDataset),
  query: Schema.optional(DeviceQuery),
  userFilter: Schema.optional(DashboardUserFilter),
  dimension: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
});

/**
 * The query a widget sends, shared by the browser and the report renderer.
 *
 * Keeping this in the domain contract is what makes a scheduled report show
 * exactly what the dashboard shows: both paths build the same request and go
 * through the same query endpoint.
 */
export const dashboardQueryForWidget = (widget: {
  readonly type: DashboardWidgetType;
  readonly config: unknown;
}): DashboardQueryRequest => {
  const config: {
    readonly dataset?: DashboardDataset;
    readonly query?: DeviceQuery;
    readonly userFilter?: DashboardUserFilter;
    readonly dimension?: string;
    readonly limit?: number;
  } = Option.getOrElse(Schema.decodeUnknownOption(WidgetQueryConfig)(widget.config), () => ({}));

  return {
    dataset: config.dataset ?? "devices",
    query: config.query ?? { all: [] },
    userFilter: config.userFilter,
    groupBy: config.dimension,
    limit: config.limit,
    countOnly: widget.type === "stat",
  };
};
