import { Schema } from "effect";
import { canonicalTenantSegment } from "./tenant";

/**
 * Typed route helpers for the dashboard.
 *
 * File-based routing stays the source of truth: these helpers only name the
 * existing path patterns and decode the values the router hands back. A link
 * built through `routes` is encoded the same way the router decodes it, and a
 * parameter read through a schema fails the same way on every page.
 */

/** Query-string values the Solid router exposes, before normalisation. */
export type RouteSearchValue = string | ReadonlyArray<string> | undefined;

export type RouteSearch = Readonly<Record<string, RouteSearchValue>>;

const segment = (value: string): string => encodeURIComponent(value);

/** The tenant dashboard parameters, present on every `/t/:tenantId` page. */
export const TenantRouteParams = Schema.Struct({ tenantId: Schema.String });

export type TenantRouteParams = typeof TenantRouteParams.Type;

export const DeviceRouteParams = Schema.Struct({
  tenantId: Schema.String,
  deviceId: Schema.String,
});

export type DeviceRouteParams = typeof DeviceRouteParams.Type;

export const PolicyRouteParams = Schema.Struct({
  tenantId: Schema.String,
  policyId: Schema.String,
});

export type PolicyRouteParams = typeof PolicyRouteParams.Type;

export const GroupRouteParams = Schema.Struct({
  tenantId: Schema.String,
  groupId: Schema.String,
});

export type GroupRouteParams = typeof GroupRouteParams.Type;

export const UserRouteParams = Schema.Struct({
  tenantId: Schema.String,
  userId: Schema.String,
});

export type UserRouteParams = typeof UserRouteParams.Type;

export const ApplicationRouteParams = Schema.Struct({
  tenantId: Schema.String,
  applicationId: Schema.String,
});

export type ApplicationRouteParams = typeof ApplicationRouteParams.Type;

export const DashboardRouteParams = Schema.Struct({
  tenantId: Schema.String,
  dashboardId: Schema.String,
});

export type DashboardRouteParams = typeof DashboardRouteParams.Type;

export const DEVICE_STATUSES = ["enrolling", "enrolled", "unenrolling", "unenrolled"] as const;

export const DEVICE_PROTOCOLS = ["apple", "win", "android"] as const;

export const DEVICE_HEALTH_FILTERS = [
  "healthy",
  "attention",
  "missing",
  "critical",
  "unknown",
  "stale",
] as const;

export const DEVICE_STALE_DAYS = ["7", "30", "90"] as const;

export const DEVICE_PUSH_FILTERS = ["failing", "invalid"] as const;

export const DEVICE_LOST_MODE_FILTERS = ["active", "inactive"] as const;

export const DEVICE_LOCAL_ACCOUNT_FILTERS = ["without-secure-token", "not-seen-30-days"] as const;

/** Windows activation states reported by mattraxd. */
export const DEVICE_ACTIVATION_FILTERS = ["activated", "not-activated", "unknown"] as const;

export const DEVICE_SORT_FIELDS = [
  "name",
  "lastSeenAt",
  "enrolledAt",
  "status",
  "health",
  "activation",
] as const;

export const SORT_DIRECTIONS = ["asc", "desc"] as const;

/**
 * Filters the device list keeps in the URL. Unknown values are dropped rather
 * than forwarded, which is what the page did with its previous hand-written
 * literal checks.
 */
export const DeviceSearchParams = Schema.Struct({
  status: Schema.optional(Schema.Literals(DEVICE_STATUSES)),
  proto: Schema.optional(Schema.Literals(DEVICE_PROTOCOLS)),
  /** Positive day count; the picker shows 7/30/90 but a view may store any. */
  staleDays: Schema.optional(Schema.String),
  health: Schema.optional(Schema.Literals(DEVICE_HEALTH_FILTERS)),
  push: Schema.optional(Schema.Literals(DEVICE_PUSH_FILTERS)),
  lostMode: Schema.optional(Schema.Literals(DEVICE_LOST_MODE_FILTERS)),
  localAccount: Schema.optional(Schema.Literals(DEVICE_LOCAL_ACCOUNT_FILTERS)),
  setup: Schema.optional(Schema.Literals(["awaiting", "complete"])),
  notSeenSince: Schema.optional(Schema.String),
  activation: Schema.optional(Schema.Literals(DEVICE_ACTIVATION_FILTERS)),
  sort: Schema.optional(Schema.Literals(DEVICE_SORT_FIELDS)),
  direction: Schema.optional(Schema.Literals(SORT_DIRECTIONS)),
  q: Schema.optional(Schema.String),
  groupId: Schema.optional(Schema.String),
  attributeKey: Schema.optional(Schema.String),
  attributeValue: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  /** 1-based page index, so a paged device view is shareable. */
  page: Schema.optional(Schema.String),
  /** Visible table column ids, comma-separated, from a saved view. */
  columns: Schema.optional(Schema.String),
  /** Rows per page, from a saved view. */
  pageSize: Schema.optional(Schema.String),
  /**
   * The saved view the current filters came from. Only a UI marker: the exact
   * filters and columns are also in the URL so a copied link keeps working if
   * the view is later renamed or deleted.
   */
  view: Schema.optional(Schema.String),
  import: Schema.optional(Schema.Literal("1")),
});

export type DeviceSearchParams = typeof DeviceSearchParams.Type;

const firstValue = (value: RouteSearchValue): string | undefined => {
  if (Array.isArray(value)) return value[0];

  return Schema.is(Schema.String)(value) ? value : undefined;
};

/** Normalise router search values to the single string a schema expects. */
export const searchObject = (search: RouteSearch): Record<string, string> => {
  const entries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(search)) {
    const item = firstValue(value);

    if (item !== undefined) entries.push([key, item]);
  }

  return Object.fromEntries(entries);
};

/** Decode one enum filter, treating an unknown value as absent. */
const literalValue = <const T extends ReadonlyArray<string>>(
  values: T,
  value: string | undefined,
): T[number] | undefined => {
  if (value === undefined) return undefined;

  const schema = Schema.Literals(values);

  return Schema.is(schema)(value) ? value : undefined;
};

/**
 * A page index survives the URL only when it is a positive integer. Out-of-range
 * or non-numeric values are dropped rather than sent to the API, which would
 * otherwise return an empty page and leave the pagination controls stranded.
 */
const pageIndexValue = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const page = Number(value);

  return Number.isInteger(page) && page >= 1 ? String(page) : undefined;
};

type MutableDeviceSearchParams = {
  -readonly [K in keyof DeviceSearchParams]: DeviceSearchParams[K];
};

export const decodeDeviceSearchParams = (search: RouteSearch): DeviceSearchParams => {
  const values = searchObject(search);
  const params: MutableDeviceSearchParams = {};
  const status = literalValue(DEVICE_STATUSES, values.status);
  const proto = literalValue(DEVICE_PROTOCOLS, values.proto);
  const staleDaysValue = values.staleDays === undefined ? undefined : Number(values.staleDays);
  const staleDays =
    staleDaysValue !== undefined &&
    Number.isInteger(staleDaysValue) &&
    staleDaysValue >= 1 &&
    staleDaysValue <= 3650
      ? String(staleDaysValue)
      : undefined;
  const health = literalValue(DEVICE_HEALTH_FILTERS, values.health);
  const push = literalValue(DEVICE_PUSH_FILTERS, values.push);
  const lostMode = literalValue(DEVICE_LOST_MODE_FILTERS, values.lostMode);
  const localAccount = literalValue(DEVICE_LOCAL_ACCOUNT_FILTERS, values.localAccount);
  const setup = literalValue(["awaiting", "complete"], values.setup);
  const activation = literalValue(DEVICE_ACTIVATION_FILTERS, values.activation);
  const sort = literalValue(DEVICE_SORT_FIELDS, values.sort);
  const direction = literalValue(SORT_DIRECTIONS, values.direction);
  const page = pageIndexValue(values.page);
  const pageSizeValue = values.pageSize === undefined ? undefined : Number(values.pageSize);
  const pageSize =
    pageSizeValue !== undefined &&
    Number.isInteger(pageSizeValue) &&
    pageSizeValue >= 1 &&
    pageSizeValue <= 200
      ? String(pageSizeValue)
      : undefined;
  const columns = values.columns
    ?.split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .join(",");
  const view = values.view?.trim();

  if (status !== undefined) params.status = status;

  if (proto !== undefined) params.proto = proto;

  if (staleDays !== undefined) params.staleDays = staleDays;

  if (health !== undefined) params.health = health;

  if (push !== undefined) params.push = push;

  if (lostMode !== undefined) params.lostMode = lostMode;

  if (localAccount !== undefined) params.localAccount = localAccount;

  if (setup !== undefined) params.setup = setup;

  if (activation !== undefined) params.activation = activation;

  if (values.notSeenSince !== undefined) params.notSeenSince = values.notSeenSince;

  if (sort !== undefined) params.sort = sort;

  if (direction !== undefined) params.direction = direction;

  if (values.q !== undefined) params.q = values.q;

  if (values.groupId !== undefined) params.groupId = values.groupId;

  if (values.attributeKey !== undefined) params.attributeKey = values.attributeKey;

  if (values.attributeValue !== undefined) params.attributeValue = values.attributeValue;

  if (values.query !== undefined) params.query = values.query;

  if (page !== undefined) params.page = page;

  if (columns) params.columns = columns;

  if (pageSize !== undefined) params.pageSize = pageSize;

  if (view) params.view = view;

  if (values.import === "1") params.import = "1";

  return params;
};

/**
 * Read every device-list filter from a reactive search-params proxy. Reading
 * absent keys is deliberate: Solid only tracks keys that are touched, so a link
 * that adds `?health=attention` must touch `health` for the page to react.
 */
export const readDeviceSearchParams = (search: RouteSearch): DeviceSearchParams =>
  decodeDeviceSearchParams({
    status: search.status,
    proto: search.proto,
    staleDays: search.staleDays,
    health: search.health,
    push: search.push,
    lostMode: search.lostMode,
    localAccount: search.localAccount,
    setup: search.setup,
    notSeenSince: search.notSeenSince,
    sort: search.sort,
    direction: search.direction,
    q: search.q,
    groupId: search.groupId,
    attributeKey: search.attributeKey,
    attributeValue: search.attributeValue,
    query: search.query,
    page: search.page,
    columns: search.columns,
    pageSize: search.pageSize,
    view: search.view,
    import: search.import,
  });

/** Dashboard search parameters: `?edit=1` opens a dashboard in edit mode. */
export const DashboardSearchParams = Schema.Struct({
  edit: Schema.optional(Schema.Literal("1")),
});

export type DashboardSearchParams = typeof DashboardSearchParams.Type;

export const dashboardSearch = (search: DashboardSearchParams): string =>
  search.edit === "1" ? "?edit=1" : "";

/** The canonical paths of the dashboard. */
export const routes = {
  home: () => "/",
  login: (returnTo?: string) =>
    returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login",
  account: () => "/account",
  accountDelete: () => "/account/delete",
  adminAccounts: () => "/admin/accounts",
  settings: () => "/settings",
  tenants: () => "/tenants",
  newTenant: () => "/tenants/new",
  tenant: (tenantId: string | undefined) => {
    // Every caller lives under the `/t/:tenantId` route, so a missing id is a
    // programming error: fail loudly instead of linking to `/t/undefined`.
    if (!tenantId) throw new Error("A tenant route needs a tenant id");
    const base = `/t/${segment(canonicalTenantSegment(tenantId))}`;

    return {
      overview: () => base,
      dashboards: () => `${base}/dashboards`,
      dashboard: (dashboardId: string, search: DashboardSearchParams = {}) =>
        `${base}/dashboards/${segment(dashboardId)}${dashboardSearch(search)}`,
      dashboardReports: (dashboardId: string) =>
        `${base}/dashboards/${segment(dashboardId)}/reports`,
      devices: (search: DeviceSearchParams = {}) => {
        const query = new URLSearchParams();

        const entries = Object.entries(search).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        );

        for (const [key, value] of entries) query.set(key, value);

        return `${base}/devices${entries.length > 0 ? `?${query}` : ""}`;
      },
      device: (deviceId: string) => `${base}/devices/${segment(deviceId)}`,
      osVersions: () => `${base}/os-versions`,
      users: () => `${base}/users`,
      user: (userId: string) => `${base}/users/${segment(userId)}`,
      groups: () => `${base}/groups`,
      newGroup: () => `${base}/groups/new`,
      group: (groupId: string) => `${base}/groups/${segment(groupId)}`,
      policies: () => `${base}/policies`,
      newPolicy: () => `${base}/policies/new`,
      importPolicy: (policyId?: string) =>
        `${base}/policies/import${policyId ? `?policy=${segment(policyId)}` : ""}`,
      policy: (policyId: string) => `${base}/policies/${segment(policyId)}`,
      policyDesign: (policyId: string) => `${base}/policies/${segment(policyId)}/design`,
      policyEditor: (policyId: string) => `${base}/policies/${segment(policyId)}/editor`,
      policyAssignments: (policyId: string) => `${base}/policies/${segment(policyId)}/assignments`,
      applications: () => `${base}/applications`,
      newApplication: () => `${base}/applications/new`,
      application: (applicationId: string) => `${base}/applications/${segment(applicationId)}`,
      softwareCatalogue: () => `${base}/applications/catalogue`,
      softwareCatalogueTitle: (titleId: string) =>
        `${base}/applications/catalogue/${segment(titleId)}`,
      scripts: () => `${base}/scripts`,
      restrictedSoftware: () => `${base}/restricted-software`,
      restrictedSoftwareRule: (ruleId: string) => `${base}/restricted-software/${segment(ruleId)}`,
      migrations: () => `${base}/migration`,
      migration: (migrationId: string) => `${base}/migration/${segment(migrationId)}`,
      newScript: () => `${base}/scripts/new`,
      script: (scriptId: string) => `${base}/scripts/${segment(scriptId)}`,
      software: () => `${base}/software`,
      enrollment: () => `${base}/enrollment`,
      settings: () => `${base}/settings`,
      settingsMigration: () => `${base}/settings/migration`,
      settingsMigrationDetail: (migrationId: string) =>
        `${base}/settings/migration/${segment(migrationId)}`,
      settingsTab: (
        tab:
          | ""
          | "administrators"
          | "approvals"
          | "backups"
          | "identity"
          | "attributes"
          | "enrollment"
          | "management"
          | "migration"
          | "delivery"
          | "integrations"
          | "audit"
          | "os-updates"
          | "billing"
          | "storage"
          | "legal",
      ) => (tab === "" ? `${base}/settings` : `${base}/settings/${tab}`),
      settingsAdministrators: () => `${base}/settings/administrators`,
      settingsDirectory: () => `${base}/settings/identity/directory`,
    };
  },
} as const;
