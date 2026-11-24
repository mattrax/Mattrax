import { describe, expect, it } from "vitest";
import {
  activeMigrationTab,
  activeSettingsTab,
  groupSettingsTabs,
  MIGRATION_TABS,
  migrationLandingHref,
  migrationTabHref,
  SETTINGS_TABS,
  settingsTabById,
  settingsTabHref,
} from "./settings-tabs";

describe("settings tab metadata", () => {
  it("starts the rail with the tenant group and no workspace label", () => {
    expect(SETTINGS_TABS[0]?.id).toBe("");
    expect(SETTINGS_TABS[0]?.group).toBe("Tenant");
    expect(SETTINGS_TABS.some((tab) => tab.group === ("Workspace" as string))).toBe(false);
  });

  it("includes backups next to General and Administrators", () => {
    const backups = settingsTabById("backups");

    expect(backups?.label).toBe("Backups");
    expect(backups?.group).toBe("Tenant");
  });

  it("keeps every tab's group in the declared order", () => {
    const groups = groupSettingsTabs(SETTINGS_TABS);

    expect(groups.map((entry) => entry.group)).toEqual([
      "Tenant",
      "Access",
      "Fleet",
      "Organisation",
    ]);
    expect(groups[0]?.tabs.map((tab) => tab.id)).toEqual(["", "administrators", "backups"]);
  });

  it("drops a group with no visible tabs", () => {
    const groups = groupSettingsTabs(SETTINGS_TABS.filter((tab) => tab.id === "audit"));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.group).toBe("Organisation");
  });
});

describe("settings tab routing", () => {
  const base = "/t/acme/settings";

  it("builds the general and tab addresses", () => {
    expect(settingsTabHref(base, "")).toBe(base);
    expect(settingsTabHref(base, "backups")).toBe("/t/acme/settings/backups");
  });

  it("resolves the active tab and falls back to General", () => {
    expect(activeSettingsTab(base, base)).toBe("");
    expect(activeSettingsTab("/t/acme/settings/backups", base)).toBe("backups");
    expect(activeSettingsTab("/t/acme/settings/backups/anything", base)).toBe("backups");
    expect(activeSettingsTab("/t/acme/settings/nope", base)).toBe("");
    expect(activeSettingsTab("/t/other/settings/backups", base)).toBe("");
  });

  it("resolves migration's own tabs, keeping cohort detail on Cohorts", () => {
    const migration = "/t/acme/settings/migration";

    expect(MIGRATION_TABS.map((tab) => tab.label)).toEqual(["Cohorts", "Export / import"]);
    expect(migrationTabHref(migration, "")).toBe(migration);
    expect(migrationTabHref(migration, "export")).toBe(`${migration}/export`);
    expect(activeMigrationTab(migration, migration)).toBe("");
    expect(activeMigrationTab(`${migration}/export`, migration)).toBe("export");
    expect(activeMigrationTab(`${migration}/mig_123`, migration)).toBe("");
    expect(activeMigrationTab("/t/acme/settings", migration)).toBe("");
  });

  it("lands tenant movers without device access on Export / import", () => {
    const settings = "/t/acme/settings";

    expect(migrationLandingHref(settings, { cohorts: true, move: true })).toBe(
      `${settings}/migration`,
    );
    expect(migrationLandingHref(settings, { cohorts: true, move: false })).toBe(
      `${settings}/migration`,
    );
    expect(migrationLandingHref(settings, { cohorts: false, move: true })).toBe(
      `${settings}/migration/export`,
    );
    expect(migrationLandingHref(settings, { cohorts: false, move: false })).toBe(
      `${settings}/migration`,
    );
  });
});
