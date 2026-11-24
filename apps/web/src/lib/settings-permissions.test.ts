import { describe, expect, it } from "vitest";
import {
  MIGRATION_ACCESS_PERMISSIONS,
  MIGRATION_MOVE_PERMISSIONS,
  permissionForTenantPath,
  settingsTabPermission,
  settingsTabPermissions,
} from "./settings-permissions";

describe("settings tab permissions", () => {
  it("gates backups on backups.read", () => {
    expect(settingsTabPermission("backups")).toBe("backups.read");
    expect(settingsTabPermissions("backups")).toEqual(["backups.read"]);
  });

  it("lets device readers or tenant movers see Migration", () => {
    expect(settingsTabPermissions("migration")).toEqual(MIGRATION_ACCESS_PERMISSIONS);
    expect(MIGRATION_MOVE_PERMISSIONS).toEqual(["tenant.export", "tenant.import"]);
  });

  it("does not gate General on backups", () => {
    expect(settingsTabPermission("")).toBe("tenant.read");
  });
});

describe("tenant path permissions", () => {
  it("gates the cohort tracker on devices.read", () => {
    expect(permissionForTenantPath("/t/acme/settings/migration", "acme")).toBe("devices.read");
  });

  it("lets the export page gate its own export/import union", () => {
    expect(permissionForTenantPath("/t/acme/settings/migration/export", "acme")).toBeUndefined();
  });

  it("keeps the guards for ordinary settings tabs", () => {
    expect(permissionForTenantPath("/t/acme/settings/audit", "acme")).toBe("audit.read");
    expect(permissionForTenantPath("/t/acme/settings", "acme")).toBe("tenant.read");
  });

  it("lets the backups page render its own no-access notice", () => {
    expect(permissionForTenantPath("/t/acme/settings/backups", "acme")).toBeUndefined();
  });
});
