import { describe, expect, it } from "vitest";
import type {
  ApplicationSearchRow,
  DeviceRow,
  GroupRow,
  PolicyRow,
  SearchResult,
  SoftwareSearchRow,
  UserSearchRow,
} from "@mattrax/enterprise-domain/client";
import { groupRank, matchesSearchTerm, searchRowCommand } from "./command-palette-search";

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
  storeId: null,
  ...overrides,
});

const userRow = (overrides: Partial<UserSearchRow>): UserSearchRow => ({
  id: "directory-user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  ...overrides,
});

type AdministratorRow = Extract<SearchResult["rows"][number], { role: string }>;

const administratorRow = (overrides: Partial<AdministratorRow>): AdministratorRow => ({
  id: "account-1",
  name: "Grace Hopper",
  email: "grace@example.com",
  role: "owner",
  ...overrides,
});

const softwareRow = (overrides: Partial<SoftwareSearchRow>): SoftwareSearchRow => ({
  name: "Figma",
  bundleId: "com.figma.Desktop",
  version: "116.1",
  shortVersion: "116.1.2",
  publisher: "Figma Inc.",
  deviceCount: 1,
  ...overrides,
});

describe("command palette search rows", () => {
  it("orders result groups after the built-in commands", () => {
    expect(groupRank("Devices")).toBeLessThan(groupRank("Policies"));
    expect(groupRank("People")).toBeLessThan(groupRank("Administrators"));
    expect(groupRank("Administrators")).toBeLessThan(groupRank("Groups"));
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
      keywords: [],
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
      keywords: ["com.figma.Desktop", "116.1.2"],
    });

    expect(
      searchRowCommand(softwareRow({ name: "Slack", version: null, publisher: null }), "tenant-1")
        ?.subtitle,
    ).toBe("1 device");
  });

  it("keeps server hits that only match a hidden field", () => {
    const software = searchRowCommand(softwareRow({}), "tenant-1");

    const application = searchRowCommand(
      applicationRow({ identifier: null, storeId: "slack-store" }),
      "tenant-1",
    );

    if (!software || !application) throw new Error("expected palette commands");

    // These fields are not in the rendered title/subtitle; without keywords the
    // palette's own filter would show "No results" for a valid server hit.
    expect(matchesSearchTerm(software, "com.figma.desktop")).toBe(true);
    expect(matchesSearchTerm(software, "116.1.2")).toBe(true);
    expect(matchesSearchTerm(application, "slack-store")).toBe(true);
    expect(matchesSearchTerm(application, "figma")).toBe(true);
    expect(matchesSearchTerm(software, "not-a-match")).toBe(false);
  });

  it("keeps directory people separate from administrators", () => {
    expect(searchRowCommand(userRow({}), "tenant-1")).toEqual({
      id: "person-directory-user-1",
      title: "Ada Lovelace",
      subtitle: "ada@example.com",
      group: "People",
      href: "/t/tenant-1/settings/identity/directory",
      permission: "members.read",
      keywords: ["directory", "person"],
    });

    expect(searchRowCommand(administratorRow({ role: "owner" }), "tenant-1")).toEqual({
      id: "administrator-account-1",
      title: "Grace Hopper",
      subtitle: "grace@example.com · owner",
      group: "Administrators",
      href: "/t/tenant-1/settings/administrators",
      permission: "members.read",
      keywords: ["administrator", "admin", "account", "owner"],
    });
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
