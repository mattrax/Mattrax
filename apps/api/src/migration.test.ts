import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "..", "migrations");

const migrationNames = () =>
  readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const readMigration = (name: string) =>
  readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");

const readSnapshot = (name: string) =>
  JSON.parse(readFileSync(join(migrationsDir, name, "snapshot.json"), "utf8")) as {
    ddl: Array<Record<string, any>>;
  };

const DEVICE_INVENTORY_COLUMNS = [
  "filevault_enabled",
  "battery_health",
  "capabilities",
  "model_number",
  "inventory_updated_at",
] as const;

describe("device inventory migration", () => {
  const names = migrationNames();
  const inventoryMigrations = names.filter((name) =>
    readMigration(name).includes("`filevault_enabled`"),
  );

  it("is added by exactly one migration", () => {
    expect(inventoryMigrations).toHaveLength(1);
  });

  it("adds every inventory column to the device table", () => {
    const sql = readMigration(inventoryMigrations[0]!);
    expect(sql).toContain("ALTER TABLE `device`");
    for (const column of DEVICE_INVENTORY_COLUMNS) expect(sql).toContain(`\`${column}\``);
    expect(sql).not.toContain("NOT NULL");
  });

  it("ships a snapshot with nullable columns of the expected types", () => {
    const snapshot = readSnapshot(names.at(-1)!);
    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns" && entry.table === "device")
        .map((entry) => [entry.name, entry]),
    );
    const expected: Record<(typeof DEVICE_INVENTORY_COLUMNS)[number], string> = {
      filevault_enabled: "boolean",
      battery_health: "varchar(255)",
      capabilities: "json",
      model_number: "varchar(255)",
      inventory_updated_at: "datetime(3)",
    };
    for (const [column, type] of Object.entries(expected)) {
      const entry = columns.get(column);
      expect(entry, `missing snapshot column ${column}`).toBeDefined();
      expect(entry!.type).toBe(type);
      expect(entry!.notNull).toBe(false);
    }
  });

  it("does not leave the device inventory columns in a later migration", () => {
    const [inventoryMigration] = inventoryMigrations;
    for (const name of names.filter((candidate) => candidate > inventoryMigration!))
      for (const column of DEVICE_INVENTORY_COLUMNS)
        expect(readMigration(name)).not.toContain(`\`${column}\``);
  });
});

describe("tenant branding migration", () => {
  const names = migrationNames();
  const brandingMigrations = names.filter((name) => readMigration(name).includes("`display_name`"));

  it("is added by exactly one migration", () => {
    expect(brandingMigrations).toHaveLength(1);
  });

  it("adds nullable branding columns to the organization table", () => {
    const sql = readMigration(brandingMigrations[0]!);
    expect(sql).toContain("ALTER TABLE `organization`");
    for (const column of ["display_name", "support_email", "brand_color"])
      expect(sql).toContain(`\`${column}\``);
    expect(sql).not.toContain("NOT NULL");
  });

  it("ships a snapshot with nullable branding columns of the expected types", () => {
    const snapshot = readSnapshot(names.at(-1)!);
    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns" && entry.table === "organization")
        .map((entry) => [entry.name, entry]),
    );
    expect(columns.get("display_name")).toMatchObject({
      type: "varchar(255)",
      notNull: false,
    });
    expect(columns.get("support_email")).toMatchObject({
      type: "varchar(320)",
      notNull: false,
    });
    expect(columns.get("brand_color")).toMatchObject({
      type: "varchar(7)",
      notNull: false,
    });
  });

  it("does not leave the branding columns in a later migration", () => {
    const [brandingMigration] = brandingMigrations;
    for (const name of names.filter((candidate) => candidate > brandingMigration!))
      for (const column of ["`display_name`", "`support_email`", "`brand_color`"])
        expect(readMigration(name)).not.toContain(column);
  });
});

describe("APNs push telemetry migration", () => {
  const names = migrationNames();
  const pushMigrations = names.filter((name) => readMigration(name).includes("`last_push_at`"));

  it("is added by exactly one migration", () => {
    expect(pushMigrations).toHaveLength(1);
  });

  it("adds every telemetry column with a failure counter default", () => {
    const sql = readMigration(pushMigrations[0]!);
    expect(sql).toContain("ALTER TABLE `device_apple`");
    for (const column of [
      "last_push_at",
      "last_push_ok_at",
      "last_push_error",
      "last_push_error_code",
      "consecutive_push_failures",
    ])
      expect(sql).toContain(`\`${column}\``);
    expect(sql).toContain("`consecutive_push_failures` int DEFAULT 0 NOT NULL");
  });

  it("ships a snapshot with nullable telemetry and a non-null counter", () => {
    const snapshot = readSnapshot(names.at(-1)!);
    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns" && entry.table === "device_apple")
        .map((entry) => [entry.name, entry]),
    );
    for (const column of [
      "last_push_at",
      "last_push_ok_at",
      "last_push_error",
      "last_push_error_code",
    ]) {
      const entry = columns.get(column);
      expect(entry, `missing snapshot column ${column}`).toBeDefined();
      expect(entry!.notNull).toBe(false);
    }
    const counter = columns.get("consecutive_push_failures");
    expect(counter).toMatchObject({ type: "int", notNull: true, default: "0" });
  });
});

describe("scoped API token migration", () => {
  const names = migrationNames();
  const tokenMigrations = names.filter(
    (name) =>
      readMigration(name).includes("ALTER TABLE `account_api_token`") &&
      readMigration(name).includes("`scopes`"),
  );

  it("is added by exactly one migration", () => {
    expect(tokenMigrations).toHaveLength(1);
  });

  it("adds nullable tenant and scope columns and backfills legacy tokens", () => {
    const sql = readMigration(tokenMigrations[0]!);
    expect(sql).toContain("ALTER TABLE `account_api_token`");
    expect(sql).toContain("`tenant_id`");
    expect(sql).toContain("`scopes` json");
    expect(sql).toContain("JSON_ARRAY('read', 'write')");
    expect(sql).toContain("WHERE `scopes` IS NULL");
    // tenant_id stays nullable (account-wide tokens), scopes is backfilled but
    // also nullable so a future default can be applied without a rewrite.
    expect(sql).not.toMatch(/`scopes` json NOT NULL/);
  });

  it("ships a snapshot with nullable scoped columns", () => {
    const snapshot = readSnapshot(names.at(-1)!);
    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns" && entry.table === "account_api_token")
        .map((entry) => [entry.name, entry]),
    );
    expect(columns.get("tenant_id")).toMatchObject({
      type: "varchar(255)",
      notNull: false,
    });
    expect(columns.get("scopes")).toMatchObject({
      type: "json",
      notNull: false,
    });
  });
});

describe("MFA migration", () => {
  const names = migrationNames();
  const mfaMigrations = names.filter((name) =>
    readMigration(name).includes("CREATE TABLE `auth_totp_factor`"),
  );

  it("is added by exactly one migration", () => {
    expect(mfaMigrations).toHaveLength(1);
  });

  it("adds the factor table and subject/tenant flags", () => {
    const sql = readMigration(mfaMigrations[0]!);
    expect(sql).toContain("`scope` varchar(191) PRIMARY KEY");
    expect(sql).toContain("`state` text NOT NULL");
    expect(sql).toContain("`version` text NOT NULL");
    expect(sql).toContain("ALTER TABLE `user` ADD `totp_enabled`");
    expect(sql).toContain("ALTER TABLE `sso_config` ADD `require_mfa`");
  });

  it("ships a snapshot with the new columns", () => {
    const snapshot = readSnapshot(names.at(-1)!);
    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns")
        .map((entry) => [`${entry.table}.${entry.name}`, entry]),
    );
    expect(columns.get("user.totp_enabled")).toMatchObject({
      type: "boolean",
      notNull: true,
      default: "false",
    });
    expect(columns.get("sso_config.require_mfa")).toMatchObject({
      type: "boolean",
      notNull: true,
      default: "false",
    });
    expect(columns.get("auth_totp_factor.scope")).toMatchObject({
      type: "varchar(191)",
      notNull: true,
    });
  });
});

describe("dynamic groups migration", () => {
  const names = migrationNames();
  const dynamicMigrations = names.filter((name) =>
    readMigration(name).includes("ALTER TABLE `enterprise_group` ADD `kind`"),
  );

  it("is added by exactly one migration", () => {
    expect(dynamicMigrations).toHaveLength(1);
  });

  it("adds group kind/rules/evaluation and membership source columns", () => {
    const sql = readMigration(dynamicMigrations[0]!);
    expect(sql).toContain("ALTER TABLE `enterprise_group`");
    expect(sql).toContain("`kind` varchar(16) DEFAULT 'manual' NOT NULL");
    expect(sql).toContain("`rules` json");
    expect(sql).toContain("`last_evaluated_at` datetime(3)");
    expect(sql).toContain("ALTER TABLE `group_device`");
    expect(sql).toContain("`source` varchar(16) DEFAULT 'manual' NOT NULL");
  });

  it("ships a snapshot with the new columns", () => {
    const snapshot = readSnapshot(names.at(-1)!);
    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns")
        .map((entry) => [`${entry.table}.${entry.name}`, entry]),
    );
    expect(columns.get("enterprise_group.kind")).toMatchObject({
      type: "varchar(16)",
      notNull: true,
      default: "'manual'",
    });
    expect(columns.get("enterprise_group.rules")).toMatchObject({
      type: "json",
      notNull: false,
    });
    expect(columns.get("enterprise_group.last_evaluated_at")).toMatchObject({
      type: "datetime(3)",
      notNull: false,
    });
    expect(columns.get("group_device.source")).toMatchObject({
      type: "varchar(16)",
      notNull: true,
      default: "'manual'",
    });
  });
});
