import { describe, expect, it } from "vitest";
import { buildBreadcrumbs } from "./breadcrumbs";

const tenant = "/t/acme";

describe("buildBreadcrumbs", () => {
  it("hides trails for container and section landing pages", () => {
    expect(buildBreadcrumbs({ pathname: `${tenant}`, title: "Fleet overview" })).toEqual([]);
    expect(buildBreadcrumbs({ pathname: `${tenant}/devices`, title: "Devices" })).toEqual([]);
    expect(buildBreadcrumbs({ pathname: `${tenant}/settings`, title: "General" })).toEqual([]);
    expect(buildBreadcrumbs({ pathname: "/account", title: "Account" })).toEqual([]);
  });

  it("starts detail pages at their section and drops the duplicated leaf name", () => {
    expect(
      buildBreadcrumbs({ pathname: `${tenant}/devices/device_123`, title: "Reception Mac" }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Devices", href: `${tenant}/devices` },
    ]);
    expect(buildBreadcrumbs({ pathname: `${tenant}/groups/group_123`, title: "Staff" })).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Groups", href: `${tenant}/groups` },
    ]);
  });

  it("keeps nested policy tabs without exposing the opaque policy id", () => {
    expect(
      buildBreadcrumbs({
        pathname: `${tenant}/policies/policy_123/assignments`,
        title: "Assignments — Staff policy",
      }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Policies", href: `${tenant}/policies` },
      { label: "Assignments", href: `${tenant}/policies/policy_123/assignments` },
    ]);
  });

  it("labels the policy deployment tab instead of falling back to Details", () => {
    expect(
      buildBreadcrumbs({
        pathname: `${tenant}/policies/policy_123/deployment`,
        resourceName: "Staff policy",
      }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Policies", href: `${tenant}/policies` },
      { label: "Staff policy", href: `${tenant}/policies/policy_123` },
      {
        label: "Deployment",
        href: `${tenant}/policies/policy_123/deployment`,
      },
    ]);
  });

  it("names the policy when the page supplies its loaded name", () => {
    expect(
      buildBreadcrumbs({
        pathname: `${tenant}/policies/policy_123/assignments`,
        title: "Assignments — Staff policy",
        resourceName: "Staff policy",
      }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Policies", href: `${tenant}/policies` },
      { label: "Staff policy", href: `${tenant}/policies/policy_123` },
      {
        label: "Assignments",
        href: `${tenant}/policies/policy_123/assignments`,
      },
    ]);
  });

  it("names the policy and the overview view when the path ends at the id", () => {
    expect(
      buildBreadcrumbs({
        pathname: `${tenant}/policies/policy_123`,
        resourceName: "Staff policy",
        section: "Overview",
      }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Policies", href: `${tenant}/policies` },
      { label: "Staff policy", href: `${tenant}/policies/policy_123` },
      { label: "Overview", href: `${tenant}/policies/policy_123` },
    ]);
  });

  it("keeps the dashboard and reports crumbs without exposing the dashboard id", () => {
    expect(
      buildBreadcrumbs({
        pathname: `${tenant}/dashboards/dash_123/reports`,
        title: "Reports for Fleet",
      }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Dashboards", href: `${tenant}/dashboards` },
      { label: "Reports", href: `${tenant}/dashboards/dash_123/reports` },
    ]);
  });

  it("links standalone migration detail back to the cohort list", () => {
    expect(
      buildBreadcrumbs({ pathname: `${tenant}/migration/migration_123`, title: "Migration" }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Migration", href: `${tenant}/migration` },
    ]);
  });

  it("gives settings sub-pages the section trail without the tenant", () => {
    expect(
      buildBreadcrumbs({
        pathname: `${tenant}/settings/identity/domains`,
        title: "Identity",
      }),
    ).toEqual([
      { label: "Settings", href: `${tenant}/settings` },
      { label: "Identity", href: `${tenant}/settings/identity` },
      { label: "Domains", href: `${tenant}/settings/identity/domains` },
    ]);
  });

  it("treats a creation route as a resource leaf so the section remains", () => {
    expect(buildBreadcrumbs({ pathname: `${tenant}/groups/new`, title: "Create group" })).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Groups", href: `${tenant}/groups` },
    ]);
  });

  it("uses the page title when the trailing segment is not a known route", () => {
    expect(
      buildBreadcrumbs({ pathname: `${tenant}/devices/1/diagnostics`, title: "Diagnostics" }),
    ).toEqual([
      { label: "Tenant", href: tenant },
      { label: "Devices", href: `${tenant}/devices` },
    ]);
  });
});
