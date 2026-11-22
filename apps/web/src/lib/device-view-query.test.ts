import { describe, expect, it } from "vitest";
import type { DeviceViewQuery } from "@mattrax/enterprise-domain/client";
import {
  deviceFilterConditions,
  hasExplicitDeviceSearch,
  mergeActiveViewQuery,
  resolveDeviceDefaultView,
  staleDaysValue,
} from "./device-view-query";

const filterState = {
  status: "",
  proto: "",
  groupId: "",
  health: "",
  push: "",
  setup: "",
  notSeenSince: "",
  activation: "",
  staleDays: "",
  attributeKey: "",
  attributeValue: "",
};

const view = (overrides: Partial<DeviceViewQuery> = {}): DeviceViewQuery => ({
  columns: ["name"],
  ...overrides,
});

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

describe("explicit device searches", () => {
  it("treats any populated filter or view marker as explicit", () => {
    expect(hasExplicitDeviceSearch({})).toBe(false);
    expect(hasExplicitDeviceSearch({ q: "" })).toBe(false);
    expect(hasExplicitDeviceSearch({ columns: "" })).toBe(false);
    expect(hasExplicitDeviceSearch({ setup: "awaiting" })).toBe(true);
    expect(hasExplicitDeviceSearch({ view: "view-1" })).toBe(true);
  });
});

describe("default view resolution", () => {
  it("never applies the default after an explicit link is cleared", () => {
    const state = { resolved: false };

    expect(
      resolveDeviceDefaultView(state, {
        explicitAtMount: true,
        ready: true,
        hasDefault: true,
      }),
    ).toBe("skip");

    expect(
      resolveDeviceDefaultView(state, {
        explicitAtMount: false,
        ready: true,
        hasDefault: true,
      }),
    ).toBe("skip");
  });

  it("waits for the views query, then applies once", () => {
    const state = { resolved: false };

    expect(
      resolveDeviceDefaultView(state, {
        explicitAtMount: false,
        ready: false,
        hasDefault: true,
      }),
    ).toBe("wait");

    expect(
      resolveDeviceDefaultView(state, {
        explicitAtMount: false,
        ready: true,
        hasDefault: true,
      }),
    ).toBe("apply");

    expect(
      resolveDeviceDefaultView(state, {
        explicitAtMount: false,
        ready: true,
        hasDefault: true,
      }),
    ).toBe("skip");
  });
});

describe("updating an active view", () => {
  it("preserves stored attributes and cutoffs the UI cannot represent", () => {
    expect(
      mergeActiveViewQuery(
        view({
          columns: ["name"],
          attributes: JSON.stringify({ cost_centre: "EMEA", region: "EU" }),
          staleDays: 13,
          notSeenSince: "2026-01-01T00:00:00.000Z",
        }),
        view({ columns: ["name", "serial"], attributes: JSON.stringify({ cost_centre: "APAC" }) }),
      ),
    ).toEqual({
      columns: ["name", "serial"],
      attributes: JSON.stringify({ cost_centre: "APAC", region: "EU" }),
      staleDays: 13,
      notSeenSince: "2026-01-01T00:00:00.000Z",
    });
  });

  it("keeps an active view's attribute filter when the UI clears its single editor", () => {
    expect(
      mergeActiveViewQuery(view({ attributes: JSON.stringify({ region: "EU" }) }), view({}))
        .attributes,
    ).toBe(JSON.stringify({ region: "EU" }));
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
