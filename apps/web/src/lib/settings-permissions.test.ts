import { describe, expect, it } from "vitest";
import {
  firstReadableSettingsTab,
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

  it("lets the backups page render its own read-only denial", () => {
    expect(permissionForTenantPath("/t/acme/settings/backups", "acme")).toBeUndefined();
    expect(permissionForTenantPath("/t/acme/settings/billing", "acme")).toBe("billing.read");
  });

  it("lets device readers or tenant movers see Migration", () => {
    expect(settingsTabPermissions("migration")).toEqual(MIGRATION_ACCESS_PERMISSIONS);
    expect(MIGRATION_MOVE_PERMISSIONS).toEqual(["tenant.export", "tenant.import"]);
  });

  it("does not gate General on backups", () => {
    expect(settingsTabPermission("")).toBe("tenant.read");
  });
});


describe("first readable settings tab", () => {
  const allowed = (permissions: ReadonlyArray<string>) => (permission: string) =>
    permissions.includes(permission);

  it("sends a devices-only role to the cohort tracker", () => {
    expect(firstReadableSettingsTab(allowed(["devices.read"]), "acme")).toBe(
      "/t/acme/settings/migration",
    );
  });

  it("sends a backups-only role to backups", () => {
    expect(firstReadableSettingsTab(allowed(["backups.read"]), "acme")).toBe(
      "/t/acme/settings/backups",
    );
  });

  it("sends export/import-only roles to the deployment tools", () => {
    expect(firstReadableSettingsTab(allowed(["tenant.export"]), "acme")).toBe(
      "/t/acme/settings/migration/export",
    );
    expect(firstReadableSettingsTab(allowed(["tenant.import"]), "acme")).toBe(
      "/t/acme/settings/migration/export",
    );
  });

  it("returns nothing for a role without any settings permission", () => {
    expect(firstReadableSettingsTab(allowed([]), "acme")).toBeUndefined();
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
    expect(permissionForTenantPath("/t/acme/settings/billing", "acme")).toBe("billing.read");
    expect(permissionForTenantPath("/t/acme/settings", "acme")).toBe("tenant.read");
  });

  it("lets the backups page render its own no-access notice", () => {
    expect(permissionForTenantPath("/t/acme/settings/backups", "acme")).toBeUndefined();
  });
});
