#!/usr/bin/env node
/**
 * Dashboard API latency benchmark.
 *
 * Seeds a disposable tenant, then times the API endpoints the dashboard loads
 * against a running local API (`pnpm cloud dev`). Pair it with
 * `db-latency-proxy.ts` to model production database latency:
 *
 *   tsx apps/cloud/scripts/db-latency-proxy.ts --latency 40 &
 *   MATTRAX_DEV_DATABASE_URL=mysql://mattrax:mattrax@127.0.0.1:3307/mattraxe pnpm cloud dev
 *   tsx apps/cloud/scripts/api-bench.ts --runs 5 --out bench/after-40ms.json
 *
 * It reports the median wall time and the number of MySQL commands each
 * endpoint issues (counted by the proxy, so auth middleware, tenant
 * resolution, handler queries and background writes are all included).
 * Without the proxy it falls back to `SHOW GLOBAL STATUS LIKE 'Questions'`,
 * which is only accurate when nothing else is using the database.
 */
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);

const flag = (name: string): boolean => args.includes(`--${name}`);

const stringArg = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);

  if (index === -1) return fallback;

  return args[index + 1] ?? fallback;
};

const numberArg = (name: string, fallback: number): number => {
  const index = args.indexOf(`--${name}`);

  if (index === -1) return fallback;

  const value = Number(args[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const baseUrl = stringArg("base-url", "http://localhost:9050").replace(/\/$/, "");
const controlUrl = stringArg("control-url", "http://127.0.0.1:3309");
const runs = numberArg("runs", 5);
const warmup = numberArg("warmup", 2);
const outFile = stringArg("out", "");
const label = stringArg("label", "bench");
const reseed = flag("reseed");
const cleanup = flag("cleanup");

const organizationId = "benchorg00000000000000001";
const organizationSlug = "api-bench";
const accountId = "benchaccount000000000001";
const accountEmail = "api-bench@example.com";
const token = "mattrax_bench_token_0123456789abcdef";
const tokenHash = createHash("sha256").update(token).digest("hex");
const deviceId = "bench-device-000000";

const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "mattrax",
  password: process.env.DATABASE_PASSWORD ?? "mattrax",
  database: process.env.DATABASE_NAME ?? "mattraxe",
  timezone: "Z",
  multipleStatements: true,
});

const now = new Date();
const iso = (offsetMs = 0) => new Date(now.getTime() + offsetMs);

const cleanupTenant = async () => {
  await connection.execute("DELETE FROM organization WHERE id = ?", [organizationId]);
  await connection.execute("DELETE FROM account WHERE id LIKE 'benchaccount%'");
};

const seed = async () => {
  await cleanupTenant();

  await connection.execute(
    `INSERT INTO account
       (id, name, email, email_verified, disabled, source, totp_enabled, passkey_enabled, auth_revision, created_at, updated_at)
     VALUES (?, ?, ?, 1, 0, 'manual', 0, 1, ?, ?, ?)`,
    [accountId, "API Bench", accountEmail, "bench-revision", iso(), iso()],
  );

  await connection.execute(
    `INSERT INTO organization
       (id, name, slug, require_mfa, scripts_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 0, 1, ?, ?)`,
    [organizationId, "API Bench", organizationSlug, iso(), iso()],
  );

  await connection.execute(
    `INSERT INTO member (id, organization_id, account_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', ?, ?)`,
    ["benchmember0000000000001", organizationId, accountId, iso(), iso()],
  );

  await connection.execute(
    `INSERT INTO account_api_token
       (id, account_id, name, token_prefix, token_hash, tenant_id, scopes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "benchtoken00000000000001",
      accountId,
      "bench",
      token.slice(0, 12),
      tokenHash,
      organizationId,
      JSON.stringify(["read", "write"]),
      iso(),
      iso(),
    ],
  );

  // A second member so the accounts list has more than one row.
  await connection.execute(
    `INSERT INTO tenant_role (id, organization_id, name, description, permissions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      "benchrole000000000000001",
      organizationId,
      "Helpdesk",
      "Bench custom role",
      JSON.stringify(["tenant.read", "devices.read"]),
      iso(),
      iso(),
    ],
  );

  for (let index = 0; index < 4; index += 1) {
    const id = `benchaccountmember${String(index).padStart(4, "0")}`;

    await connection.execute(
      `INSERT INTO account
         (id, name, email, email_verified, disabled, source, totp_enabled, passkey_enabled, auth_revision, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, 'manual', 0, 1, ?, ?, ?)`,
      [id, `Bench Member ${index}`, `bench-member-${index}@example.com`, "rev", iso(), iso()],
    );
    await connection.execute(
      `INSERT INTO member (id, organization_id, account_id, role, custom_role_id, created_at, updated_at)
       VALUES (?, ?, ?, 'viewer', ?, ?, ?)`,
      [
        `benchmember${String(index).padStart(4, "0")}x`,
        organizationId,
        id,
        index === 0 ? "benchrole000000000000001" : null,
        iso(),
        iso(),
      ],
    );
  }

  // Directories and groups.
  const userRows: unknown[] = [];

  for (let index = 0; index < 200; index += 1) {
    userRows.push([
      `benchuser${String(index).padStart(6, "0")}`,
      organizationId,
      `Directory User ${String(index).padStart(3, "0")}`,
      `directory-${index}@example.com`,
      "manual",
      0,
      iso(),
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO user (id, organization_id, name, email, source, disabled, created_at, updated_at)
     VALUES ${userRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`,
    userRows.flat(),
  );

  const groupRows: unknown[] = [];

  for (let index = 0; index < 8; index += 1) {
    groupRows.push([
      `benchugroup${String(index).padStart(5, "0")}`,
      organizationId,
      `Directory Group ${index}`,
      "manual",
      iso(),
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO user_group (id, organization_id, name, source, created_at, updated_at)
     VALUES ${groupRows.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
    groupRows.flat(),
  );

  const userGroupRows: unknown[] = [];

  for (let index = 0; index < 200; index += 1) {
    userGroupRows.push([
      `benchugroup${String(index % 8).padStart(5, "0")}`,
      `benchuser${String(index).padStart(6, "0")}`,
    ]);
  }

  await connection.query(
    `INSERT INTO user_group_member (group_id, user_id)
     VALUES ${userGroupRows.map(() => "(?, ?)").join(",")}`,
    userGroupRows.flat(),
  );

  // Devices: a mixed 500-device fleet with a realistic health spread.
  const deviceRows: unknown[] = [];

  for (let index = 0; index < 500; index += 1) {
    const proto = ["apple", "win", "android"][index % 3];
    const stale = index % 17 === 0;
    deviceRows.push([
      `bench-device-${String(index).padStart(6, "0")}`,
      organizationId,
      proto,
      index % 25 === 0 ? "unenrolled" : "enrolled",
      `Device ${String(index).padStart(4, "0")}`,
      proto === "apple" ? "MacBook Pro" : proto === "win" ? "Surface Laptop 5" : "Pixel 8",
      `BENCHSERIAL${String(index).padStart(6, "0")}`,
      iso(-(index % 365) * 86_400_000),
      stale ? iso(-45 * 86_400_000) : iso(-(index % 5) * 3_600_000),
      "14.2",
      proto === "win" ? "activated" : null,
      iso(-(index % 3) * 86_400_000),
    ]);
  }

  await connection.query(
    `INSERT INTO device
       (id, organization_id, proto, status, name, model, serial, enrolled_at, last_seen_at,
        os_version, windows_activation_status, applications_updated_at)
     VALUES ${deviceRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`,
    deviceRows.flat(),
  );

  const appleRows: unknown[] = [];

  for (let index = 0; index < 500; index += 3) {
    appleRows.push([
      `bench-device-${String(index).padStart(6, "0")}`,
      index % 30 === 0 ? 1 : 0,
      index % 30 === 0 ? 0 : 1,
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO device_apple (device_id, awaiting_configuration, configured, token_updated_at)
     VALUES ${appleRows.map(() => "(?, ?, ?, ?)").join(",")}`,
    appleRows.flat(),
  );

  const declarationRows: unknown[] = [];

  for (let index = 0; index < 500; index += 7) {
    declarationRows.push([
      `bench-device-${String(index).padStart(6, "0")}`,
      `bench-declaration-${index}`,
      "configuration",
      1,
      "valid",
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO device_declaration (device_id, identifier, declaration_type, active, valid, updated_at)
     VALUES ${declarationRows.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
    declarationRows.flat(),
  );

  const groupDeviceRows: unknown[] = [];
  const enterpriseGroupRows: unknown[] = [];

  for (let index = 0; index < 10; index += 1) {
    enterpriseGroupRows.push([
      `bench-group-${String(index).padStart(4, "0")}`,
      organizationId,
      `Bench Group ${index}`,
      "manual",
      null,
      iso(),
      iso(),
    ]);
  }

  for (let index = 0; index < 500; index += 1) {
    groupDeviceRows.push([
      `bench-group-${String(index % 10).padStart(4, "0")}`,
      `bench-device-${String(index).padStart(6, "0")}`,
      "manual",
    ]);
  }

  await connection.query(
    `INSERT INTO enterprise_group (id, organization_id, name, kind, rules, created_at, updated_at)
     VALUES ${enterpriseGroupRows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",")}`,
    enterpriseGroupRows.flat(),
  );

  await connection.query(
    `INSERT INTO group_device (group_id, device_id, source)
     VALUES ${groupDeviceRows.map(() => "(?, ?, ?)").join(",")}`,
    groupDeviceRows.flat(),
  );

  const policyRows: unknown[] = [];

  for (let index = 0; index < 8; index += 1) {
    policyRows.push([
      `bench-policy-${String(index).padStart(4, "0")}`,
      organizationId,
      `Bench Policy ${index}`,
      index,
      iso(),
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO policy (id, organization_id, name, priority, created_at, updated_at)
     VALUES ${policyRows.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
    policyRows.flat(),
  );

  const groupPolicyRows: unknown[] = [];

  for (let index = 0; index < 8; index += 1) {
    groupPolicyRows.push([
      `bench-group-${String(index).padStart(4, "0")}`,
      `bench-policy-${String(index).padStart(4, "0")}`,
      "include",
    ]);
  }

  await connection.query(
    `INSERT INTO group_policy (group_id, policy_id, mode)
     VALUES ${groupPolicyRows.map(() => "(?, ?, ?)").join(",")}`,
    groupPolicyRows.flat(),
  );

  const configurationRows: unknown[] = [];

  for (let index = 0; index < 8; index += 1) {
    for (const kind of ["settings", "restrictions"]) {
      configurationRows.push([
        kind,
        `bench-policy-${String(index).padStart(4, "0")}`,
        JSON.stringify({ bench: true }),
        `hash-${index}-${kind}`,
      ]);
    }
  }

  await connection.query(
    `INSERT INTO configuration (kind, policy_id, data, hash)
     VALUES ${configurationRows.map(() => "(?, ?, ?, ?)").join(",")}`,
    configurationRows.flat(),
  );

  const deploymentRows: unknown[] = [];

  for (let index = 0; index < 8; index += 1) {
    deploymentRows.push([
      `bench-deployment-${String(index).padStart(4, "0")}`,
      organizationId,
      `bench-policy-${String(index).padStart(4, "0")}`,
      1,
      JSON.stringify({ version: 1 }),
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO policy_deployment (id, organization_id, policy_id, version, snapshot, created_at)
     VALUES ${deploymentRows.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`,
    deploymentRows.flat(),
  );

  const devicePolicyRows: unknown[] = [];

  for (let index = 0; index < 40; index += 1) {
    devicePolicyRows.push([
      `bench-device-${String(index).padStart(6, "0")}`,
      `bench-policy-${String(index % 8).padStart(4, "0")}`,
      "include",
    ]);
  }

  await connection.query(
    `INSERT INTO device_policy (device_id, policy_id, mode)
     VALUES ${devicePolicyRows.map(() => "(?, ?, ?)").join(",")}`,
    devicePolicyRows.flat(),
  );

  const applicationRows: unknown[] = [];

  for (let index = 0; index < 12; index += 1) {
    applicationRows.push([
      `bench-app-${String(index).padStart(4, "0")}`,
      organizationId,
      `Bench App ${index}`,
      ["apple", "win", "android"][index % 3],
      `com.example.bench${index}`,
      "1.0.0",
      "manifest",
      iso(),
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO application
       (id, organization_id, name, platform, bundle_id, version, source, created_at, updated_at)
     VALUES ${applicationRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`,
    applicationRows.flat(),
  );

  const appGroupRows: unknown[] = [];

  for (let index = 0; index < 12; index += 1) {
    appGroupRows.push([
      `bench-group-${String(index % 10).padStart(4, "0")}`,
      `bench-app-${String(index).padStart(4, "0")}`,
    ]);
  }

  await connection.query(
    `INSERT INTO application_group (group_id, application_id)
     VALUES ${appGroupRows.map(() => "(?, ?)").join(",")}`,
    appGroupRows.flat(),
  );

  const appDeviceRows: unknown[] = [];

  for (let index = 0; index < 36; index += 1) {
    appDeviceRows.push([
      `bench-device-${String(index).padStart(6, "0")}`,
      `bench-app-${String(index % 12).padStart(4, "0")}`,
    ]);
  }

  await connection.query(
    `INSERT INTO application_device (device_id, application_id)
     VALUES ${appDeviceRows.map(() => "(?, ?)").join(",")}`,
    appDeviceRows.flat(),
  );

  const deviceApplicationRows: unknown[] = [];

  for (let index = 0; index < 500; index += 1) {
    for (let app = 0; app < 6; app += 1) {
      deviceApplicationRows.push([
        `bench-device-${String(index).padStart(6, "0")}`,
        organizationId,
        `com.example.installed${app}`,
        `Installed App ${app}`,
        "1.0.0",
        "1.0",
        "Bench",
        0,
        app === 0 ? 1 : 0,
        0,
        iso(-app * 3_600_000),
      ]);
    }
  }

  await connection.query(
    `INSERT INTO device_application
       (device_id, organization_id, bundle_id, name, version, short_version, publisher,
        has_update_available, is_managed, bundle_size, last_reported_at)
     VALUES ${deviceApplicationRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`,
    deviceApplicationRows.flat(),
  );

  const deviceUserRows: unknown[] = [];

  for (let index = 0; index < 40; index += 1) {
    deviceUserRows.push([
      organizationId,
      `bench-device-${String(index).padStart(6, "0")}`,
      `benchuser${String(index % 200).padStart(6, "0")}`,
      "manual",
      iso(),
    ]);
  }

  await connection.query(
    `INSERT INTO device_user (organization_id, device_id, user_id, source, created_at)
     VALUES ${deviceUserRows.map(() => "(?, ?, ?, ?, ?)").join(",")}`,
    deviceUserRows.flat(),
  );

  const auditRows: unknown[] = [];

  for (let index = 0; index < 60; index += 1) {
    auditRows.push([
      `bench-audit-${String(index).padStart(4, "0")}`,
      organizationId,
      accountId,
      accountEmail,
      "device.updated",
      "device",
      `bench-device-${String(index).padStart(6, "0")}`,
      iso(-index * 60_000),
    ]);
  }

  await connection.query(
    `INSERT INTO audit_log
       (id, organization_id, actor_account_id, actor_email, action, target_type, target_id, created_at)
     VALUES ${auditRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`,
    auditRows.flat(),
  );

  await connection.execute(
    `INSERT INTO device_secret
       (device_id, organization_id, kind, sealed_value, format, created_at, updated_at)
     VALUES (?, ?, 'filevault_recovery_key', 'sealed', 'cms', ?, ?)`,
    [deviceId, organizationId, iso(), iso()],
  );
};

/** Count queries without the proxy by reading the server's global counter. */
const globalQuestions = async (): Promise<number | undefined> => {
  try {
    const [rows] = await connection.query("SHOW GLOBAL STATUS LIKE 'Questions'");
    const row = (rows as Array<{ Value: string }>)[0];

    return row ? Number(row.Value) : undefined;
  } catch {
    return undefined;
  }
};

const proxy = async (
  path: string,
  method: "GET" | "POST" = "GET",
): Promise<{ queries?: number }> => {
  try {
    const response = await fetch(`${controlUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(1000),
    });

    if (!response.ok) return {};

    return (await response.json()) as { queries?: number };
  } catch {
    return {};
  }
};

type Scenario = {
  name: string;
  path: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Skip in the aggregate page model. */
  excludeFromPage?: boolean;
};

const tenant = `/api/v1/tenants/${organizationId}`;

const dashboardQuery = (body: unknown, name: string) => ({
  name,
  method: "POST" as const,
  path: `${tenant}/dashboard-query`,
  body,
});

const scenarios: Scenario[] = [
  { name: "GET /v1/tenants", path: "/api/v1/tenants" },
  { name: "GET /v1/tenants/:id", path: tenant },
  { name: "GET /v1/tenants/:id/security", path: `${tenant}/security` },
  { name: "GET /v1/tenants/:id/devices", path: `${tenant}/devices` },
  {
    name: "GET devices/search (page)",
    path: `${tenant}/devices/search?limit=50&sort=lastSeenAt&direction=desc`,
  },
  {
    name: "GET devices/search (text q)",
    path: `${tenant}/devices/search?limit=50&q=Device%200042`,
  },
  {
    name: "GET devices/search (health sort)",
    path: `${tenant}/devices/search?limit=50&sort=health&direction=asc`,
  },
  {
    name: "GET devices/search (structured query)",
    path: `${tenant}/devices/search?limit=50&query=${encodeURIComponent("health=attention")}`,
  },
  { name: "GET /devices/:id", path: `${tenant}/devices/${deviceId}` },
  { name: "GET /devices/:id/health", path: `${tenant}/devices/${deviceId}/health` },
  { name: "GET /devices/:id/activity", path: `${tenant}/devices/${deviceId}/activity` },
  { name: "GET /devices/:id/applications", path: `${tenant}/devices/${deviceId}/applications` },
  { name: "GET /devices/:id/users", path: `${tenant}/devices/${deviceId}/users` },
  { name: "GET /device-health", path: `${tenant}/device-health` },
  { name: "GET /v1/tenants/:id/policies", path: `${tenant}/policies` },
  { name: "GET /policies/:id", path: `${tenant}/policies/bench-policy-0000` },
  {
    name: "GET /policies/:id/assignments",
    path: `${tenant}/policies/bench-policy-0000/assignments`,
  },
  {
    name: "GET /policies/:id/deployments",
    path: `${tenant}/policies/bench-policy-0000/deployments`,
  },
  { name: "GET /v1/tenants/:id/groups", path: `${tenant}/groups` },
  { name: "GET /groups/:id", path: `${tenant}/groups/bench-group-0000` },
  { name: "GET /v1/tenants/:id/applications", path: `${tenant}/applications` },
  { name: "GET /applications/inventory", path: `${tenant}/applications/inventory?limit=50` },
  { name: "GET /applications/:id", path: `${tenant}/applications/bench-app-0000` },
  { name: "GET /v1/tenants/:id/accounts", path: `${tenant}/accounts` },
  { name: "GET /v1/tenants/:id/directory", path: `${tenant}/directory` },
  { name: "GET /v1/tenants/:id/dashboards", path: `${tenant}/dashboards` },
  { name: "GET /v1/tenants/:id/audit-log", path: `${tenant}/audit-log` },
  dashboardQuery(
    { dataset: "devices", query: { all: [] }, countOnly: true },
    "POST dashboard-query (count all)",
  ),
  dashboardQuery(
    {
      dataset: "devices",
      query: { all: [{ field: "health", op: "eq", value: "attention" }] },
      countOnly: true,
    },
    "POST dashboard-query (count attention)",
  ),
  dashboardQuery(
    { dataset: "devices", query: { all: [] }, groupBy: "platform" },
    "POST dashboard-query (pie platform)",
  ),
  dashboardQuery(
    {
      dataset: "devices",
      query: { all: [{ field: "health", op: "eq", value: "attention" }] },
      limit: 10,
    },
    "POST dashboard-query (table attention)",
  ),
  {
    name: "POST dashboard-query/batch (default)",
    method: "POST",
    path: `${tenant}/dashboard-query/batch`,
    body: {
      queries: [
        { dataset: "devices", query: { all: [] }, countOnly: true },
        {
          dataset: "devices",
          query: { all: [{ field: "health", op: "eq", value: "attention" }] },
          countOnly: true,
        },
        {
          dataset: "devices",
          query: { all: [{ field: "health", op: "eq", value: "critical" }] },
          countOnly: true,
        },
        {
          dataset: "devices",
          query: { all: [{ field: "health", op: "eq", value: "stale" }] },
          countOnly: true,
        },
        { dataset: "devices", query: { all: [] }, groupBy: "platform" },
        {
          dataset: "devices",
          query: { all: [{ field: "health", op: "eq", value: "attention" }] },
          limit: 10,
        },
      ],
    },
  },
];

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

const measure = async (scenario: Scenario) => {
  const times: number[] = [];
  const counts: number[] = [];

  for (let index = 0; index < warmup + runs; index += 1) {
    const usingProxy = (await proxy("/reset", "POST")).queries !== undefined;
    const before = usingProxy ? undefined : await globalQuestions();
    const started = performance.now();

    const response = await fetch(`${baseUrl}${scenario.path}`, {
      method: scenario.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(scenario.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: scenario.body === undefined ? undefined : JSON.stringify(scenario.body),
    });
    const body = await response.text();
    const duration = performance.now() - started;

    if (!response.ok)
      throw new Error(`${scenario.name} failed (${response.status}): ${body.slice(0, 400)}`);

    if (index < warmup) continue;

    times.push(duration);

    if (usingProxy) {
      const stats = await proxy("/stats");
      counts.push(stats.queries ?? 0);
    } else {
      const after = await globalQuestions();

      if (before !== undefined && after !== undefined)
        // Subtracting the two SHOW STATUS statements keeps the reported count
        // attributable to the request.
        counts.push(Math.max(0, after - before - 2));
    }
  }

  return {
    name: scenario.name,
    queries: counts.length ? Math.round(median(counts)) : undefined,
    ms: Number(median(times).toFixed(1)),
    minMs: Number(Math.min(...times).toFixed(1)),
    maxMs: Number(Math.max(...times).toFixed(1)),
  };
};

try {
  if (reseed) {
    console.log("Seeding benchmark tenant…");
    await seed();
    console.log(`Seeded tenant ${organizationId} (${organizationSlug}).`);
  }

  const health = await fetch(`${baseUrl}/api/health`).catch(() => undefined);

  if (!health?.ok) throw new Error(`API is not reachable at ${baseUrl}`);

  const results: Array<Awaited<ReturnType<typeof measure>>> = [];

  for (const scenario of scenarios) {
    const result = await measure(scenario);

    results.push(result);
    console.log(
      `${result.name.padEnd(44)} ${String(result.queries ?? "?").padStart(4)} queries ${String(
        result.ms,
      ).padStart(8)} ms`,
    );
  }

  const pageNames = new Set([
    "GET /v1/tenants/:id",
    "GET /device-health",
    "GET /v1/tenants/:id/dashboards",
    "POST dashboard-query (count all)",
    "POST dashboard-query (count attention)",
    "POST dashboard-query (pie platform)",
    "POST dashboard-query (table attention)",
  ]);
  const page = results.filter((result) => pageNames.has(result.name));

  const batchPageNames = new Set([
    "GET /v1/tenants/:id",
    "GET /device-health",
    "GET /v1/tenants/:id/dashboards",
    "POST dashboard-query/batch (default)",
  ]);
  const batchPage = results.filter((result) => batchPageNames.has(result.name));

  const payload = {
    label,
    baseUrl,
    latency: (await proxy("/stats")).queries === undefined ? "uninstrumented" : controlUrl,
    runs,
    generatedAt: new Date().toISOString(),
    results,
    overviewPage: {
      requests: page.length,
      queriesSerial: page.reduce((total, result) => total + (result.queries ?? 0), 0),
      msSerial: Number(page.reduce((total, result) => total + result.ms, 0).toFixed(1)),
      msParallelApprox: Number(Math.max(...page.map((result) => result.ms)).toFixed(1)),
    },
    overviewPageWithBatch: {
      requests: batchPage.length,
      queriesSerial: batchPage.reduce((total, result) => total + (result.queries ?? 0), 0),
      msSerial: Number(batchPage.reduce((total, result) => total + result.ms, 0).toFixed(1)),
      msParallelApprox: Number(Math.max(...batchPage.map((result) => result.ms)).toFixed(1)),
    },
  };

  console.log(
    `\nOverview page: ${page.length} requests, ${payload.overviewPage.queriesSerial} queries, ` +
      `${payload.overviewPage.msSerial} ms serial (${payload.overviewPage.msParallelApprox} ms if fully parallel)`,
  );
  console.log(
    `Overview page (batched widgets): ${batchPage.length} requests, ` +
      `${payload.overviewPageWithBatch.queriesSerial} queries, ` +
      `${payload.overviewPageWithBatch.msSerial} ms serial (${payload.overviewPageWithBatch.msParallelApprox} ms if fully parallel)`,
  );

  if (outFile) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");

    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Wrote ${outFile}`);
  }
} finally {
  if (cleanup) {
    await cleanupTenant();
    console.log("Removed the benchmark tenant.");
  }

  await connection.end();
}
