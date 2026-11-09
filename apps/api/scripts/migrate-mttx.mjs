#!/usr/bin/env node
/**
 * Best-effort migration from the legacy `mattrax/mttx` MySQL schema into the
 * `mattraxe` schema.
 *
 * This script is intentionally NOT part of CI. It is an operator tool:
 *
 *   MTTX_DATABASE_URL=... TARGET_DATABASE_URL=... \
 *     node apps/api/scripts/migrate-mttx.mjs --dry-run
 *
 * See apps/api/scripts/README.md and docs/enterprise/mttx-data-migration.md.
 */

import crypto from "node:crypto";
import mysql from "mysql2/promise";

// AuthApi is created with namespace "mattrax/auth"; the email strategy is
// registered under the key "email". Yielded Auth therefore uses this module id.
const EMAIL_MODULE_ID = "mattrax/auth/email";

const KNOWN_KIND =
  /^(mttx\.apple\.(device|custom\.[A-Za-z0-9]{1,20}|certificate\.[A-Za-z0-9]{1,20}|declaration\.[A-Za-z0-9]{1,20}|application\.[A-Za-z0-9]{1,20})|mttx\.windows\.custom\.[A-Za-z0-9]{1,20})$/;

const TARGET_TABLES = [
  "user",
  "organization",
  "member",
  "enterprise_enrollment",
  "device",
  "device_apple",
  "device_apple_user",
  "enterprise_group",
  "policy",
  "configuration",
  "group_device",
  "group_policy",
  "platform_instance",
  "apple_push_certificate",
  "scep_ca",
  "auth_identifiers",
  "auth_credentials",
  "auth_emailCredentials",
];

const SOURCE_TABLES = ["account", "tenant", "device", "group", "policy", "configuration"];

// ─── CLI ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = new Set(argv);
const has = (flag) => flags.has(flag);

if (has("--help") || has("-h")) {
  console.log(`Usage: node apps/api/scripts/migrate-mttx.mjs [options]

Options:
  --dry-run            Run every write inside a transaction, then roll back.
  --yes                Required for a real migration. Refuses to write without it.
  --resell-apns        Re-seal legacy APNs private keys (needs MTTX_SECRET and AUTH_SECRET).
  --import-scep-ca     Import the legacy SCEP CA instead of generating a new one.
  --skip-instances     Do not migrate the legacy instance table.
  --verbose            Print each skipped row (default: first 20 per reason).
  --help               Show this help.

Environment:
  MTTX_DATABASE_URL    Legacy MySQL DSN (or MTTX_DATABASE_HOST/PORT/USER/PASSWORD/NAME).
  TARGET_DATABASE_URL  Target MySQL DSN (or DATABASE_HOST/PORT/USER/PASSWORD/NAME).
  MTTX_SECRET          Legacy 32-byte application secret (only for --resell-apns).
  AUTH_SECRET          New application secret (only for --resell-apns).`);
  process.exit(0);
}

const dryRun = has("--dry-run");
const confirmed = has("--yes");
const verbose = has("--verbose");

if (!dryRun && !confirmed) {
  console.error(
    "Refusing to migrate without --yes. Run with --dry-run first to inspect what would happen.",
  );
  process.exit(1);
}

// ─── Connections ────────────────────────────────────────────────────────────

const redactDsn = (dsn) => {
  try {
    const url = new URL(dsn);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<unparseable DSN>";
  }
};

const dsnFromParts = (prefix, defaults = {}) => {
  const host = process.env[`${prefix}HOST`] ?? defaults.host;
  const port = process.env[`${prefix}PORT`] ?? defaults.port;
  const user = process.env[`${prefix}USER`] ?? defaults.user;
  const password = process.env[`${prefix}PASSWORD`] ?? defaults.password;
  const database = process.env[`${prefix}NAME`] ?? defaults.database;
  if (!host || !database) return null;
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password ?? "")}@` : "";
  return `mysql://${auth}${host}:${port ?? 3306}/${database}`;
};

const sourceDsn = process.env.MTTX_DATABASE_URL ?? dsnFromParts("MTTX_DATABASE_") ?? null;
const targetDsn =
  process.env.TARGET_DATABASE_URL ??
  dsnFromParts("DATABASE_", {
    host: "127.0.0.1",
    port: "3306",
    user: "mattrax",
    password: "mattrax",
    database: "mattraxe",
  });

if (!sourceDsn) {
  console.error(
    "Missing legacy database configuration: set MTTX_DATABASE_URL or MTTX_DATABASE_HOST/PORT/USER/PASSWORD/NAME.",
  );
  process.exit(1);
}
if (!targetDsn) {
  console.error(
    "Missing target database configuration: set TARGET_DATABASE_URL or DATABASE_HOST/PORT/USER/PASSWORD/NAME.",
  );
  process.exit(1);
}

const connectionConfig = (dsn, sslFlag) => {
  const url = new URL(dsn);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    // Keep DATETIME values as strings so they pass through without a
    // connection-timezone conversion. Legacy sqlx wrote UTC.
    dateStrings: true,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
    charset: "utf8mb4",
    ...(sslFlag ? { ssl: {} } : {}),
  };
};

if (redactDsn(sourceDsn) === redactDsn(targetDsn)) {
  console.error("Source and target DSNs point at the same database. Refusing to run.");
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const q = (identifier) => "`" + String(identifier).replaceAll("`", "``") + "`";

const sha256hex = (value) => crypto.createHash("sha256").update(value).digest("hex");

const randomId = () => crypto.randomBytes(32).toString("base64url");

const stableId = (...parts) => sha256hex(parts.join("\u0000")).slice(0, 24);

const asText = (value) => (value == null ? null : String(value));

const bufferOrNull = (value) => {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value), "binary");
};

const hexOrNull = (value) => {
  const buffer = bufferOrNull(value);
  return buffer ? buffer.toString("hex") : null;
};

const base64OrNull = (value) => {
  const buffer = bufferOrNull(value);
  return buffer ? buffer.toString("base64") : null;
};

const boolOrFalse = (value) => Boolean(value && Number(value) !== 0);

const sqlNow = () => new Date().toISOString().replace("T", " ").replace("Z", "");

const sqlDateToMillis = (value) => {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  if (!text) return null;
  const isoTry = text.includes("T") ? text : text.replace(" ", "T");
  const withZone = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(isoTry) ? isoTry : `${isoTry}Z`;
  const millis = Date.parse(withZone);
  return Number.isFinite(millis) ? millis : null;
};

const parseJson = (value) => {
  if (value == null) return null;
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  return JSON.parse(text);
};

const slugify = (value, fallback) => {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || fallback;
};

const pemEncode = (label, der) => {
  const base64 = Buffer.from(der).toString("base64");
  const lines = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
};

// Legacy APNs keys: nonce(12) || ChaCha20-Poly1305 ciphertext || tag(16).
const unsealLegacyApnsKey = (secret, blob) => {
  const payload = Buffer.from(blob);
  if (payload.length < 12 + 16 + 1) throw new Error("legacy APNs key is too short");
  const nonce = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(12, payload.length - 16);
  const key = Buffer.from(secret, "utf8");
  if (key.length !== 32) throw new Error("MTTX_SECRET must be exactly 32 bytes");
  const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonce, {
    authTagLength: 16,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

// New APNs keys: base64(iv(12) || AES-256-GCM ciphertext || tag(16)).
const sealWithAuthSecret = (secret, plaintext) => {
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
};

// ─── Bookkeeping ────────────────────────────────────────────────────────────

const stats = new Map();
const skips = new Map();
const warnings = [];

const tableStats = (name) => {
  if (!stats.has(name)) {
    stats.set(name, { inserted: 0, updated: 0, unchanged: 0, skipped: 0 });
  }
  return stats.get(name);
};

const recordResult = (name, result) => {
  const entry = tableStats(name);
  if (result.affectedRows === 1) entry.inserted += 1;
  else if (result.affectedRows === 2) entry.updated += 1;
  else entry.unchanged += 1;
};

const skip = (table, reason, detail) => {
  tableStats(table).skipped += 1;
  const key = `${table}: ${reason}`;
  if (!skips.has(key)) skips.set(key, []);
  skips.get(key).push(detail);
};

const warn = (message) => {
  warnings.push(message);
};

// ─── SQL helpers ────────────────────────────────────────────────────────────

const upsert = async (connection, table, row, updateColumns) => {
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]);
  const sql = updateColumns.length
    ? `INSERT INTO ${q(table)} (${columns.map(q).join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")}) ON DUPLICATE KEY UPDATE ${updateColumns
        .map((column) => `${q(column)} = VALUES(${q(column)})`)
        .join(", ")}`
    : `INSERT IGNORE INTO ${q(table)} (${columns.map(q).join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`;
  const [result] = await connection.execute(sql, values);
  return result;
};

const insertIgnore = async (connection, table, row) => {
  const columns = Object.keys(row);
  const sql = `INSERT IGNORE INTO ${q(table)} (${columns.map(q).join(", ")}) VALUES (${columns
    .map(() => "?")
    .join(", ")})`;
  const [result] = await connection.execute(
    sql,
    columns.map((column) => row[column]),
  );
  return result;
};

const tableSet = async (connection) => {
  const [rows] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  return new Set(rows.map((row) => row.name));
};

const columnCache = new Map();
const columnsOf = async (connection, table) => {
  const cacheKey = `${connection.__name}:${table}`;
  if (columnCache.has(cacheKey)) return columnCache.get(cacheKey);
  const [rows] = await connection.query(
    `SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
  const result = new Set(rows.map((row) => row.name));
  columnCache.set(cacheKey, result);
  return result;
};

// ─── Main ───────────────────────────────────────────────────────────────────

let source;
let target;
let inTransaction = false;

const main = async () => {
  console.log(
    `Source: ${redactDsn(sourceDsn)}${process.env.MTTX_DATABASE_SSL === "1" ? " (TLS)" : ""}`,
  );
  console.log(
    `Target: ${redactDsn(targetDsn)}${process.env.TARGET_DATABASE_SSL === "1" ? " (TLS)" : ""}`,
  );
  console.log(dryRun ? "Mode: dry run (all writes rolled back)" : "Mode: real migration");

  source = await mysql.createConnection(
    connectionConfig(sourceDsn, process.env.MTTX_DATABASE_SSL === "1"),
  );
  source.__name = "source";
  target = await mysql.createConnection(
    connectionConfig(targetDsn, process.env.TARGET_DATABASE_SSL === "1"),
  );
  target.__name = "target";

  const sourceTables = await tableSet(source);
  const targetTables = await tableSet(target);

  for (const table of SOURCE_TABLES) {
    if (!sourceTables.has(table)) {
      throw new Error(`Legacy table "${table}" is missing. Is this a current mttx database?`);
    }
  }
  for (const table of TARGET_TABLES) {
    if (!targetTables.has(table)) {
      throw new Error(`Target table "${table}" is missing. Run "pnpm db:migrate" first.`);
    }
  }

  if (process.env.MTTX_SECRET && Buffer.byteLength(process.env.MTTX_SECRET, "utf8") !== 32) {
    warn("MTTX_SECRET is not 32 bytes; legacy APNs keys cannot be re-sealed with it.");
  }

  await target.beginTransaction();
  inTransaction = true;

  // ── organisations ────────────────────────────────────────────────────────
  const tenantColumns = await columnsOf(source, "tenant");
  const accountColumns = await columnsOf(source, "account");
  const tenantSelect = (column) =>
    tenantColumns.has(column) ? `\`${column}\`` : `NULL AS \`${column}\``;
  const accountSelect = (column) =>
    accountColumns.has(column) ? `\`${column}\`` : `NULL AS \`${column}\``;

  const [tenants] = await source.query(
    `SELECT id, name, ${tenantSelect("email")}, ${tenantSelect("created")},
            ${tenantSelect("modified")}, ${tenantSelect("stripe_customer_id")},
            ${tenantSelect("android_enterprise_id")}, ${tenantSelect("enroll_id")},
            ${tenantSelect("enroll_code")}, ${tenantSelect("enroll_max_devices")},
            ${tenantSelect("enroll_enabled_apple")}, ${tenantSelect("enroll_enabled_windows")},
            ${tenantSelect("enroll_enabled_android")}, ${tenantSelect("enroll_enabled_asset_tag")}
       FROM tenant`,
  );

  const [accounts] = await source.query(
    `SELECT id, name, email, ${accountSelect("created")}, ${accountSelect("modified")},
            ${accountSelect("disabled")}, ${accountSelect("verified")}
       FROM account`,
  );

  const [existingOrgRows] = await target.query("SELECT id, slug FROM organization");
  const usedSlugs = new Map(existingOrgRows.map((row) => [row.slug, row.id]));
  const orgIds = new Set();

  const [existingUsers] = await target.query("SELECT id, email FROM user");
  const userByEmail = new Map(existingUsers.map((row) => [row.email.toLowerCase(), row.id]));
  const userIds = new Set();

  const [passwordCountRows] = await source.query(
    accountColumns.has("password")
      ? "SELECT COUNT(*) AS count FROM account WHERE password IS NOT NULL"
      : "SELECT 0 AS count",
  );
  const legacyPasswordUsers = Number(passwordCountRows[0]?.count ?? 0);
  const hasVerifiedColumn = accountColumns.has("verified");
  const hasDisabledColumn = accountColumns.has("disabled");
  if (!hasVerifiedColumn) {
    warn("legacy account.verified is missing; assuming every account is verified");
  }
  if (!hasDisabledColumn) {
    warn("legacy account.disabled is missing; assuming every account is enabled");
  }

  // ── users + auth identities ──────────────────────────────────────────────
  for (const account of accounts) {
    const id = String(account.id);
    const email = String(account.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) {
      skip("user", "missing email", id);
      continue;
    }

    const conflictingUser = userByEmail.get(email);
    if (conflictingUser && conflictingUser !== id) {
      skip("user", "email already belongs to another target user", `${id} <${email}>`);
      continue;
    }

    const createdAt = account.created ?? account.modified ?? sqlNow();
    const updatedAt = account.modified ?? createdAt;
    const emailVerified = hasVerifiedColumn ? boolOrFalse(account.verified) : true;

    const result = await upsert(
      target,
      "user",
      {
        id,
        name: String(account.name ?? email),
        email,
        email_verified: emailVerified,
        image: null,
        stripe_customer_id: null,
        disabled: hasDisabledColumn ? boolOrFalse(account.disabled) : false,
        auth_revision: randomId(),
        created_at: createdAt,
        updated_at: updatedAt,
      },
      ["name", "email", "email_verified", "disabled", "updated_at"],
    );
    recordResult("user", result);
    userIds.add(id);
    userByEmail.set(email, id);

    // Email identifier. Unverified legacy accounts get a NULL verified_at,
    // which means Yielded Auth will not accept them for email-code sign-in
    // until the address is verified again.
    const [identifierConflict] = await target.query(
      "SELECT subject_id FROM auth_identifiers WHERE namespace = 'email' AND value = ? LIMIT 1",
      [email],
    );
    if (identifierConflict && identifierConflict.subject_id !== id) {
      skip("auth_identifiers", "email identifier already owned by another user", email);
    } else {
      const verifiedAt = emailVerified ? sqlDateToMillis(createdAt) : null;
      const identifierResult = await insertIgnore(target, "auth_identifiers", {
        namespace: "email",
        value: email,
        module_id: null,
        credential_id: null,
        subject_id: id,
        revision: randomId(),
        verified_at: verifiedAt,
        active: true,
      });
      recordResult("auth_identifiers", identifierResult);
    }

    // Email credential so passwordless sign-in has an authority vector entry.
    // No auth_passwords row is written: legacy Argon2 hashes are not
    // compatible with Yielded Auth's verifier contract.
    const credentialId = stableId("mttx-email-credential", id);
    const credentialResult = await insertIgnore(target, "auth_credentials", {
      credential_id: credentialId,
      subject_id: id,
      revision: randomId(),
      active: true,
    });
    recordResult("auth_credentials", credentialResult);
    const [credentialRows] = await target.query(
      "SELECT revision FROM auth_credentials WHERE credential_id = ? LIMIT 1",
      [credentialId],
    );
    const credentialRevision = credentialRows[0]?.revision ?? randomId();
    const emailCredentialResult = await insertIgnore(target, "auth_emailCredentials", {
      module_id: EMAIL_MODULE_ID,
      subject_id: id,
      credential_id: credentialId,
      identifier_namespace: "email",
      identifier_value: email,
      credential_revision: credentialRevision,
      active: true,
    });
    recordResult("auth_emailCredentials", emailCredentialResult);
  }

  const accountsWithoutTenant = new Set(userIds);
  for (const tenant of tenants) accountsWithoutTenant.delete(String(tenant.id));
  for (const id of accountsWithoutTenant) {
    warn(`account ${id} has no tenant; user migrated without an organisation`);
  }

  // ── organisations + owner memberships + enrollment ───────────────────────
  const [existingEnrollments] = await target.query(
    "SELECT id, organization_id FROM enterprise_enrollment",
  );
  const enrollmentByOrg = new Map(existingEnrollments.map((row) => [row.organization_id, row.id]));

  for (const tenant of tenants) {
    const id = String(tenant.id);
    const createdAt = tenant.created ?? tenant.modified ?? sqlNow();
    const updatedAt = tenant.modified ?? createdAt;

    let slug = null;
    const [existingOrg] = await target.query("SELECT slug FROM organization WHERE id = ? LIMIT 1", [
      id,
    ]);
    if (existingOrg) {
      slug = existingOrg.slug;
    } else {
      const base = slugify(tenant.name, `tenant-${id.slice(0, 6)}`);
      slug = base;
      let attempt = 1;
      while (usedSlugs.has(slug) && usedSlugs.get(slug) !== id) {
        slug = `${base.slice(0, 55)}-${id.slice(0, 6)}${attempt > 1 ? `-${attempt}` : ""}`;
        attempt += 1;
      }
    }

    const metadata = {};
    if (tenant.email) metadata.mttxContactEmail = String(tenant.email);
    if (tenant.android_enterprise_id) {
      metadata.mttxAndroidEnterpriseId = String(tenant.android_enterprise_id);
    }

    const result = await upsert(
      target,
      "organization",
      {
        id,
        name: String(tenant.name ?? `Tenant ${id}`),
        slug,
        logo: null,
        metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
        stripe_customer_id: asText(tenant.stripe_customer_id),
        created_at: createdAt,
        updated_at: updatedAt,
      },
      ["name", "metadata", "stripe_customer_id", "updated_at"],
    );
    recordResult("organization", result);
    usedSlugs.set(slug, id);
    orgIds.add(id);

    if (userIds.has(id)) {
      const membershipResult = await upsert(
        target,
        "member",
        {
          id: stableId("mttx-owner", id),
          organization_id: id,
          user_id: id,
          role: "owner",
          created_at: createdAt,
          updated_at: updatedAt,
        },
        [],
      );
      recordResult("member", membershipResult);
    } else {
      skip("member", "tenant has no matching account", id);
    }

    const desiredEnrollmentId = tenant.enroll_id ? String(tenant.enroll_id) : id;
    const existingEnrollmentId = enrollmentByOrg.get(id);
    if (existingEnrollmentId && existingEnrollmentId !== desiredEnrollmentId) {
      skip(
        "enterprise_enrollment",
        "organisation already has an enrollment with a different id",
        `${id}: keeping ${existingEnrollmentId}, legacy ${desiredEnrollmentId}`,
      );
    } else {
      const enrollmentResult = await upsert(
        target,
        "enterprise_enrollment",
        {
          id: desiredEnrollmentId,
          organization_id: id,
          code: asText(tenant.enroll_code),
          enabled_apple:
            tenant.enroll_enabled_apple == null ? true : boolOrFalse(tenant.enroll_enabled_apple),
          enabled_windows:
            tenant.enroll_enabled_windows == null
              ? true
              : boolOrFalse(tenant.enroll_enabled_windows),
          enabled_android:
            tenant.enroll_enabled_android == null
              ? false
              : boolOrFalse(tenant.enroll_enabled_android),
          enabled_asset_tag:
            tenant.enroll_enabled_asset_tag == null
              ? false
              : boolOrFalse(tenant.enroll_enabled_asset_tag),
          max_devices: tenant.enroll_max_devices == null ? 100 : Number(tenant.enroll_max_devices),
          created_at: createdAt,
          updated_at: updatedAt,
        },
        [
          "code",
          "enabled_apple",
          "enabled_windows",
          "enabled_android",
          "enabled_asset_tag",
          "max_devices",
          "updated_at",
        ],
      );
      recordResult("enterprise_enrollment", enrollmentResult);
      enrollmentByOrg.set(id, desiredEnrollmentId);
    }
  }

  // ── devices + Apple extensions ───────────────────────────────────────────
  const deviceColumns = await columnsOf(source, "device");
  const hasDeviceApple = sourceTables.has("device_apple");
  const appleColumns = hasDeviceApple ? await columnsOf(source, "device_apple") : new Set();

  const deviceColumn = (column) => (deviceColumns.has(column) ? `d.\`${column}\`` : "NULL");
  const appleColumn = (column) => (appleColumns.has(column) ? `da.\`${column}\`` : "NULL");

  const deviceCreated = deviceColumns.has("created")
    ? "d.`created`"
    : deviceColumns.has("enrolled")
      ? "d.`enrolled`"
      : "d.`last_seen`";

  const [devices] = await source.query(
    `SELECT d.id, d.proto, d.status, d.tenant AS organization_id, d.name, d.model,
            d.serial, ${deviceCreated} AS created, ${deviceColumn("last_seen")} AS last_seen,
            ${deviceColumn("notes")} AS notes,
            ${deviceColumn("asset_tag")}, ${deviceColumn("physical_name")},
            ${deviceColumn("vendor")}, ${deviceColumn("os_edition")},
            ${deviceColumn("os_version")}, ${deviceColumn("os_build")},
            ${deviceColumn("disk_total")}, ${deviceColumn("disk_used")},
            ${appleColumn("udid")}, ${appleColumn("cert_hash")},
            ${appleColumn("model_identifier")}, ${appleColumn("enrollment_id")},
            ${appleColumn("topic")}, ${appleColumn("token")}, ${appleColumn("push_magic")},
            ${appleColumn("unlock_token")}, ${appleColumn("bootstrap_token")},
            ${appleColumn("configured")}, ${appleColumn("device_token")},
            ${appleColumn("token_updated")}, ${appleColumn("authenticated")}
       FROM device d
       ${hasDeviceApple ? "LEFT JOIN device_apple da ON da.id = d.id" : ""}`,
  );

  const deviceIds = new Set();

  for (const device of devices) {
    const id = String(device.id);
    const organizationId = String(device.organization_id);
    if (!orgIds.has(organizationId)) {
      skip("device", "organisation was not migrated", `${id} -> ${organizationId}`);
      continue;
    }

    const serial = asText(device.serial);
    if (serial) {
      const [serialConflict] = await target.query(
        "SELECT id FROM device WHERE serial = ? AND id <> ? LIMIT 1",
        [serial, id],
      );
      if (serialConflict) {
        skip("device", "serial already belongs to another device", `${id}: ${serial}`);
        continue;
      }
    }

    const result = await upsert(
      target,
      "device",
      {
        id,
        organization_id: organizationId,
        proto: String(device.proto),
        status: String(device.status ?? "enrolling"),
        name: String(device.name ?? id),
        model: asText(device.model),
        model_identifier: asText(device.model_identifier),
        serial,
        enrolled_at: device.created ?? device.last_seen ?? sqlNow(),
        last_seen_at: device.last_seen ?? device.created ?? sqlNow(),
        notes: asText(device.notes),
        asset_tag: asText(device.asset_tag),
        physical_name: asText(device.physical_name),
        vendor: asText(device.vendor),
        os_edition: asText(device.os_edition),
        os_version: asText(device.os_version),
        os_build: asText(device.os_build),
        disk_total: asText(device.disk_total),
        disk_used: asText(device.disk_used),
        dm_identifier: asText(device.udid),
        dm_cert_hash: hexOrNull(device.cert_hash),
        ddm_declarations_token: null,
      },
      [
        "organization_id",
        "proto",
        "status",
        "name",
        "model",
        "model_identifier",
        "serial",
        "enrolled_at",
        "last_seen_at",
        "notes",
        "asset_tag",
        "physical_name",
        "vendor",
        "os_edition",
        "os_version",
        "os_build",
        "disk_total",
        "disk_used",
        "dm_identifier",
        "dm_cert_hash",
      ],
    );
    recordResult("device", result);
    deviceIds.add(id);

    if (String(device.proto) !== "apple") continue;

    const deviceToken =
      asText(device.device_token) ?? stableId("mttx-device-token", id).slice(0, 42);
    const appleResult = await upsert(
      target,
      "device_apple",
      {
        device_id: id,
        enrollment_id: asText(device.enrollment_id),
        token: hexOrNull(device.token),
        push_magic: asText(device.push_magic),
        topic: asText(device.topic),
        unlock_token: base64OrNull(device.unlock_token),
        bootstrap_token: base64OrNull(device.bootstrap_token),
        configured: boolOrFalse(device.configured),
        device_token: deviceToken,
        token_updated_at: device.token_updated ?? device.authenticated ?? null,
      },
      [
        "enrollment_id",
        "token",
        "push_magic",
        "topic",
        "unlock_token",
        "bootstrap_token",
        "configured",
        "device_token",
        "token_updated_at",
      ],
    );
    recordResult("device_apple", appleResult);
  }

  // ── Apple user channels ──────────────────────────────────────────────────
  if (sourceTables.has("device_user")) {
    const [deviceUsers] = await source.query(
      `SELECT id, device, topic, token, push_magic, enabled, authenticated, token_updated
         FROM device_user`,
    );
    for (const user of deviceUsers) {
      const deviceId = String(user.device);
      const userId = String(user.id);
      if (!deviceIds.has(deviceId)) {
        skip("device_apple_user", "device was not migrated", `${deviceId}/${userId}`);
        continue;
      }
      if (user.enabled != null && !boolOrFalse(user.enabled)) {
        skip("device_apple_user", "user channel is disabled", `${deviceId}/${userId}`);
        continue;
      }
      const result = await upsert(
        target,
        "device_apple_user",
        {
          device_id: deviceId,
          user_id: userId,
          token: hexOrNull(user.token),
          push_magic: asText(user.push_magic),
          topic: asText(user.topic),
          unlock_token: null,
          updated_at: user.token_updated ?? user.authenticated ?? sqlNow(),
        },
        ["token", "push_magic", "topic", "updated_at"],
      );
      recordResult("device_apple_user", result);
    }
  }

  // ── groups ───────────────────────────────────────────────────────────────
  const [groups] = await source.query(
    "SELECT id, name, notes, tenant, created, modified FROM `group`",
  );
  const groupIds = new Set();
  for (const group of groups) {
    const id = String(group.id);
    const organizationId = String(group.tenant);
    if (!orgIds.has(organizationId)) {
      skip("enterprise_group", "organisation was not migrated", `${id} -> ${organizationId}`);
      continue;
    }
    const result = await upsert(
      target,
      "enterprise_group",
      {
        id,
        organization_id: organizationId,
        name: String(group.name ?? id),
        notes: asText(group.notes),
        created_at: group.created ?? group.modified ?? sqlNow(),
        updated_at: group.modified ?? group.created ?? sqlNow(),
      },
      ["organization_id", "name", "notes", "updated_at"],
    );
    recordResult("enterprise_group", result);
    groupIds.add(id);
  }

  const [groupDevices] = await source.query("SELECT `group`, device FROM group_device");
  for (const link of groupDevices) {
    const groupId = String(link.group);
    const deviceId = String(link.device);
    if (!groupIds.has(groupId) || !deviceIds.has(deviceId)) {
      skip("group_device", "group or device was not migrated", `${groupId}/${deviceId}`);
      continue;
    }
    const result = await insertIgnore(target, "group_device", {
      group_id: groupId,
      device_id: deviceId,
    });
    recordResult("group_device", result);
  }

  // ── policies + configurations ────────────────────────────────────────────
  const [policies] = await source.query(
    "SELECT id, name, notes, tenant, created, modified FROM policy",
  );
  const policyIds = new Set();
  for (const policy of policies) {
    const id = String(policy.id);
    const organizationId = String(policy.tenant);
    if (!orgIds.has(organizationId)) {
      skip("policy", "organisation was not migrated", `${id} -> ${organizationId}`);
      continue;
    }
    const result = await upsert(
      target,
      "policy",
      {
        id,
        organization_id: organizationId,
        name: String(policy.name ?? id),
        notes: asText(policy.notes),
        created_at: policy.created ?? policy.modified ?? sqlNow(),
        updated_at: policy.modified ?? policy.created ?? sqlNow(),
      },
      ["organization_id", "name", "notes", "updated_at"],
    );
    recordResult("policy", result);
    policyIds.add(id);
  }

  const [configurations] = await source.query(
    "SELECT `kind`, policy, data, hash FROM configuration",
  );
  for (const configuration of configurations) {
    const policyId = String(configuration.policy);
    const kind = String(configuration.kind);
    if (!policyIds.has(policyId)) {
      skip("configuration", "policy was not migrated", `${kind} -> ${policyId}`);
      continue;
    }
    let data;
    try {
      data = parseJson(configuration.data);
    } catch {
      skip("configuration", "data is not valid JSON", `${kind} -> ${policyId}`);
      continue;
    }
    if (!KNOWN_KIND.test(kind)) {
      warn(`unknown configuration kind "${kind}" on policy ${policyId}; copied unchanged`);
    }
    const serialized = JSON.stringify(data);
    const result = await upsert(
      target,
      "configuration",
      {
        kind,
        policy_id: policyId,
        data: serialized,
        // The legacy Rust hash is not the new SHA-256(JSON.stringify(data))
        // definition; recompute it so DDM server tokens are consistent.
        hash: sha256hex(serialized),
      },
      ["data", "hash"],
    );
    recordResult("configuration", result);
  }

  const [groupPolicies] = await source.query("SELECT `group`, policy FROM group_policy");
  for (const link of groupPolicies) {
    const groupId = String(link.group);
    const policyId = String(link.policy);
    if (!groupIds.has(groupId) || !policyIds.has(policyId)) {
      skip("group_policy", "group or policy was not migrated", `${groupId}/${policyId}`);
      continue;
    }
    const result = await insertIgnore(target, "group_policy", {
      group_id: groupId,
      policy_id: policyId,
    });
    recordResult("group_policy", result);
  }

  // ── platform instances ───────────────────────────────────────────────────
  if (!has("--skip-instances") && sourceTables.has("instance")) {
    const [instances] = await source.query(
      `SELECT id, \`key\`, description, issued_by, user_count, device_count,
              created, revoked, last_seen
         FROM instance`,
    );
    for (const instance of instances) {
      const id = String(instance.id);
      const issuedBy = asText(instance.issued_by);
      if (!issuedBy || !userIds.has(issuedBy)) {
        skip("platform_instance", "issuer user was not migrated", id);
        continue;
      }
      const key = String(instance.key ?? "");
      if (!key) {
        skip("platform_instance", "instance key is empty", id);
        continue;
      }
      const keyHash = sha256hex(key);
      const [keyConflict] = await target.query(
        "SELECT id FROM platform_instance WHERE key_hash = ? AND id <> ? LIMIT 1",
        [keyHash, id],
      );
      if (keyConflict) {
        skip("platform_instance", "key hash already belongs to another instance", id);
        continue;
      }
      const result = await upsert(
        target,
        "platform_instance",
        {
          id,
          key_prefix: key.slice(0, 13),
          key_hash: keyHash,
          description: asText(instance.description),
          issued_by_user_id: issuedBy,
          user_count: Number(instance.user_count ?? 0),
          device_count: Number(instance.device_count ?? 0),
          created_at: instance.created ?? sqlNow(),
          updated_at: instance.created ?? sqlNow(),
          last_seen_at: instance.last_seen ?? null,
          revoked_at: instance.revoked ?? null,
        },
        [
          "key_prefix",
          "key_hash",
          "description",
          "issued_by_user_id",
          "user_count",
          "device_count",
          "last_seen_at",
          "revoked_at",
        ],
      );
      recordResult("platform_instance", result);
    }
  }

  // ── APNs certificates (operator decision) ────────────────────────────────
  const hasLegacyApns = sourceTables.has("apple_push_certs");
  if (hasLegacyApns) {
    const [apnsRows] = await source.query(
      `SELECT t.id AS organization_id, t.apns_topic AS tenant_topic,
              apc.topic AS certificate_topic, apc.cert, apc.\`key\`, apc.email,
              apc.updated_at
         FROM tenant t
         INNER JOIN apple_push_certs apc ON apc.topic = t.apns_topic`,
    );

    if (apnsRows.length && !has("--resell-apns")) {
      warn(
        `${apnsRows.length} APNs certificate(s) were NOT migrated. Re-upload them in the UI, ` +
          "or rerun with --resell-apns, MTTX_SECRET and AUTH_SECRET to re-seal the legacy keys.",
      );
      for (const row of apnsRows.slice(0, 5)) {
        warn(`  APNs topic ${row.certificate_topic} for organisation ${row.organization_id}`);
      }
    } else if (apnsRows.length) {
      const legacySecret = process.env.MTTX_SECRET;
      const authSecret = process.env.AUTH_SECRET;
      if (!legacySecret || !authSecret) {
        throw new Error("--resell-apns requires both MTTX_SECRET and AUTH_SECRET");
      }
      for (const row of apnsRows) {
        const organizationId = String(row.organization_id);
        if (!orgIds.has(organizationId)) {
          skip("apple_push_certificate", "organisation was not migrated", organizationId);
          continue;
        }
        try {
          const der = unsealLegacyApnsKey(legacySecret, row.key);
          const jwk = crypto
            .createPrivateKey({ key: der, format: "der", type: "pkcs8" })
            .export({ format: "jwk" });
          const encryptedKey = sealWithAuthSecret(authSecret, JSON.stringify(jwk));
          const result = await upsert(
            target,
            "apple_push_certificate",
            {
              organization_id: organizationId,
              email: String(row.email ?? ""),
              topic: String(row.certificate_topic),
              cert_pem: pemEncode("CERTIFICATE", row.cert),
              encrypted_key: encryptedKey,
              updated_at: row.updated_at ?? sqlNow(),
            },
            ["email", "topic", "cert_pem", "encrypted_key", "updated_at"],
          );
          recordResult("apple_push_certificate", result);
        } catch (cause) {
          skip(
            "apple_push_certificate",
            "could not decrypt/re-seal legacy key",
            `${organizationId}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
    }
  } else {
    warn("legacy table apple_push_certs is missing; no APNs certificates were migrated");
  }

  // ── SCEP CA (operator decision) ──────────────────────────────────────────
  if (sourceTables.has("ca")) {
    if (has("--import-scep-ca")) {
      const [caRows] = await source.query(
        "SELECT id, cert, `key`, not_before, not_after FROM ca ORDER BY not_before DESC LIMIT 1",
      );
      if (caRows.length) {
        const ca = caRows[0];
        try {
          const jwk = crypto
            .createPrivateKey({ key: Buffer.from(ca.key), format: "der", type: "pkcs8" })
            .export({ format: "jwk" });
          const result = await upsert(
            target,
            "scep_ca",
            {
              id: 1,
              cert_pem: pemEncode("CERTIFICATE", ca.cert),
              private_key_jwk: JSON.stringify(jwk),
              created_at: ca.not_before ?? sqlNow(),
            },
            ["cert_pem", "private_key_jwk"],
          );
          recordResult("scep_ca", result);
          warn(
            "Imported the legacy SCEP CA. scep_issued_certificate has no legacy history, so " +
              "renewals for old certificates will fail until devices re-enroll or serials are backfilled.",
          );
        } catch (cause) {
          skip(
            "scep_ca",
            "could not convert legacy CA key",
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      }
    } else {
      warn(
        "SCEP CA was NOT migrated. The new server will generate a fresh CA; existing devices " +
          "must re-enroll. Use --import-scep-ca only if device continuity is mandatory.",
      );
    }
  }

  // ── validation ───────────────────────────────────────────────────────────
  const count = async (connection, table) => {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${q(table)}`);
    return Number(rows[0]?.count ?? 0);
  };

  console.log("\nMigrated row counts (target):");
  for (const table of [
    "user",
    "organization",
    "member",
    "enterprise_enrollment",
    "device",
    "device_apple",
    "device_apple_user",
    "enterprise_group",
    "policy",
    "configuration",
    "group_device",
    "group_policy",
    "platform_instance",
    "apple_push_certificate",
    "scep_ca",
  ]) {
    if (!targetTables.has(table)) continue;
    console.log(`  ${table.padEnd(24)} ${await count(target, table)}`);
  }

  const [sourceDeviceCounts] = await source.query(
    "SELECT tenant AS organization_id, COUNT(*) AS count FROM device GROUP BY tenant",
  );
  const [targetDeviceCounts] = await target.query(
    "SELECT organization_id, COUNT(*) AS count FROM device GROUP BY organization_id",
  );
  const targetByOrg = new Map(
    targetDeviceCounts.map((row) => [String(row.organization_id), Number(row.count)]),
  );
  for (const row of sourceDeviceCounts) {
    const organizationId = String(row.organization_id);
    if (!orgIds.has(organizationId)) continue;
    const expected = Number(row.count);
    const actual = targetByOrg.get(organizationId) ?? 0;
    if (expected !== actual) {
      warn(`device count mismatch for ${organizationId}: legacy ${expected}, target ${actual}`);
    }
  }

  const skipEntries = [...skips.entries()];
  if (skipEntries.length) {
    console.log("\nSkipped rows:");
    for (const [reason, details] of skipEntries) {
      console.log(`  ${reason}: ${details.length}`);
      for (const detail of details.slice(0, verbose ? details.length : 20)) {
        console.log(`    - ${detail}`);
      }
      if (!verbose && details.length > 20) {
        console.log(`    ... ${details.length - 20} more (use --verbose)`);
      }
    }
  }

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }

  console.log("\nPer-table operation counts:");
  for (const [table, entry] of stats.entries()) {
    console.log(
      `  ${table.padEnd(24)} inserted=${entry.inserted} updated=${entry.updated} ` +
        `unchanged=${entry.unchanged} skipped=${entry.skipped}`,
    );
  }

  console.log(
    `\n${legacyPasswordUsers} legacy account(s) had a password hash. No auth_passwords rows ` +
      "were written; those users must reset their password or use email-code sign-in.",
  );

  if (dryRun) {
    await target.rollback();
    inTransaction = false;
    console.log("\nDry run complete. Every change was rolled back.");
  } else {
    await target.commit();
    inTransaction = false;
    console.log("\nMigration committed.");
  }
};

const run = async () => {
  try {
    await main();
  } catch (cause) {
    console.error("\nMigration failed:", cause instanceof Error ? cause.message : cause);
    if (target && inTransaction) {
      try {
        await target.rollback();
        inTransaction = false;
        console.error("Target transaction rolled back.");
      } catch {
        // Connection may already be gone; nothing more to do.
      }
    }
    process.exitCode = 1;
  } finally {
    if (source) await source.end().catch(() => {});
    if (target && !target.__ended) {
      target.__ended = true;
      await target.end().catch(() => {});
    }
  }
};

await run();
