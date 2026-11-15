import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";

/**
 * Drizzle stores one folder per migration and one row per applied folder.
 * This runner reproduces the same bookkeeping so `pnpm db:migrate` keeps
 * working against a database that was first provisioned by the container.
 */
const MIGRATIONS_TABLE = "__drizzle_migrations";

const folderMillis = (name) => {
  const stamp = name.slice(0, 14);
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6)) - 1;
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const second = Number(stamp.slice(12, 14));

  return Date.UTC(year, month, day, hour, minute, second);
};

const readMigrations = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = [];

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
      if (cause.code !== "ENOENT") throw cause;
    }
  }

  migrations.sort((left, right) => left.name.localeCompare(right.name));

  return migrations;
};

const connect = async (databaseUrl, log) => {
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

export const migrate = async ({ databaseUrl, migrationsDirectory, log = console.log }) => {
  const migrations = await readMigrations(migrationsDirectory);

  if (migrations.length === 0) {
    log("mattrax self-host: no migrations to apply");

    return;
  }

  const connection = await connect(databaseUrl, log);

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

    const [rows] = await connection.query(
      `SELECT hash, created_at FROM \`${MIGRATIONS_TABLE}\``,
    );

    const applied = new Map(rows.map((row) => [String(row.hash), Number(row.created_at)]));
    const pending = migrations.filter((migration) => !applied.has(migration.hash));

    if (pending.length === 0) {
      log("mattrax self-host: database schema is up to date");

      return;
    }

    for (const migration of pending) {
      log(`mattrax self-host: applying migration ${migration.name}`);

      await connection.beginTransaction();

      try {
        for (const statement of migration.statements) await connection.query(statement);

        await connection.query(
          `INSERT INTO \`${MIGRATIONS_TABLE}\` (\`hash\`, \`created_at\`, \`name\`) VALUES (?, ?, ?)`,
          [migration.hash, migration.createdAt, migration.name],
        );
        await connection.commit();
      } catch (cause) {
        await connection.rollback();
        throw cause;
      }
    }
  } finally {
    await connection.end();
  }
};
