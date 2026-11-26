import { randomUUID } from "node:crypto";
import { Redacted } from "effect";
import mysql from "mysql2/promise";
import type { ConnectionOptions } from "mysql2/promise";

/**
 * Opt-in real-MySQL fixture. TEST_MYSQL_URL must point at a disposable local
 * server (loopback only); the user needs CREATE/DROP DATABASE privileges. Each
 * suite gets a uniquely named database that is dropped in afterAll.
 */
export type MysqlFixture = {
  readonly database: string;
  readonly connection: ConnectionOptions;
  readonly query: <T extends mysql.RowDataPacket[] = mysql.RowDataPacket[]>(
    sql: string,
    values?: unknown[],
  ) => Promise<T>;
  readonly dispose: () => Promise<void>;
};

const loopback = new Set(["localhost", "127.0.0.1", "::1"]);

export const startMysqlFixture = async (): Promise<MysqlFixture | undefined> => {
  const configured = process.env.TEST_MYSQL_URL?.trim();

  if (!configured) return undefined;

  const url = new URL(configured);

  if (url.protocol !== "mysql:" || !loopback.has(url.hostname))
    throw new Error("TEST_MYSQL_URL must use mysql: on a loopback host");

  const database = `security_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const connection: ConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    timezone: "Z",
  };
  const admin = await mysql.createConnection({ ...connection, database: undefined });

  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  await admin.query(`USE \`${database}\``);

  await admin.query(`CREATE TABLE step_up_totp_state (
    subject_id varchar(255) PRIMARY KEY,
    last_accepted_step int NOT NULL DEFAULT 0,
    failures int NOT NULL DEFAULT 0,
    locked_until datetime(3),
    updated_at datetime(3) NOT NULL
  ) ENGINE=InnoDB`);

  await admin.query(`CREATE TABLE organization (
    id varchar(255) PRIMARY KEY,
    billing_plan varchar(255),
    billing_status varchar(32),
    billing_entitlement_revision bigint NOT NULL DEFAULT 0,
    updated_at datetime(3) NOT NULL
  ) ENGINE=InnoDB`);

  await admin.query(`CREATE TABLE services_tenant (
    id varchar(255) PRIMARY KEY,
    name varchar(255) NOT NULL,
    stripe_customer_id varchar(255),
    entitlement_synced_at datetime(3),
    created_at datetime(3) NOT NULL,
    updated_at datetime(3) NOT NULL,
    CONSTRAINT services_tenant_customer_unique UNIQUE (stripe_customer_id)
  ) ENGINE=InnoDB`);

  await admin.query(`CREATE TABLE services_subscription (
    id varchar(255) PRIMARY KEY,
    plan varchar(255) NOT NULL,
    tenant_id varchar(255) NOT NULL,
    stripe_customer_id varchar(255),
    stripe_subscription_id varchar(255),
    status varchar(32) NOT NULL,
    entitlement_revision bigint NOT NULL DEFAULT 0,
    period_start datetime(3),
    period_end datetime(3),
    cancel_at_period_end boolean,
    created_at datetime(3) NOT NULL,
    updated_at datetime(3) NOT NULL,
    CONSTRAINT services_subscription_tenant_unique UNIQUE (tenant_id),
    CONSTRAINT services_subscription_stripe_unique UNIQUE (stripe_subscription_id)
  ) ENGINE=InnoDB`);

  await admin.query(`CREATE TABLE services_stripe_event (
    id varchar(255) PRIMARY KEY,
    type varchar(255) NOT NULL,
    tenant_id varchar(255),
    license_id varchar(255),
    received_at datetime(3) NOT NULL
  ) ENGINE=InnoDB`);

  await admin.query(`CREATE TABLE services_deployment_license (
    id varchar(255) PRIMARY KEY,
    name varchar(255) NOT NULL,
    license_key_hash varchar(255) NOT NULL,
    license_key_prefix varchar(255) NOT NULL,
    origin varchar(255),
    contact_email varchar(320),
    stripe_customer_id varchar(255),
    stripe_subscription_id varchar(255),
    plan varchar(255) NOT NULL DEFAULT 'device',
    status varchar(32),
    device_count int NOT NULL DEFAULT 0,
    tenant_count int NOT NULL DEFAULT 0,
    period_end datetime(3),
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    last_seen_at datetime(3),
    created_at datetime(3) NOT NULL,
    updated_at datetime(3) NOT NULL
  ) ENGINE=InnoDB`);

  return {
    database,
    connection,
    query: async <T extends mysql.RowDataPacket[] = mysql.RowDataPacket[]>(
      sql: string,
      values?: unknown[],
    ): Promise<T> => {
      const [rows] = await admin.query(sql, values);
      return rows as T;
    },
    dispose: async () => {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.end();
    },
  };
};

/** Options accepted by the Effect MySQL client layer used by production. */
export const effectMysqlOptions = (connection: ConnectionOptions) => ({
  host: connection.host,
  port: connection.port,
  username: connection.user!,
  password: Redacted.make(connection.password ?? ""),
  database: connection.database!,
  poolConfig: { timezone: "Z" },
  disablePreparedStatements: true,
});
