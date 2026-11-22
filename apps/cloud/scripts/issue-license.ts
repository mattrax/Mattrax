import { createHash, randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/**
 * Issue a deployment licence for a self-hosted Mattrax install.
 *
 * Run against the services database (the `services_` schema):
 *
 *   DATABASE_URL=mysql://… pnpm license:issue --name "Acme" --email ops@acme.test
 *
 * The printed key is the only copy: the database stores a SHA-256 hash. Give it
 * to the operator as `MATTRAX_LICENSE_KEY`, together with the services origin
 * as `MATTRAX_BILLING_URL`.
 */

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
};

const name = argument("name")?.trim();

if (!name) {
  console.error("Usage: issue-license --name <customer> [--email <address>] [--origin <url>]");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const licenseKey = `mtx_lic_${randomBytes(32).toString("base64url")}`;

const hash = createHash("sha256").update(licenseKey).digest("hex");

const now = new Date();

const id = randomUUID().replaceAll("-", "").slice(0, 24);

const connection = await mysql.createConnection({ uri: databaseUrl, timezone: "Z" });

try {
  await connection.query(
    `INSERT INTO services_deployment_license
      (id, name, license_key_hash, license_key_prefix, origin, contact_email, plan,
       device_count, tenant_count, cancel_at_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'device', 0, 0, false, ?, ?)`,
    [
      id,
      name,
      hash,
      licenseKey.slice(0, 16),
      argument("origin")?.trim() || null,
      argument("email")?.trim() || null,
      now,
      now,
    ],
  );
} finally {
  await connection.end();
}

console.log(`Deployment licence created.
  id:      ${id}
  name:    ${name}
  key:     ${licenseKey}

Set on the self-hosted deployment:
  MATTRAX_BILLING_URL=${process.env.MATTRAX_BILLING_URL ?? "https://services.mattrax.app"}
  APNS_RELAY_URL=https://services.mattrax.app/v1/apns/push
  MATTRAX_LICENSE_KEY=${licenseKey}`);
