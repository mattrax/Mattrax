import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "..", "migrations");

const names = () =>
  readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const readMigration = (name: string) =>
  readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");

type Entry = {
  readonly entityType: string;
  readonly table: string;
  readonly name: string;
  readonly columns?: ReadonlyArray<string>;
  readonly tableTo?: string;
  readonly onDelete?: string;
};

const latestSnapshot = (): { readonly ddl: ReadonlyArray<Entry> } =>
  JSON.parse(readFileSync(join(migrationsDir, names().at(-1)!, "snapshot.json"), "utf8"));

describe("Google Workspace directory sync migration", () => {
  const migrationNames = names();

  const googleMigrations = migrationNames.filter((name) =>
    readMigration(name).includes("google_directory_sync"),
  );

  it("is created by exactly one migration", () => {
    expect(googleMigrations).toHaveLength(1);
  });

  it("seals the service account and keeps sync state on the tenant row", () => {
    const sql = readMigration(googleMigrations[0]!);

    expect(sql).toContain("CREATE TABLE `google_directory_sync`");
    expect(sql).toContain("PRIMARY KEY");

    for (const column of [
      "sealed_service_account",
      "service_account_email",
      "admin_email",
      "customer",
      "status",
      "last_counts",
      "sync_interval_minutes",
      "next_sync_at",
    ])
      expect(sql).toContain(`\`${column}\``);
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("ships a snapshot with the tenant primary key and cascade", () => {
    const ddl = latestSnapshot().ddl.filter((entry) => entry.table === "google_directory_sync");
    const primary = ddl.find((entry) => entry.entityType === "pks");

    expect(primary?.columns).toEqual(["organization_id"]);
    expect(ddl.find((entry) => entry.entityType === "fks")).toMatchObject({
      tableTo: "organization",
      onDelete: "CASCADE",
    });
  });
});
