import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Effect, Predicate } from "effect";
import mysql from "mysql2/promise";
import {
  databaseConfigFromUrl,
  mysqlConnectionOptions,
  runMigrations,
} from "@mattrax/cloud-services";
import type { Migration } from "@mattrax/cloud-services";

/**
 * Minimal Drizzle migration runner.
 *
 * The services database is provisioned independently from the application, so
 * it cannot rely on the application container's migration step. This mirrors
 * the bookkeeping Drizzle uses (one row per migration folder) so `drizzle-kit`
 * can keep generating migrations and both runners agree on what is applied.
 */

const folderMillis = (name: string): number => {
  const stamp = name.slice(0, 14);
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6)) - 1;
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const second = Number(stamp.slice(12, 14));

  return Date.UTC(year, month, day, hour, minute, second);
};

const hasErrnoCode = (cause: unknown, code: string): boolean =>
  Predicate.isError(cause) && "code" in cause && cause.code === code;

const readMigrations = async (directory: string): Promise<Migration[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations: Migration[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const file = path.join(directory, entry.name, "migration.sql");

    try {
      const sql = await readFile(file, "utf8");
      migrations.push({
        name: entry.name,
        statements: sql
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter(Boolean),
        hash: createHash("sha256").update(sql).digest("hex"),
        createdAt: folderMillis(entry.name),
      });
    } catch (error) {
      if (!hasErrnoCode(error, "ENOENT")) throw error;
    }
  }

  migrations.sort((left, right) => left.name.localeCompare(right.name));

  return migrations;
};

export interface MigrateOptions {
  databaseUrl: string;
  migrationsDirectory: string;
  log?: (message: string) => void;
}

export const migrateDatabase = async ({
  databaseUrl,
  migrationsDirectory,
  log = console.log,
}: MigrateOptions): Promise<void> => {
  const config = databaseConfigFromUrl(databaseUrl);
  const migrations = await readMigrations(migrationsDirectory);

  if (migrations.length === 0) {
    log("services: no migrations to apply");

    return;
  }

  await Effect.runPromise(
    runMigrations({
      migrations,
      lockName: "mattrax_services_migrate",
      label: "services",
      log,
      connect: Effect.tryPromise({
        try: () =>
          mysql.createConnection({
            ...mysqlConnectionOptions(config),
            multipleStatements: false,
            timezone: "Z",
          }),
        catch: (cause) => cause,
      }),
    }),
  );
};
