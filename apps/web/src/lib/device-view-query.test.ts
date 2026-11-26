import { describe, expect, it } from "vitest";
import { deviceFilterConditions, staleDaysValue } from "./device-view-query";

const filterState = {
  status: "",
  proto: "",
  groupId: "",
  health: "",
  push: "",
  lostMode: "",
  localAccount: "",
  setup: "",
  notSeenSince: "",
  activation: "",
  staleDays: "",
  attributeKey: "",
  attributeValue: "",
};

describe("device view filters", () => {
  it("shows setup and notSeenSince as FilterBar chips so they survive edits", () => {
    expect(
      deviceFilterConditions({
        ...filterState,
        setup: "awaiting",
        notSeenSince: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual([
      { field: "setup", operator: "is", values: ["awaiting"] },
      {
        field: "notSeenSince",
        operator: "is",
        values: ["2026-01-01T00:00:00.000Z"],
      },
    ]);
  });
});

describe("stale days", () => {
  it("accepts arbitrary representative days and rejects junk", () => {
    expect(staleDaysValue("13")).toBe("13");
    expect(staleDaysValue("7")).toBe("7");
    expect(staleDaysValue("0")).toBeUndefined();
    expect(staleDaysValue("2.5")).toBeUndefined();
    expect(staleDaysValue("days")).toBeUndefined();
  });
});
