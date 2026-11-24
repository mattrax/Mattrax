import { describe, expect, it } from "vitest";
import { settingsTabPermission } from "./settings-permissions";

describe("settings tab permissions", () => {
  it("gates backups on backups.read", () => {
    expect(settingsTabPermission("backups")).toBe("backups.read");
  });

  it("keeps export and migration on the existing device permission", () => {
    expect(settingsTabPermission("migration")).toBe("devices.read");
  });

  it("does not gate General on backups", () => {
    expect(settingsTabPermission("")).toBe("tenant.read");
  });
});
