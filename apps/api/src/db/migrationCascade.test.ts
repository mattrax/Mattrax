import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

type ForeignKey = {
  readonly name: string;
  readonly table: string;
  readonly tableTo: string;
  readonly onDelete: string;
};

const deleteRule = (clause: string): string =>
  clause.match(/ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT|SET DEFAULT)/)?.[1] ?? "NO ACTION";

/**
 * Replay every migration in order, tracking `CREATE TABLE` foreign keys and
 * the later `ALTER ... DROP/ADD FOREIGN KEY` statements. This mirrors what a
 * fresh deployment actually ends up with, rather than what any single
 * migration happens to contain.
 */
const migratedForeignKeys = (): Map<string, ForeignKey> => {
  const keys = new Map<string, ForeignKey>();

  const directories = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directory of directories) {
    let sql: string;

    try {
      sql = readFileSync(join(migrationsDir, directory, "migration.sql"), "utf8");
    } catch {
      continue;
    }

    for (const match of sql.matchAll(/CREATE TABLE `(\w+)` \(([\s\S]*?)\n\);/g)) {
      const table = match[1]!;

      for (const line of match[2]!.split("\n")) {
        const constraint = line.match(
          /CONSTRAINT `(\w+)` FOREIGN KEY \(([^)]*)\) REFERENCES `(\w+)`\(([^)]*)\)([\s\S]*)/,
        );

        if (!constraint) continue;
        keys.set(constraint[1]!, {
          name: constraint[1]!,
          table,
          tableTo: constraint[3]!,
          onDelete: deleteRule(constraint[5]!),
        });
      }
    }

    for (const match of sql.matchAll(/ALTER TABLE `\w+` DROP FOREIGN KEY `(\w+)`;/g))
      keys.delete(match[1]!);

    for (const match of sql.matchAll(
      /ALTER TABLE `(\w+)` ADD CONSTRAINT `(\w+)` FOREIGN KEY \(([^)]*)\) REFERENCES `(\w+)`\(([^)]*)\)([^;]*);/g,
    )) {
      keys.set(match[2]!, {
        name: match[2]!,
        table: match[1]!,
        tableTo: match[4]!,
        onDelete: deleteRule(match[6]!),
      });
    }
  }

  return keys;
};

type SnapshotDdlEntry = {
  readonly entityType: string;
  readonly name: string;
  readonly table: string;
  readonly tableTo: string;
  readonly columns: ReadonlyArray<string>;
  readonly onDelete: string;
};

type MigrationSnapshot = {
  readonly ddl: ReadonlyArray<SnapshotDdlEntry>;
};

const latestSnapshot = (): MigrationSnapshot => {
  const directories = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const latest = directories.at(-1)!;

  return JSON.parse(readFileSync(join(migrationsDir, latest, "snapshot.json"), "utf8"));
};

describe("migration foreign-key delete rules", () => {
  const sql = migratedForeignKeys();
  const snapshot = latestSnapshot();
  const snapshotForeignKeys = snapshot.ddl.filter((entry) => entry.entityType === "fks");

  it("matches the latest snapshot for every foreign key", () => {
    for (const expected of snapshotForeignKeys) {
      const actual = sql.get(expected.name);
      expect(actual, `${expected.name} is missing from the migrations`).toBeDefined();
      expect(actual!.onDelete, `${expected.name} delete rule drifted from the snapshot`).toBe(
        expected.onDelete,
      );
      expect(actual!.table).toBe(expected.table);
      expect(actual!.tableTo).toBe(expected.tableTo);
    }
  });

  it("cascades tenant deletion through every organization-scoped table", () => {
    const organizationKeys = snapshotForeignKeys.filter(
      (entry) => entry.tableTo === "organization",
    );

    expect(organizationKeys.length).toBeGreaterThan(0);

    for (const expected of organizationKeys) {
      expect(sql.get(expected.name)?.onDelete, expected.name).toBe("CASCADE");
    }
  });
});
