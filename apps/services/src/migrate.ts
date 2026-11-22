import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";

/**
 * Minimal Drizzle migration runner.
 *
 * The services database is provisioned independently from the application, so
 * it cannot rely on the application container's migration step. This mirrors
 * the bookkeeping Drizzle uses (one row per migration folder) so `drizzle-kit`
 * can keep generating migrations and both runners agree on what is applied.
 */

const MIGRATIONS_TABLE = "__drizzle_migrations";

interface Migration {
  name: string;
  statements: string[];
  hash: string;
  createdAt: number;
}

interface MigrationRow extends RowDataPacket {
  hash: string;
  created_at: number | string | bigint | null;
}

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
  cause instanceof Error && "code" in cause && cause.code === code;

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

const connect = async (databaseUrl: string): Promise<Connection> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await mysql.createConnection({
        uri: databaseUrl,
        multipleStatements: false,
        timezone: "Z",
      });
    } catch (error) {
      if (attempt >= 10) throw error;

      console.warn(`services: database unavailable (attempt ${attempt}), retrying`);
      await delay(Math.min(attempt * 1000, 5000));
    }
  }
};

export interface MigrateOptions {
  databaseUrl: string;
  migrationsDirectory: string;
}

export const migrateDatabase = async ({
  databaseUrl,
  migrationsDirectory,
}: MigrateOptions): Promise<void> => {
  const migrations = await readMigrations(migrationsDirectory);

  if (migrations.length === 0) {
    console.log("services: no migrations to apply");

    return;
  }

  const connection = await connect(databaseUrl);

  // Two replicas must not apply the same migration concurrently. MySQL DDL
  // commits implicitly, so the advisory lock is the strongest guarantee.
  const [lockRows] = await connection.query<RowDataPacket[]>(
    "SELECT GET_LOCK('mattrax_services_migrate', 60) AS acquired",
  );

  if (Number(lockRows[0]?.acquired) !== 1) {
    await connection.end();

    throw new Error("could not acquire the services migration lock");
  }

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT,
        name TEXT,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await connection.query<MigrationRow[]>(
      `SELECT hash, created_at FROM \`${MIGRATIONS_TABLE}\``,
    );

    const applied = new Set(rows.map((row) => String(row.hash)));
    const pending = migrations.filter((migration) => !applied.has(migration.hash));

    if (pending.length === 0) {
      console.log("services: database schema is up to date");

      return;
    }

    for (const migration of pending) {
      console.log(`services: applying migration ${migration.name}`);

      for (const statement of migration.statements) await connection.query(statement);

      await connection.query(
        `INSERT INTO \`${MIGRATIONS_TABLE}\` (\`hash\`, \`created_at\`, \`name\`) VALUES (?, ?, ?)`,
        [migration.hash, migration.createdAt, migration.name],
      );
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('mattrax_services_migrate')").catch(() => {});
    await connection.end();
  }
};
