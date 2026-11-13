import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import {
  AndroidManagement,
  base64UrlEncode,
  clearJwksCache,
  verifyPubSubOidcToken,
  type AndroidManagementShape,
  type PubSubOidcClaims,
  type PubSubOidcVerifierConfig,
} from "@mattrax/dm-android";
import { Db, schema, type EnterpriseDb } from "@mattrax/enterprise-core";
import {
  androidRoutes,
  createAndroidSignup,
  handleAndroidPubSub,
  type AndroidDeliveryConfig,
  type AndroidPubSubResult,
} from "@mattrax/enterprise-backend";

type Row = Record<string, any>;

const tableName = (table: any): string => {
  const symbol = Object.getOwnPropertySymbols(table).find(
    (candidate) => candidate.description === "drizzle:Name",
  );

  return table?.[symbol!] as string;
};

const matches = (row: Row, where: unknown): boolean => {
  if (!where || typeof where !== "object") return true;

  return Object.entries(where as Record<string, unknown>).every(([key, value]) =>
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

    for (const row of this.rows) this.store[this.table]!.push({ ...row });

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
    for (const row of this.store[this.table]!) Object.assign(row, this.patch);

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

export const createFakeDb = (seed: Record<string, Row[]> = {}) => {
  const store: Record<string, Row[]> = Object.fromEntries(
    Object.keys(schema).map((key) => [tableName((schema as any)[key]), []]),
  );

  for (const [table, rows] of Object.entries(seed)) store[table] = rows.map((row) => ({ ...row }));

  const query = Object.fromEntries(
    Object.keys(schema).map((key) => {
      const table = tableName((schema as any)[key]);

      return [
        key,
        {
          findFirst: ({ where }: { where?: unknown } = {}) =>
            Effect.succeed(store[table]!.find((row) => matches(row, where))),
          findMany: ({ where }: { where?: unknown } = {}) =>
            Effect.succeed(store[table]!.filter((row) => matches(row, where))),
        },
      ];
    }),
  );

  const db = {
    store,
    query,
    insert: (table: any) => new FakeInsert(store, tableName(table)),
    update: (table: any) => new FakeUpdate(store, tableName(table)),
    delete: (table: any) => new FakeDelete(store, tableName(table)),
    select: () => new EmptySelect(),
    transaction: (work: (tx: unknown) => unknown) => work(db),
  };

  return db;
};

export type AndroidHarness = {
  readonly db: ReturnType<typeof createFakeDb>;
  readonly config: AndroidDeliveryConfig;
  readonly routeHandler: (request: Request) => Promise<Response>;
  readonly createSignup: (organization: {
    readonly id: string;
    readonly name: string;
  }) => Promise<{ url: string }>;
  readonly handlePubSub: (options: {
    readonly body: unknown;
    readonly authorization?: string;
  }) => Promise<AndroidPubSubResult>;
  readonly signToken: (overrides?: Record<string, unknown>) => Promise<string>;
  readonly verifyOidc: (
    token: string,
    overrides?: Partial<PubSubOidcVerifierConfig>,
  ) => Promise<PubSubOidcClaims>;
  readonly pushBody: (data: unknown, notificationType: string, messageId?: string) => unknown;
  readonly calls: {
    signupUrls: Array<{ callbackUrl: string }>;
    enterprises: Array<Record<string, unknown>>;
    policies: Array<{ enterpriseName: string; policyId: string; policy: Record<string, unknown> }>;
    devices: Array<{ deviceName: string; policyName: string }>;
    commands: Array<{ deviceName: string; type: string }>;
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
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "compliance" }));

  const payload = base64UrlEncode(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "compliance",
      email: serviceAccountEmail,
      email_verified: true,
      iat: now - 5,
      exp: now + 600,
      ...overrides,
    }),
  );

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const base64Json = (value: unknown): string => {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

export const createAndroidHarness = async (): Promise<AndroidHarness> => {
  clearJwksCache();

  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    kid: "compliance",
    alg: "RS256",
    use: "sig",
  };

  const jwksFetch = (async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;

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
      calls.enterprises.push(input as unknown as Record<string, unknown>);

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
    listDevices: () => Effect.succeed({ devices: [] }),
    issueCommand: (input) => {
      calls.commands.push({ deviceName: input.deviceName, type: input.type });

      return Effect.succeed({ operationName: `${enterpriseName}/operations/compliance` });
    },
    deleteDevice: () => Effect.void,
  } satisfies AndroidManagementShape);

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
    readonly body: unknown;
    readonly authorization?: string;
  }): Promise<AndroidPubSubResult> =>
    Effect.runPromise(
      handleAndroidPubSub({
        db: db as unknown as EnterpriseDb,
        config,
        authSecret: "compliance-auth-secret",
        origin: "https://mdm.example.test",
        authorization: options.authorization,
        body: options.body,
        fetch: jwksFetch,
        now: () => Date.now(),
      }).pipe(Effect.provideService(AndroidManagement, androidService)),
    );

  const createSignup = async (organization: { id: string; name: string }) =>
    Effect.runPromise(
      createAndroidSignup({
        db: db as unknown as EnterpriseDb,
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
  }).pipe(
    Layer.provideMerge(Layer.succeed(Db, db as unknown as EnterpriseDb)),
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
        verifyPubSubOidcToken(token, {
          audience,
          serviceAccountEmail,
          jwksUri,
          fetch: jwksFetch,
          ...overrides,
        }),
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
