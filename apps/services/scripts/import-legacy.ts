import mysql from "mysql2/promise";

/**
 * Copy legacy billing rows from a pre-split application database into the
 * services database.
 *
 * Run this BEFORE applying the application migration that drops
 * `subscription`, `stripe_event` and `deployment_license`:
 *
 *   SOURCE_DATABASE_URL=mysql://… DATABASE_URL=mysql://… pnpm services db:import-legacy
 *
 * It is idempotent and only copies the rows billing still needs. Stripe event
 * history is intentionally not copied: the ledger only dedupes retries.
 */

const sourceUrl = process.env.SOURCE_DATABASE_URL?.trim();
const targetUrl = process.env.DATABASE_URL?.trim();

if (!sourceUrl || !targetUrl) {
  console.error("SOURCE_DATABASE_URL and DATABASE_URL are required");
  process.exit(1);
}

const source = await mysql.createConnection({ uri: sourceUrl, timezone: "Z" });
const target = await mysql.createConnection({ uri: targetUrl, timezone: "Z" });

const hasTable = async (name: string) => {
  const [rows] = await source.query<Array<{ n: number }>>(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [name],
  );

  return Number(rows[0]?.n ?? 0) > 0;
};

try {
  if (await hasTable("deployment_license")) {
    const [rows] = await source.query<Array<Record<string, unknown>>>(
      "SELECT * FROM deployment_license",
    );

    for (const row of rows)
      await target.query(
        `INSERT INTO services_deployment_license
          (id, name, license_key_hash, license_key_prefix, origin, contact_email,
           stripe_customer_id, stripe_subscription_id, plan, status, device_count,
           tenant_count, period_end, cancel_at_period_end, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), origin = VALUES(origin), contact_email = VALUES(contact_email),
           stripe_customer_id = VALUES(stripe_customer_id),
           stripe_subscription_id = VALUES(stripe_subscription_id), plan = VALUES(plan),
           status = VALUES(status), device_count = VALUES(device_count),
           tenant_count = VALUES(tenant_count), period_end = VALUES(period_end),
           cancel_at_period_end = VALUES(cancel_at_period_end),
           last_seen_at = VALUES(last_seen_at), updated_at = VALUES(updated_at)`,
        [
          row.id,
          row.name,
          row.license_key_hash,
          row.license_key_prefix,
          row.origin,
          row.contact_email,
          row.stripe_customer_id,
          row.stripe_subscription_id,
          row.plan ?? "device",
          row.status,
          row.device_count ?? 0,
          row.tenant_count ?? 0,
          row.period_end,
          row.cancel_at_period_end ?? false,
          row.last_seen_at,
          row.created_at,
          row.updated_at,
        ],
      );

    console.log(`Copied ${rows.length} deployment licences.`);
  }

  if (await hasTable("organization")) {
    const [rows] = await source.query<Array<Record<string, unknown>>>(
      "SELECT id, name, stripe_customer_id, created_at, updated_at FROM organization WHERE stripe_customer_id IS NOT NULL",
    );

    for (const row of rows)
      await target.query(
        `INSERT INTO services_tenant
           (id, name, stripe_customer_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name),
           stripe_customer_id = VALUES(stripe_customer_id), updated_at = VALUES(updated_at)`,
        [row.id, row.name, row.stripe_customer_id, row.created_at, row.updated_at],
      );

    console.log(`Copied ${rows.length} hosted tenants.`);
  }

  if (await hasTable("subscription")) {
    const [rows] = await source.query<Array<Record<string, unknown>>>("SELECT * FROM subscription");

    for (const row of rows)
      await target.query(
        `INSERT INTO services_subscription
           (id, plan, tenant_id, stripe_customer_id, stripe_subscription_id, status,
            period_start, period_end, cancel_at_period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE plan = VALUES(plan), tenant_id = VALUES(tenant_id),
           stripe_customer_id = VALUES(stripe_customer_id),
           stripe_subscription_id = VALUES(stripe_subscription_id), status = VALUES(status),
           period_start = VALUES(period_start), period_end = VALUES(period_end),
           cancel_at_period_end = VALUES(cancel_at_period_end),
           updated_at = VALUES(updated_at)`,
        [
          row.id,
          row.plan,
          row.reference_id,
          row.stripe_customer_id,
          row.stripe_subscription_id,
          row.status,
          row.period_start,
          row.period_end,
          row.cancel_at_period_end,
          row.created_at,
          row.updated_at,
        ],
      );

    console.log(`Copied ${rows.length} hosted subscriptions.`);
  }
} finally {
  await source.end();
  await target.end();
}
