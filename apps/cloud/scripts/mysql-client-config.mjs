#!/usr/bin/env node
/**
 * Write a MySQL option file from a `mysql://` connection URL.
 *
 * `DATABASE_URL` and friends are URLs, but `mysqldump` and `mysql` only read
 * option files or flags. Passing the password as a flag would expose it in the
 * process list, so it goes into a 0600 file instead. The URL is read from
 * `MYSQL_URL` rather than `argv` for the same reason.
 *
 * The database name is printed on stdout so callers do not have to parse the
 * URL twice.
 *
 * Usage: MYSQL_URL=mysql://user:pass@host:3306/db node scripts/mysql-client-config.mjs <out.cnf>
 */
import { writeFileSync } from "node:fs";

const url = process.env.MYSQL_URL?.trim();

const out = process.argv[2];

if (!url) throw new Error("MYSQL_URL is not set");

if (!out) {
  throw new Error("usage: MYSQL_URL=mysql://... node scripts/mysql-client-config.mjs <out.cnf>");
}

const parsed = new URL(url);

if (parsed.protocol !== "mysql:") {
  throw new Error(`MYSQL_URL must be a mysql:// URL, got "${parsed.protocol}//"`);
}

// Option files treat an unquoted `#` or `;` as the start of a comment and strip
// leading and trailing whitespace, so every value is quoted with backslashes
// and quotes escaped.
const quote = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

// drizzle.config.ts accepts the same three spellings; drizzle-kit has to
// translate MySQL's `ssl-mode` because mysql2 rejects it, but the CLI takes it
// directly.
const sslMode = parsed.searchParams.get("ssl-mode") ?? parsed.searchParams.get("ssl_mode");

const lines = [
  "# Written by apps/cloud/scripts/mysql-client-config.mjs. Contains a credential: never commit.",
  "[client]",
  `host=${quote(parsed.hostname)}`,
  `port=${parsed.port || "3306"}`,
  `user=${quote(decodeURIComponent(parsed.username))}`,
  `password=${quote(decodeURIComponent(parsed.password))}`,
  // REQUIRED means "encrypt, do not verify the chain", which is what our
  // server certificate supports; VERIFY_* needs the server's CA.
  ...(sslMode ? [`ssl-mode=${sslMode.toUpperCase()}`] : []),
];

writeFileSync(out, `${lines.join("\n")}\n`, { mode: 0o600 });

process.stdout.write(decodeURIComponent(parsed.pathname.replace(/^\/+/, "")));
