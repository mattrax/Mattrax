import { describe, expect, it } from "vitest";
import { reconcileDeviceViewQuery } from "./Search.ts";
import type { DeviceViewQuery } from "./Search.ts";

const view = (query: Partial<DeviceViewQuery> = {}): DeviceViewQuery => ({
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
