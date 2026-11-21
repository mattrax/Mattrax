import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLE_PERMISSIONS } from "./rbac.js";
import { ssrTenantPermissions } from "./ssr.ts";
import type { SsrTokenTenant } from "./ssr.ts";

const tenant = (overrides: Partial<SsrTokenTenant> = {}): SsrTokenTenant => ({
  id: "tenant-1",
  name: "Acme",
  slug: "acme",
  role: "owner",
  roleName: "Owner",
  roleKind: "built-in",
  logo: null,
  displayName: null,
  brandColor: null,
  ...overrides,
});

describe("SSR token tenant permissions", () => {
  it("derives a built-in role's permissions when the token omitted them", () => {
    expect([...ssrTenantPermissions(tenant())]).toEqual([...BUILT_IN_ROLE_PERMISSIONS.owner]);
    expect([...ssrTenantPermissions(tenant({ role: "member", roleName: "Member" }))]).toEqual([
      ...BUILT_IN_ROLE_PERMISSIONS.member,
    ]);
  });

  it("prefers an explicit permission set", () => {
    expect([
      ...ssrTenantPermissions(tenant({ permissions: ["tenant.read", "devices.read"] })),
    ]).toEqual(["tenant.read", "devices.read"]);
  });

  it("fails closed for a custom role that somehow omitted its set", () => {
    expect([
      ...ssrTenantPermissions(
        tenant({
          role: "member",
          roleName: "Custom",
          roleKind: "custom",
          roleId: "role-1",
        }),
      ),
    ]).toEqual([]);
  });
});
