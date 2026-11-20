import { describe, expect, it } from "vitest";
import { Option, Schema } from "effect";
import {
  DashboardRouteParams,
  DeviceRouteParams,
  DeviceSearchParams,
  decodeDeviceSearchParams,
  routes,
} from "./routes";

describe("route builders", () => {
  it("encodes tenant and resource ids", () => {
    const tenant = routes.tenant("acme corp");

    expect(tenant.overview()).toBe("/t/acme%20corp");
    expect(tenant.device("dev/1")).toBe("/t/acme%20corp/devices/dev%2F1");
    expect(tenant.policy("policy#1")).toBe("/t/acme%20corp/policies/policy%231");
    expect(tenant.users()).toBe("/t/acme%20corp/users");
    expect(tenant.user("user/1")).toBe("/t/acme%20corp/users/user%2F1");
  });

  it("builds settings tabs and the general tab", () => {
    const tenant = routes.tenant("acme");

    expect(tenant.settings()).toBe("/t/acme/settings");
    expect(tenant.settingsTab("")).toBe("/t/acme/settings");
    expect(tenant.settingsTab("audit")).toBe("/t/acme/settings/audit");
  });

  it("serialises only the device filters that are set", () => {
    const tenant = routes.tenant("acme");

    expect(tenant.devices()).toBe("/t/acme/devices");
    expect(tenant.devices({ health: "attention" })).toBe("/t/acme/devices?health=attention");
    expect(tenant.devices({ health: "missing" })).toBe("/t/acme/devices?health=missing");
    expect(tenant.devices({ proto: "apple", q: "mac book" })).toBe(
      "/t/acme/devices?proto=apple&q=mac+book",
    );
  });

  it("round-trips the dashboard edit flag", () => {
    const tenant = routes.tenant("acme");

    expect(tenant.dashboard("dash-1")).toBe("/t/acme/dashboards/dash-1");
    expect(tenant.dashboard("dash-1", { edit: "1" })).toBe("/t/acme/dashboards/dash-1?edit=1");
  });
});

describe("route parameter schemas", () => {
  it("accepts a complete device route and rejects a partial one", () => {
    const complete = Schema.decodeUnknownOption(DeviceRouteParams)({
      tenantId: "acme",
      deviceId: "device-1",
    });

    const partial = Schema.decodeUnknownOption(DeviceRouteParams)({ tenantId: "acme" });

    expect(Option.isSome(complete)).toBe(true);
    expect(Option.isNone(partial)).toBe(true);
  });

  it("decodes a dashboard route", () => {
    expect(
      Option.getOrUndefined(
        Schema.decodeUnknownOption(DashboardRouteParams)({
          tenantId: "acme",
          dashboardId: "dash-1",
        }),
      ),
    ).toEqual({ tenantId: "acme", dashboardId: "dash-1" });
  });
});

describe("device search codecs", () => {
  it("takes the first value of a repeated parameter", () => {
    expect(decodeDeviceSearchParams({ status: ["enrolled", "unenrolled"] })).toEqual({
      status: "enrolled",
    });
  });

  it("drops unknown enum values instead of forwarding them", () => {
    expect(decodeDeviceSearchParams({ status: "bogus", health: "attention" })).toEqual({
      health: "attention",
    });
  });

  it("keeps the MIA health filter", () => {
    expect(decodeDeviceSearchParams({ health: "missing" })).toEqual({ health: "missing" });
  });

  it("keeps the documented filter fields", () => {
    expect(
      decodeDeviceSearchParams({
        q: "mac",
        groupId: "group-1",
        staleDays: "30",
        sort: "lastSeenAt",
        direction: "desc",
        import: "1",
      }),
    ).toEqual({
      q: "mac",
      groupId: "group-1",
      staleDays: "30",
      sort: "lastSeenAt",
      direction: "desc",
      import: "1",
    });
  });

  it("has a schema that matches the decoded shape", () => {
    const decoded = decodeDeviceSearchParams({ proto: "win" });

    expect(Option.isSome(Schema.decodeUnknownOption(DeviceSearchParams)(decoded))).toBe(true);
  });
});
