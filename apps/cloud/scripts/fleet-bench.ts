#!/usr/bin/env node
/**
 * Fleet query benchmark.
 *
 * Seeds a disposable tenant with devices and times the SQL shapes the dashboard
 * uses (count, name/last-seen paging, filtering, search and the application-side
 * health/rollup scans). Run it against a development database only:
 *
 *   pnpm bench:fleet -- --devices 100000
 *
 * The tenant and its devices are removed afterwards unless `--keep` is passed.
 */
import mysql from "mysql2/promise";

const args = process.argv.slice(2);

const numberArg = (name: string, fallback: number): number => {
  const index = args.indexOf(`--${name}`);

  if (index === -1) return fallback;

  const value = Number(args[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const flag = (name: string): boolean => args.includes(`--${name}`);

const deviceCount = numberArg("devices", 50_000);

const keep = flag("keep");

const batchSize = 5_000;

const organizationId = "benchfleetorg";

const organizationSlug = "bench-fleet";

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "mattrax",
  password: process.env.DATABASE_PASSWORD ?? "mattrax",
  database: process.env.DATABASE_NAME ?? "mattraxe",
  multipleStatements: true,
});

/** The scalar placeholders this benchmark binds. */
type SqlParameter = string | number | boolean | Date | null;

const time = async (
  label: string,
  sql: string,
  params: SqlParameter[] = [],
): Promise<{ rows: unknown; duration: number }> => {
  const started = performance.now();
  const [rows] = await connection.execute(sql, params);
  const duration = performance.now() - started;
  console.log(
    `${label.padEnd(42)} ${duration.toFixed(1).padStart(9)} ms  ${Array.isArray(rows) ? `${rows.length} row(s)` : ""}`,
  );

  return { rows, duration };
};

const deviceModel = (proto: string): string => {
  switch (proto) {
    case "apple":
      return "MacBook Pro (16-inch, 2021)";
    case "win":
      return "Surface Laptop 5";
    default:
      return "Pixel 8";
  }
};

const deviceOsVersion = (proto: string): string => {
  switch (proto) {
    case "apple":
      return "14.2";
    case "win":
      return "10.0.22631";
    default:
      return "14";
  }
};

const seed = async (): Promise<void> => {
  await connection.execute(
    `INSERT INTO organization (id, name, slug, require_mfa, created_at, updated_at)
     VALUES (?, ?, ?, 0, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [organizationId, "Bench Fleet", organizationSlug],
  );

  console.log(`Seeding ${deviceCount.toLocaleString()} devices…`);
  const now = Date.now();

  for (let start = 0; start < deviceCount; start += batchSize) {
    const rows: string[] = [];
    const values: SqlParameter[] = [];
    const end = Math.min(start + batchSize, deviceCount);

    for (let index = start; index < end; index++) {
      const proto = ["apple", "win", "android"][index % 3];
      const status = index % 20 === 0 ? "unenrolled" : "enrolled";
      const seen = new Date(now - (index % 90) * 24 * 60 * 60 * 1000);
      const enrolled = new Date(now - (index % 365) * 24 * 60 * 60 * 1000);

      rows.push(`(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      values.push(
        `d${String(index).padStart(10, "0")}`,
        organizationId,
        proto,
        status,
        `Device ${String(index).padStart(6, "0")}`,
        deviceModel(proto),
        `SERIAL${String(index).padStart(10, "0")}`,
        `bench-${index % 400}-${index}`,
        `bench-${index}`,
        enrolled,
        seen,
        deviceOsVersion(proto),
      );
    }

    await connection.query(
      `INSERT INTO device
        (id, organization_id, proto, status, name, model, serial, model_identifier, dm_identifier, enrolled_at, last_seen_at, os_version)
       VALUES ${rows.join(",")}
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      values,
    );
    process.stdout.write(`\r  ${end.toLocaleString()} / ${deviceCount.toLocaleString()}`);
  }

  process.stdout.write("\n");
  await connection.query("ANALYZE TABLE device");
};

const cleanup = async (): Promise<void> => {
  await connection.execute("DELETE FROM organization WHERE id = ?", [organizationId]);
};

const bench = async (): Promise<void> => {
  // Warm the buffer pool once so the first statement is not the outlier.
  await connection.execute("SELECT COUNT(*) FROM device WHERE organization_id = ?", [
    organizationId,
  ]);

  await time("count fleet", "SELECT COUNT(*) FROM device WHERE organization_id = ?", [
    organizationId,
  ]);

  await time(
    "first page by name",
    `SELECT id, name, status, proto, serial, model, last_seen_at
       FROM device WHERE organization_id = ? ORDER BY name LIMIT 50 OFFSET 0`,
    [organizationId],
  );

  await time(
    "deep page by name (offset 25k)",
    `SELECT id, name, status, proto, serial, model, last_seen_at
       FROM device WHERE organization_id = ? ORDER BY name LIMIT 50 OFFSET 25000`,
    [organizationId],
  );

  await time(
    "first page by last seen",
    `SELECT id, name, status, proto, serial, model, last_seen_at
       FROM device WHERE organization_id = ? ORDER BY last_seen_at DESC LIMIT 50 OFFSET 0`,
    [organizationId],
  );

  await time(
    "status filter + name page",
    `SELECT id, name FROM device WHERE organization_id = ? AND status = 'enrolled'
       ORDER BY name LIMIT 50`,
    [organizationId],
  );

  await time(
    "substring search (name/serial/model)",
    `SELECT id, name FROM device WHERE organization_id = ? AND
       (name LIKE ? OR serial LIKE ? OR model LIKE ? OR dm_identifier LIKE ? OR asset_tag LIKE ? OR notes LIKE ?)
       LIMIT 50`,
    [organizationId, "%000042%", "%000042%", "%000042%", "%000042%", "%000042%", "%000042%"],
  );

  await time(
    "stale filter",
    `SELECT id, name FROM device WHERE organization_id = ? AND last_seen_at < ?
       ORDER BY last_seen_at LIMIT 50`,
    [organizationId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)],
  );

  // The dashboard/health paths currently scan the tenant in application code.
  await time("application-side fleet scan", "SELECT * FROM device WHERE organization_id = ?", [
    organizationId,
  ]);

  await time(
    "rollup by platform/status",
    `SELECT proto, status, COUNT(*) AS count FROM device WHERE organization_id = ?
       GROUP BY proto, status`,
    [organizationId],
  );

  const [plan] = await connection.execute(
    `EXPLAIN SELECT id FROM device WHERE organization_id = ? ORDER BY name LIMIT 50`,
    [organizationId],
  );

  console.log("\nEXPLAIN (first page by name):");
  console.table(plan);
};

try {
  await seed();
  await bench();
} finally {
  if (!keep) {
    await cleanup();
    console.log("\nRemoved the benchmark tenant.");
  } else {
    console.log(`\nKept tenant ${organizationId} (${organizationSlug}).`);
  }

  await connection.end();
}
