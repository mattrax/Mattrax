import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ROLE_PERMISSIONS,
  PERMISSIONS,
  builtInRolePermissions,
  credentialPermissions,
  hasAnyWritePermission,
  hasUnrestrictedCredential,
  isPermission,
  normalizeCredentialPermissions,
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

describe("credential permission ceilings", () => {
  it("keeps legacy broad scopes compatible", () => {
    expect(credentialPermissions(null).size).toBe(PERMISSIONS.length);
    expect(credentialPermissions(["write"]).size).toBe(PERMISSIONS.length);
    expect(credentialPermissions(["read", "write"]).size).toBe(PERMISSIONS.length);
    expect(credentialPermissions(["mcp"]).size).toBe(PERMISSIONS.length);

    const read = credentialPermissions(["read"]);
    expect(read.size).toBeGreaterThan(0);
    expect([...read].every((permission) => permission.endsWith(".read"))).toBe(true);

    // An explicitly empty grant is not "unset"; it is no access.
    expect(credentialPermissions([]).size).toBe(0);
    expect(credentialPermissions(["unknown.permission"]).size).toBe(0);

    expect(hasUnrestrictedCredential(null)).toBe(true);
    expect(hasUnrestrictedCredential(["write"])).toBe(true);
    expect(hasUnrestrictedCredential(["read"])).toBe(false);
    expect(hasUnrestrictedCredential([])).toBe(false);
    // Explicitly granting the whole catalogue is equivalent to `write`.
    expect(hasUnrestrictedCredential([...PERMISSIONS])).toBe(true);
  });

  it("normalises fine-grained grants and adds their read companion", () => {
    expect(normalizeCredentialPermissions(["devices.write"])).toEqual([
      "devices.read",
      "devices.write",
    ]);
    expect(normalizeCredentialPermissions(["policies.read", "policies.write"])).toEqual([
      "policies.read",
      "policies.write",
    ]);
    expect(normalizeCredentialPermissions(["devices.explode"])).toBeUndefined();

    const grant = credentialPermissions(["devices.write"]);
    expect(grant.has("devices.read")).toBe(true);
    expect(grant.has("devices.write")).toBe(true);
    expect(grant.has("policies.read")).toBe(false);
  });
});
