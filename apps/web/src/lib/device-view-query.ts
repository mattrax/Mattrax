import type { FilterCondition } from "@mattrax/ui";

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
 * Every filter the page applies must appear here. Otherwise a filter can be
 * active without a visible chip, and the next FilterBar edit resets it as if
 * it had never existed.
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

/** A positive stale-day value the URL can carry, or `undefined`. */
export const staleDaysValue = (value: string | undefined): string | undefined => {
  if (!value) return undefined;

  const days = Number(value);

  return Number.isInteger(days) && days >= 1 && days <= 3650 ? String(days) : undefined;
};
