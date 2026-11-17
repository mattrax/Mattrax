import { Match, Option, Schema } from "effect";
import {
  DeviceQuery,
  deviceQueryProblem,
  EnterpriseBadRequest,
  type DashboardQueryBucket,
  type DashboardWidgetType,
} from "@mattrax/enterprise-domain";

const decodeQuery = Schema.decodeUnknownSync(DeviceQuery);

export type WidgetLayout = { x: number; y: number; w: number; h: number };

const NumericValue = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

const integer = (value: Schema.Json | undefined, fallback: number) => {
  const number = Option.getOrUndefined(Schema.decodeUnknownOption(NumericValue)(value));

  return number === undefined ? fallback : Math.trunc(number);
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

const WidgetRecord = Schema.Record(Schema.String, Schema.Json);

const record = (value: Schema.Json | undefined): Schema.Schema.Type<typeof WidgetRecord> =>
  Option.getOrElse(Schema.decodeUnknownOption(WidgetRecord)(value), () => ({}));

const text = (value: Schema.Json | undefined, field: string, maximum = 500) => {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value));

  if (decoded === undefined || decoded.trim() === "")
    throw new EnterpriseBadRequest({ message: `${field} is required` });

  return decoded.trim().slice(0, maximum);
};

const queryValue = (value: Schema.Json | undefined) => {
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

const datasetValue = (value: Schema.Json | undefined): "devices" | "software" => {
  if (value !== "devices" && value !== "software")
    throw new EnterpriseBadRequest({ message: "Choose a devices or software dataset" });

  return value;
};

const columnsValue = (value: Schema.Json | undefined) => {
  if (value === undefined) return undefined;

  const decoded = Schema.decodeUnknownOption(Schema.Array(Schema.String))(value);

  if (Option.isNone(decoded))
    throw new EnterpriseBadRequest({ message: "Table columns must be a list of field names" });

  return decoded.value.slice(0, 20);
};

type StatWidgetConfig = {
  dataset: "devices" | "software";
  query: DeviceQuery;
  label?: string;
};

type TableWidgetConfig = {
  dataset: "devices" | "software";
  query: DeviceQuery;
  columns?: ReadonlyArray<string>;
  limit?: number;
};

export type DashboardWidgetConfig =
  | { readonly markdown: string }
  | {
      readonly dataset: "devices" | "software";
      readonly query: DeviceQuery;
      readonly label?: string;
    }
  | {
      readonly dataset: "devices" | "software";
      readonly query: DeviceQuery;
      readonly dimension: string;
    }
  | {
      readonly dataset: "devices" | "software";
      readonly query: DeviceQuery;
      readonly columns?: ReadonlyArray<string>;
      readonly limit?: number;
    };

/**
 * Validate widget configuration before it reaches the database. Unknown fields
 * are dropped so a widget only ever stores the options its type understands.
 */
export const normalizeWidgetConfig = (
  type: DashboardWidgetType,
  value: Schema.Json | undefined,
): DashboardWidgetConfig => {
  const config = record(value);

  switch (type) {
    case "markdown": {
      const markdown = text(config.markdown, "Markdown", 20_000);

      return { markdown };
    }

    case "stat": {
      const label = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.String)(config.label),
      )?.trim();

      const stat: StatWidgetConfig = {
        dataset: datasetValue(config.dataset),
        query: queryValue(config.query),
      };

      return label ? { ...stat, label: label.slice(0, 80) } : stat;
    }

    case "pie":
      return {
        dataset: datasetValue(config.dataset),
        query: queryValue(config.query),
        dimension: text(config.dimension, "Dimension", 80),
      };
    case "table": {
      const columns = columnsValue(config.columns);

      const table: TableWidgetConfig = {
        dataset: datasetValue(config.dataset),
        query: queryValue(config.query),
      };

      if (columns) table.columns = columns;

      if (config.limit !== undefined)
        table.limit = Math.min(Math.max(integer(config.limit, 100), 1), 200);

      return table;
    }

    default:
      throw new EnterpriseBadRequest({ message: "Choose a valid widget type" });
  }
};

export const platformBucket = (proto: string | null | undefined) =>
  Match.value(proto).pipe(
    Match.when("apple", () => "Apple"),
    Match.when("win", () => "Windows"),
    Match.when("android", () => "Android"),
    Match.orElse(() => "Unknown"),
  );

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

const ageBucket = (days: number) => {
  if (days < 1) return "Today";

  if (days <= 7) return "1–7 days";

  if (days <= 30) return "8–30 days";

  if (days <= 90) return "31–90 days";

  return "Over 90 days";
};

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
