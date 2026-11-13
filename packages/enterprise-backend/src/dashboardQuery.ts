import { Schema } from "effect";
import {
  DeviceQuery,
  deviceQueryProblem,
  EnterpriseBadRequest,
  type DashboardQueryBucket,
  type DashboardWidgetType,
} from "@mattrax/enterprise-domain";

const decodeQuery = Schema.decodeUnknownSync(DeviceQuery);

export type WidgetLayout = { x: number; y: number; w: number; h: number };

const integer = (value: unknown, fallback: number) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};

export const normalizeWidgetLayout = (
  layout: Partial<WidgetLayout>,
  fallback: WidgetLayout = { x: 0, y: 0, w: 4, h: 3 },
): WidgetLayout => {
  const w = Math.min(Math.max(integer(layout.w, fallback.w), 1), 12);
  const h = Math.min(Math.max(integer(layout.h, fallback.h), 1), 24);
  const x = Math.min(Math.max(integer(layout.x, fallback.x), 0), 12 - w);
  const y = Math.max(integer(layout.y, fallback.y), 0);
  return { x, y, w, h };
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const text = (value: unknown, field: string, maximum = 500) => {
  if (typeof value !== "string" || value.trim() === "")
    throw new EnterpriseBadRequest({ message: `${field} is required` });
  return value.trim().slice(0, maximum);
};

const queryValue = (value: unknown) => {
  try {
    const query = decodeQuery(value ?? { all: [] });
    const problem = deviceQueryProblem(query);
    if (problem) throw new EnterpriseBadRequest({ message: problem });
    return query;
  } catch (error) {
    if (error instanceof EnterpriseBadRequest) throw error;
    throw new EnterpriseBadRequest({ message: "That device query is not valid" });
  }
};

const datasetValue = (value: unknown) => {
  if (value !== "devices" && value !== "software")
    throw new EnterpriseBadRequest({ message: "Choose a devices or software dataset" });
  return value;
};

const columnsValue = (value: unknown) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new EnterpriseBadRequest({ message: "Table columns must be a list of field names" });
  return value.slice(0, 20).map((item) => String(item));
};

/**
 * Validate widget configuration before it reaches the database. Unknown fields
 * are dropped so a widget only ever stores the options its type understands.
 */
export const normalizeWidgetConfig = (type: DashboardWidgetType, value: unknown): unknown => {
  const config = record(value);
  switch (type) {
    case "markdown": {
      const markdown = text(config.markdown, "Markdown", 20_000);
      return { markdown };
    }
    case "stat":
      return {
        dataset: datasetValue(config.dataset),
        query: queryValue(config.query),
        ...(typeof config.label === "string" && config.label.trim()
          ? { label: config.label.trim().slice(0, 80) }
          : {}),
      };
    case "pie":
      return {
        dataset: datasetValue(config.dataset),
        query: queryValue(config.query),
        dimension: text(config.dimension, "Dimension", 80),
      };
    case "table": {
      const columns = columnsValue(config.columns);
      return {
        dataset: datasetValue(config.dataset),
        query: queryValue(config.query),
        ...(columns ? { columns } : {}),
        ...(config.limit === undefined
          ? {}
          : { limit: Math.min(Math.max(integer(config.limit, 100), 1), 200) }),
      };
    }
    default:
      throw new EnterpriseBadRequest({ message: "Choose a valid widget type" });
  }
};

export const platformBucket = (proto: string | null | undefined) =>
  proto === "apple"
    ? "Apple"
    : proto === "win"
      ? "Windows"
      : proto === "android"
        ? "Android"
        : "Unknown";

export const deviceBucket = (
  device: {
    readonly proto?: string | null;
    readonly osVersion?: string | null;
    readonly model?: string | null;
    readonly status?: string | null;
    readonly fileVaultStatus?: string | null;
    readonly fileVaultEnabled?: boolean | null;
    readonly batteryHealth?: string | null;
    readonly osEdition?: string | null;
    readonly enrolledAt?: Date | string | null;
    readonly lastSeenAt?: Date | string | null;
  },
  dimension: string,
  health: { readonly level: string } | null | undefined,
  now = new Date(),
): string => {
  switch (dimension) {
    case "platform":
    case "proto":
      return platformBucket(device.proto);
    case "health":
      return health?.level ? titleCase(health.level) : "Unknown";
    case "status":
      return titleCase(device.status ?? "unknown");
    case "fileVault":
    case "fileVaultStatus": {
      if (device.fileVaultStatus) return titleCase(device.fileVaultStatus);
      if (device.fileVaultEnabled === true) return "Enabled";
      if (device.fileVaultEnabled === false) return "Disabled";
      return "Unknown";
    }
    case "enrolledDays": {
      const days = ageInDays(device.enrolledAt, now);
      return days === null ? "Unknown" : ageBucket(days);
    }
    case "staleDays": {
      const days = ageInDays(device.lastSeenAt, now);
      return days === null ? "Never seen" : ageBucket(days);
    }
    case "osVersion":
      return device.osVersion?.trim() || "Unknown";
    case "model":
      return device.model?.trim() || "Unknown";
    case "osEdition":
      return device.osEdition?.trim() || "Unknown";
    case "batteryHealth":
      return device.batteryHealth?.trim() || "Unknown";
    default:
      return "Unknown";
  }
};

const titleCase = (value: string) =>
  value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("_", " ");

const ageInDays = (value: Date | string | null | undefined, now: Date) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
};

const ageBucket = (days: number) =>
  days < 1
    ? "Today"
    : days <= 7
      ? "1–7 days"
      : days <= 30
        ? "8–30 days"
        : days <= 90
          ? "31–90 days"
          : "Over 90 days";

export const softwareBucket = (
  application: {
    readonly isManaged?: boolean;
    readonly hasUpdateAvailable?: boolean;
  },
  dimension: string,
): string => {
  switch (dimension) {
    case "managed":
      return application.isManaged ? "Managed" : "Unmanaged";
    case "updates":
    case "hasUpdate":
      return application.hasUpdateAvailable ? "Update available" : "Up to date";
    default:
      return "Unknown";
  }
};

/** Turn labels into sorted buckets with optional ordering. */
export const toBuckets = (
  labels: ReadonlyArray<string>,
  order?: ReadonlyArray<string>,
): DashboardQueryBucket[] => {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const entries = [...counts.entries()];
  if (order) {
    const rank = new Map(order.map((label, index) => [label, index]));
    entries.sort(
      (left, right) =>
        (rank.get(left[0]) ?? order.length) - (rank.get(right[0]) ?? order.length) ||
        right[1] - left[1],
    );
  } else entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return entries.slice(0, 12).map(([label, value]) => ({ label, value }));
};
