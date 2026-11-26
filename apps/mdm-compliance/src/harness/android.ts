import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { FetchHttpClient } from "effect/http";
import {
  AndroidManagement,
  base64UrlEncode,
  PubSubOidcVerifier,
  PubSubOidcVerifierLive,
} from "@mattrax/dm-android";
import type {
  AndroidManagementService,
  CreateEnterpriseInput,
  PubSubOidcClaims,
  PubSubOidcVerifierConfig,
} from "@mattrax/dm-android";
import { Db, schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { createAndroidSignup, handleAndroidPubSub } from "@mattrax/enterprise-backend";
import type { AndroidDeliveryConfig, AndroidPubSubResult } from "@mattrax/enterprise-backend";
import { androidRoutes } from "@mattrax/enterprise-api";

type RowValue = string | number | boolean | Date | null | undefined | RowValue[] | Row;

interface Row {
  [key: string]: RowValue;
}

interface DrizzleTable {
  readonly __table?: never;
}

function isDrizzleTable(value: unknown): value is DrizzleTable {
  if (typeof value !== "object" || value === null) return false;

  return Object.getOwnPropertySymbols(value).some(
    (symbol) => symbol.description === "drizzle:Name",
  );
}

const tableName = (table: DrizzleTable): string => {
  const symbol = Object.getOwnPropertySymbols(table).find(
    (candidate) => candidate.description === "drizzle:Name",
  );

  if (!symbol) throw new Error("Drizzle table has no drizzle:Name symbol");

  const name: unknown = Object.getOwnPropertyDescriptor(table, symbol)?.value;

  if (!Schema.is(Schema.String)(name)) throw new Error("Drizzle table name is not a string");

  return name;
};

const matches = (row: Row, where: Schema.JsonObject | undefined): boolean => {
  if (!where) return true;

  return Object.entries(where).every(([key, value]) =>
    value === undefined ? true : row[key] === value,
  );
};

class EmptySelect implements Iterable<Effect.Effect<Row[]>> {
  from(): this {
    return this;
  }
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  offset(): this {
    return this;
  }
  innerJoin(): this {
    return this;
  }
  pipe<T>(operator: (value: Effect.Effect<Row[]>) => T): T {
    return operator(Effect.succeed([]));
  }
  [Symbol.iterator](): Iterator<Effect.Effect<Row[]>> {
    return Effect.succeed([])[Symbol.iterator]();
  }
}

class FakeInsert implements Iterable<Effect.Effect<Row[]>> {
  readonly rows: Row[] = [];
  constructor(
    private readonly store: Record<string, Row[]>,
    private readonly table: string,
  ) {}
  values(value: Row | Row[]): this {
    this.rows.push(...(Array.isArray(value) ? value : [value]));

    for (const row of this.rows) this.store[this.table].push({ ...row });

    return this;
  }
  ignore(): this {
    return this;
  }
  onConflictDoNothing(): this {
    return this;
  }
  onDuplicateKeyUpdate(): this {
    return this;
  }
  [Symbol.iterator](): Iterator<Effect.Effect<Row[]>> {
    return Effect.succeed(this.rows)[Symbol.iterator]();
  }
}

class FakeUpdate implements Iterable<Effect.Effect<Row[]>> {
  private patch: Row = {};
  constructor(
    private readonly store: Record<string, Row[]>,
    private readonly table: string,
  ) {}
  set(value: Row): this {
    this.patch = value;

    return this;
  }
  where(): this {
    for (const row of this.store[this.table]) Object.assign(row, this.patch);

    return this;
  }
  [Symbol.iterator](): Iterator<Effect.Effect<Row[]>> {
    return Effect.succeed([])[Symbol.iterator]();
  }
}

class FakeDelete implements Iterable<Effect.Effect<Row[]>> {
  constructor(
    private readonly store: Record<string, Row[]>,
    private readonly table: string,
  ) {}
  where(): this {
    this.store[this.table] = [];

    return this;
  }
  returning(): this {
    return this;
  }
  [Symbol.iterator](): Iterator<Effect.Effect<Row[]>> {
    return Effect.succeed([])[Symbol.iterator]();
  }
}

type FakeQuery = {
  readonly findFirst: (options?: {
    readonly where?: Schema.JsonObject;
  }) => Effect.Effect<Row | undefined>;
  readonly findMany: (options?: {
    readonly where?: Schema.JsonObject;
  }) => Effect.Effect<Array<Row>>;
};

export type FakeDb = {
  readonly store: Record<string, Row[]>;
  readonly query: Record<string, FakeQuery>;
  readonly insert: (table: DrizzleTable) => FakeInsert;
  readonly update: (table: DrizzleTable) => FakeUpdate;
  readonly delete: (table: DrizzleTable) => FakeDelete;
  readonly select: () => EmptySelect;
  readonly transaction: <T>(work: (tx: FakeDb) => T) => T;
};

export const createFakeDb = (seed: Record<string, Row[]> = {}): FakeDb => {
  const store: Record<string, Row[]> = {};

  for (const value of Object.values(schema)) {
    if (!isDrizzleTable(value)) continue;

    store[tableName(value)] = [];
  }

  for (const [table, rows] of Object.entries(seed)) store[table] = rows.map((row) => ({ ...row }));

  const query: Record<string, FakeQuery> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!isDrizzleTable(value)) continue;

    const table = tableName(value);

    query[key] = {
      findFirst: ({ where }: { where?: Schema.JsonObject } = {}) =>
        Effect.succeed(store[table].find((row) => matches(row, where))),
      findMany: ({ where }: { where?: Schema.JsonObject } = {}) =>
        Effect.succeed(store[table].filter((row) => matches(row, where))),
    };
  }

  const db: FakeDb = {
    store,
    query,
    insert: (table: DrizzleTable) => new FakeInsert(store, tableName(table)),
    update: (table: DrizzleTable) => new FakeUpdate(store, tableName(table)),
    delete: (table: DrizzleTable) => new FakeDelete(store, tableName(table)),
    select: () => new EmptySelect(),
    transaction: <T>(work: (tx: FakeDb) => T): T => work(db),
  };

  return db;
};

const coerceFakeDb = <T>(database: FakeDb): T => {
  // SAFETY: the fake implements the Drizzle query surface used by the Android delivery paths.
  return database as T;
};

const enterpriseDb = (database: FakeDb): EnterpriseDb => coerceFakeDb(database);

export type AndroidHarness = {
  readonly db: ReturnType<typeof createFakeDb>;
  readonly config: AndroidDeliveryConfig;
  readonly routeHandler: (request: Request) => Promise<Response>;
  readonly createSignup: (organization: {
    readonly id: string;
    readonly name: string;
  }) => Promise<{ url: string }>;
  readonly handlePubSub: (options: {
    readonly body: Schema.Json;
    readonly authorization?: string;
  }) => Promise<AndroidPubSubResult>;
  readonly signToken: (overrides?: Schema.JsonObject) => Promise<string>;
  readonly verifyOidc: (
    token: string,
    overrides?: Partial<PubSubOidcVerifierConfig>,
  ) => Promise<PubSubOidcClaims>;
  readonly pushBody: (
    data: Schema.Json,
    notificationType: string,
    messageId?: string,
  ) => Schema.Json;
  readonly calls: {
    signupUrls: Array<{ callbackUrl: string }>;
    enterprises: Array<CreateEnterpriseInput>;
    policies: Array<{ enterpriseName: string; policyId: string; policy: Schema.JsonObject }>;
    devices: Array<{ deviceName: string; policyName: string }>;
    commands: Array<{ deviceName: string; type: string }>;
    jwksRequests: number;
  };
};

const organizationId = "org-compliance";

const enterpriseName = "enterprises/LC123456";

const serviceAccountEmail = "android-compliance@test-project.iam.gserviceaccount.com";

const audience = "https://mdm.example.test/api/v1/android/pubsub";

const jwksUri = "https://keys.compliance.test/jwks";

const encoder = new TextEncoder();

const signJwt = async (
  privateKey: CryptoKey,
  overrides: Schema.JsonObject = {},
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "compliance" }));

  const payload = base64UrlEncode(
    JSON.stringify(
      Object.assign(
        {
          iss: "https://accounts.google.com",
          aud: audience,
          sub: "compliance",
          email: serviceAccountEmail,
          email_verified: true,
          iat: now - 5,
          exp: now + 600,
        },
        overrides,
      ),
    ),
  );

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const base64Json = (value: Schema.Json): string => {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

export const createAndroidHarness = async (): Promise<AndroidHarness> => {
  const algorithm: RsaHashedKeyGenParams = {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  };

  const keyPair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"] as const);

  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    kid: "compliance",
    alg: "RS256",
    use: "sig",
  };

  const jwksFetch: typeof globalThis.fetch = async () => {
    calls.jwksRequests++;

    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const jwksClient = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, jwksFetch)),
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
  );
  const verifierLayer = PubSubOidcVerifierLive({
    audience,
    serviceAccountEmail,
    jwksUri,
  }).pipe(Layer.provide(jwksClient));

  const config: AndroidDeliveryConfig = {
    serviceAccount: {
      clientEmail: serviceAccountEmail,
      privateKeyPem: "unused",
      projectId: "compliance-project",
    },
    pubsubTopic: "projects/compliance-project/topics/mattrax-android",
    pubsubSubscription: "projects/compliance-project/subscriptions/mattrax-android",
    pubsubAudience: audience,
    jwksUri,
  };

  const calls: AndroidHarness["calls"] = {
    signupUrls: [],
    enterprises: [],
    policies: [],
    devices: [],
    commands: [],
    jwksRequests: 0,
  };

  const androidService = AndroidManagement.of({
    createSignupUrl: (input) => {
      calls.signupUrls.push({ callbackUrl: input.callbackUrl });

      return Effect.succeed({
        name: "signupUrls/compliance",
        url: "https://android.example.test/signup",
      });
    },
    createEnterprise: (input) => {
      calls.enterprises.push(input);

      return Effect.succeed({ name: enterpriseName });
    },
    createEnrollmentToken: () =>
      Effect.succeed({
        name: `${enterpriseName}/enrollmentTokens/compliance`,
        value: "enrollment-token",
        qrCode: "https://android.example.test/qr",
      }),
    patchPolicy: (input) => {
      calls.policies.push({
        enterpriseName: input.enterpriseName,
        policyId: input.policyId,
        policy: input.policy,
      });

      return Effect.succeed(input.policy);
    },
    patchDevice: (input) => {
      calls.devices.push(input);

      return Effect.succeed({
        name: input.deviceName,
        policyName: `${input.deviceName.split("/devices/")[0]}/policies/${input.policyName}`,
      });
    },
    getEnterprise: () =>
      Effect.succeed({ name: "enterprises/compliance", enabledNotificationTypes: [] }),
    patchEnterprise: (input) =>
      Effect.succeed({
        name: "enterprises/compliance",
        enabledNotificationTypes: [...input.enabledNotificationTypes],
      }),
    deleteEnterprise: () => Effect.void,
    listPolicies: () => Effect.succeed({ policies: [] }),
    deletePolicy: () => Effect.void,
    listDevices: () => Effect.succeed({ devices: [] }),
    getDevice: (input) => Effect.succeed({ name: input.deviceName }),
    getOperation: (input) => Effect.succeed({ name: input.operationName }),
    issueCommand: (input) => {
      calls.commands.push({ deviceName: input.deviceName, type: input.type });

      return Effect.succeed({ operationName: `${enterpriseName}/operations/compliance` });
    },
    deleteDevice: () => Effect.void,
  } satisfies AndroidManagementService);

  const db = createFakeDb({
    android_enterprise: [
      {
        organizationId,
        enterpriseName,
        status: "active",
        signupUrl: null,
        signupState: null,
        pubsubTopic: config.pubsubTopic,
        pubsubSubscription: config.pubsubSubscription,
        serviceAccountEmail,
        lastError: null,
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    organization: [
      {
        id: organizationId,
        name: "Compliance Test",
        displayName: "Compliance Test",
        supportEmail: "support@example.test",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    android_device: [
      {
        deviceId: "device-1",
        organizationId,
        enterpriseName,
        deviceName: `${enterpriseName}/devices/device-1`,
        policyId: null,
        policyHash: null,
        state: "ACTIVE",
        lastError: null,
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });

  const handlePubSub = async (options: {
    readonly body: Schema.Json;
    readonly authorization?: string;
  }): Promise<AndroidPubSubResult> =>
    Effect.runPromise(
      handleAndroidPubSub({
        db: enterpriseDb(db),
        config,
        authSecret: "compliance-auth-secret",
        origin: "https://mdm.example.test",
        authorization: options.authorization,
        body: options.body,
      }).pipe(
        Effect.provideService(AndroidManagement, androidService),
        Effect.provide(verifierLayer),
      ),
    );

  const createSignup = async (organization: { id: string; name: string }) =>
    Effect.runPromise(
      createAndroidSignup({
        db: enterpriseDb(db),
        config,
        authSecret: "compliance-auth-secret",
        origin: "https://mdm.example.test",
        organization,
      }).pipe(Effect.provideService(AndroidManagement, androidService)),
    );

  const routeLayer = androidRoutes({
    origin: "https://mdm.example.test",
    authSecret: "compliance-auth-secret",
    config,
    jwksFetch,
  }).pipe(
    Layer.provideMerge(Layer.succeed(Db, enterpriseDb(db))),
    Layer.provideMerge(Layer.succeed(AndroidManagement, androidService)),
  );

  const { handler: routeHandler } = HttpRouter.toWebHandler(routeLayer, { disableLogger: true });

  return {
    db,
    config,
    routeHandler,
    createSignup,
    handlePubSub,
    signToken: (overrides = {}) => signJwt(keyPair.privateKey, overrides),
    verifyOidc: (token: string, overrides: Partial<PubSubOidcVerifierConfig> = {}) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const verifier = yield* PubSubOidcVerifier;

          return yield* verifier.verify(token);
        }).pipe(
          Effect.provide(
            PubSubOidcVerifierLive({
              audience,
              serviceAccountEmail,
              jwksUri,
              ...overrides,
            }).pipe(Layer.provide(jwksClient)),
          ),
        ),
      ),
    pushBody: (data, notificationType, messageId = "compliance-message-1") => ({
      message: {
        data: base64Json(data),
        attributes: { notificationType },
        messageId,
      },
      subscription:
        config.pubsubSubscription ?? "projects/compliance-project/subscriptions/mattrax-android",
    }),
    calls,
  };
};
