import { describe, expect, it } from "vitest";
import { mdmEventFor, routeClassForPath, statusClass } from "./route.js";

describe("routeClassForPath", () => {
  it("classifies API, health and docs paths without keeping the tenant", () => {
    expect(routeClassForPath("/api/v1/tenants/acme/devices")).toBe("api");
    expect(routeClassForPath("/api/openapi.json")).toBe("api");
    expect(routeClassForPath("/api/health")).toBe("health");
    expect(routeClassForPath("/health")).toBe("health");
    expect(routeClassForPath("/api/ready")).toBe("ready");
    expect(routeClassForPath("/api/metrics")).toBe("metrics");
  });

  it("separates check-in, enrollment and the rest of the MDM surface", () => {
    expect(routeClassForPath("/mdm/apple/mdm")).toBe("mdm.apple.checkin");
    expect(routeClassForPath("/mdm/apple/enroll")).toBe("mdm.apple.enrollment");
    expect(routeClassForPath("/mdm/apple/assets/abc")).toBe("mdm.apple");
    expect(routeClassForPath("/mdm/apple/profiles/a/b/c")).toBe("mdm.apple");
    expect(routeClassForPath("/mdm/windows/management")).toBe("mdm.windows.checkin");
    expect(routeClassForPath("/mdm/windows/enroll")).toBe("mdm.windows.enrollment");
    expect(routeClassForPath("/mdm/windows/policy")).toBe("mdm.windows");
  });

  it("does not count SCEP as a check-in", () => {
    expect(routeClassForPath("/mdm/apple/scep/org-1")).toBe("scep");
    expect(routeClassForPath("/mdm/apple/scep")).toBe("scep");
  });

  it("collapses casing, repeated separators and trailing slashes", () => {
    expect(routeClassForPath("/API/health")).toBe("health");
    expect(routeClassForPath("//mdm//apple//mdm/")).toBe("mdm.apple.checkin");
    expect(routeClassForPath("/mdm/apple/mdm/")).toBe("mdm.apple.checkin");
  });

  it("ignores the query string", () => {
    expect(routeClassForPath("/mdm/apple/mdm?x=tenant-secret")).toBe("mdm.apple.checkin");
  });

  it("falls back to other for unknown paths", () => {
    expect(routeClassForPath("/")).toBe("other");
    expect(routeClassForPath("/dashboard")).toBe("other");
  });

  it("classifies webhooks and SCIM", () => {
    expect(routeClassForPath("/api/webhooks/stripe")).toBe("webhook");
    expect(routeClassForPath("/scim/v2/Users")).toBe("scim");
  });
});

describe("statusClass", () => {
  it("buckets a status into a bounded label", () => {
    expect(statusClass(101)).toBe("1xx");
    expect(statusClass(200)).toBe("2xx");
    expect(statusClass(204)).toBe("2xx");
    expect(statusClass(302)).toBe("3xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(429)).toBe("4xx");
    expect(statusClass(500)).toBe("5xx");
    expect(statusClass(503)).toBe("5xx");
  });
});

describe("mdmEventFor", () => {
  it("maps check-in and enrollment routes to an outcome", () => {
    expect(mdmEventFor("mdm.apple.checkin", 200)).toEqual({
      platform: "apple",
      kind: "checkin",
      outcome: "ok",
    });
    expect(mdmEventFor("mdm.apple.enrollment", 200)?.kind).toBe("enrollment");
    expect(mdmEventFor("mdm.windows.checkin", 200)?.platform).toBe("windows");
    expect(mdmEventFor("mdm.windows.enrollment", 200)?.kind).toBe("enrollment");
  });

  it("distinguishes the outcomes that need a person", () => {
    expect(mdmEventFor("mdm.apple.checkin", 410)?.outcome).toBe("unenrolled");
    expect(mdmEventFor("mdm.apple.checkin", 429)?.outcome).toBe("rate_limited");
    expect(mdmEventFor("mdm.apple.checkin", 401)?.outcome).toBe("unauthorized");
    expect(mdmEventFor("mdm.apple.checkin", 404)?.outcome).toBe("not_found");
    expect(mdmEventFor("mdm.apple.checkin", 400)?.outcome).toBe("rejected");
    expect(mdmEventFor("mdm.apple.checkin", 500)?.outcome).toBe("error");
    expect(mdmEventFor("mdm.apple.enrollment", 302)?.outcome).toBe("redirect");
  });

  it("ignores non-MDM routes", () => {
    expect(mdmEventFor("api", 200)).toBeUndefined();
    expect(mdmEventFor("mdm.apple", 200)).toBeUndefined();
  });
});
