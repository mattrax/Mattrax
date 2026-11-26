import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  deviceViewOwnerId,
  deviceViewQueryWithinLimits,
  deviceViewTenantId,
} from "./deviceViewSync.js";
import { DeviceViewQuery, reconcileDeviceViewQuery } from "./Search.ts";

const view = (query: Partial<typeof DeviceViewQuery.Type> = {}): typeof DeviceViewQuery.Type => ({
  columns: ["name", "status"],
  ...query,
});

describe("reconcileDeviceViewQuery", () => {
  it("keeps references that still exist", () => {
    const result = reconcileDeviceViewQuery(
      view({
        groupId: "group-1",
        attributes: JSON.stringify({ cost_centre: "EMEA" }),
        columns: ["name", "attribute:cost_centre"],
      }),
      {
        groupIds: new Set(["group-1"]),
        attributeKeys: new Set(["cost_centre"]),
      },
    );

    expect(result.query.groupId).toBe("group-1");
    expect(JSON.parse(result.query.attributes ?? "{}")).toEqual({ cost_centre: "EMEA" });
    expect(result.query.columns).toEqual(["name", "attribute:cost_centre"]);
    expect(result.droppedGroup).toBe(false);
    expect(result.droppedAttributes).toEqual([]);
    expect(result.droppedColumns).toEqual([]);
  });

  it("drops a deleted group, attribute filter and attribute column", () => {
    const result = reconcileDeviceViewQuery(
      view({
        groupId: "deleted-group",
        attributes: JSON.stringify({ cost_centre: "EMEA", gone: "value" }),
        columns: ["name", "attribute:cost_centre", "attribute:gone", "not-a-column"],
      }),
      {
        groupIds: new Set(["group-1"]),
        attributeKeys: new Set(["cost_centre"]),
      },
    );

    expect(result.query.groupId).toBeUndefined();
    expect(JSON.parse(result.query.attributes ?? "{}")).toEqual({ cost_centre: "EMEA" });
    expect(result.query.columns).toEqual(["name", "attribute:cost_centre"]);
    expect(result.droppedGroup).toBe(true);
    expect(result.droppedAttributes).toEqual(["gone"]);
    expect(result.droppedColumns).toEqual(["attribute:gone", "not-a-column"]);
  });

  it("removes the attribute filter entirely when every key is gone", () => {
    const result = reconcileDeviceViewQuery(
      view({ attributes: JSON.stringify({ gone: "value" }) }),
      { attributeKeys: new Set(["cost_centre"]) },
    );

    expect(result.query.attributes).toBeUndefined();
    expect(result.droppedAttributes).toEqual(["gone"]);
  });

  it("treats a successful empty list as authoritative", () => {
    const result = reconcileDeviceViewQuery(
      view({
        groupId: "group-1",
        attributes: '{"cost_centre":"EMEA"}',
        columns: ["name", "attribute:cost_centre"],
      }),
      { groupIds: new Set(), attributeKeys: new Set() },
    );

    expect(result.query.groupId).toBeUndefined();
    expect(result.query.attributes).toBeUndefined();
    expect(result.query.columns).toEqual(["name"]);
    expect(result.droppedGroup).toBe(true);
    expect(result.droppedAttributes).toEqual(["cost_centre"]);
    expect(result.droppedColumns).toEqual(["attribute:cost_centre"]);
  });

  it("leaves references alone before the known lists have loaded", () => {
    const result = reconcileDeviceViewQuery(
      view({
        groupId: "group-1",
        attributes: '{"cost_centre":"EMEA"}',
        columns: ["name", "attribute:cost_centre"],
      }),
    );

    expect(result.query.groupId).toBe("group-1");
    expect(result.query.attributes).toBe('{"cost_centre":"EMEA"}');
    expect(result.query.columns).toEqual(["name", "attribute:cost_centre"]);
  });
});

describe("saved view identity", () => {
  it("recovers the tenant id from a personal source address", () => {
    expect(deviceViewTenantId(deviceViewOwnerId("tenant-a", "account-a"))).toBe("tenant-a");
  });
});

describe("saved view limits", () => {
  it("rejects oversized filter strings and too many columns", () => {
    expect(
      Schema.decodeUnknownOption(DeviceViewQuery)({ columns: [], q: "x".repeat(2_001) })._tag,
    ).toBe("None");
    expect(
      Schema.decodeUnknownOption(DeviceViewQuery)({
        columns: Array.from({ length: 51 }, () => "name"),
      })._tag,
    ).toBe("None");
  });

  it("caps the complete encoded query even when each field is valid", () => {
    const query = Schema.decodeUnknownSync(DeviceViewQuery)({
      q: "x".repeat(2_000),
      query: "y".repeat(2_000),
      attributes: "z".repeat(2_000),
      columns: Array.from({ length: 50 }, () => "a".repeat(128)),
    });

    expect(deviceViewQueryWithinLimits(query)).toBe(false);
  });
});
