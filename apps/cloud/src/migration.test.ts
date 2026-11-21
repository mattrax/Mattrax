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

type MigrationDdlEntry = {
  readonly entityType?: string;
  readonly name?: string;
  readonly table?: string;
  readonly tableTo?: string;
  readonly onDelete?: string;
  readonly type?: string;
  readonly notNull?: boolean;
  readonly default?: string;
  readonly isUnique?: boolean;
  readonly columns?: ReadonlyArray<
    string | { readonly value: string; readonly isExpression: boolean }
  >;
};

type MigrationSnapshot = {
  readonly ddl: ReadonlyArray<MigrationDdlEntry>;
};

const readSnapshot = (name: string): MigrationSnapshot =>
  JSON.parse(readFileSync(join(migrationsDir, name, "snapshot.json"), "utf8"));

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
    const sql = readMigration(inventoryMigrations[0]);
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

    for (const name of names.filter((candidate) => candidate > inventoryMigration))
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
    const sql = readMigration(brandingMigrations[0]);
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

    for (const name of names.filter((candidate) => candidate > brandingMigration))
      for (const column of ["`display_name`", "`support_email`", "`brand_color`"])
        expect(readMigration(name)).not.toContain(column);
  });
});

describe("APNs push telemetry migration", () => {
  const names = migrationNames();

  // The same telemetry column names exist on `device_apple_user` for the user
  // channel; this suite covers the device-channel columns only.
  const pushMigrations = names.filter((name) =>
    /ALTER TABLE `device_apple` ADD `last_push_at`/.test(readMigration(name)),
  );

  it("is added by exactly one migration", () => {
    expect(pushMigrations).toHaveLength(1);
  });

  it("adds every telemetry column with a failure counter default", () => {
    const sql = readMigration(pushMigrations[0]);
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
    const sql = readMigration(tokenMigrations[0]);
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
    const sql = readMigration(mfaMigrations[0]);
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

    expect(columns.get("account.totp_enabled")).toMatchObject({
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

describe("SCEP challenge migration", () => {
  const names = migrationNames();

  const challengeMigrations = names.filter((name) =>
    readMigration(name).includes("CREATE TABLE `scep_challenge`"),
  );

  it("is added by exactly one migration", () => {
    expect(challengeMigrations).toHaveLength(1);
  });

  it("creates a tenant-scoped one-time challenge table", () => {
    const sql = readMigration(challengeMigrations[0]);
    expect(sql).toContain("`id` varchar(255) PRIMARY KEY");
    expect(sql).toContain("`organization_id` varchar(255) NOT NULL");
    expect(sql).toContain("`enrollment_id` varchar(255) NOT NULL");
    expect(sql).toContain("`expires_at` datetime(3) NOT NULL");
    expect(sql).toContain("`consumed_at` datetime(3)");
    expect(sql).toContain("`created_at` datetime(3) NOT NULL");
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("ships a snapshot with the expected columns", () => {
    const snapshot = readSnapshot(names.at(-1)!);

    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns" && entry.table === "scep_challenge")
        .map((entry) => [entry.name, entry]),
    );

    expect(columns.get("id")).toMatchObject({ type: "varchar(255)", notNull: true });
    expect(columns.get("organization_id")).toMatchObject({ type: "varchar(255)", notNull: true });
    expect(columns.get("expires_at")).toMatchObject({ type: "datetime(3)", notNull: true });
    expect(columns.get("consumed_at")).toMatchObject({ type: "datetime(3)", notNull: false });
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
    const sql = readMigration(dynamicMigrations[0]);
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

describe("onboarding email marker migration", () => {
  const names = migrationNames();

  const markerMigrations = names.filter(
    (name) =>
      readMigration(name).includes("`welcome_email_sent_at`") &&
      readMigration(name).includes("`onboarding_follow_up_sent_at`"),
  );

  it("is added by exactly one migration", () => {
    expect(markerMigrations).toHaveLength(1);
  });

  it("adds nullable one-time markers to user and organization", () => {
    const sql = readMigration(markerMigrations[0]);
    expect(sql).toContain("ALTER TABLE `user` ADD `welcome_email_sent_at` datetime(3)");
    expect(sql).toContain(
      "ALTER TABLE `organization` ADD `onboarding_follow_up_sent_at` datetime(3)",
    );
    expect(sql).not.toContain("NOT NULL");
  });

  it("ships a snapshot with nullable datetime markers", () => {
    const snapshot = readSnapshot(names.at(-1)!);

    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns")
        .map((entry) => [`${entry.table}.${entry.name}`, entry]),
    );

    expect(columns.get("account.welcome_email_sent_at")).toMatchObject({
      type: "datetime(3)",
      notNull: false,
    });
    expect(columns.get("organization.onboarding_follow_up_sent_at")).toMatchObject({
      type: "datetime(3)",
      notNull: false,
    });
  });
});

describe("ownership transfer migration", () => {
  const names = migrationNames();

  const transferMigrations = names.filter((name) =>
    readMigration(name).includes("CREATE TABLE `tenant_ownership_transfer`"),
  );

  it("is added by exactly one migration", () => {
    expect(transferMigrations).toHaveLength(1);
  });

  it("creates a tenant-scoped transfer with a single-use token", () => {
    const sql = readMigration(transferMigrations[0]);
    expect(sql).toContain("`id` varchar(255) PRIMARY KEY");
    expect(sql).toContain("`organization_id` varchar(255) NOT NULL");
    expect(sql).toContain("`requested_by_user_id` varchar(255) NOT NULL");
    expect(sql).toContain("`target_user_id` varchar(255) NOT NULL");
    expect(sql).toContain("`status` varchar(32) NOT NULL");
    expect(sql).toContain("`token_hash` varchar(255)");
    expect(sql).toContain("`expires_at` datetime(3) NOT NULL");
    expect(sql).toContain("`accepted_at` datetime(3)");
    expect(sql).toContain("`cancelled_at` datetime(3)");
    expect(sql).toContain("UNIQUE INDEX(`token_hash`)");
    expect(sql).toContain("ON DELETE CASCADE");
    // Terminal rows keep their digest so the emailed link still previews but
    // cannot be accepted; only the expiry is non-null by necessity.
    expect(sql).not.toMatch(/`token_hash` varchar\(255\) NOT NULL/);
  });

  it("ships a snapshot with the expected columns", () => {
    const snapshot = readSnapshot(names.at(-1)!);

    const columns = new Map(
      snapshot.ddl
        .filter(
          (entry) => entry.entityType === "columns" && entry.table === "tenant_ownership_transfer",
        )
        .map((entry) => [entry.name, entry]),
    );

    expect(columns.get("id")).toMatchObject({ type: "varchar(255)", notNull: true });
    expect(columns.get("organization_id")).toMatchObject({
      type: "varchar(255)",
      notNull: true,
    });
    expect(columns.get("requested_by_account_id")).toMatchObject({
      type: "varchar(255)",
      notNull: true,
    });
    expect(columns.get("target_account_id")).toMatchObject({ type: "varchar(255)", notNull: true });
    expect(columns.get("status")).toMatchObject({ type: "varchar(32)", notNull: true });
    expect(columns.get("token_hash")).toMatchObject({ type: "varchar(255)", notNull: false });
    expect(columns.get("expires_at")).toMatchObject({ type: "datetime(3)", notNull: true });
    expect(columns.get("accepted_at")).toMatchObject({ type: "datetime(3)", notNull: false });
    expect(columns.get("cancelled_at")).toMatchObject({ type: "datetime(3)", notNull: false });
    expect(columns.get("created_at")).toMatchObject({ type: "datetime(3)", notNull: true });
  });
});

describe("account/user split migration", () => {
  const names = migrationNames();

  const splitMigrations = names.filter((name) =>
    readMigration(name).includes("RENAME TABLE `user` TO `account`"),
  );

  const tables = (snapshot: MigrationSnapshot) =>
    new Set(
      snapshot.ddl.filter((entry) => entry.entityType === "tables").map((entry) => entry.name),
    );

  const columnsFor = (snapshot: MigrationSnapshot, table: string) =>
    new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns" && entry.table === table)
        .map((entry) => [entry.name, entry]),
    );

  const latest = () => readSnapshot(names.at(-1)!);

  it("renames the dashboard identity exactly once", () => {
    expect(splitMigrations).toHaveLength(1);
    const sql = readMigration(splitMigrations[0]);
    expect(sql).toContain("RENAME TABLE `user` TO `account`");
    expect(sql).toContain("CREATE TABLE `user`");
  });

  it("ships both identities in the latest snapshot", () => {
    const snapshot = latest();
    const shipped = tables(snapshot);

    expect(shipped.has("account")).toBe(true);
    expect(shipped.has("user")).toBe(true);

    const account = columnsFor(snapshot, "account");
    expect(account.get("email")).toMatchObject({ type: "varchar(320)", notNull: true });
    expect(account.get("totp_enabled")).toMatchObject({ type: "boolean", notNull: true });
    expect(account.get("default_tenant_id")).toMatchObject({ notNull: false });
    expect(account.get("organization_id")).toBeUndefined();

    // A directory person belongs to exactly one tenant and carries no
    // credentials or dashboard preferences.
    const user = columnsFor(snapshot, "user");
    expect(user.get("organization_id")).toMatchObject({ type: "varchar(255)", notNull: true });
    expect(user.get("external_id")).toMatchObject({ type: "varchar(255)", notNull: false });
    expect(user.get("source")).toMatchObject({ type: "varchar(16)", notNull: true });
    expect(user.get("disabled")).toMatchObject({ type: "boolean", notNull: true });
    expect(user.get("email_verified")).toBeUndefined();
    expect(user.get("totp_enabled")).toBeUndefined();
    expect(user.get("auth_revision")).toBeUndefined();
  });

  it("scopes directory users by tenant with unique email and external id", () => {
    const snapshot = latest();

    const indexes = snapshot.ddl.filter(
      (entry) => entry.entityType === "indexes" && entry.table === "user",
    );

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "user_organization_email_unique",
          isUnique: true,
          columns: [
            { value: "organization_id", isExpression: false },
            { value: "email", isExpression: false },
          ],
        }),
        expect.objectContaining({
          name: "user_organization_external_unique",
          isUnique: true,
          columns: [
            { value: "organization_id", isExpression: false },
            { value: "external_id", isExpression: false },
          ],
        }),
      ]),
    );

    const organizationKey = snapshot.ddl.find(
      (entry) =>
        entry.entityType === "fks" && entry.table === "user" && entry.tableTo === "organization",
    );

    expect(organizationKey).toMatchObject({
      name: "user_organization_id_organization_id_fkey",
      onDelete: "CASCADE",
    });
  });

  it("points memberships at accounts, not directory users", () => {
    const member = columnsFor(latest(), "member");

    expect(member.get("account_id")).toMatchObject({ type: "varchar(255)", notNull: true });
    expect(member.get("user_id")).toBeUndefined();
  });

  it("keeps directory scoping links on the tenant-scoped user", () => {
    const snapshot = latest();

    for (const table of ["device_user", "user_policy", "user_group_member"]) {
      expect(columnsFor(snapshot, table).get("user_id")).toMatchObject({ notNull: true });

      const target = snapshot.ddl.find(
        (entry) =>
          entry.entityType === "fks" &&
          entry.table === table &&
          (entry.columns ?? []).some((column) =>
            typeof column === "string" ? column === "user_id" : column.value === "user_id",
          ),
      );

      expect(target, `${table}.user_id must reference a table`).toBeDefined();
      expect(target!.tableTo, `${table}.user_id must reference the directory user`).toBe("user");
      expect(target!.onDelete).toBe("CASCADE");
    }
  });

  it("maps existing directory-provisioned accounts into the new user table", () => {
    const sql = readMigration(splitMigrations[0]);

    // Only Graph/SCIM accounts become directory users; normal accounts keep
    // signing in and must not be duplicated into the directory.
    expect(sql).toContain("WHERE `account`.`source` IN ('graph', 'scim')");
    expect(sql).toContain("INSERT INTO `user`");
    expect(sql).toContain("_account_user_map");
    expect(sql).toContain("DROP TABLE `_account_user_map`");
  });
});

const WINDOWS_ACTIVATION_COLUMNS = [
  "windows_activation_status",
  "windows_activation_license_status",
  "windows_activation_edition",
  "windows_activation_channel",
  "windows_activation_license_name",
  "windows_activation_updated_at",
] as const;

describe("Windows activation migration", () => {
  const names = migrationNames();

  const activationMigrations = names.filter((name) =>
    readMigration(name).includes("`windows_activation_status`"),
  );

  it("is added by exactly one migration", () => {
    expect(activationMigrations).toHaveLength(1);
  });

  it("adds nullable activation columns to the device table", () => {
    const sql = readMigration(activationMigrations[0]);
    expect(sql).toContain("ALTER TABLE `device`");

    for (const column of WINDOWS_ACTIVATION_COLUMNS) expect(sql).toContain(`\`${column}\``);
    expect(sql).not.toContain("NOT NULL");
  });

  it("ships a snapshot with nullable columns of the expected types", () => {
    const snapshot = readSnapshot(names.at(-1)!);

    const columns = new Map(
      snapshot.ddl
        .filter((entry) => entry.entityType === "columns" && entry.table === "device")
        .map((entry) => [entry.name, entry]),
    );

    const expected: Record<(typeof WINDOWS_ACTIVATION_COLUMNS)[number], string> = {
      windows_activation_status: "varchar(16)",
      windows_activation_license_status: "int",
      windows_activation_edition: "varchar(255)",
      windows_activation_channel: "varchar(255)",
      windows_activation_license_name: "varchar(255)",
      windows_activation_updated_at: "datetime(3)",
    };

    for (const [column, type] of Object.entries(expected)) {
      const entry = columns.get(column);
      expect(entry, `missing snapshot column ${column}`).toBeDefined();
      expect(entry!.type).toBe(type);
      expect(entry!.notNull).toBe(false);
    }
  });

  it("does not leave the activation columns in a later migration", () => {
    const [activationMigration] = activationMigrations;

    for (const name of names.filter((candidate) => candidate > activationMigration))
      for (const column of WINDOWS_ACTIVATION_COLUMNS)
        expect(readMigration(name)).not.toContain(`\`${column}\``);
  });
});
