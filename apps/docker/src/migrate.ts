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
 * Drizzle stores one folder per migration and one row per applied folder.
 * This runner reproduces the same bookkeeping so `pnpm db:migrate` keeps
 * working against a database that was first provisioned by the container.
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

export const readMigrations = async (directory: string): Promise<Migration[]> => {
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

export const migrate = async ({
  databaseUrl,
  migrationsDirectory,
  log = console.log,
}: MigrateOptions): Promise<void> => {
  // Validate TLS policy, host and port before touching the filesystem or
  // opening a socket. The application pool uses this same decoder.
  const config = databaseConfigFromUrl(databaseUrl);
  const migrations = await readMigrations(migrationsDirectory);

  if (migrations.length === 0) {
    log("mattrax self-host: no migrations to apply");

    return;
  }

  await Effect.runPromise(
    runMigrations({
      migrations,
      lockName: "mattrax_migrate",
      label: "mattrax self-host",
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
