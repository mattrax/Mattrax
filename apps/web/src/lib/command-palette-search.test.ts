import { describe, expect, it } from "vitest";
import type {
  ApplicationSearchRow,
  DeviceRow,
  GroupRow,
  PolicyRow,
  SoftwareSearchRow,
} from "@mattrax/enterprise-domain/client";
import { groupRank, searchRowCommand } from "./command-palette-search";

const deviceRow = (overrides: Partial<DeviceRow>): DeviceRow => ({
  id: "device-1",
  proto: "apple",
  name: "Mac",
  status: "enrolled",
  enrolledAt: "2026-11-01T00:00:00.000Z",
  lastSeenAt: "2026-11-18T00:00:00.000Z",
  ...overrides,
});

const groupRow = (overrides: Partial<GroupRow>): GroupRow => ({
  id: "group-1",
  name: "Staff",
  kind: "manual",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const policyRow = (overrides: Partial<PolicyRow>): PolicyRow => ({
  id: "policy-1",
  name: "Baseline",
  priority: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const applicationRow = (overrides: Partial<ApplicationSearchRow>): ApplicationSearchRow => ({
  id: "app-1",
  name: "Figma",
  platform: "apple",
  identifier: "com.figma.Desktop",
  ...overrides,
});

const softwareRow = (overrides: Partial<SoftwareSearchRow>): SoftwareSearchRow => ({
  name: "Figma",
  bundleId: "com.figma.Desktop",
  version: "116.1",
  publisher: "Figma Inc.",
  deviceCount: 1,
  ...overrides,
});

describe("command palette search rows", () => {
  it("orders result groups after the built-in commands", () => {
    expect(groupRank("Devices")).toBeLessThan(groupRank("Policies"));
    expect(groupRank("Policies")).toBeLessThan(groupRank("Applications"));
    expect(groupRank("Applications")).toBeLessThan(groupRank("Software"));
    expect(groupRank("Unknown")).toBeGreaterThan(groupRank("Software"));

    expect(
      ["Software", "Devices", "Applications"].sort(
        (left, right) => groupRank(left) - groupRank(right),
      ),
    ).toEqual(["Devices", "Applications", "Software"]);
  });

  it("links a catalogue application to its detail page", () => {
    expect(searchRowCommand(applicationRow({}), "tenant-1")).toEqual({
      id: "application-app-1",
      title: "Figma",
      subtitle: "Apple · com.figma.Desktop",
      group: "Applications",
      href: "/t/tenant-1/applications/app-1",
      permission: "applications.read",
    });
  });

  it("summarises an installed software hit with version, vendor and device count", () => {
    expect(searchRowCommand(softwareRow({ deviceCount: 2 }), "tenant-1")).toEqual({
      id: "software-com.figma.Desktop-116.1-Figma%20Inc.",
      title: "Figma",
      subtitle: "v116.1 · Figma Inc. · 2 devices",
      group: "Software",
      href: "/t/tenant-1/software",
      permission: "applications.read",
    });

    expect(
      searchRowCommand(softwareRow({ name: "Slack", version: null, publisher: null }), "tenant-1")
        ?.subtitle,
    ).toBe("1 device");
  });

  it("keeps the existing device, group and policy destinations", () => {
    expect(
      searchRowCommand(deviceRow({ serial: "C02", model: "MacBook" }), "tenant-1"),
    ).toMatchObject({
      group: "Devices",
      href: "/t/tenant-1/devices/device-1",
      subtitle: "C02 · MacBook",
      permission: "devices.read",
    });

    expect(searchRowCommand(groupRow({ devicesCount: 3 }), "tenant-1")).toMatchObject({
      group: "Groups",
      href: "/t/tenant-1/groups/group-1",
      subtitle: "3 devices",
    });

    expect(searchRowCommand(policyRow({}), "tenant-1")).toMatchObject({
      group: "Policies",
      href: "/t/tenant-1/policies/policy-1",
      permission: "policies.read",
    });
  });
});
