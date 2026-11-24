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
