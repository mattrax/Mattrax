import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ROLE_PERMISSIONS,
  PERMISSIONS,
  builtInRolePermissions,
  hasAnyWritePermission,
  isPermission,
  permissionLabel,
} from "./rbac.ts";

describe("RBAC catalogue", () => {
  it("keeps built-in role boundaries", () => {
    expect(BUILT_IN_ROLE_PERMISSIONS.owner).toHaveLength(PERMISSIONS.length);
    expect(BUILT_IN_ROLE_PERMISSIONS.admin).not.toContain("tenant.delete");
    expect(BUILT_IN_ROLE_PERMISSIONS.admin).not.toContain("tenant.export");
    expect(
      BUILT_IN_ROLE_PERMISSIONS.member.every((permission) => permission.endsWith(".read")),
    ).toBe(true);
    expect(builtInRolePermissions("owner,auditor").size).toBe(PERMISSIONS.length);
    expect(hasAnyWritePermission(builtInRolePermissions("member"))).toBe(false);
    expect(hasAnyWritePermission(builtInRolePermissions("admin"))).toBe(true);
  });

  it("validates and labels permissions", () => {
    expect(isPermission("devices.write")).toBe(true);
    expect(isPermission("devices.explode")).toBe(false);
    expect(permissionLabel("devices.write")).toBe("Manage devices");
  });
});
