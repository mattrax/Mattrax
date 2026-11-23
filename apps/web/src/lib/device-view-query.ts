import { Option, Schema } from "effect";
import type { DeviceViewQuery } from "@mattrax/enterprise-domain/client";
import type { FilterCondition } from "@mattrax/ui";

/** Query-string keys that describe an explicit device search. */
export const DEVICE_SEARCH_KEYS = [
  "q",
  "status",
  "proto",
  "staleDays",
  "health",
  "push",
  "lostMode",
  "localAccount",
  "setup",
  "notSeenSince",
  "activation",
  "groupId",
  "attributeKey",
  "attributeValue",
  "query",
  "sort",
  "direction",
  "page",
  "columns",
  "pageSize",
  "view",
] as const;

export type DeviceFilterState = {
  status: string;
  proto: string;
  groupId: string;
  health: string;
  push: string;
  lostMode: string;
  localAccount: string;
  setup: string;
  notSeenSince: string;
  activation: string;
  staleDays: string;
  attributeKey: string;
  attributeValue: string;
};

/**
 * Build the chips shown by the device table's FilterBar.
 *
 * Every filter the page applies must appear here. Otherwise a view can apply a
 * filter that is invisible, and the next FilterBar edit resets it as if it had
 * never existed.
 */
export const deviceFilterConditions = (state: DeviceFilterState): FilterCondition[] => {
  const conditions: FilterCondition[] = [];

  if (state.status) conditions.push({ field: "status", operator: "is", values: [state.status] });

  if (state.proto) conditions.push({ field: "proto", operator: "is", values: [state.proto] });

  if (state.groupId) conditions.push({ field: "groupId", operator: "is", values: [state.groupId] });

  if (state.health) conditions.push({ field: "health", operator: "is", values: [state.health] });

  if (state.push) conditions.push({ field: "push", operator: "is", values: [state.push] });

  if (state.lostMode)
    conditions.push({ field: "lostMode", operator: "is", values: [state.lostMode] });

  if (state.localAccount)
    conditions.push({ field: "localAccount", operator: "is", values: [state.localAccount] });

  if (state.setup) conditions.push({ field: "setup", operator: "is", values: [state.setup] });

  if (state.notSeenSince)
    conditions.push({
      field: "notSeenSince",
      operator: "is",
      values: [state.notSeenSince],
    });

  if (state.activation)
    conditions.push({ field: "activation", operator: "is", values: [state.activation] });

  if (state.staleDays)
    conditions.push({ field: "staleDays", operator: "is", values: [state.staleDays] });

  if (state.attributeKey)
    conditions.push({
      field: "attr:" + state.attributeKey,
      operator: "is",
      values: state.attributeValue ? [state.attributeValue] : [],
    });

  return conditions;
};

type SearchValue = string | ReadonlyArray<string> | undefined;

/** True when the device URL names any filter at all. */
export const hasExplicitDeviceSearch = (search: Readonly<Record<string, SearchValue>>) =>
  DEVICE_SEARCH_KEYS.some((key) => {
    const value = search[key];

    return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
  });

/**
 * Resolve the member's default view exactly once per page load.
 *
 * `explicitAtMount` is latched by the caller. If the page opened on a copied
 * link, clearing that link later must not unexpectedly bring the default view
 * back.
 */
export type DeviceDefaultViewState = { resolved: boolean };

export const resolveDeviceDefaultView = (
  state: DeviceDefaultViewState,
  input: { explicitAtMount: boolean; ready: boolean; hasDefault: boolean },
): "wait" | "apply" | "skip" => {
  if (state.resolved) return "skip";
  if (!input.ready) return "wait";

  state.resolved = true;

  return input.explicitAtMount || !input.hasDefault ? "skip" : "apply";
};

const decodeAttributeMap = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String));

const parseAttributes = (value: string | undefined): Record<string, string> => {
  if (!value) return {};

  try {
    return Option.getOrElse(decodeAttributeMap(JSON.parse(value)), () => ({}));
  } catch {
    return {};
  }
};

/**
 * Merge the parts of a stored view the table UI cannot represent into an
 * update.
 *
 * The table has one attribute editor but a view can carry several attribute
 * filters (for example from the API). Updating a view must not silently delete
 * the extras, and clearing a relative filter in the UI must not drop a stored
 * absolute cutoff the UI never showed.
 */
export const mergeActiveViewQuery = (
  active: DeviceViewQuery,
  current: DeviceViewQuery,
): DeviceViewQuery => {
  const activeAttributes = parseAttributes(active.attributes);
  const attributes =
    Object.keys(activeAttributes).length > 0
      ? JSON.stringify({ ...activeAttributes, ...parseAttributes(current.attributes) })
      : current.attributes;

  return {
    ...current,
    attributes,
    staleDays: current.staleDays ?? active.staleDays,
    notSeenSince: current.notSeenSince ?? active.notSeenSince,
  };
};

/** A positive stale-day value the URL can carry, or `undefined`. */
export const staleDaysValue = (value: string | undefined): string | undefined => {
  if (!value) return undefined;

  const days = Number(value);

  return Number.isInteger(days) && days >= 1 && days <= 3650 ? String(days) : undefined;
};
