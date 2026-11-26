import { randomUUID } from "node:crypto";
import { MysqlClient } from "@effect/sql-mysql2";
import { Hooks } from "@yielded/auth";
import {
  KdfAdmission,
  PasswordHashing,
  defaultScryptPasswordHashingConfig,
} from "@yielded/auth/Password";
import * as PasswordScrypt from "@yielded/auth/PasswordScrypt";
import * as WebCrypto from "@yielded/auth/WebCrypto";
import {
  Database,
  makePasskeyRegistrationServices,
} from "@yielded/auth-persistence-drizzle/Mysql2";
import { Db, passkeyRegistrationMapping } from "@mattrax/enterprise-core";
import { PASSKEY_MODULE_ID, Registration } from "@mattrax/enterprise-domain";
import { Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect";
import mysql from "mysql2/promise";
import type { ConnectionOptions, RowDataPacket } from "mysql2/promise";
import * as Kdf from "effect/crypto/Kdf";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeAppAuth } from "../src/Account/auth.ts";

type MysqlFixture = {
  readonly connection: ConnectionOptions;
  readonly query: <T extends RowDataPacket[] = RowDataPacket[]>(
    sql: string,
    values?: unknown[],
  ) => Promise<T>;
  readonly dispose: () => Promise<void>;
};

const loopback = new Set(["localhost", "127.0.0.1", "::1"]);

const startMysqlFixture = async (): Promise<MysqlFixture> => {
  const configured = process.env.TEST_MYSQL_URL?.trim();

  if (!configured) throw new Error("TEST_MYSQL_URL is required");

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

  const statements = [
    `CREATE TABLE account (
      id varchar(255) PRIMARY KEY,
      name varchar(255) NOT NULL,
      email varchar(320) NOT NULL,
      email_verified boolean NOT NULL DEFAULT false,
      image text,
      default_tenant_id varchar(255),
      disabled boolean NOT NULL DEFAULT false,
      superadmin boolean NOT NULL DEFAULT false,
      source varchar(16) NOT NULL DEFAULT 'manual',
      totp_enabled boolean NOT NULL DEFAULT false,
      passkey_enabled boolean NOT NULL DEFAULT false,
      auth_revision varchar(64) NOT NULL,
      welcome_email_sent_at datetime(3),
      billing_entitlement_revision bigint NOT NULL DEFAULT 0,
      created_at datetime(3) NOT NULL,
      updated_at datetime(3) NOT NULL,
      CONSTRAINT account_email_unique UNIQUE (email)
    ) ENGINE=InnoDB`,
    `CREATE TABLE registration_verification (
      email varchar(320) PRIMARY KEY,
      name varchar(255) NOT NULL,
      code_hash varchar(128) NOT NULL,
      \`grant\` varchar(128) NOT NULL,
      attempts int NOT NULL DEFAULT 0,
      expires_at datetime(3) NOT NULL,
      verified_at datetime(3),
      created_at datetime(3) NOT NULL,
      updated_at datetime(3) NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE auth_credentials (
      credential_id varchar(191) NOT NULL,
      subject_id varchar(191) NOT NULL,
      revision text NOT NULL,
      active boolean NOT NULL,
      CONSTRAINT auth_credentials_key_0 UNIQUE (credential_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE auth_passkeyCredentials (
      credential_id varchar(191) PRIMARY KEY,
      subject_id text NOT NULL,
      rp_id text NOT NULL,
      protocol_credential_id text NOT NULL,
      credential_key varchar(191) NOT NULL,
      user_handle text NOT NULL,
      public_key text NOT NULL,
      algorithm bigint NOT NULL,
      profile text NOT NULL,
      credential_revision text NOT NULL,
      active boolean NOT NULL,
      primary_sign_in boolean NOT NULL,
      enrollment_user_verified boolean NOT NULL,
      backup_eligible boolean NOT NULL,
      backup_state boolean NOT NULL,
      counter bigint NOT NULL,
      name text NOT NULL,
      created_at bigint NOT NULL,
      last_used_at bigint,
      CONSTRAINT auth_passkeyCredentials_key_1 UNIQUE (credential_key)
    ) ENGINE=InnoDB`,
    `CREATE TABLE auth_passkeyFlows (
      module_id varchar(191) NOT NULL,
      flow_id varchar(191) NOT NULL,
      purpose text NOT NULL,
      snapshot text NOT NULL,
      application_snapshot text,
      request_binding_verifier text NOT NULL,
      request_binding_expires_at bigint NOT NULL,
      issued_at bigint NOT NULL,
      expires_at bigint NOT NULL,
      PRIMARY KEY (module_id, flow_id)
    ) ENGINE=InnoDB`,
  ];

  for (const statement of statements) await admin.query(statement);

  return {
    connection,
    query: async <T extends RowDataPacket[] = RowDataPacket[]>(
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

const origin = "https://mattrax.example.com";
const challenge = Buffer.alloc(32, 1).toString("base64url");
const userHandle = Buffer.alloc(16, 2).toString("base64url");
const protocolCredentialId = Buffer.alloc(32, 3).toString("base64url");
const publicKey = Buffer.alloc(65, 4).toString("base64url");
const bindingVerifier = Buffer.alloc(32, 5).toString("base64url");
const profile = {
  profileId: "default",
  rpId: "mattrax.example.com",
  rpName: "Mattrax",
  origins: [origin],
  developmentLocalhost: false,
  residentKey: "required",
  userVerification: "required",
  primarySignIn: true,
  attestation: "none",
  algorithms: [-7],
} as const;

const cryptoLayer = PasswordHashing.layer(defaultScryptPasswordHashingConfig).pipe(
  Layer.provideMerge(
    Layer.mergeAll(WebCrypto.layer, Kdf.layerWebCrypto, PasswordScrypt.layer, KdfAdmission.layer()),
  ),
);

const registration = (email = "ada@example.com", grant = "mailbox-proof") =>
  Schema.decodeUnknownSync(Registration)({ name: "Ada Lovelace", email, grant });

const seedGrant = async (
  fixture: MysqlFixture,
  overrides: Partial<{
    email: string;
    grant: string;
    verifiedAt: Date | null;
    expiresAt: Date;
  }> = {},
) => {
  const now = new Date();

  await fixture.query(
    `INSERT INTO registration_verification
      (email, name, code_hash, \`grant\`, attempts, expires_at, verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      overrides.email ?? "ada@example.com",
      "Ada Lovelace",
      "unused-code-hash",
      overrides.grant ?? "mailbox-proof",
      0,
      overrides.expiresAt ?? new Date(now.getTime() + 15 * 60 * 1000),
      overrides.verifiedAt === undefined ? now : overrides.verifiedAt,
      now,
      now,
    ],
  );
};

const seedAccount = async (fixture: MysqlFixture, email = "ada@example.com") => {
  const now = new Date();

  await fixture.query(
    `INSERT INTO account
      (id, name, email, email_verified, disabled, source, totp_enabled, passkey_enabled,
       auth_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "existing-account",
      "Existing",
      email,
      true,
      false,
      "manual",
      false,
      true,
      "existing-revision",
      now,
      now,
    ],
  );
};

describe.skipIf(!process.env.TEST_MYSQL_URL)("registration grants on disposable MySQL", () => {
  let fixture: MysqlFixture;
  let runtime: ManagedRuntime.ManagedRuntime<any, never>;
  let authorityTag: any;
  let authority: any;

  beforeAll(async () => {
    fixture = await startMysqlFixture();
    const database = MysqlClient.layer({
      host: fixture.connection.host,
      port: fixture.connection.port,
      username: fixture.connection.user!,
      password: Redacted.make(fixture.connection.password ?? ""),
      database: fixture.connection.database!,
      poolConfig: { timezone: "Z" },
      disablePreparedStatements: true,
    });
    const appAuth = makeAppAuth(origin);
    authorityTag = appAuth.strategies.registration.RegistrationAuthority;
    runtime = ManagedRuntime.make(
      Layer.effect(
        authorityTag,
        Effect.map(
          makePasskeyRegistrationServices(passkeyRegistrationMapping),
          (services) => services.passkeyRegistrationAuthority,
        ),
      ).pipe(
        Layer.provide(
          Layer.effect(
            Database,
            Effect.map(Db, (db) => db as Database["Service"]),
          ),
        ),
        Layer.provide(cryptoLayer),
        Layer.provide(Hooks.LifecycleHooks.empty),
        Layer.provide(Db.layer.pipe(Layer.provide(database))),
        Layer.orDie,
      ),
    );
    authority = await runtime.runPromise(authorityTag);
  });

  beforeEach(async () => {
    await fixture.query("DELETE FROM auth_passkeyCredentials");
    await fixture.query("DELETE FROM auth_credentials");
    await fixture.query("DELETE FROM auth_passkeyFlows");
    await fixture.query("DELETE FROM account");
    await fixture.query("DELETE FROM registration_verification");
  });

  afterAll(async () => {
    await runtime?.dispose();
    await fixture?.dispose();
  });

  const issue = async (value: typeof Registration.Type, suffix = "1") => {
    const inspected = await Effect.runPromise(authority.inspect(value) as Effect.Effect<any, any>);
    expect(inspected.eligible).toBe(true);

    const now = Date.now();
    const ceremony = {
      moduleId: PASSKEY_MODULE_ID,
      flowId: `flow-${suffix}`,
      commandId: `command-${suffix}`,
      purpose: "registration",
      profile,
      challenge,
      requestBindingVerifier: bindingVerifier,
      requestBindingExpiresAtMillis: now + 60_000,
      issuedAtMillis: now,
      expiresAtMillis: now + 60_000,
      allowedCredentials: [],
      context: {
        _tag: "Registration",
        fingerprint: inspected.fingerprint,
        userHandle,
        name: inspected.name,
        displayName: inspected.displayName,
      },
    };
    const access = {
      moduleId: ceremony.moduleId,
      purpose: ceremony.purpose,
      flowId: ceremony.flowId,
      requestBindingVerifier: ceremony.requestBindingVerifier,
      requestBindingExpiresAtMillis: ceremony.requestBindingExpiresAtMillis,
    };
    const prepared = await Effect.runPromise(
      authority.issueRegistration(
        { ceremony, registration: value },
        (decision: unknown, journal: Hooks.CommitJournal) => journal.prepare(decision),
      ) as Effect.Effect<any, any>,
    );

    expect(await Effect.runPromise(prepared.read)).toMatchObject({ _tag: "Issued" });
    return { ceremony, access };
  };

  const complete = async (ceremony: any, access: any) => {
    const prepared = await Effect.runPromise(
      authority.completeRegistration(
        {
          ceremony,
          access,
          verified: {
            protocolCredentialId,
            publicKey,
            algorithm: -7,
            userVerified: true,
            backupEligible: false,
            backupState: false,
            counter: 0,
          },
        },
        (decision: unknown, journal: Hooks.CommitJournal) => journal.prepare(decision),
      ) as Effect.Effect<any, any>,
    );

    return Effect.runPromise(prepared.read);
  };

  it.each([
    ["missing", async () => undefined],
    [
      "expired",
      async (target: MysqlFixture) =>
        seedGrant(target, { expiresAt: new Date(Date.now() - 1_000) }),
    ],
    ["unverified", async (target: MysqlFixture) => seedGrant(target, { verifiedAt: null })],
    [
      "mismatched grant",
      async (target: MysqlFixture) => seedGrant(target, { grant: "another-grant" }),
    ],
    [
      "mismatched email",
      async (target: MysqlFixture) => seedGrant(target, { email: "other@example.com" }),
    ],
  ])("rejects %s grants at eligibility", async (_label, seed) => {
    await seed(fixture);

    expect(await Effect.runPromise(authority.inspect(registration()))).toMatchObject({
      eligible: false,
    });
    expect(await fixture.query<RowDataPacket[]>("SELECT * FROM account")).toHaveLength(0);
  });

  it("rejects an existing email even when its grant is live", async () => {
    await seedGrant(fixture);
    await seedAccount(fixture);

    expect(await Effect.runPromise(authority.inspect(registration()))).toMatchObject({
      eligible: false,
    });
  });

  it("creates a verified passkey account for the normalized email grant", async () => {
    await seedGrant(fixture);
    const value = registration("  ADA@Example.COM ");
    const { ceremony, access } = await issue(value);

    expect(await complete(ceremony, access)).toMatchObject({ _tag: "RegistrationAccepted" });

    const [account] = await fixture.query<RowDataPacket[]>("SELECT * FROM account");
    expect(account).toMatchObject({
      email: "ada@example.com",
      email_verified: 1,
      disabled: 0,
      passkey_enabled: 1,
    });
    expect(
      await fixture.query<RowDataPacket[]>("SELECT * FROM auth_passkeyCredentials"),
    ).toHaveLength(1);
    expect(await Effect.runPromise(authority.inspect(value))).toMatchObject({ eligible: false });
    expect(await complete(ceremony, access)).toMatchObject({ _tag: "Rejected" });
  });

  it.each([
    [
      "expired",
      "UPDATE registration_verification SET expires_at = CURRENT_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE email = NEW.email",
    ],
    [
      "unverified",
      "UPDATE registration_verification SET verified_at = NULL WHERE email = NEW.email",
    ],
    [
      "mismatched grant",
      "UPDATE registration_verification SET `grant` = 'another-grant' WHERE email = NEW.email",
    ],
    [
      "mismatched email",
      "UPDATE registration_verification SET email = 'other@example.com' WHERE email = NEW.email",
    ],
    ["missing", "DELETE FROM registration_verification WHERE email = NEW.email"],
  ])("rechecks %s grants at final persistence", async (_label, sql) => {
    await seedGrant(fixture);
    const { ceremony, access } = await issue(registration());
    await fixture.query(
      `CREATE TRIGGER invalidate_registration_grant AFTER INSERT ON account FOR EACH ROW ${sql}`,
    );

    try {
      await expect(complete(ceremony, access)).rejects.toMatchObject({
        _tag: "PasskeyUnavailable",
      });
    } finally {
      await fixture.query("DROP TRIGGER IF EXISTS invalidate_registration_grant");
    }

    expect(await fixture.query<RowDataPacket[]>("SELECT * FROM account")).toHaveLength(0);
    expect(
      await fixture.query<RowDataPacket[]>("SELECT * FROM auth_passkeyCredentials"),
    ).toHaveLength(0);
    expect(await fixture.query<RowDataPacket[]>("SELECT * FROM auth_credentials")).toHaveLength(0);
    expect(await fixture.query<RowDataPacket[]>("SELECT * FROM auth_passkeyFlows")).toHaveLength(1);
  });
});
