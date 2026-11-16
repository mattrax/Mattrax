import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";

/**
 * Drizzle stores one folder per migration and one row per applied folder.
 * This runner reproduces the same bookkeeping so `pnpm db:migrate` keeps
 * working against a database that was first provisioned by the container.
 */
const MIGRATIONS_TABLE = "__drizzle_migrations";

interface Migration {
  name: string;
  sql: string;
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
        sql,
        statements: sql
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter(Boolean),
        hash: createHash("sha256").update(sql).digest("hex"),
        createdAt: folderMillis(entry.name),
      });
    } catch (cause) {
      if (!hasErrnoCode(cause, "ENOENT")) throw cause;
    }
  }

  migrations.sort((left, right) => left.name.localeCompare(right.name));

  return migrations;
};

const connect = async (
  databaseUrl: string,
  log: (message: string) => void,
): Promise<Connection> => {
  // Compose waits for MySQL health before starting the app, but a database
  // that restarts while the container boots should not need a manual restart.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await mysql.createConnection({
        uri: databaseUrl,
        multipleStatements: false,
        timezone: "Z",
      });
    } catch (cause) {
      if (attempt >= 10) throw cause;

      log(`mattrax self-host: database unavailable (attempt ${attempt}), retrying`);

      await delay(Math.min(attempt * 1000, 5000));
    }
  }
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
  const migrations = await readMigrations(migrationsDirectory);

  if (migrations.length === 0) {
    log("mattrax self-host: no migrations to apply");

    return;
  }

  const connection = await connect(databaseUrl, log);

  // Two replicas (or a container restart racing `pnpm db:migrate`) must not
  // apply the same migration concurrently. MySQL DDL implicitly commits, so a
  // transaction cannot make a multi-statement migration atomic; the advisory
  // lock at least guarantees one runner at a time.
  const [lockRows] = await connection.query<RowDataPacket[]>(
    "SELECT GET_LOCK('mattrax_migrate', 60) AS acquired",
  );

  if (Number(lockRows[0]?.acquired) !== 1) {
    await connection.end();

    throw new Error("could not acquire the database migration lock");
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

    const applied = new Map<string, number>(
      rows.map((row): [string, number] => [String(row.hash), Number(row.created_at)]),
    );
    const pending = migrations.filter((migration) => !applied.has(migration.hash));

    if (pending.length === 0) {
      log("mattrax self-host: database schema is up to date");

      return;
    }

    for (const migration of pending) {
      log(`mattrax self-host: applying migration ${migration.name}`);

      // MySQL commits DDL immediately, so a failure part-way through leaves
      // the schema changed without a migration row. Stop here and make the
      // operator restore (or finish the statements) rather than replaying
      // from the first statement and failing on an existing table.
      for (const statement of migration.statements) await connection.query(statement);

      await connection.query(
        `INSERT INTO \`${MIGRATIONS_TABLE}\` (\`hash\`, \`created_at\`, \`name\`) VALUES (?, ?, ?)`,
        [migration.hash, migration.createdAt, migration.name],
      );
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('mattrax_migrate')").catch(() => {});

    await connection.end();
  }
};
