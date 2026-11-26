import { Option, Schema } from "effect";

const ColumnVisibility = Schema.Record(Schema.String, Schema.Boolean);
const decodeVisibility = Schema.decodeUnknownOption(ColumnVisibility);

/** Read a table's persisted column visibility with a safe empty fallback. */
export function readTableColumnVisibility(key: string | undefined): Record<string, boolean> {
  if (!key || typeof localStorage === "undefined") return {};

  try {
    const decoded = decodeVisibility(
      JSON.parse(localStorage.getItem("mattrax:table:" + key + ":columns") ?? "{}"),
    );

    return Option.getOrUndefined(decoded) ?? {};
  } catch {
    return {};
  }
}
